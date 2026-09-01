import {
	dropPointFor,
	findUncategorizedPoint,
	groupIdForTask,
	UNCATEGORIZED_ID,
	type BentoTask,
	type BentoZone
} from '$lib/bento';
import type { Point } from '$lib/zones';
import type { Task } from '../tasks/service';
import type { Zone } from '../zones/service';
import { ApiError } from './respond';

const toBentoTask = (task: Task): BentoTask => ({
	id: task.id,
	title: task.title,
	done: task.done,
	priority: task.priority,
	dueDate: task.dueDate,
	plannedDate: task.plannedDate,
	notes: task.notes,
	x: task.x,
	y: task.y
});

const toBentoZone = (zone: Zone): BentoZone => ({
	id: zone.id,
	name: zone.name,
	color: zone.color,
	x: zone.x,
	y: zone.y,
	width: zone.width,
	height: zone.height
});

/**
 * Far enough out that it is inside no zone and on top of no card.
 *
 * A task being created has no position yet, but `dropPointFor` answers "where
 * should this task move to", and returns null when the task is already in the
 * group asked for. Standing the not-yet-existing task somewhere it certainly is
 * not lets a create reuse the exact placement logic a drag runs, rather than
 * this module growing its own second copy of it.
 */
const OFF_BOARD = { x: -1_000_000, y: -1_000_000 };

/**
 * Where a task must sit to belong to `zoneId`.
 *
 * A task has no category column — it is in a zone when its centre falls inside
 * that zone's rectangle, which is why setting a category means writing
 * coordinates. This is the same call the bento view makes when a card is
 * dropped into a box, so an agent's placement and a drag are the same
 * operation, and the result reads identically in the canvas, in bento, and on
 * the wall display.
 *
 * Returns null when the task is already in that zone and nothing needs to move.
 */
export function placementFor(
	zoneId: string | null,
	task: Task | null,
	zones: Zone[],
	tasks: Task[]
): Point | null {
	if (zoneId !== null && !zones.some((z) => z.id === zoneId)) {
		throw new ApiError(404, 'not_found', `Zone ${zoneId} not found`);
	}

	const bentoZones = zones.map(toBentoZone);
	const bentoTasks = tasks.map(toBentoTask);

	// A task being created has no position, so `dropPointFor`'s "already in that
	// group, nothing to move" answer is wrong for it: standing off-board it is
	// already uncategorized, so a requested `zoneId: null` would come back null
	// and the task would fall to the default anchor instead — which sits inside
	// a default-placed zone, filing an explicitly uncategorized task into a
	// group. Creation asks a different question, so it gets a direct answer.
	if (task === null && zoneId === null) {
		const loose = bentoTasks
			.filter((t) => groupIdForTask(t, bentoZones) === UNCATEGORIZED_ID)
			.map((t) => ({ x: t.x, y: t.y }));
		return findUncategorizedPoint(bentoZones, loose);
	}

	const subject: BentoTask = task
		? toBentoTask(task)
		: {
				id: '',
				title: '',
				done: false,
				priority: null,
				dueDate: null,
				plannedDate: null,
				notes: null,
				...OFF_BOARD
			};

	return dropPointFor(zoneId ?? UNCATEGORIZED_ID, subject, bentoTasks, bentoZones);
}
