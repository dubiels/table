import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { touchpoints, people } from '../db/schema';

export type Touchpoint = typeof touchpoints.$inferSelect;

/**
 * Records a contact, and moves the person's `lastSpokeAt` forward if this is
 * the most recent one.
 *
 * Forward only, deliberately: logging a coffee you forgot about from March
 * should not rewrite "last spoke" to March when you also spoke last week. The
 * log holds the history; the column answers "how long has it been", and that
 * question only ever means the latest.
 *
 * Both writes happen in one transaction so a crash between them cannot leave a
 * logged conversation the grid does not know about. better-sqlite3 transactions
 * are synchronous, so the callback must not await.
 */
export async function logTouchpoint(input: {
	personId: string;
	occurredOn: string;
	note?: string;
}): Promise<Touchpoint> {
	const row = {
		id: randomUUID(),
		personId: input.personId,
		occurredOn: input.occurredOn,
		note: input.note ?? null,
		createdAt: new Date().toISOString()
	};

	const person = await db.query.people.findFirst({ where: eq(people.id, input.personId) });
	const isLatest = !person?.lastSpokeAt || input.occurredOn > person.lastSpokeAt;

	db.transaction((tx) => {
		tx.insert(touchpoints).values(row).run();
		if (isLatest) {
			tx.update(people)
				.set({ lastSpokeAt: input.occurredOn, updatedAt: new Date().toISOString() })
				.where(eq(people.id, input.personId))
				.run();
		}
	});

	return row;
}

/** Every touchpoint, newest first, for grouping by person in a route load. */
export async function listTouchpoints(): Promise<Touchpoint[]> {
	return db.query.touchpoints.findMany({
		orderBy: (t, { desc }) => [desc(t.occurredOn), desc(t.createdAt)]
	});
}

/**
 * The date `people.lastSpokeAt` should hold once the log looks like `dates`, or
 * `undefined` when the column is not this edit's to move.
 *
 * Changing the newest reach-out has to pull the column back to whatever is
 * newest now — otherwise "last spoke" keeps quoting a coffee you deleted.
 * Touching an older one leaves it alone, the same way backfilling does, unless
 * the edit jumps it ahead of everything else. And a `lastSpokeAt` typed by hand
 * on the person, with no touchpoint behind it, is never overwritten by an edit
 * to some unrelated older entry.
 */
function nextLastSpokeAt(
	current: string | null,
	previous: string,
	dates: string[]
): string | null | undefined {
	const latest = dates.reduce<string | null>((a, b) => (!a || b > a ? b : a), null);
	if (current === previous) return latest;
	if (latest && (!current || latest > current)) return latest;
	return undefined;
}

/** The remaining dates for a person's log, with `id` replaced or dropped. */
async function datesAfter(personId: string, id: string, replacement: string | null) {
	const all = await db.query.touchpoints.findMany({
		where: eq(touchpoints.personId, personId)
	});
	const dates: string[] = [];
	for (const t of all) {
		const date = t.id === id ? replacement : t.occurredOn;
		if (date) dates.push(date);
	}
	return dates;
}

/** Corrects a logged reach-out. Returns null if it is already gone. */
export async function updateTouchpoint(
	id: string,
	input: { occurredOn: string; note?: string }
): Promise<Touchpoint | null> {
	const existing = await db.query.touchpoints.findFirst({ where: eq(touchpoints.id, id) });
	if (!existing) return null;

	const person = await db.query.people.findFirst({ where: eq(people.id, existing.personId) });
	const lastSpokeAt = nextLastSpokeAt(
		person?.lastSpokeAt ?? null,
		existing.occurredOn,
		await datesAfter(existing.personId, id, input.occurredOn)
	);

	const row = { ...existing, occurredOn: input.occurredOn, note: input.note ?? null };
	db.transaction((tx) => {
		tx.update(touchpoints)
			.set({ occurredOn: row.occurredOn, note: row.note })
			.where(eq(touchpoints.id, id))
			.run();
		if (lastSpokeAt !== undefined) {
			tx.update(people)
				.set({ lastSpokeAt, updatedAt: new Date().toISOString() })
				.where(eq(people.id, existing.personId))
				.run();
		}
	});

	return row;
}

/** Removes a logged reach-out. Returns false if it is already gone. */
export async function deleteTouchpoint(id: string): Promise<boolean> {
	const existing = await db.query.touchpoints.findFirst({ where: eq(touchpoints.id, id) });
	if (!existing) return false;

	const person = await db.query.people.findFirst({ where: eq(people.id, existing.personId) });
	const lastSpokeAt = nextLastSpokeAt(
		person?.lastSpokeAt ?? null,
		existing.occurredOn,
		await datesAfter(existing.personId, id, null)
	);

	db.transaction((tx) => {
		tx.delete(touchpoints).where(eq(touchpoints.id, id)).run();
		if (lastSpokeAt !== undefined) {
			tx.update(people)
				.set({ lastSpokeAt, updatedAt: new Date().toISOString() })
				.where(eq(people.id, existing.personId))
				.run();
		}
	});

	return true;
}
