import type { GoogleEvent, GoogleEventTime } from './client';

export interface AgendaEvent {
	id: string;
	title: string;
	start: string;
	end: string | null;
	allDay: boolean;
	location: string | null;
}

/**
 * `YYYY-MM-DD` at midnight in the server's local zone.
 *
 * All-day events carry a bare date with no zone. Anchoring them to local
 * midnight — rather than UTC midnight — keeps them in the day the panel
 * buckets them into, and matches the convention the rest of the app uses.
 */
function localMidnight(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(year, month - 1, day).toISOString();
}

function toIso(time: GoogleEventTime | undefined): string | null {
	if (!time) return null;
	if (time.date) return localMidnight(time.date);
	if (time.dateTime) return new Date(time.dateTime).toISOString();
	return null;
}

/** True when this account is on the invite and turned it down. */
function declinedBySelf(event: GoogleEvent): boolean {
	return (event.attendees ?? []).some(
		(attendee) => attendee.self === true && attendee.responseStatus === 'declined'
	);
}

/**
 * Maps Calendar API items to the shape the Today panel renders.
 *
 * Display-only: nothing here ever touches tasks. Recurrence is already
 * expanded by the API (`singleEvents=true`), so each item is one concrete
 * occurrence with its own stable id. Sorting belongs to the caller, which is
 * the only place that sees more than one calendar.
 */
export function toAgendaEvents(items: GoogleEvent[]): AgendaEvent[] {
	const out: AgendaEvent[] = [];

	for (const event of items) {
		// Expanding a recurring series returns its cancelled occurrences as
		// tombstones rather than omitting them.
		if (event.status === 'cancelled') continue;
		if (declinedBySelf(event)) continue;

		const start = toIso(event.start);
		if (!start) continue;

		out.push({
			id: event.id,
			title: event.summary ?? '(untitled)',
			start,
			end: toIso(event.end),
			allDay: Boolean(event.start?.date),
			location: event.location || null
		});
	}

	return out;
}
