import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
		dueDate: fromGoogleDue(g.due),
		done: g.status === 'completed',
		completedAt: g.completed ?? null,
		updated: g.updated,
		deleted: g.deleted === true
	};
}

/**
 * One reconcile round.
 *
 * `full: true` skips the `updatedMin` filter and lets the planner act on a
 * linked task's absence. Periodic runs are incremental so a lifetime of
 * completed tasks is not re-fetched every few minutes; the manual refresh and
 * the very first run are full.
 *
 * Never throws, and this wrapper is what makes that true rather than aspirational.
 * The round's own guards handle the expected failures — an unreachable Google,
 * one task Google refuses — and this one catches the rest: a locked or failing
 * database during the local phase, which is systemic rather than per-task. Such
 * a round reports `ok: false` and, because the sync cursor is written last, the
 * next round replans the same work from the same window.
 */
export async function syncGoogleTasks(options?: { full?: boolean }): Promise<GoogleTaskSyncResult> {
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
	// push in this round actually sends. `markPushed` records this rather than
	// re-reading `updatedAt` afterwards: an edit made while the push was in
	// flight would otherwise be stamped as already in Google and never sync.
	const sentUpdatedAt = new Map(tableRows.map((t) => [t.id, t.updatedAt]));

	const plan = planGoogleTaskSync({
		tableTasks: tableRows.map((t) => ({
			id: t.id,
			title: t.title,
			notes: t.notes,
			dueDate: t.dueDate,
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
				due: toGoogleDue(create.dueDate),
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
				due: toGoogleDue(patch.dueDate),
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
			dueDate: create.dueDate,
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

	for (const patch of plan.patchInTable) {
		const updatedAt = new Date().toISOString();
		await db
			.update(tasks)
			.set({
				title: patch.title,
				notes: patch.notes,
				dueDate: patch.dueDate,
				done: patch.done,
				completedAt: patch.completedAt,
				updatedAt,
				googleSyncedAt: updatedAt,
				googleUpdatedAt: patch.googleUpdatedAt,
				googleError: null
			})
			.where(eq(tasks.id, patch.taskId));
		result.updatedLocally++;
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

	await writeSyncState(LAST_SYNC_KEY, startedAt);
	console.log(
		`gtasks sync: ${result.imported} imported, ${result.updatedLocally} updated, ` +
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
