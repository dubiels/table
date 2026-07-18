import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { topics } from '../db/schema';

export type Topic = typeof topics.$inferSelect;

export async function createTopic(name: string): Promise<Topic> {
	const existing = await db.query.topics.findMany({ orderBy: (t, { desc }) => [desc(t.sortOrder)] });
	const nextOrder = (existing[0]?.sortOrder ?? -1) + 1;
	const id = randomUUID();
	const row = {
		id,
		name,
		status: 'active' as const,
		sortOrder: nextOrder,
		createdAt: new Date().toISOString()
	};
	await db.insert(topics).values(row);
	return row;
}

export async function listTopics(status?: 'active' | 'archived'): Promise<Topic[]> {
	return db.query.topics.findMany({
		where: status ? eq(topics.status, status) : undefined,
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
}

export async function updateTopic(id: string, patch: { name?: string }): Promise<Topic> {
	await db.update(topics).set(patch).where(eq(topics.id, id));
	const updated = await db.query.topics.findFirst({ where: eq(topics.id, id) });
	if (!updated) throw new Error(`Topic ${id} not found`);
	return updated;
}

export async function archiveTopic(id: string): Promise<Topic> {
	return updateTopicStatus(id, 'archived');
}

async function updateTopicStatus(id: string, status: 'active' | 'archived'): Promise<Topic> {
	await db.update(topics).set({ status }).where(eq(topics.id, id));
	const updated = await db.query.topics.findFirst({ where: eq(topics.id, id) });
	if (!updated) throw new Error(`Topic ${id} not found`);
	return updated;
}

export async function moveTopic(id: string, direction: 'up' | 'down'): Promise<void> {
	const all = await db.query.topics.findMany({
		where: eq(topics.status, 'active'),
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
	const index = all.findIndex((t) => t.id === id);
	if (index === -1) return;
	const swapIndex = direction === 'up' ? index - 1 : index + 1;
	if (swapIndex < 0 || swapIndex >= all.length) return;

	const a = all[index];
	const b = all[swapIndex];
	await db.update(topics).set({ sortOrder: b.sortOrder }).where(eq(topics.id, a.id));
	await db.update(topics).set({ sortOrder: a.sortOrder }).where(eq(topics.id, b.id));
}
