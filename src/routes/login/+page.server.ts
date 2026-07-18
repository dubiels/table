import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import { createLoginToken } from '$lib/server/auth/tokens';
import { sendLoginEmail } from '$lib/server/auth/email';
import { validateLoginCode } from '$lib/server/auth/tokens';
import { createSession } from '$lib/server/auth/session';

function isAllowed(email: string): boolean {
	const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase());
	return allowed.includes(email.toLowerCase());
}

export const actions = {
	request: async ({ request }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		if (!email) return fail(400, { error: 'Email required' });

		if (isAllowed(email)) {
			const { token, code } = await createLoginToken(email);
			await sendLoginEmail(email, token, code);
		}
		// Always return the same response whether or not the email is allowed, to avoid leaking which emails are valid.
		return { sent: true, email };
	},

	code: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '').trim();
		const code = String(data.get('code') ?? '').trim();

		const result = await validateLoginCode(email, code);
		if ('error' in result) return fail(400, { codeError: result.error });

		const { sessionId, expiresAt } = await createSession(result.email);
		cookies.set('table_session', sessionId, {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			expires: expiresAt
		});
		throw redirect(303, '/');
	}
} satisfies Actions;
