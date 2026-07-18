import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { notifications } from '../db/schema';

export async function logNotification(input: {
	userId: string;
	type: 'morning_digest' | 'due_alert';
	content: { text: string; taskIds: string[] };
}) {
	await db.insert(notifications).values({
		id: randomUUID(),
		userId: input.userId,
		type: input.type,
		content: JSON.stringify(input.content),
		sentAt: new Date().toISOString(),
		readAt: null
	});
}
