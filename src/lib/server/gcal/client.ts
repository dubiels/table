const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const PAGE_SIZE = 250;

export interface GoogleEventTime {
	/** Present on all-day events, as `YYYY-MM-DD`. */
	date?: string;
	/** Present on timed events, as RFC 3339 with an offset. */
	dateTime?: string;
}

export interface GoogleEvent {
	id: string;
	status?: string;
	summary?: string;
	location?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * Every event instance on one calendar that overlaps [timeMin, timeMax).
 *
 * `singleEvents=true` makes Google expand recurring events into concrete
 * instances server-side, which is why nothing here or in agenda.ts parses an
 * rrule. Instances arrive with their own stable ids.
 */
export async function listEvents(
	calendarId: string,
	timeMin: Date,
	timeMax: Date,
	accessToken: string
): Promise<GoogleEvent[]> {
	const items: GoogleEvent[] = [];
	let pageToken: string | undefined;

	do {
		const params = new URLSearchParams({
			timeMin: timeMin.toISOString(),
			timeMax: timeMax.toISOString(),
			singleEvents: 'true',
			orderBy: 'startTime',
			maxResults: String(PAGE_SIZE)
		});
		if (pageToken) params.set('pageToken', pageToken);

		// Calendar ids are email addresses, so the path segment needs encoding.
		const url = `${API_BASE}/${encodeURIComponent(calendarId)}/events?${params}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
		items.push(...(body.items ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return items;
}
