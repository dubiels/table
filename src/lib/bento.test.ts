import { describe, it, expect } from 'vitest';
import {
	groupTasksByZone,
	columnCount,
	packColumns,
	boxRows,
	columnRows,
	zoneCenterPoint,
	findUncategorizedPoint,
	dropPointFor,
	nextFreeZoneRect,
	evictedTaskPoints,
	NEW_ZONE_SIZE,
	NEW_ZONE_GAP,
	HEADER_ROWS,
	MIN_COLUMN_WIDTH,
	MAX_COLUMNS,
	BENTO_GAP,
	UNCATEGORIZED_ID,
	type BentoGroup,
	type BentoTask,
	type BentoZone
} from './bento';
import { taskCenter, zoneForTask, rectsOverlap, type ZoneBounds } from './zones';

function task(overrides: Partial<BentoTask> & { id: string }): BentoTask {
	return {
		title: 'Untitled',
		done: false,
		priority: null,
		dueDate: null,
		plannedDate: null,
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

	it('adds an empty Uncategorized on request, so a drag always has somewhere to land', () => {
		const groups = groupTasksByZone([task({ id: '1', x: 100, y: 100 })], [work], {
			alwaysIncludeUncategorized: true
		});
		expect(groups.map((g) => g.id)).toEqual(['work', UNCATEGORIZED_ID]);
		expect(groups[1].tasks).toEqual([]);
	});

	it('does not add a second Uncategorized when tasks are already loose', () => {
		const groups = groupTasksByZone([task({ id: '1', x: -1000, y: -1000 })], [work], {
			alwaysIncludeUncategorized: true
		});
		expect(groups.map((g) => g.id)).toEqual(['work', UNCATEGORIZED_ID]);
		expect(groups[1].tasks.map((t) => t.id)).toEqual(['1']);
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

	it('skips a candidate a loose card already sits on', () => {
		const taken = findUncategorizedPoint([]);
		const next = findUncategorizedPoint([], [taken]);
		expect(next).not.toEqual(taken);
		expect(zoneForTask(taskCenter(next), [])).toBeNull();
	});
});

describe('dropPointFor', () => {
	const zones = [work, home];

	it('returns null for the box the task is already in, so a no-op drop saves nothing', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		expect(dropPointFor('work', inWork, [inWork], zones)).toBeNull();

		const loose = task({ id: '2', x: -1000, y: -1000 });
		expect(dropPointFor(UNCATEGORIZED_ID, loose, [loose], zones)).toBeNull();
	});

	it('lands the task inside the target zone, where groupTasksByZone will re-derive it', () => {
		const loose = task({ id: '1', x: -1000, y: -1000 });
		const point = dropPointFor('home', loose, [loose], zones)!;
		expect(point).not.toBeNull();
		expect(zoneForTask(taskCenter(point), zones)?.id).toBe('home');

		// The whole point of the feature: re-grouping the moved task puts it in
		// the box it was dropped on.
		const moved = { ...loose, ...point };
		const groups = groupTasksByZone([moved], zones);
		expect(groups.find((g) => g.id === 'home')!.tasks.map((t) => t.id)).toEqual(['1']);
	});

	it('does not stack the dropped card on one already in the zone', () => {
		const sitting = task({ id: 'a', x: work.x, y: work.y });
		const loose = task({ id: 'b', x: -1000, y: -1000 });
		const point = dropPointFor('work', loose, [sitting, loose], zones)!;
		expect(point).not.toEqual({ x: sitting.x, y: sitting.y });
		expect(zoneForTask(taskCenter(point), zones)?.id).toBe('work');
	});

	it('ignores the dragged card itself when looking for a free slot', () => {
		// Dragging out of home into work must not treat its own old spot as
		// occupied — the only free-slot candidate here is work's first cell.
		const dragged = task({ id: 'a', x: work.x, y: work.y });
		const inHome = task({ id: 'b', x: home.x, y: home.y });
		const point = dropPointFor('work', inHome, [dragged, inHome], zones)!;
		expect(point).not.toEqual({ x: dragged.x, y: dragged.y });
	});

	it('falls back to the center of a zone too small to fit a card, rather than missing it', () => {
		// nextFreeSlot has no in-bounds anchor here, and its last-row fallback
		// would put the card's center outside the zone — which would silently
		// drop the task into Uncategorized instead of the box it was aimed at.
		const tiny: BentoZone = {
			id: 'tiny',
			name: 'Tiny',
			color: 'sage',
			x: 2000,
			y: 2000,
			width: 100,
			height: 50
		};
		const loose = task({ id: '1', x: -1000, y: -1000 });
		const point = dropPointFor('tiny', loose, [loose], [...zones, tiny])!;
		expect(zoneForTask(taskCenter(point), [...zones, tiny])?.id).toBe('tiny');
	});

	it('sends a task dropped on Uncategorized somewhere outside every zone', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const point = dropPointFor(UNCATEGORIZED_ID, inWork, [inWork], zones)!;
		expect(zoneForTask(taskCenter(point), zones)).toBeNull();
	});

	it('does not stack on a card already loose in Uncategorized', () => {
		const loose = task({ id: 'a', ...findUncategorizedPoint(zones) });
		const inWork = task({ id: 'b', x: 100, y: 100 });
		const point = dropPointFor(UNCATEGORIZED_ID, inWork, [loose, inWork], zones)!;
		expect(point).not.toEqual({ x: loose.x, y: loose.y });
		expect(zoneForTask(taskCenter(point), zones)).toBeNull();
	});

	it('returns null for a group that no longer exists rather than guessing', () => {
		const loose = task({ id: '1', x: -1000, y: -1000 });
		expect(dropPointFor('deleted-zone', loose, [loose], zones)).toBeNull();
	});
});

describe('nextFreeZoneRect', () => {
	function zone(id: string, x: number, y: number, width = 320, height = 320): ZoneBounds {
		return { id, x, y, width, height };
	}

	it('returns a default-sized rect at the origin for an empty board', () => {
		const rect = nextFreeZoneRect([]);
		expect(rect.width).toBe(NEW_ZONE_SIZE);
		expect(rect.height).toBe(NEW_ZONE_SIZE);
		expect(rect.x).toBeGreaterThanOrEqual(0);
		expect(rect.y).toBeGreaterThanOrEqual(0);
	});

	it('steps past a zone sitting on the first slot', () => {
		const first = nextFreeZoneRect([]);
		const rect = nextFreeZoneRect([zone('a', first.x, first.y)]);
		expect(rect).not.toEqual(first);
		expect(rectsOverlap(rect, zone('a', first.x, first.y))).toBe(false);
	});

	it('leaves the configured gap between the new rect and its neighbours', () => {
		const first = nextFreeZoneRect([]);
		const taken = zone('a', first.x, first.y);
		const rect = nextFreeZoneRect([taken]);
		expect(rectsOverlap(rect, taken, NEW_ZONE_GAP - 1)).toBe(false);
	});

	it('avoids zones that are off the slot grid and oddly sized', () => {
		const odd = [zone('a', 12, 7, 517, 133), zone('b', 400, 260, 90, 640)];
		const rect = nextFreeZoneRect(odd);
		for (const z of odd) expect(rectsOverlap(rect, z)).toBe(false);
	});

	it('finds free space below a band of zones that covers every scanned row', () => {
		// Wide enough that no slot in these rows can fit beside them.
		const band = Array.from({ length: 12 }, (_, i) =>
			zone(`b${i}`, 0, i * (NEW_ZONE_SIZE + NEW_ZONE_GAP), 100_000, NEW_ZONE_SIZE)
		);
		const rect = nextFreeZoneRect(band);
		for (const z of band) expect(rectsOverlap(rect, z)).toBe(false);
	});

	it('never returns a rect with a negative anchor', () => {
		const rect = nextFreeZoneRect([zone('a', -500, -500, 2000, 2000)]);
		expect(rect.x).toBeGreaterThanOrEqual(0);
		expect(rect.y).toBeGreaterThanOrEqual(0);
	});
});

describe('evictedTaskPoints', () => {
	const zones = [work, home];

	it('moves a deleted zone’s tasks off the rect it frees, so the next category cannot adopt them', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const moves = evictedTaskPoints('work', zones, [inWork]);

		expect(moves).toHaveLength(1);
		// The freed rect is what nextFreeZoneRect hands to the next category, so
		// the test is whether that category would re-adopt the task: recreate the
		// zone on exactly the ground just vacated and the task must stay out of it.
		expect(zoneForTask(taskCenter(moves[0]), [work])).toBeNull();
	});

	it('leaves the moved tasks uncategorized against the surviving zones', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const moves = evictedTaskPoints('work', zones, [inWork]);
		const remaining = zones.filter((z) => z.id !== 'work');

		expect(zoneForTask(taskCenter(moves[0]), remaining)).toBeNull();
	});

	it('does not move tasks that belong to a zone which is staying', () => {
		const inHome = task({ id: '1', x: 520, y: 20 });
		expect(evictedTaskPoints('work', zones, [inHome])).toEqual([]);
	});

	it('does not move tasks that are already loose', () => {
		const loose = task({ id: '1', x: -1000, y: -1000 });
		expect(evictedTaskPoints('work', zones, [loose])).toEqual([]);
	});

	it('leaves a task alone when a surviving zone covers it once the deleted one is gone', () => {
		// Nested inside work, so zoneForTask picks it while both exist; deleting the
		// inner zone hands its task straight to work rather than to open ground.
		const inner: BentoZone = {
			id: 'inner',
			name: 'Inner',
			color: 'sage',
			x: 50,
			y: 50,
			width: 100,
			height: 100
		};
		const nested = task({ id: '1', x: 60, y: 60 });
		expect(evictedTaskPoints('inner', [...zones, inner], [nested])).toEqual([]);
	});

	it('spreads several evicted tasks instead of stacking them on one point', () => {
		const tasks = [
			task({ id: '1', x: 10, y: 10 }),
			task({ id: '2', x: 40, y: 40 }),
			task({ id: '3', x: 80, y: 80 })
		];
		const moves = evictedTaskPoints('work', zones, tasks);

		expect(moves).toHaveLength(3);
		expect(new Set(moves.map((m) => `${m.x},${m.y}`)).size).toBe(3);
	});

	it('avoids landing an evicted task on a card that was already loose', () => {
		const loose = task({ id: 'loose', ...findUncategorizedPoint(zones) });
		const inWork = task({ id: '1', x: 100, y: 100 });
		const moves = evictedTaskPoints('work', zones, [loose, inWork]);

		expect(moves).toHaveLength(1);
		expect(moves[0]).not.toMatchObject({ x: loose.x, y: loose.y });
	});
});
