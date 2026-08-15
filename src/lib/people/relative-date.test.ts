import { describe, it, expect } from 'vitest';
import { contactHeat, daysSince, describeAge } from './relative-date';

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

describe('contactHeat', () => {
	// Boundaries are asserted on both sides: an off-by-one here would silently
	// mis-colour a whole band and nothing else would catch it.
	it.each([
		['2026-08-15', 'fresh', 'same day'],
		['2026-08-02', 'fresh', '13 days'],
		['2026-08-01', 'recent', '14 days, the first recent day'],
		['2026-07-02', 'recent', '44 days'],
		['2026-07-01', 'cooling', '45 days, the first cooling day'],
		['2026-05-18', 'cooling', '89 days'],
		['2026-05-17', 'stale', '90 days, the first stale day'],
		['2026-02-17', 'stale', '179 days'],
		['2026-02-16', 'cold', '180 days, the first cold day'],
		['2020-01-01', 'cold', 'years']
	])('%s is %s (%s)', (date, expected) => {
		expect(contactHeat(date, TODAY)).toBe(expected);
	});

	// Not a degree of cold: there is nothing to have gone quiet on, and treating
	// it as the worst case would bury the people who genuinely have.
	it('is none when nothing has been logged', () => {
		expect(contactHeat(null, TODAY)).toBe('none');
		expect(contactHeat(undefined, TODAY)).toBe('none');
	});

	it('is none for an unparseable date rather than guessing a band', () => {
		expect(contactHeat('whenever', TODAY)).toBe('none');
	});

	it('treats a future date as freshly in touch', () => {
		expect(contactHeat('2026-09-01', TODAY)).toBe('fresh');
	});
});
