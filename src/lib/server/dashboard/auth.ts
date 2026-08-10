import { createHash, timingSafeEqual } from 'node:crypto';

export type DashboardAuthDecision = 'ok' | 'unauthorized' | 'disabled';

const digest = (value: string) => createHash('sha256').update(value).digest();

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
	return timingSafeEqual(digest(configuredToken), digest(match[1])) ? 'ok' : 'unauthorized';
}
