import type { AgendaEvent } from './server/gcal/agenda';

/**
 * Placing a day's meetings on the wall's hour grid.
 *
 * The Today panel lists events one under another, so it never had to answer
 * what two meetings at the same hour look like. A day grid does: they sit side
 * by side, each in its own lane, the way every calendar draws them.
 *
 * Kept apart from `agenda.ts` because it answers a different question —
 * geometry rather than bucketing — and only the wall asks it.
 */

/** A timed event placed in its lane, with the width its cluster implies. */
export interface PlacedEvent {
	event: AgendaEvent;
	/** Minutes from midnight, clamped to the grid. */
	start: number;
	end: number;
	/** Which lane this event takes, from 0. */
	lane: number;
	/** How many lanes its overlapping cluster needs. */
	lanes: number;
}

export interface DayBounds {
	/** First hour drawn, e.g. 8 for 8 AM. */
	startHour: number;
	/** Last hour drawn, e.g. 22 for 10 PM. */
	endHour: number;
}

function minutesOf(iso: string): number {
	const d = new Date(iso);
	return d.getHours() * 60 + d.getMinutes();
}

/** Hours the grid never draws outside, however early or late the day runs. */
const EARLIEST = 6;
const LATEST = 23;

/**
 * The hours worth drawing: an hour before the first meeting, an hour after the
 * last, and always enough to hold the current time.
 *
 * A fixed 8-to-10 grid spends a third of the rail on hours with nothing in
 * them. Fitting the grid to the day gives every meeting more height, which is
 * what makes a 45-minute block readable at all.
 */
export function dayBounds(events: AgendaEvent[], now: Date): DayBounds {
	const nowHour = now.getHours() + now.getMinutes() / 60;
	const timed = events.filter((e) => !e.allDay);
	const starts = timed.map((e) => minutesOf(e.start) / 60);
	const ends = timed.map(
		(e) => (e.end ? minutesOf(e.end) : minutesOf(e.start) + MIN_EVENT_MINUTES) / 60
	);

	const first = Math.floor(Math.min(nowHour, ...starts) - 0.5);
	const last = Math.ceil(Math.max(nowHour + 1, ...ends) + 0.5);
	return {
		startHour: Math.max(EARLIEST, Math.min(first, LATEST - 2)),
		endHour: Math.min(LATEST, Math.max(last, Math.max(EARLIEST, first) + 2))
	};
}

/** The shortest block the grid will draw, so a 10-minute meeting stays legible. */
export const MIN_EVENT_MINUTES = 25;

/**
 * Today's timed events, clamped to the drawn hours and assigned lanes.
 *
 * All-day events are left out: they belong to the whole day rather than to an
 * hour, and the wall shows them in their own row above the grid.
 *
 * An event that runs past either edge is clamped rather than dropped — a
 * meeting from 7 AM is still happening at 8, and a wall that hides it is
 * lying by omission. One that lies wholly outside is dropped.
 */
export function placeDay(events: AgendaEvent[], bounds: DayBounds): PlacedEvent[] {
	const dayStart = bounds.startHour * 60;
	const dayEnd = bounds.endHour * 60;

	const timed = events
		.filter((e) => !e.allDay)
		.map((e) => {
			const start = minutesOf(e.start);
			const end = e.end ? minutesOf(e.end) : start + MIN_EVENT_MINUTES;
			return { event: e, start, end: Math.max(end, start + MIN_EVENT_MINUTES) };
		})
		.filter((e) => e.end > dayStart && e.start < dayEnd)
		.map((e) => ({
			...e,
			start: Math.max(e.start, dayStart),
			end: Math.min(e.end, dayEnd)
		}))
		.sort((a, b) => a.start - b.start || a.end - b.end);

	const placed: PlacedEvent[] = [];
	let cluster: PlacedEvent[] = [];
	// Lane ends, one per lane, for the cluster being built.
	let laneEnds: number[] = [];

	const closeCluster = () => {
		for (const item of cluster) item.lanes = laneEnds.length;
		placed.push(...cluster);
		cluster = [];
		laneEnds = [];
	};

	for (const item of timed) {
		// Touching is not overlapping: a meeting that ends at 2 and one that
		// starts at 2 are a sequence, and splitting them into lanes would halve
		// the width of both for nothing.
		if (cluster.length > 0 && item.start >= Math.max(...laneEnds)) closeCluster();

		let lane = laneEnds.findIndex((end) => end <= item.start);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(item.end);
		} else {
			laneEnds[lane] = item.end;
		}

		cluster.push({ ...item, lane, lanes: 1 });
	}
	if (cluster.length > 0) closeCluster();

	return placed;
}

/** All-day events, which the grid cannot place and shows in its own row. */
export function allDayEvents(events: AgendaEvent[]): AgendaEvent[] {
	return events.filter((e) => e.allDay);
}
