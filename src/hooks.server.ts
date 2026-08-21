import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth/session';
import { startScheduler } from '$lib/server/scheduler';
import { decideDashboardAuth } from '$lib/server/dashboard/auth';
import { decideAgentAuth } from '$lib/server/agent/auth';
import { isPublicPath } from '$lib/server/auth/public-paths';

startScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get('table_session');
	const user = sessionId ? await getSessionUser(sessionId) : null;
	event.locals.user = user;

	if (event.url.pathname === '/api/dashboard') {
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
	if (event.url.pathname.startsWith('/api/agent/')) {
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
