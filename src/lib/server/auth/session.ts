import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions } from '../db/schema';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(email: string): Promise<{ sessionId: string; expiresAt: Date }> {
	let user = await db.query.users.findFirst({ where: eq(users.email, email) });
	if (!user) {
		const id = randomUUID();
		await db.insert(users).values({ id, email, createdAt: new Date().toISOString() });
		user = { id, email, createdAt: new Date().toISOString() };
	}

	const sessionId = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
	await db.insert(sessions).values({
		id: sessionId,
		userId: user.id,
		expiresAt: expiresAt.toISOString()
	});

	return { sessionId, expiresAt };
}

export async function getSessionUser(sessionId: string): Promise<{ id: string; email: string } | null> {
	const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
	if (!session) return null;
	if (new Date(session.expiresAt) < new Date()) return null;

	const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
	return user ? { id: user.id, email: user.email } : null;
}
