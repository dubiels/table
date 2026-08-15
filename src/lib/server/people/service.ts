import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { localDateString } from '$lib/date';
import { db } from '../db';
import { people } from '../db/schema';

export type Person = typeof people.$inferSelect;
export type PersonWithFlags = Person & { flagIds: string[] };

/**
 * Local date, matching the timezone `fly.toml` pins the process to.
 *
 * `new Date().toISOString()` answers a UTC question, not a local one, so
 * anywhere west of Greenwich it rolls over to tomorrow during the evening.
 */
function today(): string {
	return localDateString();
}

export async function createPerson(input: {
	name: string;
	linkedinUrl?: string;
	email?: string;
	phone?: string;
	metAt?: string;
	metOn?: string;
	lastSpokeAt?: string;
	notes?: string;
}): Promise<Person> {
	const now = new Date().toISOString();
	// You add someone right after meeting them, so today is nearly always right
	// and never has to be typed.
	const metOn = input.metOn ?? today();
	const row = {
		id: randomUUID(),
		name: input.name,
		linkedinUrl: input.linkedinUrl ?? null,
		email: input.email ?? null,
		phone: input.phone ?? null,
		// Company, role and city are not on the add form — they are the fields you
		// look up later rather than remember in the moment.
		company: null,
		role: null,
		city: null,
		metAt: input.metAt ?? null,
		metOn,
		// Meeting someone is the first time you spoke to them, so this starts
		// where `metOn` does unless the form says otherwise.
		lastSpokeAt: input.lastSpokeAt ?? metOn,
		notes: input.notes ?? null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	await db.insert(people).values(row);
	return row;
}

/**
 * Every person with their flag ids.
 *
 * Two queries joined in memory rather than one SQL join: at a few hundred rows
 * the difference is unmeasurable, and it keeps `PersonWithFlags` a plain object
 * the pure `filterPeople` can consume without knowing anything about Drizzle.
 */
export async function listPeople(): Promise<PersonWithFlags[]> {
	const [rows, links] = await Promise.all([
		db.query.people.findMany(),
		db.query.peopleFlags.findMany()
	]);

	const byPerson = new Map<string, string[]>();
	for (const link of links) {
		const existing = byPerson.get(link.personId);
		if (existing) existing.push(link.flagId);
		else byPerson.set(link.personId, [link.flagId]);
	}

	return rows.map((row) => ({ ...row, flagIds: byPerson.get(row.id) ?? [] }));
}

export async function updatePerson(
	id: string,
	patch: Partial<Omit<Person, 'id' | 'createdAt'>>
): Promise<void> {
	await db
		.update(people)
		.set({ ...patch, updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}

export async function archivePerson(id: string): Promise<void> {
	await db
		.update(people)
		.set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}

export async function restorePerson(id: string): Promise<void> {
	await db
		.update(people)
		.set({ archivedAt: null, updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}
