import ical from 'ical';

export interface AgendaEvent {
	id: string;
	title: string;
	start: string;
	end: string | null;
	allDay: boolean;
	location: string | null;
}

/**
 * Expands an ICS text into concrete event occurrences inside [from, from+days).
 * Recurring events are expanded via the parsed rrule; exdates are respected.
 * Display-only: nothing here ever touches tasks.
 */
export function upcomingEvents(icsText: string, from: Date, days: number): AgendaEvent[] {
	const windowEnd = new Date(from.getTime() + days * 86_400_000);
	const parsed = ical.parseICS(icsText);
	const out: AgendaEvent[] = [];

	for (const [uid, ev] of Object.entries(parsed)) {
		if (ev.type !== 'VEVENT' || !ev.start) continue;
		const title = ev.summary ?? '(untitled)';
		const location = ev.location || null;
		const allDay = (ev.start as Date & { dateOnly?: boolean }).dateOnly === true;
		const durationMs = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;

		if (ev.rrule) {
			const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => (d as Date).getTime()));
			for (const occurrence of ev.rrule.between(from, windowEnd, true)) {
				if (exdates.has(occurrence.getTime())) continue;
				out.push({
					id: `${uid}:${occurrence.toISOString()}`,
					title,
					start: occurrence.toISOString(),
					end: durationMs > 0 ? new Date(occurrence.getTime() + durationMs).toISOString() : null,
					allDay,
					location
				});
			}
		} else {
			if (ev.start >= from && ev.start < windowEnd) {
				out.push({
					id: uid,
					title,
					start: ev.start.toISOString(),
					end: ev.end ? ev.end.toISOString() : null,
					allDay,
					location
				});
			}
		}
	}

	out.sort((a, b) => a.start.localeCompare(b.start));
	return out;
}
