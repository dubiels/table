import ical from 'ical';

export interface LmsEvent {
	title: string;
	dueDate: string;
	courseId: string;
	courseName: string;
	eventId: string;
}

// Sync window: today through a fortnight out. Assignments live in the side
// panel and the list now rather than on the board, which makes the window a
// reading list — what is actually coming up — instead of an archive. Nothing
// before today, because a due date already past is not work anyone can plan.
const FUTURE_WINDOW_DAYS = 14;

/** Local midnight `days` after `date`'s own day. */
function startOfLocalDay(date: Date, days = 0): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function toLocalDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

// Canvas summaries look like "Assignment Title [Course Name]".
const TRAILING_BRACKET = /\s*\[([^[\]]+)\]\s*$/;

/**
 * The UID shape Canvas gives graded work: assignments, quizzes and graded
 * discussions all arrive as `event-assignment-<id>`, and a section-specific
 * due date as `event-assignment-override-<id>`, which this prefix also takes.
 *
 * The same feed carries `event-calendar-event-<id>` for the course calendar —
 * class meetings, "No Class", exam-room bookings. Those are not work anyone
 * hands in, and they crowded out the deadlines the panel exists to show.
 * (Announcements never reach the feed at all; Canvas does not put them on the
 * calendar.) Allow-listed rather than deny-listed because "only assignments"
 * has to keep holding when Canvas adds a kind we have never seen.
 */
const ASSIGNMENT_UID = /^event-assignment-/;

export function parseLmsIcal(icsText: string, now: Date = new Date()): LmsEvent[] {
	const cal = ical.parseICS(icsText);
	const events: LmsEvent[] = [];

	// Both edges are local midnights rather than offsets from the current
	// instant: an assignment due at 9am today is still due today at 3pm, and a
	// window anchored to `now` would have dropped it. windowEnd is the midnight
	// after the last included day, so the whole 14th day counts.
	const windowStart = startOfLocalDay(now);
	const windowEnd = startOfLocalDay(now, FUTURE_WINDOW_DAYS + 1);

	for (const key in cal) {
		const comp = cal[key];
		if (!comp || comp.type !== 'VEVENT') continue;

		// No stable id ⇒ no way to dedupe; skipping beats duplicating every sync.
		if (!comp.uid) continue;
		if (!ASSIGNMENT_UID.test(comp.uid)) continue;

		const start = comp.start;
		if (!start || isNaN(start.getTime())) continue;
		if (start < windowStart || start >= windowEnd) continue;

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
			eventId: comp.uid
		});
	}

	return events;
}
