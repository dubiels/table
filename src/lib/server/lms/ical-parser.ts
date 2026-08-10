import ical from 'ical';

export interface LmsEvent {
	title: string;
	dueDate: string;
	courseId: string;
	courseName: string;
	eventId: string;
}

// Sync window: far enough back to catch assignments due while the app was
// offline, far enough forward to be useful without importing a whole semester.
const PAST_WINDOW_DAYS = 7;
const FUTURE_WINDOW_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toLocalDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

// Canvas summaries look like "Assignment Title [Course Name]".
const TRAILING_BRACKET = /\s*\[([^[\]]+)\]\s*$/;

export function parseLmsIcal(icsText: string, now: Date = new Date()): LmsEvent[] {
	const cal = ical.parseICS(icsText);
	const events: LmsEvent[] = [];

	const windowStart = new Date(now.getTime() - PAST_WINDOW_DAYS * MS_PER_DAY);
	const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_DAYS * MS_PER_DAY);

	for (const key in cal) {
		const comp = cal[key];
		if (!comp || comp.type !== 'VEVENT') continue;

		const start = comp.start;
		if (!start || isNaN(start.getTime())) continue;
		if (start < windowStart || start > windowEnd) continue;

		const summary = comp.summary || 'Untitled';
		const bracketMatch = summary.match(TRAILING_BRACKET);
		const strippedTitle = bracketMatch ? summary.slice(0, bracketMatch.index).trim() : summary;
		// A summary that is only "[Course]" strips down to nothing — fall back
		// to Untitled rather than surfacing an empty title.
		const title = strippedTitle || 'Untitled';
		const courseName = bracketMatch ? bracketMatch[1] : 'Unknown';

		events.push({
			title,
			dueDate: toLocalDateString(start),
			// The feed has no separate course id field, so reuse the parsed course name.
			courseId: courseName,
			courseName,
			eventId: comp.uid || ''
		});
	}

	return events;
}
