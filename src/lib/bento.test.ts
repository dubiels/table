import { describe, it, expect } from 'vitest';
import {
	groupTasksByZone,
	columnCount,
	packColumns,
	boxRows,
	columnRows,
	zoneCenterPoint,
	findUncategorizedPoint,
	HEADER_ROWS,
	MIN_COLUMN_WIDTH,
	MAX_COLUMNS,
	BENTO_GAP,
	UNCATEGORIZED_ID,
	type BentoGroup,
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

function group(id: string, taskCount: number): BentoGroup {
	return {
		id,
		name: id,
		color: null,
		tasks: Array.from({ length: taskCount }, (_, i) => task({ id: `${id}-${i}` }))
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

	it('keeps every zone, even one with no tasks, so the board still shows it', () => {
		const groups = groupTasksByZone([], [work, home]);
		expect(groups.map((g) => g.id)).toEqual(['work', 'home']);
		expect(groups[0].tasks).toEqual([]);
	});

	it('drops an empty Uncategorized rather than showing a box that holds nothing', () => {
		const groups = groupTasksByZone([task({ id: '1', x: 100, y: 100 })], [work]);
		expect(groups.map((g) => g.id)).toEqual(['work']);
	});

	it('keeps an empty Uncategorized when there are no zones, so the board is never blank', () => {
		const groups = groupTasksByZone([], []);
		expect(groups.map((g) => g.id)).toEqual([UNCATEGORIZED_ID]);
		expect(groups[0].tasks).toEqual([]);
	});
});

describe('columnCount', () => {
	it('fits as many minimum-width columns as the width allows, counting the gaps', () => {
		// Two columns need 2 * MIN + one gap between them, and not a pixel less.
		const twoExactly = MIN_COLUMN_WIDTH * 2 + BENTO_GAP;
		expect(columnCount(twoExactly)).toBe(2);
		expect(columnCount(twoExactly - 1)).toBe(1);
	});

	it('never returns less than one column, whatever the width', () => {
		expect(columnCount(0)).toBe(1);
		expect(columnCount(-500)).toBe(1);
		expect(columnCount(10)).toBe(1);
	});

	it('caps at MAX_COLUMNS so a wide board stays scannable', () => {
		expect(columnCount(10_000)).toBe(MAX_COLUMNS);
	});
});

describe('boxRows / columnRows', () => {
	it('counts a box as its tasks plus the header', () => {
		expect(boxRows(group('a', 0))).toBe(HEADER_ROWS);
		expect(boxRows(group('a', 4))).toBe(HEADER_ROWS + 4);
	});

	it('gives an empty box a nonzero share, so it cannot collapse to nothing', () => {
		expect(boxRows(group('a', 0))).toBeGreaterThan(0);
	});

	it('sums a column', () => {
		expect(columnRows([group('a', 2), group('b', 3)])).toBe(HEADER_ROWS * 2 + 5);
		expect(columnRows([])).toBe(0);
	});
});

describe('packColumns', () => {
	it('deals every group out exactly once', () => {
		const groups = [group('a', 5), group('b', 1), group('c', 3), group('d', 0)];
		const packed = packColumns(groups, 3);
		expect(packed).toHaveLength(3);
		expect(
			packed
				.flat()
				.map((g) => g.id)
				.sort()
		).toEqual(['a', 'b', 'c', 'd']);
	});

	it('sends each group to the shortest column so far', () => {
		const packed = packColumns([group('big', 5), group('x', 0), group('y', 0)], 2);
		// big lands in the empty first column and makes it tall, so both small
		// groups stack in the second rather than one landing back under big.
		expect(packed[0].map((g) => g.id)).toEqual(['big']);
		expect(packed[1].map((g) => g.id)).toEqual(['x', 'y']);
	});

	it('keeps source order within a column, so boxes do not jump as tasks are added', () => {
		const packed = packColumns([group('a', 0), group('b', 0), group('c', 0)], 1);
		expect(packed[0].map((g) => g.id)).toEqual(['a', 'b', 'c']);
	});

	it('clamps a nonsense column count to one rather than dropping the board', () => {
		const packed = packColumns([group('a', 1)], 0);
		expect(packed).toHaveLength(1);
		expect(packed[0].map((g) => g.id)).toEqual(['a']);
	});

	it('returns one empty column per column when there is nothing to pack', () => {
		expect(packColumns([], 3)).toEqual([[], [], []]);
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
