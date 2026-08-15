import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Flag } from './flags';

const flagRows: Flag[] = [];
const joins: { personId: string; flagId: string; createdAt: string }[] = [];
/** Ordered log of tables the transactional delete hit, for the ordering assertion. */
const deleted: string[] = [];

// `getTableName` is drizzle's public accessor. Reading `table._.name` happens to
// work today but is internal, and this mock has to tell two tables apart.
vi.mock('../db', async () => {
	const { getTableName } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
	const tx = {
		delete: (table: Parameters<typeof getTableName>[0]) => ({
			where: () => ({
				run: () => {
					const name = getTableName(table);
					deleted.push(name);
					if (name === 'people_flags') joins.length = 0;
					else flagRows.length = 0;
				}
			})
		})
	};
	return {
		db: {
			insert: (table: Parameters<typeof getTableName>[0]) => ({
				// Copies, never the objects the service returned — see the note in
				// service.test.ts. Aliasing turns assertions into tautologies.
				values: (r: Record<string, unknown>) => {
					if (getTableName(table) === 'flags') flagRows.push({ ...r } as Flag);
					else joins.push({ ...r } as { personId: string; flagId: string; createdAt: string });
					return Promise.resolve();
				}
			}),
			query: {
				flags: { findMany: () => Promise.resolve([...flagRows]) },
				peopleFlags: { findMany: () => Promise.resolve([...joins]) }
			},
			update: () => ({
				set: (patch: Partial<Flag>) => ({
					where: () => {
						Object.assign(flagRows[0], patch);
						return Promise.resolve();
					}
				})
			}),
			delete: () => ({
				where: () => {
					joins.length = 0;
					return Promise.resolve();
				}
			}),
			// better-sqlite3 transactions are synchronous, so the callback runs
			// inline and receives a tx handle rather than a promise.
			transaction: (cb: (t: typeof tx) => void) => cb(tx)
		}
	};
});

import * as flagsService from './flags';

describe('flags service', () => {
	beforeEach(() => {
		flagRows.length = 0;
		joins.length = 0;
		deleted.length = 0;
	});

	it('creates a flag with the default colour', async () => {
		const f = await flagsService.createFlag('SF');
		expect(f.name).toBe('SF');
		expect(f.color).toBe('sage');
	});

	it('creates a flag with a chosen colour', async () => {
		const f = await flagsService.createFlag('NYC', 'blush');
		expect(f.color).toBe('blush');
	});

	// Typing "sf" when "SF" exists must not produce a twin.
	it('reuses an existing flag whose name differs only in case', async () => {
		const first = await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('sf');
		expect(second.id).toBe(first.id);
		expect(flagRows).toHaveLength(1);
	});

	it('keeps the name exactly as first typed when reusing', async () => {
		await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('sf');
		expect(second.name).toBe('SF');
	});

	it('ignores surrounding whitespace when matching an existing flag', async () => {
		const first = await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('  sf  ');
		expect(second.id).toBe(first.id);
	});

	it('lists flags', async () => {
		await flagsService.createFlag('SF');
		expect(await flagsService.listFlags()).toHaveLength(1);
	});

	it('renames a flag', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.updateFlag(f.id, { name: 'Bay Area' });
		expect(flagRows[0].name).toBe('Bay Area');
	});

	it('recolours a flag', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.updateFlag(f.id, { color: 'lilac' });
		expect(flagRows[0].color).toBe('lilac');
	});

	it('attaches a flag to a person', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		expect(joins).toHaveLength(1);
	});

	it('detaches a flag from a person', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.detachFlag('p1', f.id);
		expect(joins).toHaveLength(0);
	});

	// The foreign_keys pragma is off in db/index.ts, so ON DELETE CASCADE is not
	// enforced — the join rows must be cleared explicitly, and before the flag.
	it('clears join rows before deleting the flag itself', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.deleteFlag(f.id);
		expect(deleted).toEqual(['people_flags', 'flags']);
	});

	it('leaves no orphaned join rows behind after a delete', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.deleteFlag(f.id);
		expect(joins).toHaveLength(0);
	});
});
