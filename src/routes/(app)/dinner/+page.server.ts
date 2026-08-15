import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import * as peopleService from '$lib/server/people/service';
import * as flagsService from '$lib/server/people/flags';
import {
	quickAddPersonSchema,
	updatePersonSchema,
	flagSchema
} from '$lib/server/people/forms';

export const load: PageServerLoad = async () => {
	const [people, flags] = await Promise.all([peopleService.listPeople(), flagsService.listFlags()]);
	return { people, flags };
};

/** Every action posts the row it acts on; a missing id is a bug, not user error. */
function requireId(data: Record<string, unknown>, key = 'id'): string | null {
	const value = data[key];
	return typeof value === 'string' && value ? value : null;
}

export const actions: Actions = {
	createPerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = quickAddPersonSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A name is required' });

		const person = await peopleService.createPerson(parsed.data);
		return { created: person.id };
	},

	updatePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });

		const parsed = updatePersonSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A name is required' });

		await peopleService.updatePerson(id, {
			name: parsed.data.name,
			linkedinUrl: parsed.data.linkedinUrl ?? null,
			email: parsed.data.email ?? null,
			phone: parsed.data.phone ?? null,
			company: parsed.data.company ?? null,
			role: parsed.data.role ?? null,
			city: parsed.data.city ?? null,
			metAt: parsed.data.metAt ?? null,
			metOn: parsed.data.metOn ?? null,
			notes: parsed.data.notes ?? null
		});
		return { saved: true };
	},

	archivePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });
		await peopleService.archivePerson(id);
		return { archived: id };
	},

	restorePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });
		await peopleService.restorePerson(id);
		return { restored: id };
	},

	createFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = flagSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A flag name is required' });

		const flag = await flagsService.createFlag(parsed.data.name, parsed.data.color);
		// Quick-add from the picker attaches in the same round trip, so a new flag
		// lands on the person who prompted it without a second submit.
		const personId = requireId(data, 'personId');
		if (personId) await flagsService.attachFlag(personId, flag.id);
		return { flagId: flag.id };
	},

	updateFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing flag' });

		const parsed = flagSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A flag name is required' });

		const result = await flagsService.updateFlag(id, {
			name: parsed.data.name,
			color: parsed.data.color
		});
		if (result === 'duplicate-name') {
			return fail(400, { error: 'A flag with that name already exists' });
		}
		return { saved: true };
	},

	deleteFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing flag' });
		await flagsService.deleteFlag(id);
		return { deleted: id };
	},

	attachFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const personId = requireId(data, 'personId');
		const flagId = requireId(data, 'flagId');
		if (!personId || !flagId) return fail(400, { error: 'Missing person or flag' });
		await flagsService.attachFlag(personId, flagId);
		return { attached: true };
	},

	detachFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const personId = requireId(data, 'personId');
		const flagId = requireId(data, 'flagId');
		if (!personId || !flagId) return fail(400, { error: 'Missing person or flag' });
		await flagsService.detachFlag(personId, flagId);
		return { detached: true };
	}
};
