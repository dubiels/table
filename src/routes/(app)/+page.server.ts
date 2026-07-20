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

const zoneColor = z.enum(['sage', 'sky', 'butter', 'blush', 'lilac', 'clay']);

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
		const name = String(data.name ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		const color = zoneColor.safeParse(data.color);
		await zonesService.createZone({
			name,
			color: color.success ? color.data : undefined,
			x: data.x ? Number(data.x) : undefined,
			y: data.y ? Number(data.y) : undefined
		});
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
