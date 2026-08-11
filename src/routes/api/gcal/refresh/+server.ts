import { json } from '@sveltejs/kit';
import { refreshAgenda } from '$lib/server/gcal/service';

export const POST = async () => {
	try {
		return json(await refreshAgenda());
	} catch (err) {
		console.error('Manual gcal refresh failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
