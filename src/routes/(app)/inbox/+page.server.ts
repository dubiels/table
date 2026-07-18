import type { PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db.query.notifications.findMany({
		where: eq(notifications.userId, locals.user!.id),
		orderBy: (n, { desc }) => [desc(n.sentAt)]
	});

	const unread = rows.filter((r) => !r.readAt);
	for (const row of unread) {
		await db.update(notifications).set({ readAt: new Date().toISOString() }).where(eq(notifications.id, row.id));
	}

	return { notifications: rows.map((r) => ({ ...r, content: JSON.parse(r.content) as { text: string } })) };
};
