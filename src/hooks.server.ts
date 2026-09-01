import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth/session';
import { startScheduler } from '$lib/server/scheduler';
import { decideDashboardAuth } from '$lib/server/dashboard/auth';
import { decideAgentAuth } from '$lib/server/agent/auth';
import { isPublicPath } from '$lib/server/auth/public-paths';

startScheduler();

/**
 * Whether this request is for `prefix`, judged on the route SvelteKit actually
 * matched rather than on the URL as it was typed.
 *
 * `event.url.pathname` is the raw, still-encoded path, but routes are matched
 * against the decoded one — so `/%61pi/agent/people` resolves to the agent
 * endpoint while reading as an unrelated path here. Gating on the raw string
 * therefore leaves a spelling of every guarded URL that skips the guard, which
 * would make both "unset the token and the route is a 404" and "a session
 * cookie grants nothing on the agent API" false.
 *
 * The raw path is still checked as well, so a path under the prefix that
 * matches no route is answered by the guard rather than falling through to the
 * session redirect.
 */
function isRoute(event: { route: { id: string | null }; url: URL }, prefix: string): boolean {
	const matched = event.route.id;
	if (matched === prefix || matched?.startsWith(prefix)) return true;
	return event.url.pathname === prefix || event.url.pathname.startsWith(prefix);
}

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get('table_session');
	const user = sessionId ? await getSessionUser(sessionId) : null;
	event.locals.user = user;

	// Matched on the resolved route id, not the raw pathname. SvelteKit decodes
	// the path before matching, so `/api/dashboar%64` reaches this endpoint while
	// a raw-string comparison sees a path that does not look like it — which
	// would let the request through this gate entirely.
	if (isRoute(event, '/api/dashboard')) {
		const decision = decideDashboardAuth(
			env.DASHBOARD_TOKEN,
			event.request.headers.get('authorization'),
			!!user
		);
		if (decision === 'disabled') return new Response('Not found', { status: 404 });
		if (decision === 'unauthorized') return new Response('Unauthorized', { status: 401 });
		return resolve(event);
	}

	// Bearer-only, and ahead of the login redirect: an agent carries no session,
	// and answering it with a 303 to /login would hand a machine client an HTML
	// page with a 200 on it. A disabled token reads as a route that does not
	// exist, on the same rule as /api/dashboard.
	if (isRoute(event, '/api/agent/')) {
		const decision = decideAgentAuth(env.AGENT_TOKEN, event.request.headers.get('authorization'));
		if (decision === 'disabled') return new Response('Not found', { status: 404 });
		if (decision === 'unauthorized') {
			return new Response(
				JSON.stringify({
					error: { code: 'unauthorized', message: 'Invalid or missing bearer token' }
				}),
				{ status: 401, headers: { 'content-type': 'application/json' } }
			);
		}
		return resolve(event);
	}

	if (!user && !isPublicPath(event.url.pathname)) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
