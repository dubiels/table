import { describe, it, expect } from 'vitest';
import {
	groupTasksByZone,
	computeTreemap,
	zoneCenterPoint,
	findUncategorizedPoint,
	insetRect,
	MAX_WEIGHT_RATIO,
	UNCATEGORIZED_ID,
	type BentoTask,
	type BentoZone
} from './bento';
import { taskCenter, zoneForTask, type ZoneBounds } from './zones';

function task(overrides: Partial<BentoTask> & { id: string }): BentoTask {
	return {
		title: 'Untitled',
		done: false,
		priority: null,
		dueDate: null,
		notes: null,
		x: -1000,
		y: -1000,
		...overrides
	};
}

const work: BentoZone = {
	id: 'work',
	name: 'Work',
	color: 'sky',
	x: 0,
	y: 0,
	width: 400,
	height: 400
};
const home: BentoZone = {
	id: 'home',
	name: 'Home',
	color: 'blush',
	x: 500,
	y: 0,
	width: 200,
	height: 200
};

describe('groupTasksByZone', () => {
	it('buckets tasks into their owning zone, matching zoneForTask/taskCenter', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const inHome = task({ id: '2', x: 550, y: 50 });
		const loose = task({ id: '3', x: -1000, y: -1000 });
		const groups = groupTasksByZone([inWork, inHome, loose], [work, home]);

		expect(groups).toHaveLength(3); // work, home, uncategorized
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
		expect(byId.work.tasks.map((t) => t.id)).toEqual(['1']);
		expect(byId.home.tasks.map((t) => t.id)).toEqual(['2']);
		expect(byId[UNCATEGORIZED_ID].tasks.map((t) => t.id)).toEqual(['3']);
		expect(byId[UNCATEGORIZED_ID].name).toBe('Uncategorized');
		expect(byId[UNCATEGORIZED_ID].color).toBeNull();
	});

	it('always includes every zone, even with zero tasks, at weight 1', () => {
		const groups = groupTasksByZone([], [work, home]);
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
		expect(byId.work.tasks).toEqual([]);
		expect(byId.work.weight).toBe(1);
		expect(byId[UNCATEGORIZED_ID].weight).toBe(1);
	});

	it('weight is max(taskCount, 1)', () => {
		const tasks = [1, 2, 3].map((n) => task({ id: String(n), x: 100, y: 100 }));
		const groups = groupTasksByZone(tasks, [work]);
		expect(groups.find((g) => g.id === 'work')?.weight).toBe(3);
	});

	it('floors a quiet group so a busy board cannot squeeze it below a readable size', () => {
		const busy = Array.from({ length: 40 }, (_, i) => task({ id: `w${i}`, x: 100, y: 100 }));
		const quiet = [task({ id: 'h1', x: 550, y: 50 })];
		const groups = groupTasksByZone([...busy, ...quiet], [work, home]);
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

		expect(byId.work.weight).toBe(40);
		expect(byId.home.weight).toBeGreaterThan(1);
		expect(byId.work.weight / byId.home.weight).toBeLessThanOrEqual(MAX_WEIGHT_RATIO);
	});

	it('keeps the busiest group the heaviest', () => {
		const busy = Array.from({ length: 40 }, (_, i) => task({ id: `w${i}`, x: 100, y: 100 }));
		const quiet = [task({ id: 'h1', x: 550, y: 50 })];
		const groups = groupTasksByZone([...busy, ...quiet], [work, home]);
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
		expect(byId.work.weight).toBeGreaterThan(byId.home.weight);
		expect(byId.home.weight).toBeGreaterThan(byId[UNCATEGORIZED_ID].weight - 0.001);
	});
});

describe('computeTreemap', () => {
	it('produces one rect per item, all with positive area, inside the container bounds', () => {
		const items = [
			{ id: 'a', weight: 5 },
			{ id: 'b', weight: 3 },
			{ id: 'c', weight: 1 },
			{ id: 'd', weight: 1 } // empty-category minimum weight
		];
		const rects = computeTreemap(items, 800, 600);
		expect(rects).toHaveLength(4);
		for (const r of rects) {
			expect(r.width).toBeGreaterThan(0);
			expect(r.height).toBeGreaterThan(0);
			expect(r.x).toBeGreaterThanOrEqual(-0.01);
			expect(r.y).toBeGreaterThanOrEqual(-0.01);
			expect(r.x + r.width).toBeLessThanOrEqual(800.01);
			expect(r.y + r.height).toBeLessThanOrEqual(600.01);
		}
	});

	it('tiles the full container with no gaps/overlaps (areas sum to the container area)', () => {
		const items = [
			{ id: 'a', weight: 10 },
			{ id: 'b', weight: 6 },
			{ id: 'c', weight: 4 },
			{ id: 'd', weight: 2 },
			{ id: 'e', weight: 1 }
		];
		const width = 1000;
		const height = 500;
		const rects = computeTreemap(items, width, height);
		const summedArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
		expect(summedArea).toBeCloseTo(width * height, 0);
	});

	it('sizes each box area proportional to its weight', () => {
		const items = [
			{ id: 'big', weight: 9 },
			{ id: 'small', weight: 1 }
		];
		const rects = computeTreemap(items, 1000, 100);
		const totalArea = 1000 * 100;
		const totalWeight = 10;
		const byId = Object.fromEntries(rects.map((r) => [r.id, r]));
		expect(byId.big.width * byId.big.height).toBeCloseTo(totalArea * (9 / totalWeight), 0);
		expect(byId.small.width * byId.small.height).toBeCloseTo(totalArea * (1 / totalWeight), 0);
	});

	it('returns an empty array for zero items or a zero-sized container', () => {
		expect(computeTreemap([], 800, 600)).toEqual([]);
		expect(computeTreemap([{ id: 'a', weight: 1 }], 0, 0)).toEqual([]);
	});
});

describe('insetRect', () => {
	it('shrinks a roomy rect by the gutter on every side', () => {
		expect(insetRect({ id: 'a', x: 100, y: 40, width: 300, height: 200 }, 8)).toEqual({
			x: 108,
			y: 48,
			width: 284,
			height: 184
		});
	});

	it('never returns a negative size for a cell narrower than two gutters', () => {
		// A treemap cell under 2 * GUTTER used to render as a negative CSS width.
		const inset = insetRect({ id: 'a', x: 0, y: 0, width: 9, height: 4 }, 8);
		expect(inset.width).toBe(0);
		expect(inset.height).toBe(0);
	});

	it('collapses exactly to zero at twice the gutter', () => {
		expect(insetRect({ id: 'a', x: 0, y: 0, width: 16, height: 16 }, 8).width).toBe(0);
	});
});

describe('zoneCenterPoint', () => {
	it("returns a top-left point whose taskCenter is the zone's geometric center", () => {
		const zone: ZoneBounds = { id: 'z', x: 100, y: 200, width: 300, height: 150 };
		const point = zoneCenterPoint(zone);
		const center = taskCenter(point);
		expect(center.x).toBeCloseTo(100 + 150);
		expect(center.y).toBeCloseTo(200 + 75);
		expect(zoneForTask(center, [zone])?.id).toBe('z');
	});
});

describe('findUncategorizedPoint', () => {
	it('returns a point whose taskCenter is outside every given zone', () => {
		const zones: ZoneBounds[] = [work, home];
		const point = findUncategorizedPoint(zones);
		expect(zoneForTask(taskCenter(point), zones)).toBeNull();
	});

	it('handles no zones at all', () => {
		const point = findUncategorizedPoint([]);
		expect(zoneForTask(taskCenter(point), [])).toBeNull();
	});
});
