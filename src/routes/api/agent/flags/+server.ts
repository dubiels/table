import type { RequestHandler } from './$types';
import * as flagsService from '$lib/server/people/flags';
import { runWrite, parse } from '$lib/server/agent/respond';
import { createFlagSchema } from '$lib/server/agent/schemas';

export const POST: RequestHandler = ({ request }) =>
	runWrite(request, 'POST /api/agent/flags', async (body) => {
		const input = parse(createFlagSchema, body);
		// Reuses an existing flag case-insensitively, so this cannot mint "sf"
		// beside "SF" — replay-safe on the name alone, before any key is involved.
		const flag = await flagsService.createFlag(input.name, input.color);
		return { status: 201, body: { flag } };
	});
