import { describe, it, expect } from 'vitest';
import { upcomingEvents } from './agenda';

function ics(body: string[]): string {
	return ['BEGIN:VCALENDAR', ...body, 'END:VCALENDAR'].join('\r\n');
}

const from = new Date('2026-08-09T00:00:00Z');

describe('upcomingEvents', () => {
	it('includes a timed event inside the window', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:t1',
			'SUMMARY:Advising meeting',
			'DTSTART:20260811T140000Z',
			'DTEND:20260811T150000Z',
			'LOCATION:Room 5',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			title: 'Advising meeting',
			start: '2026-08-11T14:00:00.000Z',
			end: '2026-08-11T15:00:00.000Z',
			allDay: false,
			location: 'Room 5'
		});
	});

	it('excludes events outside the window', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:t2',
			'SUMMARY:Far future',
			'DTSTART:20261001T140000Z',
			'DTEND:20261001T150000Z',
			'END:VEVENT'
		]);
		expect(upcomingEvents(text, from, 7)).toHaveLength(0);
	});

	it('flags all-day events', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:a1',
			'SUMMARY:Reading day',
			'DTSTART;VALUE=DATE:20260812',
			'DTEND;VALUE=DATE:20260813',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		expect(events).toHaveLength(1);
		expect(events[0].allDay).toBe(true);
	});

	it('expands weekly recurrences into window occurrences', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:r1',
			'SUMMARY:CS lecture',
			'DTSTART:20260803T140000Z',
			'DTEND:20260803T152000Z',
			'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		// window 8/9–8/16 contains Mon 8/10 and Wed 8/12
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.title === 'CS lecture')).toBe(true);
		// occurrences keep the master's duration
		const first = events[0];
		expect(new Date(first.end!).getTime() - new Date(first.start).getTime()).toBe(80 * 60000);
		// distinct ids per occurrence
		expect(new Set(events.map((e) => e.id)).size).toBe(2);
	});

	it('sorts by start time', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:b',
			'SUMMARY:Later',
			'DTSTART:20260811T170000Z',
			'DTEND:20260811T180000Z',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'UID:a',
			'SUMMARY:Earlier',
			'DTSTART:20260810T090000Z',
			'DTEND:20260810T100000Z',
			'END:VEVENT'
		]);
		expect(upcomingEvents(text, from, 7).map((e) => e.title)).toEqual(['Earlier', 'Later']);
	});
});
