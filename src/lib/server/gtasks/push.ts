import { eq } from 'drizzle-orm';
import { db } from '../db';
import { googleTaskTombstones } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { getTask } from '../tasks/service';
import { insertTask, patchTask, deleteTask, toGoogleDue } from './client';
import { isGoogleTasksEnabled, markPushed, recordError } from './sync';

/**
 * Sends one task to Google right now, so a change made in Table shows up on the
 * phone in seconds rather than at the next cron tick.
 *
 * Never throws. A failure is recorded in `googleError` and left dirty, which is
 * exactly the state the reconciler retries — so the user's action always
 * succeeds locally whether or not Google is reachable.
 */
export async function pushTaskNow(taskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return;

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
 * Never throws. A failure leaves the tombstone in place, which is the whole
 * reason it is written: the next reconcile finds it and tries again.
 */
export async function pushDeletionNow(googleTaskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return;

	try {
		await deleteTask(await getAccessToken(), googleTaskId);
		await db
			.delete(googleTaskTombstones)
			.where(eq(googleTaskTombstones.googleTaskId, googleTaskId));
	} catch (err) {
		console.error(`gtasks: immediate delete of ${googleTaskId} failed, tombstone kept`, err);
	}
}
