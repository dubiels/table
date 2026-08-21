import type { PageServerLoad } from './$types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications, tasks } from '$lib/server/db/schema';

interface NotificationContent {
	text: string;
	taskIds?: string[];
}

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

	const parsed = rows.map((r) => ({
		...r,
		// Widened from the schema's narrowed 'due_alert' literal: the column is
		// plain text, so rows written back when 'morning_digest' was still a
		// valid type are still sitting in the database and still need to render.
		type: r.type as 'due_alert' | 'morning_digest',
		content: JSON.parse(r.content) as NotificationContent
	}));

	// The notification body is a frozen snapshot of counts; the task rows are
	// looked up live so an opened digest shows current titles and done state
	// rather than what was true at 7am.
	const referencedIds = [...new Set(parsed.flatMap((r) => r.content.taskIds ?? []))];
	const taskRows = referencedIds.length
		? await db.query.tasks.findMany({ where: inArray(tasks.id, referencedIds) })
		: [];
	const tasksById = new Map(taskRows.map((t) => [t.id, t]));

	return {
		notifications: parsed.map((r) => ({
			...r,
			// Dropping unknown ids covers tasks deleted since the digest was sent.
			tasks: (r.content.taskIds ?? [])
				.map((id) => tasksById.get(id))
				.filter((t) => t !== undefined)
				.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: t.done }))
		}))
	};
};
