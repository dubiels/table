/**
 * The routes reachable without a session.
 *
 * Extracted from `hooks.server.ts` so it can be tested: that module opens the
 * database and starts the cron scheduler at import time, exactly as
 * `dashboard/auth.ts` was extracted for the same reason.
 */
const PUBLIC_PATHS = [
	'/login',
	'/login/verify',
	'/manifest.json',
	'/service-worker.js',
	'/api/health'
] as const;

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some(
		// A public path matches itself and anything beneath it, but `/logins` is
		// not beneath `/login` — without the boundary check, a prefix would open
		// every route that merely starts with one.
		(p) => pathname === p || pathname.startsWith(`${p}/`)
	);
}
