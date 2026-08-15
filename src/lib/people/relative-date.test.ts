import { describe, it, expect } from 'vitest';
import { daysSince, describeAge, isStale } from './relative-date';

const TODAY = '2026-08-15';

describe('daysSince', () => {
	it('counts whole days between two dates', () => {
		expect(daysSince('2026-08-10', TODAY)).toBe(5);
	});

	it('is zero for the same day', () => {
		expect(daysSince(TODAY, TODAY)).toBe(0);
	});

	it('goes negative for a future date', () => {
		expect(daysSince('2026-08-20', TODAY)).toBe(-5);
	});

	// A DST boundary must not turn 1 day into 0 or 2 — which is exactly what
	// comparing local midnights would do.
	it('counts correctly across a daylight-saving change', () => {
		expect(daysSince('2026-03-07', '2026-03-09')).toBe(2);
		expect(daysSince('2026-10-31', '2026-11-02')).toBe(2);
	});

	it('counts across a leap day', () => {
		expect(daysSince('2028-02-28', '2028-03-01')).toBe(2);
	});

	it('returns null for an unparseable date', () => {
		expect(daysSince('not-a-date', TODAY)).toBeNull();
	});
});

describe('describeAge', () => {
	it('says today for the same day', () => {
		expect(describeAge(TODAY, TODAY)).toBe('today');
	});

	it('says yesterday for one day back', () => {
		expect(describeAge('2026-08-14', TODAY)).toBe('yesterday');
	});

	it('counts days under a week', () => {
		expect(describeAge('2026-08-12', TODAY)).toBe('3 days ago');
	});

	it('switches to weeks at seven days', () => {
		expect(describeAge('2026-08-08', TODAY)).toBe('a week ago');
		expect(describeAge('2026-08-01', TODAY)).toBe('2 weeks ago');
	});

	it('switches to months at a month', () => {
		expect(describeAge('2026-07-01', TODAY)).toBe('a month ago');
		expect(describeAge('2026-05-01', TODAY)).toBe('3 months ago');
	});

	it('switches to years at a year', () => {
		expect(describeAge('2025-06-01', TODAY)).toBe('a year ago');
		expect(describeAge('2024-01-01', TODAY)).toBe('2 years ago');
	});

	// A future date is a typo or a plan, not a memory.
	it('reports a future date plainly rather than as a negative age', () => {
		expect(describeAge('2026-09-01', TODAY)).toBe('in the future');
	});

	it('returns null for a missing or unparseable date', () => {
		expect(describeAge(null, TODAY)).toBeNull();
		expect(describeAge(undefined, TODAY)).toBeNull();
		expect(describeAge('whenever', TODAY)).toBeNull();
	});
});

describe('isStale', () => {
	it('is false for recent contact', () => {
		expect(isStale('2026-08-01', TODAY)).toBe(false);
	});

	it('is true once ninety days have passed', () => {
		expect(isStale('2026-05-17', TODAY)).toBe(true);
	});

	it('is false on the day before the threshold', () => {
		expect(isStale('2026-05-19', TODAY)).toBe(false);
	});

	// Someone with no recorded contact is not "stale" — there is nothing to have
	// gone quiet on, and flagging them would bury the people who really have.
	it('is false when there is no date at all', () => {
		expect(isStale(null, TODAY)).toBe(false);
	});
});
