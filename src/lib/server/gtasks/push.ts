import { eq } from 'drizzle-orm';
import { db } from '../db';
import { googleTaskTombstones } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { getTask } from '../tasks/service';
import { insertTask, patchTask, deleteTask, toGoogleDue } from './client';
import { isGoogleTasksEnabled, markPushed, recordError, withGoogleTasksLock } from './sync';

/**
 * Sends one task to Google right now, so a change made in Table shows up on the
 * phone in seconds rather than at the next cron tick.
 *
 * Runs on the reconciler's queue, so it never overlaps a round: both read a
 * task, decide from that read, and write `googleTaskId` back, and interleaving
 * them can create the same task in Google twice and leave the first orphaned.
 * Waiting costs the user's action a moment; racing costs them a duplicate card.
 *
 * Never throws. A failure is recorded in `googleError` and left dirty, which is
 * exactly the state the reconciler retries — so the user's action always
 * succeeds locally whether or not Google is reachable.
 */
export function pushTaskNow(taskId: string): Promise<void> {
	// Checked before queueing: with the integration off there is nothing to
	// serialize, and the caller should not wait behind anything.
	if (!isGoogleTasksEnabled()) return Promise.resolve();
	return withGoogleTasksLock(() => pushTask(taskId));
}

async function pushTask(taskId: string): Promise<void> {
	try {
		const task = await getTask(taskId);
		if (!task.googleSync) return;
		// The due-date rule gates creation only: an existing link is maintained
		// with `due: null` rather than being severed.
		if (!task.googleTaskId && !task.dueDate) return;

		const token = await getAccessToken();
		const body = {
			title: task.title,
			notes: task.notes,
			due: toGoogleDue(task.dueDate),
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
 * failure.
 *
 * Never throws. A failure leaves the tombstone in place, which is the whole
 * reason it is written: the next reconcile finds it and tries again.
 */
export function pushDeletionNow(googleTaskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return Promise.resolve();
	return withGoogleTasksLock(() => pushDeletion(googleTaskId));
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
