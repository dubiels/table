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
