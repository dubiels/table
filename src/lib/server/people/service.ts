import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { people, peopleFlags } from '../db/schema';

export type Person = typeof people.$inferSelect;
export type PersonWithFlags = Person & { flagIds: string[] };

/** Local date, matching the timezone `fly.toml` pins the process to. */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function createPerson(input: {
	name: string;
	notes?: string;
	metOn?: string;
}): Promise<Person> {
	const now = new Date().toISOString();
	const row = {
		id: randomUUID(),
		name: input.name,
		linkedinUrl: null,
		email: null,
		phone: null,
		company: null,
		role: null,
		city: null,
		metAt: null,
		// You add someone right after meeting them, so today is nearly always
		// right and never has to be typed.
		metOn: input.metOn ?? today(),
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
