import type { AgendaEvent } from './server/gcal/agenda';

/**
 * Day-bucketing for the Today panel.
 *
 * These lived inside SidePanel while it owned both sections. Splitting Today
 * and Canvas into separate panels left the page needing the same counts for
 * the panel headers, so they moved out here rather than being derived twice.
 */

const MS_PER_DAY = 86_400_000;

export const UPCOMING_DAYS = 4;

const startOfDay = (date: Date) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole days from local midnight today to the local midnight `iso` falls in. */
export function daysFromToday(iso: string): number {
	return Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / MS_PER_DAY);
}

export function dayLabel(iso: string): string {
	const diffDays = daysFromToday(iso);
	if (diffDays === 0) return 'Today';
	if (diffDays === 1) return 'Tomorrow';
	return new Date(iso).toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});
}

export function timeLabel(event: AgendaEvent): string {
	if (event.allDay) return 'all day';
	return new Date(event.start).toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit'
	});
}

/**
 * Today's events, all-day first.
 *
 * All-day events frame the day rather than sit at a point in it, so a timed
 * 9am meeting listed above an all-day conference reads backwards.
 */
export function eventsToday(agenda: AgendaEvent[]): AgendaEvent[] {
	return agenda
		.filter((event) => daysFromToday(event.start) === 0)
		.sort((a, b) => {
			if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
			return a.start.localeCompare(b.start);
		});
}

export type DayGroup = { label: string; items: AgendaEvent[] };

/**
 * The next `days` days that have anything on them, grouped by day.
 *
 * Events arrive sorted ascending by start, so same-day events are always
 * adjacent — a running list groups them without reaching for a Map.
 */
export function upcomingByDay(agenda: AgendaEvent[], days = UPCOMING_DAYS): DayGroup[] {
	const result: DayGroup[] = [];
	for (const event of agenda) {
		if (daysFromToday(event.start) < 1) continue;
		const label = dayLabel(event.start);
		const current = result.at(-1);
		if (current && current.label === label) {
			current.items.push(event);
		} else {
			if (result.length === days) break;
			result.push({ label, items: [event] });
		}
	}
	return result;
}
