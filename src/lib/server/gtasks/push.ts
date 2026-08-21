import { eq } from 'drizzle-orm';
import { db } from '../db';
import { googleTaskTombstones } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { getTask } from '../tasks/service';
import { insertTask, patchTask, deleteTask, toGoogleDue } from './client';
import { isGoogleTasksEnabled, markPushed, recordError, withGoogleTasksLockWithin } from './sync';

/**
 * How long an immediate push waits for the lock before giving up on it.
 *
 * An uncontended lock clears in a microtask, so this budget only matters when
 * something else is already holding it — another immediate push, or a sync
 * round. ~100ms is roughly where a UI action stops reading as instant, so
 * 200ms leaves room to ride out a single in-flight Google call (two pushes
 * arriving close together, the common case) while staying nowhere near "wait
 * out a round with many dirty tasks", which is the hang this bound exists to
 * prevent.
 */
const LOCK_WAIT_BUDGET_MS = 200;

/**
 * Sends one task to Google right now, so a change made in Table shows up on the
 * phone in seconds rather than at the next cron tick.
 *
 * Shares the reconciler's queue so it never overlaps a round: both read a
 * task, decide from that read, and write `googleTaskId` back, and interleaving
 * them can create the same task in Google twice and leave the first orphaned.
 * But a round makes an unbounded number of Google calls, so joining that
 * queue unconditionally would mean this — awaited by a SvelteKit form action
 * — sits blocked behind however many dirty tasks the round has left to send.
 * That trades a rare duplicate-create for a routine hang, which is worse than
 * either: the wait for the lock is bounded, and giving up on it is not a
 * failure. The task is already saved locally and already dirty, so the next
 * reconcile is what pushes it — the designed retry path, not a fallback — and
 * no `googleError` is recorded, because nothing was attempted.
 *
 * Never throws. A failure that *is* attempted is recorded in `googleError`
 * and left dirty, which is exactly the state the reconciler retries — so the
 * user's action always succeeds locally whether or not Google is reachable.
 */
export function pushTaskNow(taskId: string): Promise<void> {
	// Checked before waiting: with the integration off there is nothing to
	// serialize, and the caller should not wait behind anything.
	if (!isGoogleTasksEnabled()) return Promise.resolve();
	return withGoogleTasksLockWithin(LOCK_WAIT_BUDGET_MS, () => pushTask(taskId)).then(() => {});
}

async function pushTask(taskId: string): Promise<void> {
	try {
		const task = await getTask(taskId);
		if (!task.googleSync) return;
		// The rule gates creation only: an existing link is maintained with
		// `due: null` rather than being severed.
		if (!task.googleTaskId && !task.plannedDate) return;
		// Already linked and clean: nothing Google can see has changed, and pushing
		// anyway would patch Table's snapshot over a phone edit we have not pulled
		// yet — then advance googleUpdatedAt so no later round notices. The create
		// path is unaffected: an opt-in has no googleTaskId yet.
		if (task.googleTaskId && task.updatedAt === task.googleSyncedAt) return;

		const token = await getAccessToken();
		const body = {
			title: task.title,
			notes: task.notes,
			due: toGoogleDue(task.plannedDate),
			status: task.done ? ('completed' as const) : ('needsAction' as const)
		};

		const saved = task.googleTaskId
			? await patchTask(token, task.googleTaskId, body)
			: await insertTask(token, body);

		// `task.updatedAt` is the snapshot this push was actually built from — the
		// same version `markPushed` needs to stamp as synced. Re-reading the row
		// here instead would risk stamping an edit made while the network call was
		// in flight as already-sent, and it would never sync.
		await markPushed(taskId, saved, task.updatedAt);
	} catch (err) {
		await recordError(taskId, err).catch(() => {});
	}
}

/**
 * Deletes one Google task right now and drops its tombstone on success.
 *
 * On the same queue as the rounds, and for the same reason: a round plans its
 * own delete for this tombstone from a snapshot, so running both means one of
 * them deletes a task Google has already forgotten and logs the 404 as a
 * failure. Bounded by the same budget as `pushTaskNow` and for the same
 * reason — `deleteTask`'s form action awaits this too, and a round's
 * unbounded call count must not become this request's wait.
 *
 * Never throws. A failure — including giving up on the lock — leaves the
 * tombstone in place, which is the whole reason it is written: the next
 * reconcile finds it and tries again.
 */
export function pushDeletionNow(googleTaskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return Promise.resolve();
	return withGoogleTasksLockWithin(LOCK_WAIT_BUDGET_MS, () => pushDeletion(googleTaskId)).then(
		() => {}
	);
}

async function pushDeletion(googleTaskId: string): Promise<void> {
	try {
		await deleteTask(await getAccessToken(), googleTaskId);
		await db
			.delete(googleTaskTombstones)
			.where(eq(googleTaskTombstones.googleTaskId, googleTaskId));
	} catch (err) {
		console.error(`gtasks: immediate delete of ${googleTaskId} failed, tombstone kept`, err);
	}
}
