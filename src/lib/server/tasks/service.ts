import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { tasks, topics } from '../db/schema';

export type Task = typeof tasks.$inferSelect;

export async function createTask(input: {
	topicId: string;
	title: string;
	notes?: string;
	dueDate?: string;
	priority?: 'low' | 'med' | 'high';
}): Promise<Task> {
	const existing = await db.query.tasks.findMany({
		where: eq(tasks.topicId, input.topicId),
		orderBy: (t, { desc }) => [desc(t.sortOrder)]
	});
	const nextOrder = (existing[0]?.sortOrder ?? -1) + 1;
	const id = randomUUID();
	const row = {
		id,
		topicId: input.topicId,
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		done: false,
		sortOrder: nextOrder,
		createdAt: new Date().toISOString()
	};
	await db.insert(tasks).values(row);
	return row;
}

export async function listTasksForTopic(topicId: string): Promise<Task[]> {
	return db.query.tasks.findMany({
		where: eq(tasks.topicId, topicId),
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
}

export async function updateTask(
	id: string,
	patch: Partial<{ title: string; notes: string | null; dueDate: string | null; priority: 'low' | 'med' | 'high' | null }>
): Promise<Task> {
	await db.update(tasks).set(patch).where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!updated) throw new Error(`Task ${id} not found`);
	return updated;
}

export async function toggleTaskDone(id: string): Promise<Task> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) throw new Error(`Task ${id} not found`);
	await db.update(tasks).set({ done: !existing.done }).where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	return updated!;
}

export async function deleteTask(id: string): Promise<void> {
	await db.delete(tasks).where(eq(tasks.id, id));
}

export async function moveTask(id: string, direction: 'up' | 'down'): Promise<void> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) return;
	const siblings = await db.query.tasks.findMany({
		where: eq(tasks.topicId, existing.topicId),
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
	const index = siblings.findIndex((t) => t.id === id);
	const swapIndex = direction === 'up' ? index - 1 : index + 1;
	if (swapIndex < 0 || swapIndex >= siblings.length) return;

	const a = siblings[index];
	const b = siblings[swapIndex];
	await db.update(tasks).set({ sortOrder: b.sortOrder }).where(eq(tasks.id, a.id));
	await db.update(tasks).set({ sortOrder: a.sortOrder }).where(eq(tasks.id, b.id));
}

export async function listAllActiveTasksWithTopics(): Promise<Array<Task & { topicName: string }>> {
	const rows = await db
		.select({
			id: tasks.id,
			topicId: tasks.topicId,
			title: tasks.title,
			notes: tasks.notes,
			dueDate: tasks.dueDate,
			priority: tasks.priority,
			done: tasks.done,
			sortOrder: tasks.sortOrder,
			createdAt: tasks.createdAt,
			topicName: topics.name
		})
		.from(tasks)
		.innerJoin(topics, eq(tasks.topicId, topics.id))
		.where(and(eq(topics.status, 'active'), eq(tasks.done, false)));
	return rows;
}
