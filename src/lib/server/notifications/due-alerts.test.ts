import { describe, it, expect } from 'vitest';
import { findTasksNeedingDueAlert } from './due-alerts';

describe('findTasksNeedingDueAlert', () => {
	const now = new Date('2026-07-18T08:00:00Z');

	it('includes a task due within the lead window', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-19', done: false }];
		const result = findTasksNeedingDueAlert(tasks, [], now, 24);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});

	it('excludes a task due outside the lead window', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-25', done: false }];
		const result = findTasksNeedingDueAlert(tasks, [], now, 24);
		expect(result).toEqual([]);
	});

	it('excludes a done task even if due soon', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-18', done: true }];
		const result = findTasksNeedingDueAlert(tasks, [], now, 24);
		expect(result).toEqual([]);
	});

	it('excludes a task already alerted on today', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-18', done: false }];
		const sent = [
			{
				type: 'due_alert',
				sentAt: '2026-07-18T07:00:00Z',
				content: JSON.stringify({ text: 'x', taskIds: ['1'] })
			}
		];
		const result = findTasksNeedingDueAlert(tasks, sent, now, 24);
		expect(result).toEqual([]);
	});

	it('includes an overdue task', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-10', done: false }];
		const result = findTasksNeedingDueAlert(tasks, [], now, 24);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});
});
