import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { GTASKS_ENABLED: 'true', GCAL_REFRESH_TOKEN: 'refresh-token' }
}));

vi.mock('../google/oauth', () => ({
	getAccessToken: () => Promise.resolve('access-token')
}));

const listTasksMock = vi.fn();
const insertTaskMock = vi.fn();
const patchTaskMock = vi.fn();
const deleteTaskMock = vi.fn();

vi.mock('./client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./client')>();
	return {
		...actual,
		listTasks: (...args: unknown[]) => listTasksMock(...args),
		insertTask: (...args: unknown[]) => insertTaskMock(...args),
		patchTask: (...args: unknown[]) => patchTaskMock(...args),
		deleteTask: (...args: unknown[]) => deleteTaskMock(...args)
	};
});

/** The one linked, clean task both the round and the write-through path see. */
const taskRow = {
	id: 't1',
	title: 'Linked',
	notes: null,
	dueDate: '2026-08-12',
	done: false,
	completedAt: null,
	updatedAt: '2026-08-11T12:00:00.000Z',
	googleSync: true,
	googleTaskId: 'g1',
	googleSyncedAt: '2026-08-11T12:00:00.000Z',
	googleUpdatedAt: '2026-08-11T12:00:00.000Z',
	googleError: null,
	x: 0,
	y: 0
};

let cursor: { key: string; value: string } | undefined;

vi.mock('../db', () => ({
	db: {
		query: {
			syncState: { findFirst: () => Promise.resolve(cursor) },
			tasks: {
				findMany: () => Promise.resolve([{ ...taskRow }]),
				findFirst: () => Promise.resolve({ ...taskRow })
			},
			googleTaskTombstones: { findMany: () => Promise.resolve([]) }
		},
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: () => Promise.resolve(),
				onConflictDoNothing: () => Promise.resolve()
			})
		}),
		update: () => ({ set: () => ({ where: () => Promise.resolve({ changes: 1 }) }) }),
		delete: () => ({ where: () => Promise.resolve() })
	}
}));

import { syncGoogleTasks } from './sync';
import { pushTaskNow } from './push';

/** A promise whose settlement the test drives, standing in for a slow Google. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Lets every already-queued microtask run, so "has it started yet?" is honest. */
async function settle() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('sync round serialization', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cursor = { key: 'gtasks:lastSyncAt', value: '2026-08-11T12:00:00.000Z' };
		patchTaskMock.mockResolvedValue({ id: 'g1', updated: '2026-08-11T13:00:00.000Z' });
	});

	it('joins the round already in flight instead of starting a second one', async () => {
		// The board's load is the reachable amplifier: its own timeout bounds how
		// long the request waits, not how long the round runs, and the cursor is
		// written last — so a reload while Google is slow finds the state still
		// stale. Without a guard each reload starts another round, each plans the
		// same createInGoogle, and the user's board grows duplicate cards.
		const first = deferred<[]>();
		listTasksMock.mockReturnValueOnce(first.promise).mockResolvedValue([]);

		const a = syncGoogleTasks();
		const b = syncGoogleTasks();
		await settle();
		expect(listTasksMock).toHaveBeenCalledTimes(1);

		first.resolve([]);
		expect(await a).toEqual(await b);
		expect(listTasksMock).toHaveBeenCalledTimes(1);
	});

	it('still does a full fetch for a caller that asked for one mid-round', async () => {
		// The manual refresh means "go and look at everything now". Handing it the
		// incremental round that happened to be running would make the button a
		// lie, so the full round is queued behind instead of joined.
		const first = deferred<[]>();
		listTasksMock.mockReturnValueOnce(first.promise).mockResolvedValue([]);

		const incremental = syncGoogleTasks();
		const full = syncGoogleTasks({ full: true });
		await settle();
		expect(listTasksMock).toHaveBeenCalledTimes(1);

		first.resolve([]);
		await incremental;
		await full;

		expect(listTasksMock).toHaveBeenCalledTimes(2);
		expect(listTasksMock.mock.calls[0][1]).toMatchObject({ updatedMin: expect.any(String) });
		expect(listTasksMock.mock.calls[1][1]).toEqual({ updatedMin: undefined });
	});

	it('holds a write-through push until the round in flight has finished', async () => {
		// Both touch the same rows: a push racing a round can send the same task
		// twice, and the second markPushed overwrites the googleTaskId of the
		// first, orphaning a live Google task.
		const first = deferred<[]>();
		listTasksMock.mockReturnValueOnce(first.promise).mockResolvedValue([]);

		const round = syncGoogleTasks();
		const push = pushTaskNow('t1');
		await settle();
		expect(patchTaskMock).not.toHaveBeenCalled();

		first.resolve([]);
		await round;
		await push;
		expect(patchTaskMock).toHaveBeenCalledTimes(1);
	});
});
