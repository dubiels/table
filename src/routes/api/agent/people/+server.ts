import type { RequestHandler } from './$types';
import * as peopleService from '$lib/server/people/service';
import * as flagsService from '$lib/server/people/flags';
import * as touchpointsService from '$lib/server/people/touchpoints';
import { resolvePersonCity } from '$lib/server/cities';
import { runRead, runWrite, parse, boolParam } from '$lib/server/agent/respond';
import { createPersonSchema } from '$lib/server/agent/schemas';
import { serializePeople, serializePerson } from '$lib/server/agent/serialize';
import { requireFlag } from '$lib/server/agent/resources';

export const GET: RequestHandler = ({ url }) =>
	runRead(async () => {
		const [people, flags, touchpoints] = await Promise.all([
			peopleService.listPeople(),
			flagsService.listFlags(),
			touchpointsService.listTouchpoints()
		]);
		return {
			people: serializePeople(people, flags, touchpoints, {
				includeArchived: boolParam(url, 'includeArchived')
			})
		};
	});

export const POST: RequestHandler = ({ request }) =>
	runWrite(request, 'POST /api/agent/people', async (body) => {
		const input = parse(createPersonSchema, body);
		// Checked before the person exists, so a bad flag id fails the request
		// outright rather than leaving a half-tagged person behind.
		for (const flagId of input.flagIds ?? []) await requireFlag(flagId);

		// A matched id owns the text stored beside it, resolved here rather than
		// trusting what was posted — the same rule the add form follows.
		const location = resolvePersonCity({ city: input.city, cityId: input.cityId });

		const person = await peopleService.createPerson({
			name: input.name,
			status: input.status,
			linkedinUrl: input.linkedinUrl ?? undefined,
			email: input.email ?? undefined,
			phone: input.phone ?? undefined,
			company: input.company ?? undefined,
			role: input.role ?? undefined,
			city: location.city ?? undefined,
			cityId: location.cityId ?? undefined,
			metAt: input.metAt ?? undefined,
			metOn: input.metOn ?? undefined,
			lastSpokeAt: input.lastSpokeAt ?? undefined,
			notes: input.notes ?? undefined
		});

		// Flags can only be attached once the person exists, so this happens here
		// rather than inside createPerson — as the form action does it too.
		//
		// A failure attaching one is deliberately not fatal. The person row is
		// already committed, and throwing would release the idempotency claim, so
		// the agent's retry under the same key would create a SECOND person rather
		// than finishing the first one's tags. Reporting the flags that actually
		// landed lets the caller re-attach the rest against the person it now
		// knows exists, which is recoverable where a duplicate contact is not.
		const attached: string[] = [];
		for (const flagId of input.flagIds ?? []) {
			try {
				await flagsService.attachFlag(person.id, flagId);
				attached.push(flagId);
			} catch (err) {
				console.error(`agent api: attaching flag ${flagId} to ${person.id} failed`, err);
			}
		}

		const flags = await flagsService.listFlags();
		return {
			status: 201,
			body: {
				// The flags that are really on the row, not the ones that were asked
				// for — otherwise a partial failure reads as a complete success.
				person: serializePerson(
					{ ...person, flagIds: attached },
					new Map(flags.map((f) => [f.id, f])),
					[]
				)
			}
		};
	});
