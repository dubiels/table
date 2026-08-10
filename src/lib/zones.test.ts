import { describe, it, expect } from 'vitest';
import {
	zoneForTask,
	taskCenter,
	ZONE_COLOR_KEYS,
	visibleWorldBounds,
	type ZoneBounds
} from './zones';

const work: ZoneBounds = { id: 'work', x: 0, y: 0, width: 400, height: 400 };
const inbox: ZoneBounds = { id: 'inbox', x: 50, y: 50, width: 100, height: 100 };

describe('zoneForTask', () => {
	it('returns the zone whose bounds contain the point', () => {
		expect(zoneForTask({ x: 300, y: 300 }, [work])?.id).toBe('work');
	});

	it('returns null when the point is outside every zone', () => {
		expect(zoneForTask({ x: 500, y: 500 }, [work])).toBeNull();
	});

	it('breaks overlap ties by choosing the smallest-area zone', () => {
		expect(zoneForTask({ x: 100, y: 100 }, [work, inbox])?.id).toBe('inbox');
	});

	it('includes points exactly on the boundary', () => {
		expect(zoneForTask({ x: 0, y: 0 }, [work])?.id).toBe('work');
		expect(zoneForTask({ x: 400, y: 400 }, [work])?.id).toBe('work');
	});
});

describe('taskCenter', () => {
	it('offsets a top-left anchor by half the default card size', () => {
		const c = taskCenter({ x: 10, y: 20 });
		expect(c.x).toBeGreaterThan(10);
		expect(c.y).toBeGreaterThan(20);
	});
});

describe('ZONE_COLOR_KEYS', () => {
	it('exposes the six palette keys', () => {
		expect(ZONE_COLOR_KEYS).toEqual(['sage', 'sky', 'butter', 'blush', 'lilac', 'clay']);
	});
});

describe('visibleWorldBounds', () => {
	it('equals the natural viewport at zoom 1', () => {
		expect(visibleWorldBounds(1000, 600, 1)).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 600 });
	});

	it('extends beyond the natural viewport when zoomed out', () => {
		// scale(0.5) around the center shows 2x the size, centered: [-500, 1500] clipped to >= 0
		expect(visibleWorldBounds(1000, 600, 0.5)).toEqual({ minX: 0, minY: 0, maxX: 1500, maxY: 900 });
	});

	it('grows monotonically as zoom decreases', () => {
		const z1 = visibleWorldBounds(1000, 600, 0.9);
		const z2 = visibleWorldBounds(1000, 600, 0.6);
		expect(z2.maxX).toBeGreaterThan(z1.maxX);
		expect(z2.maxY).toBeGreaterThan(z1.maxY);
	});
});
