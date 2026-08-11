import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task } from './service';

let rows: Task[] = [];
let tombstones: { googleTaskId: string; deletedAt: string }[] = [];
vi.mock('../db', () => ({
	db: {
		insert: () => ({
			values: (r: Task) => {
				// Store a copy, not the caller's own object: a real database row is
				// never the same object the caller constructed, and callers that hold
				// on to their return value (e.g. `const t = await createTask(...)`)
				// must see a stable snapshot even as the "database" row is mutated
				// later by updates.
				rows.push({ ...r });
				return Promise.resolve();
			}
		}),
		query: {
			tasks: {
				findMany: () => Promise.resolve([...rows]),
				findFirst: () => Promise.resolve(rows[0])
			}
		},
		update: () => ({
			set: (patch: Partial<Task>) => ({
				where: () => {
					Object.assign(rows[0], patch);
					return Promise.resolve();
				}
			})
		}),
		delete: () => ({
			where: () => {
				rows.length = 0;
				return Promise.resolve();
			}
		}),
		transaction: (fn: (tx: unknown) => void) => {
			fn({
				insert: () => ({
					values: (v: { googleTaskId: string; deletedAt: string }) => ({
						onConflictDoNothing: () => ({
							run: () => {
								tombstones.push(v);
							}
						})
					})
				}),
				delete: () => ({
					where: () => ({
						run: () => {
							rows.length = 0;
						}
					})
				})
			});
		}
	}
}));

import * as tasksService from './service';

describe('tasks service', () => {
	beforeEach(() => {
		rows = [];
		tombstones = [];
	});

	it('creates a standalone task with a position and no topic', async () => {
		const t = await tasksService.createTask({ title: 'Buy milk', x: 12, y: 34 });
		expect(t.title).toBe('Buy milk');
		expect(t.x).toBe(12);
		expect(t.y).toBe(34);
		expect('topicId' in t).toBe(false);
	});

	it('updates a task position', async () => {
		await tasksService.createTask({ title: 'Buy milk', x: 0, y: 0 });
		await tasksService.updateTaskPosition(rows[0].id, 100, 200);
		expect(rows[0]).toMatchObject({ x: 100, y: 200 });
	});

	it('stamps a new task with its creation time', async () => {
		const t = await tasksService.createTask({ title: 'Fresh' });
		expect(t.updatedAt).toBe(t.createdAt);
	});

	it('bumps updatedAt when a field Google can see changes', async () => {
		// Fake timers plus a strict `toBeGreaterThan` avoid a same-millisecond
		// false pass: with real timers and `toBeGreaterThanOrEqual`, a build that
		// never bumps `updatedAt` at all would still satisfy the assertion.
		vi.useFakeTimers();
		try {
			const t = await tasksService.createTask({ title: 'Before' });
			vi.advanceTimersByTime(1000);
			await tasksService.updateTask(t.id, { title: 'After' });
			expect(rows[0].updatedAt).not.toBe('');
			expect(Date.parse(rows[0].updatedAt)).toBeGreaterThan(Date.parse(t.updatedAt));
		} finally {
			vi.useRealTimers();
		}
	});

	it('bumps updatedAt when a due date is cleared', async () => {
		// `field in patch` must stay true for `{ dueDate: null }` — clearing a due
		// date is itself a change Google needs to know about, so a refactor to
		// `field in patch && patch[field]` (falsy-checking the new value) would
		// silently stop treating this as dirty. Fake timers make the clock move
		// deterministically, so a missed bump shows up as an unchanged updatedAt
		// rather than a coin-flip on same-millisecond timestamps.
		vi.useFakeTimers();
		try {
			const t = await tasksService.createTask({ title: 'Due today', dueDate: '2026-08-11' });
			vi.advanceTimersByTime(1000);
			await tasksService.updateTask(t.id, { dueDate: null });
			expect(rows[0].dueDate).toBeNull();
			expect(Date.parse(rows[0].updatedAt)).toBeGreaterThan(Date.parse(t.updatedAt));
		} finally {
			vi.useRealTimers();
		}
	});

	it('bumps updatedAt on completion', async () => {
		const t = await tasksService.createTask({ title: 'Toggle me' });
		await tasksService.toggleTaskDone(t.id);
		expect(rows[0].completedAt).not.toBeNull();
		expect(rows[0].updatedAt).toBe(rows[0].completedAt);
	});

	it('does NOT bump updatedAt when only the priority changes', async () => {
		// Fake timers plus a clock advance mean a regression that bumps
		// `updatedAt` produces a visibly different timestamp instead of risking a
		// same-millisecond coincidence that would let the assertion pass anyway.
		vi.useFakeTimers();
		try {
			const t = await tasksService.createTask({ title: 'Priority only' });
			vi.advanceTimersByTime(1000);
			await tasksService.updateTask(t.id, { priority: 'high' });
			expect(rows[0].priority).toBe('high');
			expect(rows[0].updatedAt).toBe(t.updatedAt);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does NOT bump updatedAt when a card is moved', async () => {
		// Dirtiness is `updatedAt !== googleSyncedAt`, so a drag that bumped this
		// would fire a pointless push and could win a conflict against a real edit
		// made on the phone. Fake timers + a clock advance make a regression that
		// bumps `updatedAt` show up as a changed timestamp rather than risking a
		// same-millisecond coincidence.
		vi.useFakeTimers();
		try {
			const t = await tasksService.createTask({ title: 'Dragged' });
			vi.advanceTimersByTime(1000);
			await tasksService.updateTaskPosition(t.id, 500, 500);
			expect(rows[0].x).toBe(500);
			expect(rows[0].updatedAt).toBe(t.updatedAt);
		} finally {
			vi.useRealTimers();
		}
	});

	it('records the opt-in without marking the task dirty', async () => {
		// Fake timers + a clock advance make a regression that bumps `updatedAt`
		// show up as a changed timestamp rather than risking a same-millisecond
		// coincidence that would let the assertion pass anyway.
		vi.useFakeTimers();
		try {
			const t = await tasksService.createTask({ title: 'Opt me in' });
			vi.advanceTimersByTime(1000);
			await tasksService.setGoogleSync(t.id, true);
			expect(rows[0].googleSync).toBe(true);
			expect(rows[0].updatedAt).toBe(t.updatedAt);
		} finally {
			vi.useRealTimers();
		}
	});

	it('records a tombstone carrying the googleTaskId when deleting a linked task', async () => {
		const t = await tasksService.createTask({ title: 'Linked' });
		rows[0].googleTaskId = 'g-123';
		await tasksService.deleteTask(t.id);
		expect(tombstones).toEqual([{ googleTaskId: 'g-123', deletedAt: expect.any(String) }]);
		expect(rows).toHaveLength(0);
	});

	it('records no tombstone when deleting an unlinked task', async () => {
		const t = await tasksService.createTask({ title: 'Unlinked' });
		// googleTaskId defaults to null from createTask, i.e. never synced.
		await tasksService.deleteTask(t.id);
		expect(tombstones).toEqual([]);
		expect(rows).toHaveLength(0);
	});

	// The mock's `findFirst` ignores the id it is passed and always returns
	// `rows[0]`, so this can only exercise "no rows at all" — not "wrong id
	// while other rows exist." Making the mock id-aware would mean introspecting
	// the drizzle `eq(tasks.id, id)` fragment `deleteTask` passes as `where`,
	// which is internal drizzle structure this mock has no business depending
	// on. Named narrowly instead of widening the mock for one test.
	it('is a no-op when there are no tasks to delete', async () => {
		await expect(tasksService.deleteTask('missing-id')).resolves.toBeUndefined();
		expect(tombstones).toEqual([]);
		expect(rows).toHaveLength(0);
	});
});
