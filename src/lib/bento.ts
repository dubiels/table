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
}

export function groupTasksByZone(tasks: BentoTask[], zones: BentoZone[]): BentoGroup[] {
	const byZone = new Map<string, BentoTask[]>(zones.map((z) => [z.id, []]));
	const uncategorized: BentoTask[] = [];

	for (const task of tasks) {
		const hit = zoneForTask(taskCenter(task), zones);
		if (hit) byZone.get(hit.id)!.push(task);
		else uncategorized.push(task);
	}

	const groups: BentoGroup[] = zones.map((zone) => ({
		id: zone.id,
		name: zone.name,
		color: zone.color,
		tasks: byZone.get(zone.id) ?? []
	}));

	// An empty "Uncategorized" is a box that exists to say nothing lives in it.
	// It earns its place only when something is actually loose, or when there are
	// no zones at all and dropping it would leave the board blank.
	if (uncategorized.length > 0 || zones.length === 0) {
		groups.push({
			id: UNCATEGORIZED_ID,
			name: 'Uncategorized',
			color: null,
			tasks: uncategorized
		});
	}

	return groups;
}

/**
 * Narrowest a column may get before the layout drops one.
 *
 * The board used to be tiled as a squarified treemap, which splits area by task
 * count. Area is the wrong budget for this content: a box needs width enough to
 * read a task title and only as much height as it has cards, but an area budget
 * can be spent as "tall and narrow" just as happily as square. That is what put
 * seven hundred empty pixels under a six-task box while a one-task box wrapped
 * its title over three lines in a 190px slot.
 *
 * Packing into columns of a guaranteed width and letting each box stand at its
 * content height removes both failures by construction.
 */
export const MIN_COLUMN_WIDTH = 240;

/** Past four columns the boxes are readable but the board stops being scannable. */
export const MAX_COLUMNS = 4;

/** Gap between columns and between stacked boxes, in px. Mirrored in BentoView's CSS. */
export const BENTO_GAP = 8;

export function columnCount(width: number, gap = BENTO_GAP): number {
	if (width <= 0) return 1;
	// The n columns carry n-1 gaps, so lending the width one extra gap makes the
	// division exact rather than rounding a fitting column away.
	const fits = Math.floor((width + gap) / (MIN_COLUMN_WIDTH + gap));
	return Math.max(1, Math.min(MAX_COLUMNS, fits));
}

/**
 * What a box costs a column, in task-card rows.
 *
 * Only the ratio matters — this balances columns, it does not size anything —
 * so the header and padding are counted as a bit more than one card's worth.
 */
export const HEADER_ROWS = 1.6;

export function boxRows(group: BentoGroup): number {
	return HEADER_ROWS + group.tasks.length;
}

/**
 * Rows in a packed column — the share of the board's width and leftover height
 * that column earns.
 *
 * Boxes stand taller than their content when there is room to spare, because a
 * board of content-height boxes with a hand of empty space under them reads as
 * a set of columns rather than a bento. Sharing the slack out in proportion to
 * what each box holds is what keeps that from turning back into the old
 * problem, where one box got all the emptiness and another got none of it.
 */
export function columnRows(column: BentoGroup[]): number {
	return column.reduce((sum, group) => sum + boxRows(group), 0);
}

/**
 * Groups dealt into `columns` columns, each box going to the shortest column so
 * far.
 *
 * Source order is preserved rather than packing the tallest boxes first: a
 * board whose boxes rearrange themselves every time a task is added is harder
 * to use than one that is a few rows off balance.
 */
export function packColumns(groups: BentoGroup[], columns: number): BentoGroup[][] {
	const count = Math.max(1, columns);
	const packed: BentoGroup[][] = Array.from({ length: count }, () => []);
	const rows = new Array<number>(count).fill(0);

	for (const group of groups) {
		let shortest = 0;
		for (let i = 1; i < count; i++) {
			if (rows[i] < rows[shortest]) shortest = i;
		}
		packed[shortest].push(group);
		rows[shortest] += boxRows(group);
	}

	return packed;
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
