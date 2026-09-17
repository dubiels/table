import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Touchpoint } from './touchpoints';

type PersonRow = { id: string; lastSpokeAt: string | null; updatedAt: string };

const logged: Touchpoint[] = [];
const peopleRows: PersonRow[] = [];

/**
 * The touchpoint the next findFirst/where is meant to hit. Nothing in the mock
 * can read drizzle's SQL objects, so a test says which row it is acting on and
 * the fakes take it from there — the services only ever address one at a time.
 */
let target: string | null = null;

function reset() {
	logged.length = 0;
	peopleRows.length = 0;
	target = null;
	peopleRows.push({ id: 'p1', lastSpokeAt: null, updatedAt: '2026-01-01T00:00:00.000Z' });
}

/** Points the mock at a row, standing in for the where() it cannot interpret. */
function __target(id: string | null) {
	target = id;
}

// Mirrors the mock in flags.test.ts: drizzle's where() takes an SQL object a
// hand mock cannot interpret, so these fakes operate on the whole array and the
// tests keep to one person. Rows are pushed as COPIES — aliasing the object the
// service returned turns assertions into comparisons of a value with itself,
// which this repo has shipped three times.
vi.mock('../db', async () => {
	const { getTableName } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
	const tx = {
		insert: () => ({
			values: (r: Touchpoint) => ({
				run: () => {
					logged.push({ ...r });
				}
			})
		}),
		update: (table: Parameters<typeof getTableName>[0]) => ({
			set: (patch: Partial<PersonRow> & Partial<Touchpoint>) => ({
				where: () => ({
					run: () => {
						if (getTableName(table) === 'people' && peopleRows[0]) {
							Object.assign(peopleRows[0], patch);
							return;
						}
						const row = logged.find((t) => t.id === target);
						if (row) Object.assign(row, patch);
					}
				})
			})
		}),
		delete: () => ({
			where: () => ({
				run: () => {
					const i = logged.findIndex((t) => t.id === target);
					if (i >= 0) logged.splice(i, 1);
				}
			})
		})
	};
	return {
		db: {
			query: {
				people: { findFirst: () => Promise.resolve(peopleRows[0]) },
				touchpoints: {
					findMany: () => Promise.resolve([...logged]),
					findFirst: () => Promise.resolve(logged.find((t) => t.id === target))
				}
			},
			transaction: (cb: (t: typeof tx) => void) => cb(tx)
		}
	};
});

import * as service from './touchpoints';

describe('logTouchpoint', () => {
	beforeEach(reset);

	it('records the contact', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10', note: 'coffee' });
		expect(logged).toHaveLength(1);
		expect(logged[0]).toMatchObject({ personId: 'p1', occurredOn: '2026-08-10', note: 'coffee' });
	});

	it('allows a touchpoint with no note', async () => {
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(t.note).toBeNull();
	});

	it('sets lastSpokeAt when the person has never been contacted', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-10');
	});

	it('moves lastSpokeAt forward for a more recent contact', async () => {
		peopleRows[0].lastSpokeAt = '2026-06-01';
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-10');
	});

	// Remembering a coffee from March must not rewrite "last spoke" to March when
	// you also spoke last week — the column answers "how long has it been", and
	// that only ever means the latest.
	it('leaves lastSpokeAt alone when backfilling an older contact', async () => {
		peopleRows[0].lastSpokeAt = '2026-08-01';
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-03-14' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-01');
	});

	it('still records the backfilled contact in the log', async () => {
		peopleRows[0].lastSpokeAt = '2026-08-01';
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-03-14' });
		expect(logged.map((t) => t.occurredOn)).toEqual(['2026-03-14']);
	});

	it('leaves lastSpokeAt alone when logging the same day again', async () => {
		peopleRows[0].lastSpokeAt = '2026-08-10';
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-10');
		expect(logged).toHaveLength(1);
	});
});

describe('listTouchpoints', () => {
	beforeEach(reset);

	it('returns what has been logged', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(await service.listTouchpoints()).toHaveLength(1);
	});
});

describe('updateTouchpoint', () => {
	beforeEach(reset);

	it('corrects the date and the note', async () => {
		const t = await service.logTouchpoint({
			personId: 'p1',
			occurredOn: '2026-08-10',
			note: 'tea'
		});
		__target(t.id);
		await service.updateTouchpoint(t.id, { occurredOn: '2026-08-11', note: 'coffee' });
		expect(logged[0]).toMatchObject({ occurredOn: '2026-08-11', note: 'coffee' });
	});

	it('clears the note when the field is left empty', async () => {
		const t = await service.logTouchpoint({
			personId: 'p1',
			occurredOn: '2026-08-10',
			note: 'tea'
		});
		__target(t.id);
		await service.updateTouchpoint(t.id, { occurredOn: '2026-08-10' });
		expect(logged[0].note).toBeNull();
	});

	// The whole point of the recount: lastSpokeAt was quoting this entry, so a
	// correction to it has to drag the column along rather than strand it.
	it('follows the newest reach-out backwards', async () => {
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(t.id);
		await service.updateTouchpoint(t.id, { occurredOn: '2026-07-01' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-07-01');
	});

	it('falls back to the next newest when the latest moves behind it', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-06-01' });
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(t.id);
		await service.updateTouchpoint(t.id, { occurredOn: '2026-03-14' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-06-01');
	});

	it('leaves lastSpokeAt alone when an older entry is corrected', async () => {
		const old = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-03-14' });
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(old.id);
		await service.updateTouchpoint(old.id, { occurredOn: '2026-03-20' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-10');
	});

	it('moves lastSpokeAt forward when an older entry jumps ahead', async () => {
		const old = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-03-14' });
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(old.id);
		await service.updateTouchpoint(old.id, { occurredOn: '2026-09-01' });
		expect(peopleRows[0].lastSpokeAt).toBe('2026-09-01');
	});

	it('returns null for a reach-out that is already gone', async () => {
		__target(null);
		expect(await service.updateTouchpoint('missing', { occurredOn: '2026-08-10' })).toBeNull();
	});
});

describe('deleteTouchpoint', () => {
	beforeEach(reset);

	it('removes the entry', async () => {
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(t.id);
		expect(await service.deleteTouchpoint(t.id)).toBe(true);
		expect(logged).toHaveLength(0);
	});

	it('pulls lastSpokeAt back to the next newest', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-06-01' });
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(t.id);
		await service.deleteTouchpoint(t.id);
		expect(peopleRows[0].lastSpokeAt).toBe('2026-06-01');
	});

	it('clears lastSpokeAt when the last entry goes', async () => {
		const t = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(t.id);
		await service.deleteTouchpoint(t.id);
		expect(peopleRows[0].lastSpokeAt).toBeNull();
	});

	it('leaves lastSpokeAt alone when an older entry goes', async () => {
		const old = await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-03-14' });
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		__target(old.id);
		await service.deleteTouchpoint(old.id);
		expect(peopleRows[0].lastSpokeAt).toBe('2026-08-10');
	});

	it('returns false for a reach-out that is already gone', async () => {
		__target(null);
		expect(await service.deleteTouchpoint('missing')).toBe(false);
	});
});
