import { describe, it, expect } from 'vitest';
import { toAgendaEvents } from './agenda';
import type { GoogleEvent } from './client';

function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
	return {
		id: 'e1',
		summary: 'Advising meeting',
		start: { dateTime: '2026-08-11T14:00:00Z' },
		end: { dateTime: '2026-08-11T15:00:00Z' },
		...overrides
	};
}

describe('toAgendaEvents', () => {
	it('maps a timed event to UTC ISO strings', () => {
		const [mapped] = toAgendaEvents([event({ location: 'Room 5' })]);
		expect(mapped).toEqual({
			id: 'e1',
			title: 'Advising meeting',
			start: '2026-08-11T14:00:00.000Z',
			end: '2026-08-11T15:00:00.000Z',
			allDay: false,
			location: 'Room 5'
		});
	});

	it('normalises a dateTime carrying an offset to UTC', () => {
		const [mapped] = toAgendaEvents([
			event({ start: { dateTime: '2026-08-11T10:00:00-04:00' }, end: undefined })
		]);
		expect(mapped.start).toBe('2026-08-11T14:00:00.000Z');
	});

	it('maps an all-day event to local midnight and flags it', () => {
		const [mapped] = toAgendaEvents([
			event({ start: { date: '2026-08-11' }, end: { date: '2026-08-12' } })
		]);
		// Tests are pinned to America/New_York; August is UTC-4.
		expect(mapped.start).toBe('2026-08-11T04:00:00.000Z');
		expect(mapped.allDay).toBe(true);
	});

	it("passes an all-day event's exclusive end date through unchanged", () => {
		// Google reports a one-day event as ending on the following day. The ICS
		// path did the same, so the panel's arithmetic is unaffected.
		const [mapped] = toAgendaEvents([
			event({ start: { date: '2026-08-11' }, end: { date: '2026-08-12' } })
		]);
		expect(mapped.end).toBe('2026-08-12T04:00:00.000Z');
	});

	it('returns a null end when the payload has none', () => {
		const [mapped] = toAgendaEvents([event({ end: undefined })]);
		expect(mapped.end).toBeNull();
	});

	it('drops cancelled instances of a recurring series', () => {
		expect(toAgendaEvents([event({ status: 'cancelled' })])).toEqual([]);
	});

	it('drops an event this account declined', () => {
		const declined = event({
			attendees: [{ self: true, responseStatus: 'declined' }]
		});
		expect(toAgendaEvents([declined])).toEqual([]);
	});

	it('keeps an event this account accepted', () => {
		const accepted = event({
			attendees: [{ self: true, responseStatus: 'accepted' }]
		});
		expect(toAgendaEvents([accepted])).toHaveLength(1);
	});

	it('keeps an event someone else declined', () => {
		const otherDeclined = event({
			attendees: [
				{ self: true, responseStatus: 'accepted' },
				{ responseStatus: 'declined' }
			]
		});
		expect(toAgendaEvents([otherDeclined])).toHaveLength(1);
	});

	it('falls back to a placeholder title and a null location', () => {
		const [mapped] = toAgendaEvents([event({ summary: undefined, location: undefined })]);
		expect(mapped.title).toBe('(untitled)');
		expect(mapped.location).toBeNull();
	});

	it('skips an event with no usable start', () => {
		expect(toAgendaEvents([event({ start: undefined })])).toEqual([]);
	});
});
