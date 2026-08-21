import type { RequestHandler } from './$types';
import * as peopleService from '$lib/server/people/service';
import { runWrite } from '$lib/server/agent/respond';
import { requirePerson } from '$lib/server/agent/resources';

/**
 * Archive rather than delete, and restorable.
 *
 * A hand-written paragraph about someone met once cannot be recovered from
 * anywhere, so Dinner Table has no delete at all. DELETE here therefore undoes
 * the archive — the sub-resource is the archived state, and removing it is
 * restoring the person.
 */
export const POST: RequestHandler = ({ request, params }) =>
	runWrite(request, `POST /api/agent/people/${params.id}/archive`, async () => {
		await requirePerson(params.id);
		await peopleService.archivePerson(params.id);
		const person = await requirePerson(params.id);
		return { status: 200, body: { id: params.id, archived: true, archivedAt: person.archivedAt } };
	});

export const DELETE: RequestHandler = ({ request, params }) =>
	runWrite(request, `DELETE /api/agent/people/${params.id}/archive`, async () => {
		await requirePerson(params.id);
		await peopleService.restorePerson(params.id);
		return { status: 200, body: { id: params.id, archived: false, archivedAt: null } };
	});
