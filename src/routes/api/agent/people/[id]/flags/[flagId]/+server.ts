import type { RequestHandler } from './$types';
import * as flagsService from '$lib/server/people/flags';
import { runWrite } from '$lib/server/agent/respond';
import { requirePerson } from '$lib/server/agent/resources';

export const DELETE: RequestHandler = ({ request, params }) =>
	runWrite(request, `DELETE /api/agent/people/${params.id}/flags/${params.flagId}`, async () => {
		await requirePerson(params.id);
		// The flag itself is not required to exist: the end state this asks for —
		// "this person does not carry this flag" — is already true if it never did,
		// and a 404 would make a retry after a successful detach look like failure.
		await flagsService.detachFlag(params.id, params.flagId);
		return { status: 200, body: { personId: params.id, flagId: params.flagId, detached: true } };
	});
