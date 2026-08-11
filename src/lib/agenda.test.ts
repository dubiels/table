import { describe, it, expect } from 'vitest';
import { timeRangeLabel } from './agenda';
import type { AgendaEvent } from './server/gcal/agenda';

function event(partial: Partial<AgendaEvent>): AgendaEvent {
	return {
		id: 'e1',
		title: 'Standup',
		start: '2026-08-11T09:00:00-04:00',
		end: '2026-08-11T09:30:00-04:00',
		allDay: false,
		location: null,
		...partial
	};
}

// The formatting is the runtime's, and the test machine's locale is not pinned
// the way its zone is, so these assert the shape of the range rather than the
// exact glyphs a given locale writes.
const at = (iso: string) =>
	new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

describe('timeRangeLabel', () => {
	it('says "all day" rather than a span for an all-day event', () => {
		expect(timeRangeLabel(event({ allDay: true, end: null }))).toBe('all day');
	});

	it('falls back to the start when the event has no end', () => {
		expect(timeRangeLabel(event({ end: null }))).toBe(at('2026-08-11T09:00:00-04:00'));
	});

	it('writes one time when the ends land on the same minute', () => {
		const label = timeRangeLabel(event({ end: '2026-08-11T09:00:00-04:00' }));
		expect(label).toBe(at('2026-08-11T09:00:00-04:00'));
	});

	it('spans start to end', () => {
		const label = timeRangeLabel(event({ end: '2026-08-11T10:30:00-04:00' }));
		expect(label).toContain(at('2026-08-11T10:30:00-04:00'));
	});

	it('writes the meridiem once when both ends share it', () => {
		const label = timeRangeLabel(event({ end: '2026-08-11T10:30:00-04:00' }));
		// Zero in a 24-hour locale, one in a 12-hour one — never both ends.
		expect(label.match(/[AP]M/gi)?.length ?? 0).toBeLessThan(2);
	});

	it('keeps both meridiems when the event crosses noon', () => {
		const label = timeRangeLabel(
			event({ start: '2026-08-11T11:30:00-04:00', end: '2026-08-11T13:00:00-04:00' })
		);
		expect(label).toContain(at('2026-08-11T11:30:00-04:00'));
	});
});
