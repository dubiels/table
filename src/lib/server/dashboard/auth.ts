import { createHash, timingSafeEqual } from 'node:crypto';

export type DashboardAuthDecision = 'ok' | 'unauthorized' | 'disabled';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Hashes both sides then compares timing-safely, so lengths always match. */
function tokensMatch(a: string, b: string): boolean {
	return timingSafeEqual(digest(a), digest(b));
}

/**
 * DASHBOARD_TOKEN unset/empty means the route is disabled (404) — absence of
 * config must never mean absence of auth. A session cookie also grants access
 * so the endpoint is inspectable in a logged-in browser. Token comparison is
 * timing-safe (hashboth, then timingSafeEqual, so lengths always match).
 */
export function decideDashboardAuth(
	configuredToken: string | undefined,
	authorizationHeader: string | null,
	hasSession: boolean
): DashboardAuthDecision {
	if (!configuredToken) return 'disabled';
	if (hasSession) return 'ok';
	const match = authorizationHeader?.match(/^Bearer (.+)$/);
	if (!match) return 'unauthorized';
	return tokensMatch(configuredToken, match[1]) ? 'ok' : 'unauthorized';
}

/**
 * TASKS_FEED_TOKEN unset/empty means the feed is disabled (404). Google
 * Calendar's fetcher can't send headers, so the token travels as a query
 * param instead of an Authorization header. Same session/timing-safe rules
 * as decideDashboardAuth.
 */
export function decideFeedAuth(
	configuredToken: string | undefined,
	presentedToken: string | null,
	hasSession: boolean
): DashboardAuthDecision {
	if (!configuredToken) return 'disabled';
	if (hasSession) return 'ok';
	if (!presentedToken) return 'unauthorized';
	return tokensMatch(configuredToken, presentedToken) ? 'ok' : 'unauthorized';
}
