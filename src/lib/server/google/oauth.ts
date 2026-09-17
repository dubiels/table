import { env } from '$env/dynamic/private';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Treat a token as expired a minute early so a request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Which Google login a call is for.
 *
 * Two accounts, not two calendars: a calendar shared between accounts would
 * need none of this. Chapter One and Personal are separate logins, so each
 * holds its own refresh token and neither can see the other's events. The
 * OAuth client is shared — the same desktop client authorised twice, once per
 * account, by running `npm run google:auth` again.
 *
 * `primary` is the account Table already had, and is what Google Tasks keeps
 * using; `second` is optional everywhere.
 */
export type GoogleAccount = 'primary' | 'second';

const REFRESH_TOKEN_ENV: Record<GoogleAccount, string> = {
	primary: 'GCAL_REFRESH_TOKEN',
	second: 'GCAL_REFRESH_TOKEN_2'
};

/** One entry per account: a failure on one must not evict the other's token. */
const cache = new Map<GoogleAccount, { token: string; expiresAt: number }>();

/** Whether this account has a refresh token at all. */
export function hasGoogleAccount(account: GoogleAccount): boolean {
	return Boolean(env[REFRESH_TOKEN_ENV[account]]);
}

/**
 * A Google OAuth access token for one account's refresh token, cached in
 * memory until shortly before it expires. Access tokens last an hour and the
 * agenda refreshes every ten minutes, so this makes one network call per hour
 * per account rather than one per agenda fetch.
 *
 * Throws on a failed refresh. Callers decide what that means — see
 * `service.ts`, which treats it as "skip this account, serve what the others
 * returned, and retry next time".
 */
export async function getAccessToken(account: GoogleAccount = 'primary'): Promise<string> {
	const hit = cache.get(account);
	if (hit && Date.now() < hit.expiresAt) return hit.token;

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: env[REFRESH_TOKEN_ENV[account]] ?? '',
		client_id: env.GCAL_CLIENT_ID ?? '',
		client_secret: env.GCAL_CLIENT_SECRET ?? ''
	});

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`token refresh failed for ${account}: HTTP ${res.status}`);

	const json = (await res.json()) as { access_token: string; expires_in: number };
	const token = {
		token: json.access_token,
		expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS
	};
	cache.set(account, token);
	return token.token;
}
