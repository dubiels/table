import type { PageServerLoad } from './$types';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db.query.notifications.findMany({
		where: eq(notifications.userId, locals.user!.id),
		orderBy: (n, { desc }) => [desc(n.sentAt)]
	});

	if (rows.some((r) => !r.readAt)) {
		await db
			.update(notifications)
			.set({ readAt: new Date().toISOString() })
			.where(and(eq(notifications.userId, locals.user!.id), isNull(notifications.readAt)));
	}

	return {
		notifications: rows.map((r) => ({ ...r, content: JSON.parse(r.content) as { text: string } }))
	};
};
