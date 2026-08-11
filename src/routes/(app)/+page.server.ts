import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as zonesService from '$lib/server/zones/service';
import * as tasksService from '$lib/server/tasks/service';
import { newTaskSchema } from '$lib/server/tasks/forms';
import { evictedTaskPoints } from '$lib/bento';
import { getAgenda } from '$lib/server/gcal/service';
import { syncGoogleTasks, isGoogleTasksEnabled, readSyncState } from '$lib/server/gtasks/sync';
import { pushTaskNow, pushDeletionNow } from '$lib/server/gtasks/push';

/** Long enough that a reload is not a sync, short enough to catch the walk back from the bus. */
const STALE_MS = 60_000;
/** A board that renders now beats a board that renders correct-to-the-second. */
const LOAD_SYNC_BUDGET_MS = 4000;

/**
 * Brings Google Tasks up to date before the board renders, but only when it is
 * actually stale and only for as long as it is worth waiting.
 *
 * The cron job is what keeps the mirror fresh in general; this exists for the
 * case the cron cannot serve — you ticked something off on your phone a minute
 * ago and just opened Table. On timeout or failure the board renders whatever
 * the database already holds.
 */
async function syncGoogleTasksIfStale(): Promise<void> {
	if (!isGoogleTasksEnabled()) return;

	// The whole body is guarded, not just the sync: reading the cursor touches
	// SQLite, and a failure there is no more a reason to replace the board with
	// an error page than a failure to reach Google is.
	try {
		const lastSyncAt = await readSyncState('gtasks:lastSyncAt');
		if (lastSyncAt && Date.now() - Date.parse(lastSyncAt) < STALE_MS) return;

		await Promise.race([
			syncGoogleTasks(),
			new Promise((resolve) => setTimeout(resolve, LOAD_SYNC_BUDGET_MS))
		]);
	} catch (err) {
		console.error('gtasks: load-time sync failed', err);
	}
}

export const load: PageServerLoad = async () => {
	await syncGoogleTasksIfStale();
	// getAgenda() already swallows per-calendar failures; the catch is a belt for
	// anything unexpected, because a calendar must never stop the board loading.
	const [tasks, zones, agenda] = await Promise.all([
		tasksService.listActiveTasks(),
		zonesService.listZones(),
		getAgenda().catch(() => [])
	]);
	// Whether the feed URLs exist, never the URLs themselves — they are bearer
	// secrets, and the panel only needs to know which of its two faces to show.
	// The same names syncLmsAssignments() and getAgenda() read, so they can never
	// disagree. An empty agenda alone would not distinguish "no calendar set up"
	// from "a quiet week", and those want different empty states.
	const lmsConfigured = Boolean(env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL);
	const gcalConfigured = Boolean(env.GCAL_REFRESH_TOKEN);
	return { tasks, zones, agenda, lmsConfigured, gcalConfigured };
};

const zoneColors = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'] as const;
const zoneColor = z.enum(zoneColors);

const newZoneSchema = z.object({
	name: z.string().optional(),
	color: z.string().optional(),
	x: z.coerce.number().optional(),
	y: z.coerce.number().optional(),
	width: z.coerce.number().optional(),
	height: z.coerce.number().optional()
});

export const actions: Actions = {
	createTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newTaskSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Invalid task' });
		const task = await tasksService.createTask({
			title: parsed.data.title,
			dueDate: parsed.data.dueDate || undefined,
			priority: parsed.data.priority,
			// Honoured only with a due date: an undated Google task never reaches
			// the calendar grid, which is the whole point of pushing it.
			googleSync: parsed.data.googleSync === true && Boolean(parsed.data.dueDate),
			x: parsed.data.x,
			y: parsed.data.y
		});
		await pushTaskNow(task.id);
	},

	updateTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = String(data.id);
		await tasksService.updateTask(id, {
			title: data.title ? String(data.title) : undefined,
			notes: data.notes ? String(data.notes) : null,
			dueDate: data.dueDate ? String(data.dueDate) : null,
			priority: (data.priority as 'low' | 'med' | 'high') || null
		});
		// An unchecked checkbox is not submitted at all, so absence is a real
		// "off" — but only when the control was rendered. Guarded on the feature
		// flag, or turning the integration off for a day and editing a task would
		// silently clear an opt-in that nothing on screen was showing.
		if (isGoogleTasksEnabled()) await tasksService.setGoogleSync(id, data.googleSync === 'on');
		await pushTaskNow(id);
	},

	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		const task = await tasksService.toggleTaskDone(String(data.get('id')));
		await pushTaskNow(task.id);
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		// Read before the delete: afterwards there is no row left to tell us which
		// Google task it owned. deleteTask() writes the tombstone that makes this
		// retry-safe if the Google call below fails.
		const existing = await tasksService.getTask(id).catch(() => null);
		await tasksService.deleteTask(id);
		if (existing?.googleTaskId) await pushDeletionNow(existing.googleTaskId);
	},

	createZone: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newZoneSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Invalid zone' });
		const name = parsed.data.name?.trim() || 'New group';
		const color = zoneColor.safeParse(parsed.data.color);
		const existingCount = (await zonesService.listZones()).length;
		const zone = await zonesService.createZone({
			name,
			color: color.success ? color.data : zoneColors[existingCount % zoneColors.length],
			x: parsed.data.x,
			y: parsed.data.y,
			width: parsed.data.width,
			height: parsed.data.height
		});
		return { zone };
	},

	renameZone: async ({ request }) => {
		const data = await request.formData();
		await zonesService.renameZone(String(data.get('id')), String(data.get('name')));
	},

	updateZoneColor: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = zoneColor.safeParse(data.color);
		if (!parsed.success) return fail(400, { error: 'Invalid color' });
		await zonesService.updateZoneColor(String(data.id), parsed.data);
	},

	deleteZone: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id'));

		// Read before the delete, because both the zone's own rectangle and the
		// tasks it holds are needed to work out who is orphaned by its removal.
		const [zones, tasks] = await Promise.all([
			zonesService.listZones(),
			tasksService.listActiveTasks()
		]);
		const moves = evictedTaskPoints(id, zones, tasks);

		await zonesService.deleteZone(id);
		// After the delete, so a failure here leaves tasks loose on old ground
		// rather than moved out of a category that still exists.
		await Promise.all(moves.map((m) => tasksService.updateTaskPosition(m.id, m.x, m.y)));
	}
};
