import { describe, it, expect } from 'vitest';
import { buildMorningDigestContent } from './digest';

describe('buildMorningDigestContent', () => {
	// Constructed in local time on purpose: due dates are local YYYY-MM-DD, and
	// the suite pins TZ so these instants mean the same thing everywhere.
	const today = new Date(2026, 6, 18, 8, 0); // 08:00 local, 2026-07-18

	it('keeps the counts sentence as the summary for push bodies', () => {
		const tasks = [
			{ id: '1', title: 'Overdue thing', dueDate: '2026-07-17', done: false },
			{ id: '2', title: 'Due today thing', dueDate: '2026-07-18', done: false },
			{ id: '3', title: 'No due date', dueDate: null, done: false }
		];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.summary).toContain('3 open task');
		expect(result.summary).toContain('1 overdue');
		expect(result.summary).toContain('1 due today');
		expect(result.taskIds.sort()).toEqual(['1', '2', '3']);
	});

	it('lists overdue and due-today tasks by title, with the rest as a count', () => {
		const tasks = [
			{ id: '1', title: 'Return library books', dueDate: '2026-07-16', done: false },
			{ id: '2', title: 'Problem set', dueDate: '2026-07-17', done: false },
			{ id: '3', title: 'Dentist form', dueDate: '2026-07-18', done: false },
			{ id: '4', title: 'Reorder filament', dueDate: null, done: false },
			{ id: '5', title: 'Water plants', dueDate: '2026-07-25', done: false }
		];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.text).toContain('Overdue:');
		expect(result.text).toContain('• Return library books — due Jul 16');
		expect(result.text).toContain('• Problem set — due Jul 17');
		expect(result.text).toContain('Due today:');
		expect(result.text).toContain('• Dentist form');
		expect(result.text).toContain('…and 2 more on the table.');
		expect(result.text).not.toContain('Reorder filament');
		expect(result.text).not.toContain('Water plants');
	});

	it('omits the trailing count when every open task is urgent', () => {
		const tasks = [{ id: '1', title: 'Only thing', dueDate: '2026-07-18', done: false }];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.text).toContain('• Only thing');
		expect(result.text).not.toContain('more on the table');
	});

	it('falls back to the counts sentence when nothing is urgent', () => {
		const tasks = [
			{ id: '1', title: 'Someday thing', dueDate: null, done: false },
			{ id: '2', title: 'Next week', dueDate: '2026-07-25', done: false }
		];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.text).toBe(result.summary);
		expect(result.text).toContain('2 open task');
	});

	it('does not roll over to tomorrow late in the evening', () => {
		// 23:30 local is already tomorrow in UTC, which made today's tasks read
		// as overdue and tomorrow's as due today, hours early.
		const lateEvening = new Date(2026, 6, 18, 23, 30);
		const tasks = [
			{ id: '1', title: 'Due today', dueDate: '2026-07-18', done: false },
			{ id: '2', title: 'Due tomorrow', dueDate: '2026-07-19', done: false }
		];
		const result = buildMorningDigestContent(tasks, lateEvening);
		expect(result.summary).toContain('1 due today');
		expect(result.summary).not.toContain('overdue');
		expect(result.text).toContain('• Due today');
		expect(result.text).not.toContain('• Due tomorrow');
	});

	it('handles an empty table', () => {
		const result = buildMorningDigestContent([], today);
		expect(result.text).toContain('nothing on the table');
		expect(result.summary).toContain('nothing on the table');
		expect(result.taskIds).toEqual([]);
	});
});
