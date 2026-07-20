import type { PageServerLoad, Actions } from './$types';
import * as tasksService from '$lib/server/tasks/service';

export const load: PageServerLoad = async () => {
	const tasks = await tasksService.listCompletedTasks();
	return { tasks };
};

export const actions: Actions = {
	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		await tasksService.toggleTaskDone(String(data.get('id')));
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		await tasksService.deleteTask(String(data.get('id')));
	}
};
