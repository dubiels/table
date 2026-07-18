import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';

// Use an in-memory DB and inject it, rather than importing the module-level singleton.
vi.mock('../db', () => {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return { db };
});

const { createLoginToken, validateLoginToken, validateLoginCode } = await import('./tokens');

describe('login token lifecycle', () => {
	it('validates a freshly created token exactly once', async () => {
		const { token } = await createLoginToken('a@example.com');
		const first = await validateLoginToken(token);
		expect(first).toEqual({ email: 'a@example.com' });

		const second = await validateLoginToken(token);
		expect(second).toEqual({ error: 'used' });
	});

	it('validates a freshly created code exactly once', async () => {
		const { code } = await createLoginToken('b@example.com');
		const first = await validateLoginCode('b@example.com', code);
		expect(first).toEqual({ email: 'b@example.com' });

		const second = await validateLoginCode('b@example.com', code);
		expect(second).toEqual({ error: 'used' });
	});

	it('rejects an unknown token', async () => {
		const result = await validateLoginToken('not-a-real-token');
		expect(result).toEqual({ error: 'invalid' });
	});

	it('rejects a wrong code and increments attempt count without consuming the row', async () => {
		await createLoginToken('c@example.com');
		const wrong = await validateLoginCode('c@example.com', '000000');
		expect(wrong).toEqual({ error: 'invalid' });
	});

	it('locks out after 5 wrong code attempts', async () => {
		await createLoginToken('d@example.com');
		for (let i = 0; i < 5; i++) {
			await validateLoginCode('d@example.com', '000000');
		}
		const sixth = await validateLoginCode('d@example.com', '000000');
		expect(sixth).toEqual({ error: 'locked' });
	});

	it('rejects an expired token', async () => {
		const { token } = await createLoginToken('e@example.com', -1000);
		const result = await validateLoginToken(token);
		expect(result).toEqual({ error: 'expired' });
	});
});
