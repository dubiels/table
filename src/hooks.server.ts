import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth/session';
import { startScheduler } from '$lib/server/scheduler';
import { decideDashboardAuth } from '$lib/server/dashboard/auth';
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

	if (!user && !isPublicPath(event.url.pathname)) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
