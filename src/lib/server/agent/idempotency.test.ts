import { describe, it, expect, beforeEach, vi } from 'vitest';

const { testDb, testSqlite } = await vi.hoisted(async () => {
	const { createTestDb } = await import('./test-db');
	return createTestDb();
});

vi.mock('$lib/server/db', () => ({ db: testDb, sqliteClient: testSqlite }));

const { resetTestDb } = await import('./test-db');
const { withIdempotency } = await import('./idempotency');
const { agentIdempotency } = await import('../db/schema');

beforeEach(() => resetTestDb(testSqlite));

const created = (id: string) => ({ status: 201, body: { id } });

/**
 * Stands in for an attempt that claimed the key, stalled past the takeover
 * window, and only then failed — the case a release-by-key would get wrong.
 */
async function withIdempotencyAsStalledOwner(key: string, route: string, token: string) {
	const { and, eq } = await import('drizzle-orm');
	// Its release, written the way the module writes one: scoped to its own token.
	await testDb
		.delete(agentIdempotency)
		.where(and(eq(agentIdempotency.key, key), eq(agentIdempotency.claim, token)));
	throw new Error(`stalled attempt on ${route} failed`);
}

describe('withIdempotency', () => {
	it('runs the write when no key is given, every time', async () => {
		const run = vi.fn().mockResolvedValue(created('a'));

		await withIdempotency(null, 'POST /tasks', run);
		await withIdempotency(undefined, 'POST /tasks', run);

		expect(run).toHaveBeenCalledTimes(2);
	});

	it('replays the original result instead of writing twice', async () => {
		let n = 0;
		const run = vi.fn(async () => created(`task-${++n}`));

		const first = await withIdempotency('k1', 'POST /tasks', run);
		const second = await withIdempotency('k1', 'POST /tasks', run);

		expect(run).toHaveBeenCalledTimes(1);
		expect(first).toEqual({ kind: 'fresh', status: 201, body: { id: 'task-1' } });
		// The original body, not a second task and not merely the same shape.
		expect(second).toEqual({ kind: 'replay', status: 201, body: { id: 'task-1' } });
	});

	it('refuses a key already used on a different route', async () => {
		await withIdempotency('k1', 'POST /tasks', async () => created('a'));

		const reused = await withIdempotency('k1', 'POST /people', async () => created('b'));

		expect(reused).toEqual({ kind: 'conflict', code: 'idempotency_key_reused' });
	});

	it('reports a key whose first attempt is still running', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const slow = withIdempotency('k1', 'POST /tasks', async () => {
			await gate;
			return created('a');
		});

		const concurrent = await withIdempotency('k1', 'POST /tasks', async () => created('b'));
		expect(concurrent).toEqual({ kind: 'conflict', code: 'idempotency_key_in_flight' });

		release();
		await slow;
	});

	it('does not store a failed write, so a corrected retry can succeed', async () => {
		const rejected = await withIdempotency('k1', 'POST /tasks', async () => ({
			status: 400,
			body: { error: { code: 'invalid_body' } }
		}));
		expect(rejected.kind).toBe('fresh');

		const retried = await withIdempotency('k1', 'POST /tasks', async () => created('a'));

		expect(retried).toEqual({ kind: 'fresh', status: 201, body: { id: 'a' } });
	});

	it('releases the key when the write throws, and rethrows', async () => {
		const boom = new Error('service exploded');
		await expect(
			withIdempotency('k1', 'POST /tasks', async () => {
				throw boom;
			})
		).rejects.toThrow(boom);

		const rows = await testDb.select().from(agentIdempotency);
		expect(rows).toHaveLength(0);
	});

	it('refuses a key reused with a different body', async () => {
		// The failure an LLM-generated key is most likely to cause: reusing a key
		// for a genuinely different write. Replaying the first result would report
		// success while silently dropping the second task.
		const first = await withIdempotency(
			'k1',
			'POST /tasks',
			async () => created('milk'),
			'fp-milk'
		);
		expect(first.kind).toBe('fresh');

		const second = await withIdempotency(
			'k1',
			'POST /tasks',
			async () => created('call-mum'),
			'fp-call-mum'
		);

		expect(second).toEqual({ kind: 'conflict', code: 'idempotency_key_reused' });
	});

	it('lets exactly one of two concurrent attempts take over a stale claim', async () => {
		// Both read the same abandoned row and both judge it stale. Without an
		// ownership fence both would proceed and the write would run twice.
		await testDb.insert(agentIdempotency).values({
			key: 'k1',
			route: 'POST /tasks',
			claim: 'abandoned-token',
			fingerprint: null,
			status: null,
			response: null,
			createdAt: new Date(Date.now() - 5 * 60_000).toISOString()
		});

		const ran: string[] = [];
		const attempt = (id: string) =>
			withIdempotency('k1', 'POST /tasks', async () => {
				ran.push(id);
				return created(id);
			});

		const [a, b] = await Promise.all([attempt('a'), attempt('b')]);

		expect(ran).toHaveLength(1);
		const outcomes = [a.kind, b.kind].sort();
		expect(outcomes).toEqual(['conflict', 'fresh']);
	});

	it('does not let a superseded attempt erase the result of the one that replaced it', async () => {
		// A stalls past the takeover window; B seizes the claim and succeeds. A
		// then fails. Releasing by key alone would delete B's stored result and let
		// a third attempt run the write all over again.
		await testDb.insert(agentIdempotency).values({
			key: 'k1',
			route: 'POST /tasks',
			claim: 'stalled-token',
			fingerprint: null,
			status: null,
			response: null,
			createdAt: new Date(Date.now() - 5 * 60_000).toISOString()
		});

		const b = await withIdempotency('k1', 'POST /tasks', async () => created('b'));
		expect(b).toEqual({ kind: 'fresh', status: 201, body: { id: 'b' } });

		// A wakes up and fails. Its release must be a no-op: it no longer owns the key.
		await expect(
			withIdempotencyAsStalledOwner('k1', 'POST /tasks', 'stalled-token')
		).rejects.toThrow();

		const rows = await testDb.select().from(agentIdempotency);
		expect(rows).toHaveLength(1);
		expect(JSON.parse(rows[0].response!)).toEqual({ id: 'b' });
	});

	it('takes over a claim abandoned by a crashed request', async () => {
		// A process killed between claiming and storing leaves this row behind.
		// Without a takeover the agent could never complete that write again.
		await testDb.insert(agentIdempotency).values({
			key: 'k1',
			route: 'POST /tasks',
			status: null,
			response: null,
			createdAt: new Date(Date.now() - 5 * 60_000).toISOString()
		});

		const result = await withIdempotency('k1', 'POST /tasks', async () => created('a'));

		expect(result).toEqual({ kind: 'fresh', status: 201, body: { id: 'a' } });
	});
});
