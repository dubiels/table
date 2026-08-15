import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { flags, peopleFlags } from '../db/schema';
import type { FlagColor } from '$lib/people/colors';

export type Flag = typeof flags.$inferSelect;

export async function listFlags(): Promise<Flag[]> {
	return db.query.flags.findMany({ orderBy: (f, { asc }) => [asc(f.name)] });
}

/**
 * A flag by name, created only if nothing matches ignoring case.
 *
 * SQLite compares text case-sensitively, so the unique constraint on the column
 * would happily accept "sf" alongside "SF". Matching here is what stops the
 * filter bar filling with near-duplicates. The name is stored exactly as first
 * typed; a later duplicate adopts the original spelling rather than rewriting it.
 */
export async function createFlag(name: string, color: FlagColor = 'sage'): Promise<Flag> {
	const trimmed = name.trim();
	const existing = (await db.query.flags.findMany()).find(
		(f) => f.name.toLowerCase() === trimmed.toLowerCase()
	);
	if (existing) return existing;

	const row = {
		id: randomUUID(),
		name: trimmed,
		color,
		createdAt: new Date().toISOString()
	};
	await db.insert(flags).values(row);
	return row;
}

/**
 * Renames/recolours a flag, guarding the rename against another flag already
 * holding the target name.
 *
 * Checked case-insensitively — stricter than the database's exact-match unique
 * index — for the same reason `createFlag` reuses `sf` for an existing `SF`:
 * without it the filter bar fills with near-duplicate labels. A flag renaming
 * to a different casing of its OWN name (`SF` -> `Sf`) is not a collision and
 * must still succeed.
 */
export async function updateFlag(
	id: string,
	patch: { name?: string; color?: FlagColor }
): Promise<'ok' | 'duplicate-name'> {
	if (patch.name !== undefined) {
		const trimmed = patch.name.trim();
		const collision = (await db.query.flags.findMany()).find(
			(f) => f.id !== id && f.name.toLowerCase() === trimmed.toLowerCase()
		);
		if (collision) return 'duplicate-name';
	}

	await db.update(flags).set(patch).where(eq(flags.id, id));
	return 'ok';
}

/**
 * A flag and every attachment of it, in one transaction.
 *
 * `db/index.ts` sets only `journal_mode`, leaving the `foreign_keys` pragma off,
 * so `ON DELETE CASCADE` is declared but never enforced — SQLite will not clean
 * up the join rows itself, so they have to go explicitly, and first, or they'd
 * be left pointing at a flag that no longer exists. (The transaction below is
 * still atomic — a throw mid-callback rolls back both statements — so this
 * ordering is defensive practice, not a guard against a partial write.)
 *
 * better-sqlite3 transactions are synchronous, so the callback must not await;
 * `.run()` executes each statement inline.
 */
export async function deleteFlag(id: string): Promise<void> {
	db.transaction((tx) => {
		tx.delete(peopleFlags).where(eq(peopleFlags.flagId, id)).run();
		tx.delete(flags).where(eq(flags.id, id)).run();
	});
}

/**
 * Attaches a flag to a person, idempotently.
 *
 * The desired end state is "this person has this flag" — already true if it's
 * attached twice (double-click before the UI refreshes, a resubmitted form, or
 * `createFlag`'s auto-attach landing on a flag already on that person), so a
 * repeat attach is a no-op rather than a UNIQUE constraint crash.
 */
export async function attachFlag(personId: string, flagId: string): Promise<void> {
	await db
		.insert(peopleFlags)
		.values({
			personId,
			flagId,
			createdAt: new Date().toISOString()
		})
		.onConflictDoNothing();
}

export async function detachFlag(personId: string, flagId: string): Promise<void> {
	await db
		.delete(peopleFlags)
		.where(and(eq(peopleFlags.personId, personId), eq(peopleFlags.flagId, flagId)));
}
