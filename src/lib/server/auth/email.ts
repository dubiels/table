import { Resend } from 'resend';
import { env } from '$env/dynamic/private';

export async function sendLoginEmail(email: string, token: string, code: string) {
	const appUrl = env.PUBLIC_APP_URL ?? 'http://localhost:5173';
	const link = `${appUrl}/login/verify?token=${encodeURIComponent(token)}`;

	if (env.DEV_LOG_TOKENS === 'true') {
		console.log(`[dev] Login link for ${email}: ${link}`);
		console.log(`[dev] Login code for ${email}: ${code}`);
		return;
	}

	const resend = new Resend(env.RESEND_API_KEY);
	const { error } = await resend.emails.send({
		from: env.EMAIL_FROM ?? 'Table <table@example.com>',
		to: email,
		subject: 'Your Table login link',
		html: `<p>Click to log in: <a href="${link}">${link}</a></p><p>Or enter this code: <strong>${code}</strong></p><p>This expires in 15 minutes.</p>`
	});

	// The SDK RETURNS failures rather than throwing them — an unverified sending
	// domain, a revoked key, a rate limit all arrive as a resolved promise with
	// `error` set. Ignoring the result made every one of those invisible: the
	// login page said "check your email", no mail was sent, and nothing anywhere
	// recorded why. Since magic links are the only way in, that is an outage with
	// no evidence attached.
	//
	// Logged rather than thrown, deliberately. The action answers identically for
	// an allowed and a disallowed address so the form cannot be used to test who
	// has an account, and surfacing a send failure would break exactly that.
	if (error) {
		console.error(
			`auth: sending the login email to ${email} failed — ${error.name}: ${error.message}`
		);
	}
}
