import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as zonesService from '$lib/server/zones/service';
import * as peopleService from '$lib/server/people/service';
import * as tasksService from '$lib/server/tasks/service';
import { newTaskSchema } from '$lib/server/tasks/forms';
import { evictedTaskPoints } from '$lib/bento';
import { ZONE_COLOR_KEYS, type ZoneColor } from '$lib/zones';
import { getAgenda } from '$lib/server/gcal/service';
import { syncGoogleTasks, isGoogleTasksEnabled, readSyncState } from '$lib/server/gtasks/sync';
import { pushTaskNow, pushDeletionNow } from '$lib/server/gtasks/push';
import { canSendToGoogle, NEEDS_PLANNED_DATE_MESSAGE } from '$lib/googleSync';

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
 *
 * The budget bounds how long this request waits, not how long the round runs,
 * and the cursor is written last — so a reload during a slow round still reads
 * the state as stale and calls in again. That is safe only because
 * `syncGoogleTasks` joins the round already in flight instead of starting a
 * second one over the same snapshot.
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
	const [rawTasks, zones, agenda, people] = await Promise.all([
		tasksService.listActiveTasks(),
		zonesService.listZones(),
		getAgenda().catch(() => []),
		// Table may reference people; people never reference the board. Reading
		// names here is that arrow pointing the allowed way.
		peopleService.listPeople()
	]);

	// Denormalised onto the row rather than shipped as a separate lookup the
	// views would each have to thread through: a card only ever needs the name.
	const personNames = new Map(people.map((p) => [p.id, p.name]));
	const tasks = rawTasks.map((task) =>
		task.personId ? { ...task, personName: personNames.get(task.personId) ?? null } : task
	);
	// Whether the feed URLs exist, never the URLs themselves — they are bearer
	// secrets, and the panel only needs to know which of its two faces to show.
	// The same names syncLmsAssignments() and getAgenda() read, so they can never
	// disagree. An empty agenda alone would not distinguish "no calendar set up"
	// from "a quiet week", and those want different empty states.
	const lmsConfigured = Boolean(env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL);
	const gcalConfigured = Boolean(env.GCAL_REFRESH_TOKEN);
	return { tasks, zones, agenda, lmsConfigured, gcalConfigured };
};

const zoneColor = z.enum(ZONE_COLOR_KEYS as [ZoneColor, ...ZoneColor[]]);

/**
 * The rotation a zone created without an explicit color falls into. Ember is
 * deliberately absent: it is the one saturated key in an otherwise pastel
 * palette, so it should be chosen rather than handed out to every seventh group.
 */
const zoneColorRotation = ZONE_COLOR_KEYS.filter((c) => c !== 'ember');

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
			plannedDate: parsed.data.plannedDate || undefined,
			priority: parsed.data.priority,
			// Honoured only with a planned day: an undated Google task never reaches
			// the calendar grid, which is the whole point of pushing it.
			googleSync: parsed.data.googleSync === true && Boolean(parsed.data.plannedDate),
			x: parsed.data.x,
			y: parsed.data.y
		});
		await pushTaskNow(task.id);
	},

	updateTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = String(data.id);
		const existing = await tasksService.getTask(id);

		// The service marks a task dirty on key *presence* — `field in patch` —
		// which is correct: `plannedDate: null` is a real edit Google must hear
		// about, and only presence can tell that apart from a field this Save never
		// mentioned. It does mean the keys sent from here are the dirty flag. The
		// modal posts title, notes, dueDate and plannedDate on every Save, so
		// passing them through unconditionally would bump `updatedAt` for a
		// priority-only edit, or for a Save that changed nothing at all — firing a
		// pointless push and arming that task to win a both-dirty conflict against
		// a real edit made on the phone. So a key goes in only when it was
		// submitted *and* differs from what the row already holds.
		const patch: Parameters<typeof tasksService.updateTask>[1] = {};
		// An empty title is the browser's `required` being bypassed, not a request
		// to erase the title, so it is dropped rather than written.
		if (data.title && String(data.title) !== existing.title) patch.title = String(data.title);
		if ('notes' in data) {
			const notes = data.notes ? String(data.notes) : null;
			if (notes !== existing.notes) patch.notes = notes;
		}
		if ('dueDate' in data) {
			const dueDate = data.dueDate ? String(data.dueDate) : null;
			if (dueDate !== existing.dueDate) patch.dueDate = dueDate;
		}
		if ('plannedDate' in data) {
			const plannedDate = data.plannedDate ? String(data.plannedDate) : null;
			if (plannedDate !== existing.plannedDate) patch.plannedDate = plannedDate;
		}
		if ('priority' in data) {
			const priority = (data.priority as 'low' | 'med' | 'high') || null;
			if (priority !== existing.priority) patch.priority = priority;
		}
		// Drizzle rejects an empty `set`, and a Save that changed nothing has
		// nothing to write anyway — the toggle and the push below still run.
		if (Object.keys(patch).length > 0) await tasksService.updateTask(id, patch);
		// An unchecked checkbox is not submitted at all, so absence is a real
		// "off" — but only when the control was rendered. Guarded on the feature
		// flag, or turning the integration off for a day and editing a task would
		// silently clear an opt-in that nothing on screen was showing.
		if (isGoogleTasksEnabled()) {
			if (data.googleSync === 'on') {
				// The day this Save leaves behind, not the one the row held when it
				// opened — checking the old value would refuse an opt-in made in the
				// same Save that supplied the day it was waiting for.
				const plannedDate =
					'plannedDate' in data ? String(data.plannedDate || '') : (existing.plannedDate ?? '');
				if (canSendToGoogle({ plannedDate, googleTaskId: existing.googleTaskId })) {
					await tasksService.enableGoogleSync(id);
				}
			} else {
				// Unconditional, like the single call it replaces: on a task already
				// switched off this only re-clears a stale googleError, which is how
				// an error on an unlinked task has always been dismissed.
				const removed = await tasksService.unlinkFromGoogle(id);
				if (removed) await pushDeletionNow(removed);
			}
		}
		await pushTaskNow(id);
	},

	/**
	 * The board's badge, which flips one task's mirroring without opening the
	 * detail panel.
	 *
	 * Separate from `updateTask` rather than a narrower call into it, because it
	 * carries no content: routing it through the patch builder would mean
	 * inventing an empty patch and reasoning about which fields a click on a
	 * badge is claiming not to have changed.
	 */
	setTaskGoogleSync: async ({ request }) => {
		// Same guard as `updateTask`'s: with the integration off nothing on screen
		// offers this, so a request that arrives anyway is not acting on anything
		// the user can see.
		if (!isGoogleTasksEnabled()) return fail(400, { error: 'Google Tasks is not configured' });

		const data = await request.formData();
		const id = String(data.get('id'));

		if (data.get('on') !== 'true') {
			const removed = await tasksService.unlinkFromGoogle(id);
			// Immediate, so the task leaves the phone at the same moment it leaves
			// the board. A failure here keeps the tombstone for the next reconcile.
			if (removed) await pushDeletionNow(removed);
			return;
		}

		const existing = await tasksService.getTask(id);
		// The card refuses this before posting; this is the rule itself rather than
		// its message, so a stale card cannot opt a task in that Google would then
		// silently drop into a permanent "waiting to send".
		if (!canSendToGoogle(existing)) return fail(400, { error: NEEDS_PLANNED_DATE_MESSAGE });

		await tasksService.enableGoogleSync(id);
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
			color: color.success
				? color.data
				: zoneColorRotation[existingCount % zoneColorRotation.length],
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
