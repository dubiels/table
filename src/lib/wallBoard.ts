import { groupTasksByZone, type BentoTask, type BentoZone } from './bento';
import { zoneColorVars } from './zones';
import { CANVAS_SOURCE } from './listView';
import { dayOffset } from './wallDates';

/**
 * What the wall's board is made of.
 *
 * One shape for everything on it: a box per category, holding items. An item is
 * usually a single task, and inside Canvas it is a dated group of them. The
 * packing in `wallPack.ts` measures items without caring which kind it has, so
 * the Canvas box can only ever break between its groups, never inside one.
 */

export type WallTask = BentoTask & { source: string; courseName: string | null };

export type WallItem =
	{ kind: 'task'; task: WallTask } | { kind: 'group'; label: string; tasks: WallTask[] };

export interface WallBox {
	id: string;
	name: string;
	/** A CSS colour for the category dot, or null for Uncategorized. */
	color: string | null;
	/** Canvas wears its logo where the others wear a dot. */
	canvas: boolean;
	items: WallItem[];
	/** Tasks in the box, counting the ones inside groups. */
	count: number;
}

/** How far past today the wall looks for assignments. */
export const CANVAS_HORIZON_DAYS = 3;

export const CANVAS_BOX_ID = 'canvas';

function itemCount(items: WallItem[]): number {
	return items.reduce((n, item) => n + (item.kind === 'task' ? 1 : item.tasks.length), 0);
}

/**
 * Assignments the wall shows: what is due today — late work included, since a
 * missed deadline is still today's problem — and what lands in the next few
 * days. Anything further out belongs to the list view, not to a wall.
 */
export function canvasGroups(tasks: WallTask[], today: string): WallItem[] {
	const inRange = (from: number, to: number) =>
		tasks
			.filter((t) => {
				if (t.source !== CANVAS_SOURCE || t.done || !t.dueDate) return false;
				const offset = dayOffset(t.dueDate, today);
				return offset >= from && offset <= to;
			})
			.sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.title.localeCompare(b.title));

	return [
		{ kind: 'group' as const, label: 'Due today', tasks: inRange(-36500, 0) },
		{
			kind: 'group' as const,
			label: `Due in the next ${CANVAS_HORIZON_DAYS} days`,
			tasks: inRange(1, CANVAS_HORIZON_DAYS)
		}
	].filter((group) => group.tasks.length > 0);
}

/**
 * The board, in the order it is read: the categories as the board groups them,
 * then Canvas last.
 *
 * Canvas comes last rather than in zone order because it is the one box whose
 * contents nobody arranged — it is a feed, and the categories are the work you
 * put somewhere on purpose.
 */
export function buildWallBoxes(tasks: WallTask[], zones: BentoZone[], today: string): WallBox[] {
	const own = tasks.filter((t) => t.source !== CANVAS_SOURCE && !t.done);

	const boxes: WallBox[] = groupTasksByZone(own, zones)
		.filter((group) => group.tasks.length > 0)
		.map((group) => {
			const items = group.tasks.map((task) => ({ kind: 'task' as const, task: task as WallTask }));
			return {
				id: group.id,
				name: group.name,
				color: group.color ? zoneColorVars(group.color).border : null,
				canvas: false,
				items,
				count: items.length
			};
		});

	const groups = canvasGroups(tasks, today);
	if (groups.length > 0) {
		boxes.push({
			id: CANVAS_BOX_ID,
			name: 'Canvas',
			color: null,
			canvas: true,
			items: groups,
			count: itemCount(groups)
		});
	}

	return boxes;
}
