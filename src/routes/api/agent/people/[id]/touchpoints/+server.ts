import type { RequestHandler } from './$types';
import * as touchpointsService from '$lib/server/people/touchpoints';
import { runWrite, parse } from '$lib/server/agent/respond';
import { touchpointSchema } from '$lib/server/agent/schemas';
import { requirePerson } from '$lib/server/agent/resources';

export const POST: RequestHandler = ({ request, params }) =>
	runWrite(request, `POST /api/agent/people/${params.id}/touchpoints`, async (body) => {
		await requirePerson(params.id);
		const input = parse(touchpointSchema, body);
		// Moves the person's lastSpokeAt forward only if this is the most recent
		// contact — logging a coffee remembered from March must not rewrite "last
		// spoke" to March when you also spoke last week.
		const touchpoint = await touchpointsService.logTouchpoint({
			personId: params.id,
			occurredOn: input.occurredOn,
			note: input.note ?? undefined
		});
		return { status: 201, body: { touchpoint } };
	});
