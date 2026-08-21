import type { RequestHandler } from './$types';
import * as flagsService from '$lib/server/people/flags';
import { runWrite, parse } from '$lib/server/agent/respond';
import { attachFlagSchema } from '$lib/server/agent/schemas';
import { requireFlag, requirePerson } from '$lib/server/agent/resources';

export const POST: RequestHandler = ({ request, params }) =>
	runWrite(request, `POST /api/agent/people/${params.id}/flags`, async (body) => {
		await requirePerson(params.id);
		const { flagId } = parse(attachFlagSchema, body);
		const flag = await requireFlag(flagId);
		// Already idempotent in the service: the desired end state is "this person
		// has this flag", which a second attach does not disturb.
		await flagsService.attachFlag(params.id, flagId);
		return { status: 200, body: { personId: params.id, flag } };
	});
