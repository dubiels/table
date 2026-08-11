import { json } from '@sveltejs/kit';
import { syncGoogleTasks } from '$lib/server/gtasks/sync';

export const POST = async () => {
	try {
		// Always full: a manual refresh is the one moment the user is watching, so
		// it is worth paying for the unfiltered fetch that can also detect a task
		// that has vanished from Google.
		return json(await syncGoogleTasks({ full: true }));
	} catch (err) {
		console.error('Manual Google Tasks sync failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
