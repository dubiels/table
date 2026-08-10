import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { pushSubscriptions } from '../db/schema';

const vapidPublicKey = env.VAPID_PUBLIC_KEY ?? '';
const vapidPrivateKey = env.VAPID_PRIVATE_KEY ?? '';
const vapidConfigured = vapidPublicKey.length > 0 && vapidPrivateKey.length > 0;

if (vapidConfigured) {
	webpush.setVapidDetails(
		env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
		vapidPublicKey,
		vapidPrivateKey
	);
} else {
	console.warn(
		'VAPID keys not configured; push notifications are disabled until Task 9 registers them.'
	);
}

export async function sendPushToUser(
	userId: string,
	payload: { title: string; body: string; url?: string }
) {
	if (!vapidConfigured) return;

	const subs = await db.query.pushSubscriptions.findMany({
		where: eq(pushSubscriptions.userId, userId)
	});

	for (const sub of subs) {
		try {
			await webpush.sendNotification(
				{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
				JSON.stringify(payload)
			);
		} catch (err: any) {
			if (err?.statusCode === 404 || err?.statusCode === 410) {
				await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
			} else {
				console.error('Push send failed', err);
			}
		}
	}
}
