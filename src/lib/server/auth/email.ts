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
	await resend.emails.send({
		from: env.EMAIL_FROM ?? 'Table <table@example.com>',
		to: email,
		subject: 'Your Table login link',
		html: `<p>Click to log in: <a href="${link}">${link}</a></p><p>Or enter this code: <strong>${code}</strong></p><p>This expires in 15 minutes.</p>`
	});
}
