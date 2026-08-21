import type { RequestHandler } from './$types';
import * as zonesService from '$lib/server/zones/service';
import * as flagsService from '$lib/server/people/flags';
import { runRead } from '$lib/server/agent/respond';
import { serializeMeta } from '$lib/server/agent/serialize';

export const GET: RequestHandler = () =>
	runRead(async () => {
		const [zones, flags] = await Promise.all([zonesService.listZones(), flagsService.listFlags()]);
		return serializeMeta(zones, flags);
	});
