import { bearerMatches } from '../auth/bearer';

export type AgentAuthDecision = 'ok' | 'unauthorized' | 'disabled';

/**
 * AGENT_TOKEN unset/empty disables every `/api/agent/*` route (404), on the
 * same rule as the dashboard: absence of config must never mean absence of
 * auth.
 *
 * Unlike the dashboard, a session cookie grants nothing here. The credential is
 * separate precisely so it can be revoked on its own — an agent that starts
 * misbehaving is cut off by clearing one variable, without touching how its
 * owner signs in. Honouring her cookie on these routes would erase that
 * separation for any request made from her browser.
 */
export function decideAgentAuth(
	configuredToken: string | undefined,
	authorizationHeader: string | null
): AgentAuthDecision {
	if (!configuredToken) return 'disabled';
	return bearerMatches(configuredToken, authorizationHeader) ? 'ok' : 'unauthorized';
}
