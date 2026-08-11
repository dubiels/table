import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as zonesService from '$lib/server/zones/service';
import * as tasksService from '$lib/server/tasks/service';
import { newTaskSchema } from '$lib/server/tasks/forms';
import { getAgenda } from '$lib/server/gcal/service';

export const load: PageServerLoad = async () => {
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
		await tasksService.createTask({
			title: parsed.data.title,
			dueDate: parsed.data.dueDate || undefined,
			priority: parsed.data.priority,
			x: parsed.data.x,
			y: parsed.data.y
		});
	},

	updateTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		await tasksService.updateTask(String(data.id), {
			title: data.title ? String(data.title) : undefined,
			notes: data.notes ? String(data.notes) : null,
			dueDate: data.dueDate ? String(data.dueDate) : null,
			priority: (data.priority as 'low' | 'med' | 'high') || null
		});
	},

	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		await tasksService.toggleTaskDone(String(data.get('id')));
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		await tasksService.deleteTask(String(data.get('id')));
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
		await zonesService.deleteZone(String(data.get('id')));
	}
};
