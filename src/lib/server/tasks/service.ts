import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tasks, googleTaskTombstones } from '../db/schema';

export type Task = typeof tasks.$inferSelect;

/**
 * The fields Google can see. Everything else — priority, position, category,
 * and now the deadline — is invisible to Google, so changing it is not
 * something Google can be behind on and must not mark the task dirty.
 *
 * `dueDate` sits on the invisible side deliberately: it is Table's own truth
 * and there is no field on a Google task to carry it, so a deadline edit that
 * bumped `updatedAt` would fire a pointless push and arm the task to win a
 * both-dirty conflict against a real edit made on the phone.
 */
const GOOGLE_VISIBLE_FIELDS = ['title', 'notes', 'plannedDate'] as const;

export async function nextSortOrder(): Promise<number> {
	const existing = await db.query.tasks.findMany({
		orderBy: (t, { desc }) => [desc(t.sortOrder)]
	});
	return (existing[0]?.sortOrder ?? -1) + 1;
}

export async function createTask(input: {
	title: string;
	notes?: string;
	dueDate?: string;
	plannedDate?: string;
	priority?: 'low' | 'med' | 'high';
	googleSync?: boolean;
	personId?: string;
	x?: number;
	y?: number;
}): Promise<Task> {
	const now = new Date().toISOString();
	const row = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		plannedDate: input.plannedDate ?? null,
		priority: input.priority ?? null,
		done: false,
		completedAt: null,
		source: 'manual' as const,
		externalId: null,
		courseName: null,
		personId: input.personId ?? null,
		x: input.x ?? 60,
		y: input.y ?? 60,
		sortOrder: await nextSortOrder(),
		updatedAt: now,
		googleSync: input.googleSync ?? false,
		googleTaskId: null,
		googleSyncedAt: null,
		googleUpdatedAt: null,
		googleError: null,
		createdAt: now
	};
	await db.insert(tasks).values(row);
	return row;
}

export async function listTasks(): Promise<Task[]> {
	return db.query.tasks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] });
}

export async function listActiveTasks(): Promise<Task[]> {
	return db.query.tasks.findMany({
		where: eq(tasks.done, false),
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
}

export async function listCompletedTasks(): Promise<Task[]> {
	return db.query.tasks.findMany({
		where: eq(tasks.done, true),
		orderBy: (t, { desc }) => [desc(t.completedAt)]
	});
}

export async function updateTask(
	id: string,
	patch: Partial<{
		title: string;
		notes: string | null;
		dueDate: string | null;
		plannedDate: string | null;
		priority: 'low' | 'med' | 'high' | null;
		// The seam to Dinner Table. Invisible to Google, so — like priority and
		// position — its absence from GOOGLE_VISIBLE_FIELDS is what keeps linking
		// a task to a person from bumping `updatedAt` and firing a pointless push.
		personId: string | null;
	}>
): Promise<Task> {
	const touchesGoogle = GOOGLE_VISIBLE_FIELDS.some((field) => field in patch);
	await db
		.update(tasks)
		.set(touchesGoogle ? { ...patch, updatedAt: new Date().toISOString() } : patch)
		.where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!updated) throw new Error(`Task ${id} not found`);
	return updated;
}

export async function updateTaskPosition(id: string, x: number, y: number): Promise<void> {
	await db
		.update(tasks)
		.set({ x, y, sortOrder: await nextSortOrder() })
		.where(eq(tasks.id, id));
}

/**
 * Drives a task to a stated done-ness, rather than flipping whatever it holds.
 *
 * Separate from `toggleTaskDone` because a toggle cannot be retried: replaying
 * it undoes the first attempt, which is exactly wrong for a caller that retries
 * on a timeout it cannot tell apart from a failure. Stating the target state
 * makes the write safe to repeat — the second one is simply a no-op that lands
 * on the value already there.
 *
 * `updatedAt` moves either way, because `done` is a field Google can see.
 */
export async function setTaskDone(id: string, done: boolean): Promise<Task> {
	const now = new Date().toISOString();
	await db
		.update(tasks)
		.set({ done, completedAt: done ? now : null, updatedAt: now })
		.where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!updated) throw new Error(`Task ${id} not found`);
	return updated;
}

export async function toggleTaskDone(id: string): Promise<Task> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) throw new Error(`Task ${id} not found`);
	return setTaskDone(id, !existing.done);
}

export async function getTask(id: string): Promise<Task> {
	const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!row) throw new Error(`Task ${id} not found`);
	return row;
}

/**
 * Records the opt-in itself. Deliberately does not bump `updatedAt`: wanting a
 * task in Google is not a change to the task's content, and the planner detects
 * this from `googleSync` against `googleTaskId` rather than from dirtiness.
 *
 * Clears `googleError`, because the error describes how one past attempt ended
 * under an intent the user has just replaced. Opting in again is a fresh
 * attempt that has not failed yet; if it fails the same way, the push records
 * the error again within seconds, which is honest where a stale error is not.
 *
 * Takes no boolean, because the two directions are not symmetrical: turning
 * sync off has to delete the Google copy and drop a tombstone, which is
 * `unlinkFromGoogle`. A `setGoogleSync(id, false)` that only flipped the flag
 * would leave a task stranded in Google that nothing would ever collect.
 */
export async function enableGoogleSync(id: string): Promise<void> {
	await db.update(tasks).set({ googleSync: true, googleError: null }).where(eq(tasks.id, id));
}

/**
 * Switches sync off and severs the link, returning the `googleTaskId` the task
 * used to own so the caller can delete that task from Google.
 *
 * The tombstone and the clearing share one transaction for the same reason
 * they do in `deleteTask`: once `googleTaskId` is null there is nothing left
 * recording which Google task this row owned, so a commit without the
 * tombstone leaks a task in Google that nothing will ever clean up. Writing
 * the tombstone means the caller's delete does not have to succeed — a failed
 * or skipped one is retried by the next reconcile, while Table's own state is
 * already correct.
 *
 * `googleSyncedAt` is cleared along with the id so a task switched back on
 * later reads as dirty and gets pushed in full, rather than being compared
 * against a version of a Google task that no longer exists.
 *
 * Clearing `googleError` here is the escape hatch for a task Google will never
 * accept, and it is the only one that works: an unlinked, opted-out task is
 * reachable by neither the push nor the local patch, the only other writers of
 * `googleError: null`, so a leftover error would keep the badge red forever
 * with nothing left that could ever clear it.
 */
export async function unlinkFromGoogle(id: string): Promise<string | null> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) return null;

	// Read off the row before anything writes to it, and returned from this copy
	// rather than from `existing`: the id is the one thing this function exists
	// to hand back, and it is also the thing the update below erases.
	const googleTaskId = existing.googleTaskId;

	db.transaction((tx) => {
		if (googleTaskId) {
			tx.insert(googleTaskTombstones)
				.values({ googleTaskId, deletedAt: new Date().toISOString() })
				.onConflictDoNothing()
				.run();
		}
		tx.update(tasks)
			.set({ googleSync: false, googleTaskId: null, googleSyncedAt: null, googleError: null })
			.where(eq(tasks.id, id))
			.run();
	});

	return googleTaskId;
}

/**
 * Deletes a task, leaving a tombstone when it was linked to Google.
 *
 * The tombstone and the delete share one transaction because they are one fact:
 * once the row is gone there is nothing left recording which Google task it
 * owned, so a delete that committed without its tombstone would leak a task in
 * Google that nothing will ever clean up.
 */
export async function deleteTask(id: string): Promise<void> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) return;

	db.transaction((tx) => {
		if (existing.googleTaskId) {
			tx.insert(googleTaskTombstones)
				.values({ googleTaskId: existing.googleTaskId, deletedAt: new Date().toISOString() })
				.onConflictDoNothing()
				.run();
		}
		tx.delete(tasks).where(eq(tasks.id, id)).run();
	});
}
