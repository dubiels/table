import { describe, it, expect } from 'vitest';
import { newTaskSchema } from './forms';

describe('newTaskSchema', () => {
	// A browser posts every control the form has rendered, so the composer's
	// Due/Priority row arrives as empty strings when it is open and untouched —
	// not as absent keys. Rejecting those is what made the composer swallow the
	// first press and only create the task on the second.
	it('accepts a submission with the open extras row left untouched', () => {
		const parsed = newTaskSchema.safeParse({
			title: 'Buy milk',
			x: '120',
			y: '80',
			dueDate: '',
			priority: ''
		});

		expect(parsed.success).toBe(true);
		expect(parsed.data?.priority).toBeUndefined();
		expect(parsed.data?.dueDate).toBeUndefined();
	});

	it('keeps the values the extras row does carry', () => {
		const parsed = newTaskSchema.safeParse({
			title: 'Buy milk',
			x: '120',
			y: '80',
			dueDate: '2026-08-12',
			priority: 'high'
		});

		expect(parsed.success).toBe(true);
		expect(parsed.data).toMatchObject({ dueDate: '2026-08-12', priority: 'high', x: 120, y: 80 });
	});

	it('accepts a submission with the extras row closed', () => {
		const parsed = newTaskSchema.safeParse({ title: 'Buy milk', x: '120', y: '80' });

		expect(parsed.success).toBe(true);
	});

	it('rejects a blank title', () => {
		expect(newTaskSchema.safeParse({ title: '', x: '120', y: '80' }).success).toBe(false);
	});

	it('rejects a priority that is neither blank nor a known level', () => {
		expect(
			newTaskSchema.safeParse({ title: 'Buy milk', x: '1', y: '2', priority: 'urgent' }).success
		).toBe(false);
	});
});

describe('newTaskSchema plannedDate', () => {
	it('reads a planned date off the form', () => {
		const parsed = newTaskSchema.safeParse({
			title: 'Ship it',
			dueDate: '2026-09-01',
			plannedDate: '2026-08-20'
		});

		expect(parsed.success && parsed.data.plannedDate).toBe('2026-08-20');
	});

	it('treats a blank planned date as not set', () => {
		const parsed = newTaskSchema.safeParse({ title: 'Ship it', plannedDate: '' });

		expect(parsed.success && parsed.data.plannedDate).toBeUndefined();
	});

	it('accepts a plan later than its deadline', () => {
		// A plan that misses the deadline is a state the board marks, never a
		// state the server refuses.
		const parsed = newTaskSchema.safeParse({
			title: 'Ship it',
			dueDate: '2026-08-20',
			plannedDate: '2026-09-01'
		});

		expect(parsed.success).toBe(true);
	});
});
