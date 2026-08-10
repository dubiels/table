import { json } from '@sveltejs/kit';
import { listActiveTasks } from '$lib/server/tasks/service';
import { listZones } from '$lib/server/zones/service';
import { buildDashboardPayload } from '$lib/server/dashboard/serialize';

export const GET = async () => {
	const [tasks, zones] = await Promise.all([listActiveTasks(), listZones()]);
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return json(buildDashboardPayload(tasks, zones, new Date(), timezone), {
		headers: { 'cache-control': 'no-store' }
	});
};
