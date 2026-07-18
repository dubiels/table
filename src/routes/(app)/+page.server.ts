import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import * as topicsService from '$lib/server/topics/service';
import * as tasksService from '$lib/server/tasks/service';

export const load: PageServerLoad = async () => {
	const topics = await topicsService.listTopics('active');
	const tasksByTopic: Record<string, tasksService.Task[]> = {};
	for (const topic of topics) {
		tasksByTopic[topic.id] = await tasksService.listTasksForTopic(topic.id);
	}
	return { topics, tasksByTopic };
};

const newTopicSchema = z.object({ name: z.string().min(1) });
const newTaskSchema = z.object({
	topicId: z.string().min(1),
	title: z.string().min(1),
	notes: z.string().optional(),
	dueDate: z.string().optional(),
	priority: z.enum(['low', 'med', 'high']).optional()
});

export const actions: Actions = {
	createTopic: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newTopicSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Name required' });
		await topicsService.createTopic(parsed.data.name);
	},

	archiveTopic: async ({ request }) => {
		const data = await request.formData();
		await topicsService.archiveTopic(String(data.get('id')));
	},

	moveTopic: async ({ request }) => {
		const data = await request.formData();
		await topicsService.moveTopic(String(data.get('id')), data.get('direction') === 'up' ? 'up' : 'down');
	},

	createTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newTaskSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Invalid task' });
		await tasksService.createTask(parsed.data);
	},

	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		await tasksService.toggleTaskDone(String(data.get('id')));
	},

	moveTask: async ({ request }) => {
		const data = await request.formData();
		await tasksService.moveTask(String(data.get('id')), data.get('direction') === 'up' ? 'up' : 'down');
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
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		await tasksService.deleteTask(String(data.get('id')));
	}
};
