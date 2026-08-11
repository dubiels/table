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
	// Deduped: a primary calendar's id is the account's own email address, so
	// naming both (or repeating an id) would otherwise fetch the same calendar
	// twice.
	return ids.length > 0 ? [...new Set(ids)] : ['primary'];
}

/**
 * Fetches every configured calendar, merges, dedupes and sorts the result,
 * and caches it — the shared body behind `getAgenda()` and `refreshAgenda()`.
 *
 * Reports `ok: false` whenever the round did not actually reach Google: the
 * shared token refresh failed, or every configured calendar failed. In both
 * cases the previous cached agenda (if any) is handed back as `events`, but
 * `cache` itself is left untouched — not restamped, not blanked — so the
 * caller can keep serving the old agenda while the next call retries
 * immediately instead of waiting out the rest of the TTL.
 */
async function fetchAndMerge(): Promise<{ ok: boolean; events: AgendaEvent[] }> {
	let token: string;
	try {
		token = await getAccessToken();
	} catch (err) {
		// A dead or revoked refresh token fails every calendar at once, which is
		// the same situation as "nothing succeeded" below.
		console.error('gcal: access token refresh failed', err);
		return { ok: false, events: cache?.events ?? [] };
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

	if (!anySucceeded) return { ok: false, events: cache?.events ?? [] };

	// One meeting can legitimately arrive twice with the same id — the
	// attendee and organiser copies of an invite share an id when both their
	// calendars are configured — and TodayPanel renders events in a keyed
	// each, so a duplicate id must not reach the result.
	const seen = new Set<string>();
	const deduped = all.filter((event) => {
		if (seen.has(event.id)) return false;
		seen.add(event.id);
		return true;
	});

	deduped.sort((a, b) => a.start.localeCompare(b.start));
	cache = { at: Date.now(), events: deduped };
	return { ok: true, events: deduped };
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
 *
 * `force: true` skips the TTL check and always fetches — everything else,
 * including that untouched-cache-on-failure behaviour, is unchanged.
 */
export async function getAgenda(options?: { force?: boolean }): Promise<AgendaEvent[]> {
	if (!env.GCAL_REFRESH_TOKEN) return [];
	if (!options?.force && cache && Date.now() - cache.at < TTL_MS) return cache.events;

	const { events } = await fetchAndMerge();
	return events;
}

/**
 * Manually forces a fetch, bypassing the TTL, for a user-triggered refresh.
 *
 * Reports the truth rather than a blanket success: `ok: false` when nothing
 * is configured or every calendar failed, so the caller can tell the user
 * their newly added event might still be missing instead of implying the
 * agenda shown is now current. A failed refresh never touches the cache, so
 * the previously served agenda is exactly what a following `getAgenda()`
 * still returns.
 */
export async function refreshAgenda(): Promise<{ ok: boolean; events: number }> {
	if (!env.GCAL_REFRESH_TOKEN) return { ok: false, events: 0 };
	const { ok, events } = await fetchAndMerge();
	return { ok, events: ok ? events.length : 0 };
}
