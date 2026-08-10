import { json } from '@sveltejs/kit';
import { runMorningDigest } from '$lib/server/scheduler';

// Session-gated by hooks.server.ts like every other non-public route: the same
// digest the 8am cron sends, on demand, so it can be seen working without
// waiting for tomorrow morning.
export const POST = async () => {
	try {
		await runMorningDigest();
		return json({ ok: true });
	} catch (err) {
		console.error('Manual digest run failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
