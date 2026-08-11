import { env } from '$env/dynamic/private';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Treat a token as expired a minute early so a request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A Google OAuth access token for the configured refresh token, cached in
 * memory until shortly before it expires. Access tokens last an hour and the
 * agenda refreshes every ten minutes, so this makes one network call per hour
 * rather than one per agenda fetch.
 *
 * Throws on a failed refresh. Callers decide what that means — see
 * `service.ts`, which treats it as "serve the last good agenda and retry".
 */
export async function getAccessToken(): Promise<string> {
	if (cached && Date.now() < cached.expiresAt) return cached.token;

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: env.GCAL_REFRESH_TOKEN ?? '',
		client_id: env.GCAL_CLIENT_ID ?? '',
		client_secret: env.GCAL_CLIENT_SECRET ?? ''
	});

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);

	const json = (await res.json()) as { access_token: string; expires_in: number };
	cached = {
		token: json.access_token,
		expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS
	};
	return cached.token;
}
