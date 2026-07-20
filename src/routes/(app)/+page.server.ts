import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import * as zonesService from '$lib/server/zones/service';
import * as tasksService from '$lib/server/tasks/service';

export const load: PageServerLoad = async () => {
	const [tasks, zones] = await Promise.all([
		tasksService.listActiveTasks(),
		zonesService.listZones()
	]);
	return { tasks, zones };
};

const newTaskSchema = z.object({
	title: z.string().min(1),
	dueDate: z.string().optional(),
	priority: z.enum(['low', 'med', 'high']).optional(),
	x: z.coerce.number().optional(),
	y: z.coerce.number().optional()
});

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

	deleteZone: async ({ request }) => {
		const data = await request.formData();
		await zonesService.deleteZone(String(data.get('id')));
	}
};
