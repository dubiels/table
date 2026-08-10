import { env } from '$env/dynamic/private';
import { upcomingEvents, type AgendaEvent } from './agenda';

const TTL_MS = 10 * 60 * 1000;
const AGENDA_DAYS = 7;

let cache: { at: number; events: AgendaEvent[] } | null = null;

/**
 * Next 7 days of events across all configured calendars, cached 10 minutes.
 * Unset GCAL_ICAL_URLS means an empty agenda. A failing calendar is logged
 * and skipped so one bad feed never blanks the whole rail: if at least one
 * calendar succeeds, the successes are served and cached. If every
 * configured calendar fails on a given round, the previous cached agenda
 * (if any) is served as-is and the cache timestamp is left untouched, so
 * the next call retries immediately instead of serving stale data for the
 * rest of the TTL.
 */
export async function getAgenda(): Promise<AgendaEvent[]> {
	const urls = (env.GCAL_ICAL_URLS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (urls.length === 0) return [];
	if (cache && Date.now() - cache.at < TTL_MS) return cache.events;

	const now = new Date();
	const all: AgendaEvent[] = [];
	let anySucceeded = false;
	for (const url of urls) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			all.push(...upcomingEvents(await res.text(), now, AGENDA_DAYS));
			anySucceeded = true;
		} catch (err) {
			console.error('gcal: calendar fetch failed, skipping', err);
		}
	}

	if (!anySucceeded) return cache?.events ?? [];

	all.sort((a, b) => a.start.localeCompare(b.start));
	cache = { at: Date.now(), events: all };
	return all;
}
