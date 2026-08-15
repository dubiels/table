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

export async function updateFlag(
	id: string,
	patch: { name?: string; color?: FlagColor }
): Promise<void> {
	await db.update(flags).set(patch).where(eq(flags.id, id));
}

/**
 * A flag and every attachment of it, in one transaction.
 *
 * `db/index.ts` sets only `journal_mode`, leaving the `foreign_keys` pragma off,
 * so `ON DELETE CASCADE` is declared but never enforced — the join rows have to
 * go explicitly, and first, or a crash between the two statements would strand
 * rows pointing at a flag that no longer exists.
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

export async function attachFlag(personId: string, flagId: string): Promise<void> {
	await db.insert(peopleFlags).values({
		personId,
		flagId,
		createdAt: new Date().toISOString()
	});
}

export async function detachFlag(personId: string, flagId: string): Promise<void> {
	await db
		.delete(peopleFlags)
		.where(and(eq(peopleFlags.personId, personId), eq(peopleFlags.flagId, flagId)));
}
