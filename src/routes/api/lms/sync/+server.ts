import { json } from '@sveltejs/kit';
import { syncLmsAssignments } from '$lib/server/lms/sync';

export const POST = async () => {
	try {
		return json(await syncLmsAssignments());
	} catch (err) {
		console.error('Manual LMS sync failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
