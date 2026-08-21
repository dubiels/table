import { describe, it, expect } from 'vitest';
import { formatDueDate, localDateString } from './date';

describe('formatDueDate', () => {
	it('renders a local date as a short month and day', () => {
		expect(formatDueDate('2026-03-04')).toBe('Mar 4');
	});

	it('does not shift the day back across the UTC boundary', () => {
		// new Date('2026-01-01') is UTC midnight, which is Dec 31 in the test zone.
		// Parsing the parts is what keeps this on Jan 1.
		expect(formatDueDate('2026-01-01')).toBe('Jan 1');
	});
});

describe('localDateString', () => {
	it('reads the local calendar day, not the UTC one', () => {
		// 02:00Z on New Year's Day is still Dec 31 in America/New_York.
		expect(localDateString(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
	});
});
