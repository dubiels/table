import { describe, it, expect } from 'vitest';
import { taskMarks } from './taskMarks';

const TODAY = '2026-08-21';

describe('taskMarks', () => {
	it('marks a passed deadline overdue', () => {
		expect(taskMarks({ dueDate: '2026-08-20', plannedDate: null, done: false }, TODAY)).toEqual({
			overdue: true,
			slipped: false,
			unachievable: false
		});
	});

	it('marks a passed plan slipped while the deadline still holds', () => {
		expect(
			taskMarks({ dueDate: '2026-08-30', plannedDate: '2026-08-19', done: false }, TODAY)
		).toEqual({ overdue: false, slipped: true, unachievable: false });
	});

	it('does not call a task slipped once it is already overdue', () => {
		// One story per card. Overdue is the louder and truer of the two.
		// plannedDate precedes dueDate here so this case stays isolated from
		// unachievable (overdue-and-unachievable together is covered below).
		expect(
			taskMarks({ dueDate: '2026-08-19', plannedDate: '2026-08-18', done: false }, TODAY)
		).toEqual({ overdue: true, slipped: false, unachievable: false });
	});

	it('marks a plan later than its deadline unachievable', () => {
		expect(
			taskMarks({ dueDate: '2026-08-25', plannedDate: '2026-08-30', done: false }, TODAY)
		).toEqual({ overdue: false, slipped: false, unachievable: true });
	});

	it('reports overdue and unachievable together', () => {
		// Independent facts: the deadline has passed, and the plan was never
		// going to meet it anyway.
		expect(
			taskMarks({ dueDate: '2026-08-20', plannedDate: '2026-08-30', done: false }, TODAY)
		).toEqual({ overdue: true, slipped: false, unachievable: true });
	});

	it('marks nothing on a done task', () => {
		expect(
			taskMarks({ dueDate: '2026-08-01', plannedDate: '2026-08-30', done: true }, TODAY)
		).toEqual({ overdue: false, slipped: false, unachievable: false });
	});

	it('marks nothing on a task with neither date', () => {
		expect(taskMarks({ dueDate: null, plannedDate: null, done: false }, TODAY)).toEqual({
			overdue: false,
			slipped: false,
			unachievable: false
		});
	});
});
