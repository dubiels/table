import { describe, it, expect } from 'vitest';
import { wallDayLabel, wallPills, isOnTodaysPlan, dayOffset } from './wallDates';

const TODAY = '2026-09-15'; // a Tuesday

const task = (dueDate: string | null, plannedDate: string | null, done = false) => ({
	dueDate,
	plannedDate,
	done
});

describe('wallDayLabel', () => {
	it('names the days either side of today in words', () => {
		expect(wallDayLabel('2026-09-15', TODAY)).toBe('today');
		expect(wallDayLabel('2026-09-16', TODAY)).toBe('tomorrow');
		expect(wallDayLabel('2026-09-14', TODAY)).toBe('yesterday');
	});

	it('uses a weekday inside the coming week', () => {
		expect(wallDayLabel('2026-09-17', TODAY)).toBe('Thu');
		expect(wallDayLabel('2026-09-20', TODAY)).toBe('Sun');
	});

	it('switches to a date on the seventh day, when a weekday would be ambiguous', () => {
		// Also a Tuesday: "Tue" here would be indistinguishable from today.
		expect(wallDayLabel('2026-09-22', TODAY)).toBe('Sep 22');
	});

	it('never uses a weekday for the past', () => {
		expect(wallDayLabel('2026-09-11', TODAY)).toBe('Sep 11');
	});

	it('adds the year only when it differs from today', () => {
		expect(wallDayLabel('2026-12-31', TODAY)).toBe('Dec 31');
		expect(wallDayLabel('2027-01-08', TODAY)).toBe('Jan 8, 2027');
	});
});

describe('dayOffset', () => {
	it('counts calendar days across a month boundary', () => {
		expect(dayOffset('2026-10-01', TODAY)).toBe(16);
		expect(dayOffset('2026-08-14', TODAY)).toBe(-32);
	});
});

describe('wallPills', () => {
	it('says Do and Due in that order when a task carries both', () => {
		expect(wallPills(task('2026-09-18', '2026-09-16'), TODAY)).toEqual([
			{ kind: 'do', text: 'Do tomorrow', tone: 'plain' },
			{ kind: 'due', text: 'Due Fri', tone: 'plain' }
		]);
	});

	it('reddens a passed deadline', () => {
		expect(wallPills(task('2026-08-14', null), TODAY)).toEqual([
			{ kind: 'due', text: 'Due Aug 14', tone: 'late' }
		]);
	});

	it('calls a plan for today, and one already passed, the work in front of you', () => {
		expect(wallPills(task(null, TODAY), TODAY)[0].tone).toBe('now');
		expect(wallPills(task(null, '2026-09-14'), TODAY)[0].tone).toBe('now');
	});

	it('leaves a future plan plain', () => {
		expect(wallPills(task(null, '2026-09-16'), TODAY)[0].tone).toBe('plain');
	});

	it('says nothing about a task with no dates, or a finished one', () => {
		expect(wallPills(task(null, null), TODAY)).toEqual([]);
		expect(wallPills(task('2026-08-14', '2026-08-14', true), TODAY)).toEqual([]);
	});
});

describe('isOnTodaysPlan', () => {
	it('covers today and every day before it', () => {
		expect(isOnTodaysPlan(task(null, TODAY), TODAY)).toBe(true);
		expect(isOnTodaysPlan(task(null, '2026-09-14'), TODAY)).toBe(true);
	});

	it('ignores a future plan, a missing plan, and a finished task', () => {
		expect(isOnTodaysPlan(task(null, '2026-09-16'), TODAY)).toBe(false);
		expect(isOnTodaysPlan(task('2026-09-15', null), TODAY)).toBe(false);
		expect(isOnTodaysPlan(task(null, '2026-09-14', true), TODAY)).toBe(false);
	});
});
