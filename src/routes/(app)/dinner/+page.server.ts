import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import * as peopleService from '$lib/server/people/service';
import * as flagsService from '$lib/server/people/flags';
// The route is the composition layer: `src/lib/server/people/**` stays free of
// the board so it remains extractable, but the page that shows a person and
// their follow-ups is allowed to reach for both.
import * as tasksService from '$lib/server/tasks/service';
import {
	addPersonSchema,
	updatePersonSchema,
	flagSchema,
	personTaskSchema
} from '$lib/server/people/forms';

export const load: PageServerLoad = async () => {
	const [people, flags, allTasks] = await Promise.all([
		peopleService.listPeople(),
		flagsService.listFlags(),
		tasksService.listTasks()
	]);

	// Only what a person's modal renders, keyed by person. Completed ones are
	// kept: crossing something off and watching it vanish reads as data loss.
	const tasksByPerson: Record<
		string,
		{ id: string; title: string; dueDate: string | null; done: boolean }[]
	> = {};
	for (const task of allTasks) {
		if (!task.personId) continue;
		(tasksByPerson[task.personId] ??= []).push({
			id: task.id,
			title: task.title,
			dueDate: task.dueDate,
			done: task.done
		});
	}

	return { people, flags, tasksByPerson };
};

/** Every action posts the row it acts on; a missing id is a bug, not user error. */
function requireId(data: Record<string, unknown>, key = 'id'): string | null {
	const value = data[key];
	return typeof value === 'string' && value ? value : null;
}

export const actions: Actions = {
	createPerson: async ({ request }) => {
		// Read once: `flagIds` is a repeated field, so it needs getAll() rather
		// than the single value Object.fromEntries would keep.
		const form = await request.formData();
		const parsed = addPersonSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: 'A name is required' });

		const person = await peopleService.createPerson(parsed.data);

		// Flags can only be attached once the person exists, so this happens here
		// rather than inside createPerson — one round trip either way.
		const flagIds = form.getAll('flagIds').filter((v): v is string => typeof v === 'string' && !!v);
		for (const flagId of flagIds) await flagsService.attachFlag(person.id, flagId);

		// A name typed into the picker's "new flag" box. createFlag reuses an
		// existing flag case-insensitively, so this cannot mint a near-duplicate.
		const newFlagName = form.get('newFlagName');
		if (typeof newFlagName === 'string' && newFlagName.trim()) {
			const flag = await flagsService.createFlag(newFlagName);
			await flagsService.attachFlag(person.id, flag.id);
		}

		return { created: person.id };
	},

	createTaskForPerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const personId = requireId(data, 'personId');
		if (!personId) return fail(400, { error: 'Missing person' });

		const parsed = personTaskSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A task needs a title' });

		await tasksService.createTask({ ...parsed.data, personId });
		return { taskCreated: true };
	},

	toggleTaskForPerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data, 'taskId');
		if (!id) return fail(400, { error: 'Missing task' });
		await tasksService.toggleTaskDone(id);
		return { taskToggled: id };
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
			lastSpokeAt: parsed.data.lastSpokeAt ?? null,
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
