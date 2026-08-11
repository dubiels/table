import {
	zoneForTask,
	taskCenter,
	rectsOverlap,
	DEFAULT_CARD,
	type Point,
	type Rect,
	type ZoneBounds
} from './zones';
import { nextFreeSlot, overlapsAny } from './placement';

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

export interface GroupOptions {
	/**
	 * Render the Uncategorized box even when nothing is loose. A drag needs
	 * somewhere to drop a task that is leaving its category, and on a board where
	 * every task is filed the box would otherwise not exist.
	 */
	alwaysIncludeUncategorized?: boolean;
}

export function groupTasksByZone(
	tasks: BentoTask[],
	zones: BentoZone[],
	options: GroupOptions = {}
): BentoGroup[] {
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
	// It earns its place only when something is actually loose, when there are no
	// zones at all and dropping it would leave the board blank, or when a caller
	// needs it as a drop target.
	if (uncategorized.length > 0 || zones.length === 0 || options.alwaysIncludeUncategorized) {
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

/**
 * Top-left point whose `taskCenter` falls outside every given zone, scanning a
 * diagonal line in steps of 400px.
 *
 * `occupied` is the top-left of every card that must not be landed on. The
 * steps are far wider than a card, so this only ever skips a candidate when a
 * loose card is sitting on the diagonal itself.
 */
export function findUncategorizedPoint(zones: ZoneBounds[], occupied: Point[] = []): Point {
	let point = { x: -DEFAULT_CARD.width / 2, y: -DEFAULT_CARD.height / 2 };
	for (let i = 0; i < UNCATEGORIZED_MAX_CANDIDATES; i++) {
		const center = { x: i * UNCATEGORIZED_STEP, y: i * UNCATEGORIZED_STEP };
		point = { x: center.x - DEFAULT_CARD.width / 2, y: center.y - DEFAULT_CARD.height / 2 };
		if (!zoneForTask(center, zones) && !overlapsAny(point.x, point.y, occupied, DEFAULT_CARD)) {
			break;
		}
	}
	return point;
}

/** Side of a zone created from bento, matching `createZone`'s default size. */
export const NEW_ZONE_SIZE = 320;

/** Clear space left between a bento-created zone and every existing one. */
export const NEW_ZONE_GAP = 40;

/** Where the slot grid starts, matching `createZone`'s default anchor. */
export const NEW_ZONE_ORIGIN = 60;

/** How far the slot scan reaches before giving up and starting a fresh row. */
const SCAN_COLUMNS = 6;
const SCAN_ROWS = 6;

/**
 * Bounds for a zone created from bento, where there is no canvas to click and
 * so no pointer position to place it at.
 *
 * Walks a grid of default-sized slots and takes the first that clears every
 * existing zone by `NEW_ZONE_GAP`. Placing them by grid rather than at a fixed
 * default anchor is not only tidiness: `zoneForTask` resolves a task to the
 * smallest zone containing it, so zones stacked on one spot would silently
 * change which box existing tasks appear in.
 *
 * When the scan finds nothing — a board whose zones span every scanned row —
 * it starts a fresh row under everything, which cannot overlap by
 * construction.
 */
export function nextFreeZoneRect(zones: ZoneBounds[]): Rect {
	const step = NEW_ZONE_SIZE + NEW_ZONE_GAP;
	const size = { width: NEW_ZONE_SIZE, height: NEW_ZONE_SIZE };

	for (let row = 0; row < SCAN_ROWS; row++) {
		for (let col = 0; col < SCAN_COLUMNS; col++) {
			const candidate = {
				x: NEW_ZONE_ORIGIN + col * step,
				y: NEW_ZONE_ORIGIN + row * step,
				...size
			};
			if (!zones.some((z) => rectsOverlap(candidate, z, NEW_ZONE_GAP))) return candidate;
		}
	}

	const lowest = zones.reduce((bottom, z) => Math.max(bottom, z.y + z.height), 0);
	return { x: NEW_ZONE_ORIGIN, y: lowest + NEW_ZONE_GAP, ...size };
}

/** The box a task currently sits in — a zone id, or `UNCATEGORIZED_ID` when it is loose. */
export function groupIdForTask(task: BentoTask, zones: BentoZone[]): string {
	return zoneForTask(taskCenter(task), zones)?.id ?? UNCATEGORIZED_ID;
}

/**
 * Where `task` must be moved to for `groupTasksByZone` to re-derive it into the
 * box `groupId`, or null when the move is not one to make — the task is already
 * in that box, or the box has since been deleted.
 *
 * Bento boxes are a view of canvas geometry, not a field on the task, so
 * "change a task's category" can only ever mean "move it on the canvas". That
 * makes tidiness this function's problem: the target is the first free slot in
 * the zone, so dropping a handful of cards into one box leaves a readable grid
 * on the canvas rather than a single stack.
 */
export function dropPointFor(
	groupId: string,
	task: BentoTask,
	tasks: BentoTask[],
	zones: BentoZone[]
): Point | null {
	if (groupIdForTask(task, zones) === groupId) return null;

	// Its own current spot is not an obstacle — it is about to be vacated.
	const others = tasks.filter((t) => t.id !== task.id);

	if (groupId === UNCATEGORIZED_ID) {
		const loose = others.filter((t) => groupIdForTask(t, zones) === UNCATEGORIZED_ID);
		return findUncategorizedPoint(zones, loose);
	}

	const zone = zones.find((z) => z.id === groupId);
	if (!zone) return null;

	// A zone smaller than a card has no anchor that fits, and nextFreeSlot's
	// last-row fallback would put the card's center outside it — which would
	// land the task in Uncategorized instead of the box it was aimed at. The
	// center point is the one spot guaranteed to resolve back to this zone.
	if (zone.width < DEFAULT_CARD.width || zone.height < DEFAULT_CARD.height) {
		return zoneCenterPoint(zone);
	}

	const occupied = others
		.filter((t) => groupIdForTask(t, zones) === groupId)
		.map((t) => ({ x: t.x, y: t.y }));
	return nextFreeSlot(occupied, zone);
}

/**
 * Where the tasks of a deleted zone must move to so they stay uncategorized.
 *
 * Deleting a zone only removes a rectangle; the tasks keep their coordinates and
 * fall out of every box, which is the promised behaviour. But the rectangle is
 * freed too, and `nextFreeZoneRect` scans from the origin — so the next category
 * created is likely to be handed that exact spot, silently adopting the orphans
 * still sitting in it. Moving them off the freed ground is what makes
 * "uncategorized" stick rather than last until the next category is made.
 *
 * A task that lands inside a surviving zone once the deleted one is gone is left
 * alone: it has a real box to belong to, and that overlap already decided its
 * category before the delete. Returns only the tasks that actually move.
 */
export function evictedTaskPoints(
	zoneId: string,
	zones: BentoZone[],
	tasks: BentoTask[]
): { id: string; x: number; y: number }[] {
	const remaining = zones.filter((z) => z.id !== zoneId);

	// The scan avoids the doomed rectangle as well as the surviving ones. Landing
	// clear of the remaining zones alone is not enough: the first free point is
	// the canvas origin, which is exactly the ground being freed, so the orphans
	// would be moved onto the very spot the next category is handed.
	const deleted = zones.find((z) => z.id === zoneId);
	const avoid = deleted ? [...remaining, deleted] : remaining;

	// Cards already loose are obstacles from the start, so an evicted task never
	// lands on one — and each new point joins them, so they do not stack either.
	const occupied = tasks
		.filter((t) => groupIdForTask(t, zones) === UNCATEGORIZED_ID)
		.map((t) => ({ x: t.x, y: t.y }));

	const moves: { id: string; x: number; y: number }[] = [];
	for (const task of tasks) {
		if (groupIdForTask(task, zones) !== zoneId) continue;
		if (zoneForTask(taskCenter(task), remaining)) continue;
		const point = findUncategorizedPoint(avoid, occupied);
		occupied.push(point);
		moves.push({ id: task.id, x: Math.round(point.x), y: Math.round(point.y) });
	}
	return moves;
}
