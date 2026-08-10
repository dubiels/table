import { zoneForTask, taskCenter, DEFAULT_CARD, type Point, type ZoneBounds } from './zones';

export const UNCATEGORIZED_ID = 'uncategorized';

export type BentoTask = {
	id: string;
	title: string;
	done: boolean;
	priority: string | null;
	dueDate: string | null;
	notes: string | null;
	x: number;
	y: number;
};

export type BentoZone = ZoneBounds & { name: string; color: string };

export interface BentoGroup {
	id: string;
	name: string;
	color: string | null;
	tasks: BentoTask[];
	weight: number;
}

export function groupTasksByZone(tasks: BentoTask[], zones: BentoZone[]): BentoGroup[] {
	const byZone = new Map<string, BentoTask[]>(zones.map((z) => [z.id, []]));
	const uncategorized: BentoTask[] = [];

	for (const task of tasks) {
		const hit = zoneForTask(taskCenter(task), zones);
		if (hit) byZone.get(hit.id)!.push(task);
		else uncategorized.push(task);
	}

	const groups: BentoGroup[] = zones.map((zone) => {
		const zoneTasks = byZone.get(zone.id) ?? [];
		return {
			id: zone.id,
			name: zone.name,
			color: zone.color,
			tasks: zoneTasks,
			weight: Math.max(zoneTasks.length, 1)
		};
	});

	groups.push({
		id: UNCATEGORIZED_ID,
		name: 'Uncategorized',
		color: null,
		tasks: uncategorized,
		weight: Math.max(uncategorized.length, 1)
	});

	return groups;
}

export interface TreemapItem {
	id: string;
	weight: number;
}

export interface TreemapRect {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Squarified treemap (Bruls/Huizing/van Wijk): recursively lays out rows
 * along the container's current shorter edge, choosing each row's break
 * point to keep box aspect ratios as close to square as possible.
 */
export function computeTreemap(items: TreemapItem[], width: number, height: number): TreemapRect[] {
	if (items.length === 0 || width <= 0 || height <= 0) return [];

	const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
	const totalArea = width * height;
	const sorted = [...items].sort((a, b) => b.weight - a.weight);

	const rects: TreemapRect[] = [];
	let container: Rect = { x: 0, y: 0, width, height };
	let remaining = sorted;

	while (remaining.length > 0) {
		const shortSide = Math.min(container.width, container.height);
		let row: TreemapItem[] = [remaining[0]];
		let rest = remaining.slice(1);

		while (rest.length > 0) {
			const candidate = [...row, rest[0]];
			const current = worstRatio(row, shortSide, totalWeight, totalArea);
			const next = worstRatio(candidate, shortSide, totalWeight, totalArea);
			if (next <= current) {
				row = candidate;
				rest = rest.slice(1);
			} else {
				break;
			}
		}

		container = layoutRow(row, container, totalWeight, totalArea, rects);
		remaining = rest;
	}

	return rects;
}

function worstRatio(
	row: TreemapItem[],
	shortSide: number,
	totalWeight: number,
	totalArea: number
): number {
	const areas = row.map((item) => (item.weight / totalWeight) * totalArea);
	const rowArea = areas.reduce((sum, a) => sum + a, 0);
	const thickness = rowArea / shortSide;
	let worst = 1;
	for (const area of areas) {
		const extent = area / thickness;
		const ratio = Math.max(thickness / extent, extent / thickness);
		if (ratio > worst) worst = ratio;
	}
	return worst;
}

/** Places `row` as a strip along the container's current shorter edge, returns the remaining container. */
function layoutRow(
	row: TreemapItem[],
	container: Rect,
	totalWeight: number,
	totalArea: number,
	rects: TreemapRect[]
): Rect {
	const areas = row.map((item) => (item.weight / totalWeight) * totalArea);
	const rowArea = areas.reduce((sum, a) => sum + a, 0);
	const shortSide = Math.min(container.width, container.height);
	const thickness = rowArea / shortSide;
	const horizontal = container.width <= container.height; // strip spans full width, stacks items left-to-right

	let offset = 0;
	for (let i = 0; i < row.length; i++) {
		const extent = areas[i] / thickness;
		if (horizontal) {
			rects.push({
				id: row[i].id,
				x: container.x + offset,
				y: container.y,
				width: extent,
				height: thickness
			});
		} else {
			rects.push({
				id: row[i].id,
				x: container.x,
				y: container.y + offset,
				width: thickness,
				height: extent
			});
		}
		offset += extent;
	}

	return horizontal
		? {
				x: container.x,
				y: container.y + thickness,
				width: container.width,
				height: container.height - thickness
			}
		: {
				x: container.x + thickness,
				y: container.y,
				width: container.width - thickness,
				height: container.height
			};
}

/**
 * A treemap cell shrunk by `gutter` on every side, for the rendered box.
 * Clamped at zero: a cell narrower than two gutters would otherwise yield a
 * negative CSS width, which browsers discard — leaving a box at its natural
 * size, spilling over its neighbours.
 */
export function insetRect(rect: TreemapRect, gutter: number): Rect {
	return {
		x: rect.x + gutter,
		y: rect.y + gutter,
		width: Math.max(0, rect.width - gutter * 2),
		height: Math.max(0, rect.height - gutter * 2)
	};
}

/** Top-left point whose `taskCenter` lands exactly on the zone's geometric center. */
export function zoneCenterPoint(zone: ZoneBounds): Point {
	return {
		x: zone.x + zone.width / 2 - DEFAULT_CARD.width / 2,
		y: zone.y + zone.height / 2 - DEFAULT_CARD.height / 2
	};
}

const UNCATEGORIZED_STEP = 400;
const UNCATEGORIZED_MAX_CANDIDATES = 25;

/** Top-left point whose `taskCenter` falls outside every given zone, scanning a diagonal line in steps of 400px. */
export function findUncategorizedPoint(zones: ZoneBounds[]): Point {
	let center = { x: 0, y: 0 };
	for (let i = 0; i < UNCATEGORIZED_MAX_CANDIDATES; i++) {
		center = { x: i * UNCATEGORIZED_STEP, y: i * UNCATEGORIZED_STEP };
		if (!zoneForTask(center, zones)) break;
	}
	return { x: center.x - DEFAULT_CARD.width / 2, y: center.y - DEFAULT_CARD.height / 2 };
}
