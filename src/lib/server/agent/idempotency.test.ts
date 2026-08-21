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
