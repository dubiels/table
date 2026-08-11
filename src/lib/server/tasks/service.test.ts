import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task } from './service';

let rows: Task[] = [];
vi.mock('../db', () => ({
	db: {
		insert: () => ({
			values: (r: Task) => {
				rows.push(r);
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
					values: () => ({ onConflictDoNothing: () => ({ run: () => {} }) })
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
		const t = await tasksService.createTask({ title: 'Before' });
		await tasksService.updateTask(t.id, { title: 'After' });
		expect(rows[0].updatedAt).not.toBe('');
		expect(Date.parse(rows[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(t.updatedAt));
	});

	it('bumps updatedAt on completion', async () => {
		const t = await tasksService.createTask({ title: 'Toggle me' });
		await tasksService.toggleTaskDone(t.id);
		expect(rows[0].completedAt).not.toBeNull();
		expect(rows[0].updatedAt).toBe(rows[0].completedAt);
	});

	it('does NOT bump updatedAt when only the priority changes', async () => {
		const t = await tasksService.createTask({ title: 'Priority only' });
		await tasksService.updateTask(t.id, { priority: 'high' });
		expect(rows[0].priority).toBe('high');
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});

	it('does NOT bump updatedAt when a card is moved', async () => {
		const t = await tasksService.createTask({ title: 'Dragged' });
		await tasksService.updateTaskPosition(t.id, 500, 500);
		// Dirtiness is `updatedAt !== googleSyncedAt`, so a drag that bumped this
		// would fire a pointless push and could win a conflict against a real edit
		// made on the phone.
		expect(rows[0].x).toBe(500);
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});

	it('records the opt-in without marking the task dirty', async () => {
		const t = await tasksService.createTask({ title: 'Opt me in' });
		await tasksService.setGoogleSync(t.id, true);
		expect(rows[0].googleSync).toBe(true);
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});
});
