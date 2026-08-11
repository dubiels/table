import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tasks, googleTaskTombstones } from '../db/schema';

export type Task = typeof tasks.$inferSelect;

/**
 * The fields Google can see. Everything else — priority, position, category —
 * is invisible to Google, so changing it is not something Google can be behind
 * on and must not mark the task dirty.
 */
const GOOGLE_VISIBLE_FIELDS = ['title', 'notes', 'dueDate'] as const;

async function nextSortOrder(): Promise<number> {
	const existing = await db.query.tasks.findMany({
		orderBy: (t, { desc }) => [desc(t.sortOrder)]
	});
	return (existing[0]?.sortOrder ?? -1) + 1;
}

export async function createTask(input: {
	title: string;
	notes?: string;
	dueDate?: string;
	priority?: 'low' | 'med' | 'high';
	googleSync?: boolean;
	x?: number;
	y?: number;
}): Promise<Task> {
	const now = new Date().toISOString();
	const row = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		done: false,
		completedAt: null,
		source: 'manual' as const,
		externalId: null,
		courseName: null,
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
		priority: 'low' | 'med' | 'high' | null;
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

export async function toggleTaskDone(id: string): Promise<Task> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) throw new Error(`Task ${id} not found`);
	const done = !existing.done;
	const now = new Date().toISOString();
	await db
		.update(tasks)
		.set({ done, completedAt: done ? now : null, updatedAt: now })
		.where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	return updated!;
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
 */
export async function setGoogleSync(id: string, googleSync: boolean): Promise<void> {
	await db.update(tasks).set({ googleSync }).where(eq(tasks.id, id));
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
