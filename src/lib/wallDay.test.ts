import { describe, it, expect } from 'vitest';
import { placeDay, allDayEvents, dayBounds, MIN_EVENT_MINUTES } from './wallDay';
import type { AgendaEvent } from './server/gcal/agenda';

const BOUNDS = { startHour: 8, endHour: 22 };

/** Local wall-clock times: the grid is drawn in the viewer's own hours. */
const at = (hour: number, minute = 0) => new Date(2026, 8, 15, hour, minute).toISOString();

const event = (title: string, start: string, end: string | null = null): AgendaEvent => ({
	id: title,
	calendarId: 'me@example.com',
	title,
	start,
	end,
	allDay: false,
	location: null
});

const lanes = (events: AgendaEvent[]) =>
	placeDay(events, BOUNDS).map((p) => [p.event.title, p.lane, p.lanes]);

describe('placeDay', () => {
	it('gives a lone event the full width', () => {
		expect(lanes([event('Standup', at(9, 30), at(10))])).toEqual([['Standup', 0, 1]]);
	});

	it('splits two overlapping events into lanes', () => {
		expect(
			lanes([event('Lunch', at(12, 30), at(13, 30)), event('Design review', at(13), at(14))])
		).toEqual([
			['Lunch', 0, 2],
			['Design review', 1, 2]
		]);
	});

	it('widens a cluster to three lanes when three collide', () => {
		const placed = lanes([
			event('A', at(9), at(11)),
			event('B', at(9, 30), at(10, 30)),
			event('C', at(10), at(12))
		]);
		expect(placed.map((p) => p[2])).toEqual([3, 3, 3]);
		expect(placed.map((p) => p[1])).toEqual([0, 1, 2]);
	});

	it('treats back-to-back meetings as a sequence, not an overlap', () => {
		expect(lanes([event('First', at(13), at(14)), event('Second', at(14), at(15))])).toEqual([
			['First', 0, 1],
			['Second', 0, 1]
		]);
	});

	it('reuses a lane once its meeting has finished', () => {
		// C starts after A ends, so it takes A's lane rather than a third one.
		const placed = lanes([
			event('A', at(9), at(10)),
			event('B', at(9, 30), at(12)),
			event('C', at(10, 30), at(11))
		]);
		expect(placed).toEqual([
			['A', 0, 2],
			['B', 1, 2],
			['C', 0, 2]
		]);
	});

	it('clamps an event that starts before the first drawn hour', () => {
		const [placed] = placeDay([event('Early', at(6, 30), at(9))], BOUNDS);
		expect(placed.start).toBe(8 * 60);
		expect(placed.end).toBe(9 * 60);
	});

	it('drops an event that falls entirely outside the drawn hours', () => {
		expect(placeDay([event('Night shift', at(23), at(23, 45))], BOUNDS)).toEqual([]);
	});

	it('gives an event with no end a readable minimum height', () => {
		const [placed] = placeDay([event('Reminder', at(9))], BOUNDS);
		expect(placed.end - placed.start).toBe(MIN_EVENT_MINUTES);
	});

	it('leaves all-day events to their own row', () => {
		const conference = { ...event('Conference', at(0)), allDay: true };
		expect(placeDay([conference], BOUNDS)).toEqual([]);
		expect(allDayEvents([conference, event('Standup', at(9))]).map((e) => e.title)).toEqual([
			'Conference'
		]);
	});
});

describe('dayBounds', () => {
	const now = new Date(2026, 8, 16, 10, 17);

	it('frames the day an hour either side of the meetings', () => {
		expect(
			dayBounds([event('Stats', at(8), at(9, 15)), event('Ethics', at(18, 30), at(20, 30))], now)
		).toEqual({
			startHour: 7,
			endHour: 21
		});
	});

	it('keeps the current hour on the grid when the day is empty', () => {
		const bounds = dayBounds([], now);
		expect(bounds.startHour).toBeLessThanOrEqual(10);
		expect(bounds.endHour).toBeGreaterThanOrEqual(12);
	});

	it('never runs past the small hours at either end', () => {
		const bounds = dayBounds(
			[event('Night owl', at(23, 30), at(23, 59)), event('Dawn', at(5), at(6))],
			now
		);
		expect(bounds.startHour).toBe(6);
		expect(bounds.endHour).toBe(23);
	});
});
