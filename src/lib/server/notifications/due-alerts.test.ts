import { describe, it, expect } from 'vitest';
import { buildDueSoonContent, findTasksNeedingDueAlert } from './due-alerts';

describe('buildDueSoonContent', () => {
	it('lists each task by title and due date under a count summary', () => {
		const tasks = [
			{ id: '1', title: 'Problem set', dueDate: '2026-07-19', done: false },
			{ id: '2', title: 'Lab report', dueDate: '2026-07-19', done: false }
		];
		const result = buildDueSoonContent(tasks);
		expect(result.summary).toBe('2 tasks due soon.');
		expect(result.text).toContain('• Problem set — due Jul 19');
		expect(result.text).toContain('• Lab report — due Jul 19');
		expect(result.taskIds).toEqual(['1', '2']);
	});

	it('uses the singular form for one task', () => {
		const tasks = [{ id: '1', title: 'Problem set', dueDate: '2026-07-19', done: false }];
		const result = buildDueSoonContent(tasks);
		expect(result.summary).toBe('1 task due soon.');
	});
});

describe('findTasksNeedingDueAlert', () => {
	// Constructed in local time on purpose: due dates are local YYYY-MM-DD, and
	// the suite pins TZ so these instants mean the same thing everywhere.
	const now = new Date(2026, 6, 18, 8, 0); // 08:00 local, 2026-07-18

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
				sentAt: new Date(2026, 6, 18, 3, 0).toISOString(), // 03:00 local, same day
				content: JSON.stringify({ text: 'x', taskIds: ['1'] })
			}
		];
		const result = findTasksNeedingDueAlert(tasks, sent, now, 24);
		expect(result).toEqual([]);
	});

	it('still counts this morning’s alert as "today" late in the evening', () => {
		// 23:30 local is already tomorrow in UTC. Slicing ISO strings put "now"
		// and the morning's alert on different calendar days, so the task was
		// alerted a second time before midnight.
		const lateEvening = new Date(2026, 6, 18, 23, 30);
		const tasks = [{ id: '1', dueDate: '2026-07-18', done: false }];
		const sent = [
			{
				type: 'due_alert',
				sentAt: new Date(2026, 6, 18, 9, 0).toISOString(), // 09:00 local, same day
				content: JSON.stringify({ text: 'x', taskIds: ['1'] })
			}
		];
		const result = findTasksNeedingDueAlert(tasks, sent, lateEvening, 24);
		expect(result).toEqual([]);
	});

	it('anchors the lead window at local midnight, not UTC midnight', () => {
		// 22:00 local on the 18th. The 20th begins at local midnight, 26h away —
		// outside a 24h lead window. Parsing the due date as UTC midnight put it
		// only 22h away, so the alert fired a day early (up to 5h early in general,
		// 4h under EDT).
		const lateNight = new Date(2026, 6, 18, 22, 0);
		const tasks = [
			{ id: 'day-after-tomorrow', dueDate: '2026-07-20', done: false },
			{ id: 'tomorrow', dueDate: '2026-07-19', done: false }
		];
		const result = findTasksNeedingDueAlert(tasks, [], lateNight, 24);
		expect(result.map((t) => t.id)).toEqual(['tomorrow']);
	});

	it('includes an overdue task', () => {
		const tasks = [{ id: '1', dueDate: '2026-07-10', done: false }];
		const result = findTasksNeedingDueAlert(tasks, [], now, 24);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});
});
