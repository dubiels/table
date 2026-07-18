import { randomBytes, createHash, randomInt, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { loginTokens } from '../db/schema';

const MAX_ATTEMPTS = 5;

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export async function createLoginToken(
	email: string,
	expiresInMs = 15 * 60 * 1000
): Promise<{ token: string; code: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const expiresAt = new Date(Date.now() + expiresInMs);

	await db.insert(loginTokens).values({
		id: randomUUID(),
		email: email.toLowerCase(),
		tokenHash: hash(token),
		codeHash: hash(code),
		attemptCount: 0,
		expiresAt: expiresAt.toISOString(),
		used: false,
		createdAt: new Date().toISOString()
	});

	return { token, code, expiresAt };
}

export async function validateLoginToken(
	rawToken: string
): Promise<{ email: string } | { error: 'invalid' | 'expired' | 'used' }> {
	const row = await db.query.loginTokens.findFirst({
		where: eq(loginTokens.tokenHash, hash(rawToken))
	});
	if (!row) return { error: 'invalid' };
	if (row.used) return { error: 'used' };
	if (new Date(row.expiresAt) < new Date()) return { error: 'expired' };

	await db.update(loginTokens).set({ used: true }).where(eq(loginTokens.id, row.id));
	return { email: row.email };
}

export async function validateLoginCode(
	email: string,
	code: string
): Promise<{ email: string } | { error: 'invalid' | 'expired' | 'used' | 'locked' }> {
	const row = await db.query.loginTokens.findFirst({
		where: eq(loginTokens.email, email.toLowerCase()),
		orderBy: (t, { desc }) => [desc(t.createdAt)]
	});
	if (!row) return { error: 'invalid' };
	if (row.used) return { error: 'used' };
	if (row.attemptCount >= MAX_ATTEMPTS) return { error: 'locked' };
	if (new Date(row.expiresAt) < new Date()) return { error: 'expired' };

	if (row.codeHash !== hash(code)) {
		await db
			.update(loginTokens)
			.set({ attemptCount: row.attemptCount + 1 })
			.where(eq(loginTokens.id, row.id));
		const attemptsAfter = row.attemptCount + 1;
		return attemptsAfter >= MAX_ATTEMPTS ? { error: 'locked' } : { error: 'invalid' };
	}

	await db.update(loginTokens).set({ used: true }).where(eq(loginTokens.id, row.id));
	return { email: row.email };
}
