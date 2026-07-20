import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tasks } from '../db/schema';

export type Task = typeof tasks.$inferSelect;

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
	x?: number;
	y?: number;
}): Promise<Task> {
	const row = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		done: false,
		completedAt: null,
		x: input.x ?? 60,
		y: input.y ?? 60,
		sortOrder: await nextSortOrder(),
		createdAt: new Date().toISOString()
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
	await db.update(tasks).set(patch).where(eq(tasks.id, id));
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
	await db
		.update(tasks)
		.set({ done, completedAt: done ? new Date().toISOString() : null })
		.where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	return updated!;
}

export async function deleteTask(id: string): Promise<void> {
	await db.delete(tasks).where(eq(tasks.id, id));
}
