import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { validateLoginToken } from '$lib/server/auth/tokens';
import { createSession } from '$lib/server/auth/session';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) return { error: 'invalid' as const };

	const result = await validateLoginToken(token);
	if ('error' in result) return { error: result.error };

	const { sessionId, expiresAt } = await createSession(result.email);
	cookies.set('table_session', sessionId, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		expires: expiresAt
	});
	throw redirect(303, '/');
};
