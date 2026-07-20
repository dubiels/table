import { describe, it, expect } from 'vitest';
import { buildMorningDigestContent } from './digest';

describe('buildMorningDigestContent', () => {
	const today = new Date('2026-07-18T08:00:00Z');

	it('summarizes counts of overdue, due today, and total open tasks', () => {
		const tasks = [
			{ id: '1', title: 'Overdue thing', dueDate: '2026-07-17', done: false },
			{ id: '2', title: 'Due today thing', dueDate: '2026-07-18', done: false },
			{ id: '3', title: 'No due date', dueDate: null, done: false }
		];
		const result = buildMorningDigestContent(tasks, today);
		expect(result.text).toContain('3 open task');
		expect(result.text).toContain('1 overdue');
		expect(result.text).toContain('1 due today');
		expect(result.taskIds.sort()).toEqual(['1', '2', '3']);
	});

	it('handles an empty table', () => {
		const result = buildMorningDigestContent([], today);
		expect(result.text).toContain('nothing on the table');
		expect(result.taskIds).toEqual([]);
	});
});
