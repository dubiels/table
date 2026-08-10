import { describe, it, expect, beforeEach, vi } from 'vitest';

const rows: any[] = [];
vi.mock('../db', () => ({
	db: {
		insert: () => ({
			values: (r: any) => {
				rows.push(r);
				return Promise.resolve();
			}
		}),
		query: { zones: { findMany: () => Promise.resolve([...rows]) } },
		update: () => ({
			set: (patch: any) => ({
				where: () => {
					Object.assign(rows[0], patch);
					return Promise.resolve();
				}
			})
		}),
		delete: () => ({
			where: () => {
				rows.length = 0;
				return Promise.resolve();
			}
		})
	}
}));

import * as zonesService from './service';

describe('zones service', () => {
	beforeEach(() => {
		rows.length = 0;
	});

	it('creates a zone with defaults', async () => {
		const z = await zonesService.createZone({ name: 'Work' });
		expect(z.name).toBe('Work');
		expect(z.color).toBe('sage');
		expect(z.width).toBe(320);
		expect(z.id).toBeTruthy();
	});

	it('renames a zone', async () => {
		await zonesService.createZone({ name: 'Work' });
		await zonesService.renameZone(rows[0].id, 'Home');
		expect(rows[0].name).toBe('Home');
	});

	it('updates zone geometry', async () => {
		await zonesService.createZone({ name: 'Work' });
		await zonesService.updateZoneGeometry(rows[0].id, { x: 5, y: 6, width: 100, height: 200 });
		expect(rows[0]).toMatchObject({ x: 5, y: 6, width: 100, height: 200 });
	});
});
