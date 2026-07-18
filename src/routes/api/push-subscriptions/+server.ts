import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'unauthorized' }, { status: 401 });

	const body = await request.json();
	await db
		.insert(pushSubscriptions)
		.values({
			id: randomUUID(),
			userId: locals.user.id,
			endpoint: body.endpoint,
			p256dh: body.keys.p256dh,
			auth: body.keys.auth,
			createdAt: new Date().toISOString()
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: {
				userId: locals.user.id,
				p256dh: body.keys.p256dh,
				auth: body.keys.auth
			}
		});

	return json({ ok: true });
};
