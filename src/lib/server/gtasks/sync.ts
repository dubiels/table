import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, googleTaskTombstones, syncState } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { nextSortOrder } from '../tasks/service';
import {
	listTasks,
	insertTask,
	patchTask,
	deleteTask,
	toGoogleDue,
	fromGoogleDue,
	type GoogleTask
} from './client';
import { planGoogleTaskSync, type PlanGoogleTask } from './plan';

const LAST_SYNC_KEY = 'gtasks:lastSyncAt';
/** Absorbs clock drift between Table and Google when filtering by updatedMin. */
const SKEW_MS = 5 * 60 * 1000;

export interface GoogleTaskSyncResult {
	ok: boolean;
	imported: number;
	updatedLocally: number;
	deletedLocally: number;
	pushed: number;
	deletedRemotely: number;
	failed: number;
}

const EMPTY: GoogleTaskSyncResult = {
	ok: false,
	imported: 0,
	updatedLocally: 0,
	deletedLocally: 0,
	pushed: 0,
	deletedRemotely: 0,
	failed: 0
};

/**
 * Both halves matter: the flag is the deliberate switch, and the refresh token
 * is what any call would actually need. Missing either means every part of the
 * feature stays dark rather than erroring per request.
 */
export function isGoogleTasksEnabled(): boolean {
	return env.GTASKS_ENABLED === 'true' && Boolean(env.GCAL_REFRESH_TOKEN);
}

export async function readSyncState(key: string): Promise<string | null> {
	const row = await db.query.syncState.findFirst({ where: eq(syncState.key, key) });
	return row?.value ?? null;
}

export async function writeSyncState(key: string, value: string): Promise<void> {
	await db
		.insert(syncState)
		.values({ key, value })
		.onConflictDoUpdate({ target: syncState.key, set: { value } });
}

/** Google's wire shape in Table's vocabulary, so the planner never sees RFC 3339. */
function toPlanGoogleTask(g: GoogleTask): PlanGoogleTask {
	return {
		id: g.id,
		title: g.title ?? '',
		notes: g.notes ?? null,
		plannedDate: fromGoogleDue(g.due),
		done: g.status === 'completed',
		completedAt: g.completed ?? null,
		updated: g.updated,
		deleted: g.deleted === true
	};
}

/**
 * The tail of the queue every Google-touching operation runs on: reconcile
 * rounds and the write-through pushes alike. Nothing here ever runs two of them
 * at once, so a push can never race a round against the same rows.
 *
 * A module-level promise is the whole mechanism, and that is enough here: the
 * deployment is one always-on machine whose scheduler runs in this very
 * process, so all four entry points — cron, the manual route, the board's load,
 * the write-through push — are in this module's realm. It holds no state worth
 * surviving a restart either: a round cut short by one replans from the same
 * cursor, since the cursor is written last.
 */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * The round a later caller can join, and whether it is (or, once it starts,
 * will be) a full fetch. Cleared when that round settles.
 */
let pendingRound: { full: boolean; promise: Promise<GoogleTaskSyncResult> } | null = null;

/**
 * Runs `work` once everything already queued has finished.
 *
 * Both callbacks are the same on purpose: a failed predecessor must not cancel
 * its successor, and the tail is kept settled so it never rejects unhandled.
 */
export function withGoogleTasksLock<T>(work: () => Promise<T>): Promise<T> {
	const run = queueTail.then(work, work);
	queueTail = run.then(
		() => {},
		() => {}
	);
	return run;
}

/**
 * Runs `work` under the same lock as `withGoogleTasksLock`, but gives up
 * waiting for it after `budgetMs` instead of joining the queue behind
 * however much is ahead of it.
 *
 * A sync round is bounded per Google call (each has its own timeout) but not
 * in how many calls it makes — a board with many dirty tasks makes many of
 * them, one after another. Joining the queue unconditionally means waiting
 * for the whole round to drain, which is exactly the blocking-on-Google this
 * module exists to spare a live request from.
 *
 * Resolves to `undefined` on giving up, and that is the whole point: `work`
 * is never run in that case, not now and not once the lock frees up later.
 * Whatever state `work` would have changed is left for its caller to recover
 * some other way (`pushTaskNow`'s caller has a dirty row the next reconcile
 * will retry) rather than this function queuing a delayed copy of the call.
 */
export function withGoogleTasksLockWithin<T>(
	budgetMs: number,
	work: () => Promise<T>
): Promise<T | undefined> {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(undefined);
		}, budgetMs);
		// A ref'd timer would hold the process open for the whole budget even
		// after the request that started this wait has otherwise finished.
		timer.unref?.();

		// Riding the existing tail rather than calling withGoogleTasksLock up
		// front: that would enqueue `work` unconditionally, so an abandoned wait
		// would still run it once the queue got there. `settled` is what makes
		// giving up actually mean `work` never runs.
		//
		// queueTail never rejects (see above), so the second handler here is
		// unreachable in practice; it exists only so a future change to that
		// invariant fails safe instead of leaving this wait unsettled forever.
		queueTail.then(
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(withGoogleTasksLock(work));
			},
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(withGoogleTasksLock(work));
			}
		);
	});
}

/**
 * One reconcile round, or the one already running.
 *
 * `full: true` skips the `updatedMin` filter and lets the planner act on a
 * linked task's absence. Periodic runs are incremental so a lifetime of
 * completed tasks is not re-fetched every few minutes; the manual refresh and
 * the very first run are full.
 *
 * Concurrent callers join rather than start a second round. They must: the
 * cursor is only written at the end, so while a slow round is in flight every
 * other entry point still reads the state as stale — and the board's load in
 * particular bounds how long the *request* waits, not how long the round runs.
 * Two rounds over the same snapshot each plan a `createInGoogle` for the same
 * opted-in-but-unpushed task (the state a failed push leaves behind and retries
 * forever), `markPushed` keeps only the last `googleTaskId`, and the rest are
 * live in Google with nothing pointing at them — which the next full fetch
 * imports back as fresh cards. Reloading the board would breed duplicates.
 *
 * A caller that asked for a full fetch is never handed an incremental round:
 * the manual refresh means "look at everything now", and answering it with
 * whatever happened to be running would make the button a lie. Such a call
 * queues its own full round behind the one in flight instead. The reverse is
 * fine and does join — a full fetch's window contains the incremental one's.
 *
 * Never throws, and this wrapper is what makes that true rather than aspirational.
 * The round's own guards handle the expected failures — an unreachable Google,
 * one task Google refuses — and this one catches the rest: a locked or failing
 * database during the local phase, which is systemic rather than per-task. Such
 * a round reports `ok: false` and, because the sync cursor is written last, the
 * next round replans the same work from the same window.
 */
export function syncGoogleTasks(options?: { full?: boolean }): Promise<GoogleTaskSyncResult> {
	const full = options?.full === true;
	if (pendingRound && (pendingRound.full || !full)) return pendingRound.promise;

	const entry = { full, promise: withGoogleTasksLock(() => guardedRound({ full })) };
	// Set before the queued work can start — `withGoogleTasksLock` only schedules
	// it — so a caller arriving in the meantime joins this round rather than
	// queueing another.
	pendingRound = entry;
	const clear = () => {
		if (pendingRound === entry) pendingRound = null;
	};
	entry.promise.then(clear, clear);
	return entry.promise;
}

async function guardedRound(options: { full: boolean }): Promise<GoogleTaskSyncResult> {
	try {
		return await runSyncRound(options);
	} catch (err) {
		console.error('gtasks: sync round failed, leaving the cursor where it was', err);
		return { ...EMPTY };
	}
}

async function runSyncRound(options?: { full?: boolean }): Promise<GoogleTaskSyncResult> {
	if (!isGoogleTasksEnabled()) return { ...EMPTY };

	const lastSyncAt = await readSyncState(LAST_SYNC_KEY);
	const lastSyncMs = lastSyncAt === null ? Number.NaN : Date.parse(lastSyncAt);
	if (lastSyncAt !== null && Number.isNaN(lastSyncMs)) {
		// A corrupt cursor must not be able to kill sync outright: `new Date(NaN)`
		// throws on `toISOString`, and inside the fetch guard below that would be
		// logged as a Google failure, round after round, forever. A full fetch is
		// the safe reading of "we don't know how far we got", and the round ends
		// by writing a well-formed cursor again.
		console.warn(
			`gtasks: ignoring unparseable ${LAST_SYNC_KEY} (${lastSyncAt}); doing a full fetch`
		);
	}
	const full = options?.full === true || Number.isNaN(lastSyncMs);

	let token: string;
	let googleRows: GoogleTask[];
	try {
		token = await getAccessToken();
		googleRows = await listTasks(token, {
			updatedMin: full ? undefined : new Date(lastSyncMs - SKEW_MS).toISOString()
		});
	} catch (err) {
		console.error('gtasks: fetch failed, keeping local state', err);
		return { ...EMPTY };
	}

	const [tableRows, tombstoneRows] = await Promise.all([
		db.query.tasks.findMany(),
		db.query.googleTaskTombstones.findMany()
	]);

	// The version of each task the plan is computed from, and so the version any
	// push in this round actually sends and any patchInTable's conflict
	// resolution was decided against. `markPushed` records this rather than
	// re-reading `updatedAt` afterwards, and the patchInTable loop below writes
	// only if the row is still at this version: either way, an edit made while
	// this round's network calls were in flight must not be stamped as already
	// synced, or it would never sync.
	const sentUpdatedAt = new Map(tableRows.map((t) => [t.id, t.updatedAt]));

	const plan = planGoogleTaskSync({
		tableTasks: tableRows.map((t) => ({
			id: t.id,
			title: t.title,
			notes: t.notes,
			plannedDate: t.plannedDate,
			done: t.done,
			completedAt: t.completedAt,
			updatedAt: t.updatedAt,
			googleSync: t.googleSync,
			googleTaskId: t.googleTaskId,
			googleSyncedAt: t.googleSyncedAt,
			googleUpdatedAt: t.googleUpdatedAt,
			x: t.x,
			y: t.y
		})),
		googleTasks: googleRows.map(toPlanGoogleTask),
		tombstones: tombstoneRows.map((row) => ({ googleTaskId: row.googleTaskId })),
		fullFetch: full
	});

	const result: GoogleTaskSyncResult = { ...EMPTY, ok: true };
	const startedAt = new Date().toISOString();

	// Deletes first, matching the plan's own ordering.
	for (const entry of plan.deleteInGoogle) {
		try {
			await deleteTask(token, entry.googleTaskId);
			if (entry.taskId === null) {
				await db
					.delete(googleTaskTombstones)
					.where(eq(googleTaskTombstones.googleTaskId, entry.googleTaskId));
			} else {
				// Only after Google confirms: unlinking on a failed delete would
				// strand a live Google task with nothing pointing at it.
				await db
					.update(tasks)
					.set({
						googleSync: false,
						googleTaskId: null,
						googleSyncedAt: null,
						googleUpdatedAt: null,
						googleError: null
					})
					.where(eq(tasks.id, entry.taskId));
			}
			result.deletedRemotely++;
		} catch (err) {
			console.error(`gtasks: delete ${entry.googleTaskId} failed`, err);
			result.failed++;
		}
	}

	for (const create of plan.createInGoogle) {
		try {
			const created = await insertTask(token, {
				title: create.title,
				notes: create.notes,
				due: toGoogleDue(create.plannedDate),
				// A task can be completed before it is ever pushed. The create is
				// the only chance to say so: `markPushed` leaves it clean, so no
				// patch would ever follow and it would read as open in Google for
				// good.
				status: create.done ? 'completed' : 'needsAction'
			});
			await markPushed(create.taskId, created, sentUpdatedAt.get(create.taskId));
			result.pushed++;
		} catch (err) {
			await recordError(create.taskId, err);
			result.failed++;
		}
	}

	for (const patch of plan.patchInGoogle) {
		try {
			const updated = await patchTask(token, patch.googleTaskId, {
				title: patch.title,
				notes: patch.notes,
				due: toGoogleDue(patch.plannedDate),
				status: patch.done ? 'completed' : 'needsAction'
			});
			await markPushed(patch.taskId, updated, sentUpdatedAt.get(patch.taskId));
			result.pushed++;
		} catch (err) {
			await recordError(patch.taskId, err);
			result.failed++;
		}
	}

	for (const create of plan.createInTable) {
		await db.insert(tasks).values({
			id: randomUUID(),
			title: create.title,
			notes: create.notes,
			// A task arriving from Google carries a plan, not a known deadline. The
			// deadline is Table's own and gets set by hand, once it is known.
			dueDate: null,
			plannedDate: create.plannedDate,
			priority: null,
			done: false,
			completedAt: null,
			source: 'google',
			externalId: null,
			courseName: null,
			x: create.x,
			y: create.y,
			sortOrder: await nextSortOrder(),
			updatedAt: startedAt,
			googleSync: true,
			googleTaskId: create.googleTaskId,
			// Both stamps set so the task reads as clean on the next round rather
			// than immediately echoing itself back up to Google.
			googleSyncedAt: startedAt,
			googleUpdatedAt: create.googleUpdatedAt,
			googleError: null,
			createdAt: startedAt
		});
		result.imported++;
	}

	let skippedLocalPatches = 0;
	for (const patch of plan.patchInTable) {
		// The googleWins resolution above was computed from the snapshot, not from
		// whatever the row holds right now, so this write must be conditional on
		// the row still being at that snapshot version: a compare-and-swap against
		// `sentUpdatedAt`, the same map `markPushed` carries the snapshot through
		// with, rather than an unconditional overwrite. If the user edited the
		// task while Google's read/plan/write round was in flight, the WHERE
		// matches zero rows and the write is skipped instead of both overwriting
		// the edit and stamping it clean — which would bury it for good, since no
		// later round diffs against a state it never wrote down. The next round
		// sees both changes and resolves the conflict correctly.
		//
		// The fallback below can't actually be reached: every patchInTable entry's
		// taskId comes from the same tableRows this map is built from. It exists
		// only so a missing entry fails safe as a skip rather than as an
		// unconditional write.
		const snapshotUpdatedAt = sentUpdatedAt.get(patch.taskId) ?? '\0unreachable';
		const updatedAt = new Date().toISOString();
		const applied = await db
			.update(tasks)
			.set({
				title: patch.title,
				notes: patch.notes,
				plannedDate: patch.plannedDate,
				done: patch.done,
				completedAt: patch.completedAt,
				updatedAt,
				googleSyncedAt: updatedAt,
				googleUpdatedAt: patch.googleUpdatedAt,
				googleError: null
			})
			.where(and(eq(tasks.id, patch.taskId), eq(tasks.updatedAt, snapshotUpdatedAt)));
		if (applied.changes > 0) {
			result.updatedLocally++;
		} else {
			skippedLocalPatches++;
			console.warn(
				`gtasks: skipped patchInTable for task ${patch.taskId}; row was edited since the plan snapshot, next round will recompute the conflict`
			);
		}
	}

	for (const del of plan.deleteInTable) {
		await db.delete(tasks).where(eq(tasks.id, del.taskId));
		result.deletedLocally++;
	}

	for (const unlink of plan.unlinkInTable) {
		await db
			.update(tasks)
			.set({
				googleSync: false,
				googleTaskId: null,
				googleSyncedAt: null,
				googleUpdatedAt: null,
				googleError: unlink.reason
			})
			.where(eq(tasks.id, unlink.taskId));
	}

	// A skipped patchInTable means this round's window held a Google edit
	// (g1) that lost the race to a same-task Table edit and was correctly
	// deferred rather than applied. If the cursor still advances to
	// `startedAt`, the next round's `updatedMin` is computed from that new,
	// later cursor — and rounds run roughly `SKEW_MS` apart, so g1 can easily
	// fall outside the new window. The task would then be linked, dirty (the
	// user's edit never got written through), and absent from the fetch,
	// which is exactly the shape the patch-on-absence retry rule treats as
	// "Table changed offline, push it" — destroying g1 without ever comparing
	// it against the user's edit. Leaving the cursor where it was keeps g1
	// inside the next round's window, so the planner sees both edits again
	// and resolves the conflict for real instead of by omission.
	//
	// Termination: if the user keeps editing this task on every round, this
	// task's patch keeps getting skipped and the cursor keeps holding — that
	// is a stall, not data loss, and it is the same optimistic-concurrency
	// shape as the compare-and-set itself. The instant a round runs without a
	// concurrent edit, the patch applies, the row goes clean, and the very
	// next round (having no skips) advances the cursor again. Freezing the
	// cursor is safe for every other task in flight, too: any patch that did
	// apply this round already wrote `googleSyncedAt = g.updated`, so
	// replaying the same window next round is a no-op for it (googleChanged
	// and tableDirty both read false), and the rest of the plan's actions
	// (creates, deletes, pushes already sent) are likewise idempotent against
	// the already-updated local state. The cost of the stall is a wider
	// `updatedMin` window on replay, not a correctness problem.
	if (skippedLocalPatches === 0) {
		await writeSyncState(LAST_SYNC_KEY, startedAt);
	} else {
		console.warn(
			`gtasks: leaving cursor at ${lastSyncAt ?? '(none, next round stays a full fetch)'} ` +
				`because ${skippedLocalPatches} local patch(es) were skipped this round; ` +
				`next round replays the same google window so the conflict resolves with both edits visible`
		);
	}
	console.log(
		`gtasks sync: ${result.imported} imported, ${result.updatedLocally} updated ` +
			`(${skippedLocalPatches} skipped: edited mid-round), ` +
			`${result.deletedLocally} deleted locally, ${result.pushed} pushed, ` +
			`${result.deletedRemotely} deleted remotely, ${result.failed} failed`
	);
	return result;
}

/**
 * Records that Google now holds this exact version.
 *
 * `googleUpdatedAt` comes from the write's own response, not from a later
 * fetch. Google stamps `updated` at write time, so without this the next
 * reconcile would see Google as newer than Table and echo our own push back
 * down as an inbound change.
 *
 * `pushedUpdatedAt` is the task's `updatedAt` as of the snapshot the plan was
 * built from — the version that was actually sent — and is passed in rather
 * than re-read here for the mirror-image reason: the user can edit the task
 * while the push is in flight, and stamping that newer version as synced would
 * make the edit clean, so no later round would ever push it.
 */
export async function markPushed(
	taskId: string,
	googleTask: GoogleTask,
	pushedUpdatedAt: string | undefined
): Promise<void> {
	const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
	if (!row) {
		// Deleted between the snapshot and this write. Its own delete could not
		// leave a tombstone for a task it created here — the row had no
		// `googleTaskId` yet — so the Google task would be orphaned: live in
		// Google, unreferenced in Table, and invisible to every later round.
		// Tombstoning it hands the cleanup to the next round's deleteInGoogle.
		// For a patch the delete already wrote the same tombstone, hence
		// onConflictDoNothing.
		console.warn(
			`gtasks: task ${taskId} was deleted mid-round; tombstoning google task ${googleTask.id} for cleanup`
		);
		await db
			.insert(googleTaskTombstones)
			.values({ googleTaskId: googleTask.id, deletedAt: new Date().toISOString() })
			.onConflictDoNothing();
		return;
	}
	await db
		.update(tasks)
		.set({
			googleTaskId: googleTask.id,
			// Falling back to the stored value leaves the task dirty, so a missing
			// snapshot entry costs one redundant push next round instead of losing
			// the edit. Unreachable today: every plan entry comes from the snapshot.
			googleSyncedAt: pushedUpdatedAt ?? row.googleSyncedAt,
			googleUpdatedAt: googleTask.updated,
			googleError: null
		})
		.where(eq(tasks.id, taskId));
}

export async function recordError(taskId: string, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`gtasks: push for task ${taskId} failed`, err);
	try {
		await db.update(tasks).set({ googleError: message }).where(eq(tasks.id, taskId));
	} catch (dbErr) {
		// This runs inside a push loop's catch block, where throwing would abandon
		// every remaining push and replace the failure just logged above with a
		// database error. The task simply keeps whatever `googleError` it had.
		console.error(`gtasks: could not record the push failure on task ${taskId}`, dbErr);
	}
}
