import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth/session';
import { startScheduler } from '$lib/server/scheduler';

startScheduler();

const PUBLIC_PATHS = ['/login', '/login/verify', '/manifest.json', '/service-worker.js'];

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get('table_session');
	const user = sessionId ? await getSessionUser(sessionId) : null;
	event.locals.user = user;

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!user && !isPublic) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
