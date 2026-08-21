import { bearerMatches } from '../auth/bearer';

export type DashboardAuthDecision = 'ok' | 'unauthorized' | 'disabled';

/**
 * DASHBOARD_TOKEN unset/empty means the route is disabled (404) — absence of
 * config must never mean absence of auth. A session cookie also grants access
 * so the endpoint is inspectable in a logged-in browser. Token comparison is
 * timing-safe (hash both, then timingSafeEqual, so lengths always match).
 */
export function decideDashboardAuth(
	configuredToken: string | undefined,
	authorizationHeader: string | null,
	hasSession: boolean
): DashboardAuthDecision {
	if (!configuredToken) return 'disabled';
	if (hasSession) return 'ok';
	return bearerMatches(configuredToken, authorizationHeader) ? 'ok' : 'unauthorized';
}
