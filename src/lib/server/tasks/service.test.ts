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
		})
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
});
