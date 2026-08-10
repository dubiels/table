import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth/session';
import { startScheduler } from '$lib/server/scheduler';
import { decideDashboardAuth, decideFeedAuth } from '$lib/server/dashboard/auth';

startScheduler();

const PUBLIC_PATHS = ['/login', '/login/verify', '/manifest.json', '/service-worker.js'];

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

	if (event.url.pathname === '/calendar.ics') {
		const decision = decideFeedAuth(
			env.TASKS_FEED_TOKEN,
			event.url.searchParams.get('token'),
			!!user
		);
		if (decision === 'disabled') return new Response('Not found', { status: 404 });
		if (decision === 'unauthorized') return new Response('Unauthorized', { status: 401 });
		return resolve(event);
	}

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!user && !isPublic) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
