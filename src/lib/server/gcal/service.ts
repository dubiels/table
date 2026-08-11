import { env } from '$env/dynamic/private';
import { getAccessToken } from './oauth';
import { listEvents } from './client';
import { toAgendaEvents, type AgendaEvent } from './agenda';

const TTL_MS = 10 * 60 * 1000;
const AGENDA_DAYS = 7;

let cache: { at: number; events: AgendaEvent[] } | null = null;

function calendarIds(): string[] {
	const ids = (env.GCAL_CALENDAR_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.length > 0 ? ids : ['primary'];
}

/**
 * Next 7 days of events across all configured calendars, cached 10 minutes.
 *
 * Unset GCAL_REFRESH_TOKEN means an empty agenda. A failing calendar is logged
 * and skipped so one bad calendar never blanks the whole rail: if at least one
 * calendar succeeds, the successes are served and cached. If every configured
 * calendar fails on a given round — including when the shared token refresh is
 * what failed — the previous cached agenda (if any) is served as-is and the
 * cache timestamp is left untouched, so the next call retries immediately
 * instead of serving stale data for the rest of the TTL.
 */
export async function getAgenda(): Promise<AgendaEvent[]> {
	if (!env.GCAL_REFRESH_TOKEN) return [];
	if (cache && Date.now() - cache.at < TTL_MS) return cache.events;

	let token: string;
	try {
		token = await getAccessToken();
	} catch (err) {
		// A dead or revoked refresh token fails every calendar at once, which is
		// the same situation as "nothing succeeded" below.
		console.error('gcal: access token refresh failed', err);
		return cache?.events ?? [];
	}

	const now = new Date();
	const windowEnd = new Date(now.getTime() + AGENDA_DAYS * 86_400_000);
	const all: AgendaEvent[] = [];
	let anySucceeded = false;

	for (const id of calendarIds()) {
		try {
			all.push(...toAgendaEvents(await listEvents(id, now, windowEnd, token)));
			anySucceeded = true;
		} catch (err) {
			console.error(`gcal: calendar ${id} fetch failed, skipping`, err);
		}
	}

	if (!anySucceeded) return cache?.events ?? [];

	all.sort((a, b) => a.start.localeCompare(b.start));
	cache = { at: Date.now(), events: all };
	return all;
}
