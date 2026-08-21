import type { RequestHandler } from './$types';
import * as peopleService from '$lib/server/people/service';
import * as flagsService from '$lib/server/people/flags';
import * as touchpointsService from '$lib/server/people/touchpoints';
import { resolvePersonCity } from '$lib/server/cities';
import { runWrite, parse } from '$lib/server/agent/respond';
import { updatePersonSchema } from '$lib/server/agent/schemas';
import { serializePerson } from '$lib/server/agent/serialize';
import { requirePerson } from '$lib/server/agent/resources';

export const PATCH: RequestHandler = ({ request, params }) =>
	runWrite(request, `PATCH /api/agent/people/${params.id}`, async (body) => {
		const existing = await requirePerson(params.id);
		const input = parse(updatePersonSchema, body);

		const patch: Parameters<typeof peopleService.updatePerson>[1] = {};
		for (const key of [
			'name',
			'status',
			'linkedinUrl',
			'email',
			'phone',
			'company',
			'role',
			'metAt',
			'metOn',
			'lastSpokeAt',
			'notes'
		] as const) {
			if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
		}

		// City and its id move as a pair: the id owns the text beside it, so
		// changing either has to re-derive both, and the half that was not sent
		// comes from the row rather than being cleared.
		if (input.city !== undefined || input.cityId !== undefined) {
			const location = resolvePersonCity({
				city: input.city !== undefined ? input.city : existing.city,
				cityId: input.cityId !== undefined ? input.cityId : existing.cityId
			});
			patch.city = location.city;
			patch.cityId = location.cityId;
		}

		if (Object.keys(patch).length > 0) await peopleService.updatePerson(params.id, patch);

		const [updated, flags, touchpoints] = await Promise.all([
			requirePerson(params.id),
			flagsService.listFlags(),
			touchpointsService.listTouchpoints()
		]);
		return {
			status: 200,
			body: {
				person: serializePerson(
					updated,
					new Map(flags.map((f) => [f.id, f])),
					touchpoints.filter((t) => t.personId === params.id)
				)
			}
		};
	});
