import type { PageServerLoad, Actions } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';

export const load: PageServerLoad = async () => {
	// Zones come along because a completed task only records where it sat, not
	// which zone that was — the category is resolved from the two together, the
	// same way the list view does it.
	const [tasks, zones] = await Promise.all([
		tasksService.listCompletedTasks(),
		zonesService.listZones()
	]);
	return { tasks, zones };
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
