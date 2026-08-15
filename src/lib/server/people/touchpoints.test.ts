import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Touchpoint } from './touchpoints';

type PersonRow = { id: string; lastSpokeAt: string | null; updatedAt: string };

const logged: Touchpoint[] = [];
const peopleRows: PersonRow[] = [];

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
			set: (patch: Partial<PersonRow>) => ({
				where: () => ({
					run: () => {
						if (getTableName(table) === 'people' && peopleRows[0]) {
							Object.assign(peopleRows[0], patch);
						}
					}
				})
			})
		})
	};
	return {
		db: {
			query: {
				people: { findFirst: () => Promise.resolve(peopleRows[0]) },
				touchpoints: { findMany: () => Promise.resolve([...logged]) }
			},
			transaction: (cb: (t: typeof tx) => void) => cb(tx)
		}
	};
});

import * as service from './touchpoints';

describe('logTouchpoint', () => {
	beforeEach(() => {
		logged.length = 0;
		peopleRows.length = 0;
		peopleRows.push({ id: 'p1', lastSpokeAt: null, updatedAt: '2026-01-01T00:00:00.000Z' });
	});

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
	beforeEach(() => {
		logged.length = 0;
		peopleRows.length = 0;
		peopleRows.push({ id: 'p1', lastSpokeAt: null, updatedAt: '2026-01-01T00:00:00.000Z' });
	});

	it('returns what has been logged', async () => {
		await service.logTouchpoint({ personId: 'p1', occurredOn: '2026-08-10' });
		expect(await service.listTouchpoints()).toHaveLength(1);
	});
});
