import { listActiveTasks } from '$lib/server/tasks/service';
import { buildTasksIcs } from '$lib/server/ics/export';

export const GET = async () => {
	const tasks = await listActiveTasks();
	return new Response(buildTasksIcs(tasks, new Date()), {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
};
