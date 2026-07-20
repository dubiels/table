import { describe, it, expect } from 'vitest';
import { zoneForTask, taskCenter, ZONE_COLOR_KEYS, type ZoneBounds } from './zones';

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
