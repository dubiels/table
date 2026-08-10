import { nextFreeSlot, type PlacementBounds } from '$lib/placement';
import { DEFAULT_CARD, type Point } from '$lib/zones';

export interface LmsEvent {
	eventId: string;
	title: string;
	dueDate: string | null;
	courseName: string | null;
}

export interface ExistingLmsTask {
	id: string;
	externalId: string | null;
	dueDate: string | null;
}

export interface LmsSyncPlan {
	creates: Array<{
		title: string;
		dueDate: string | null;
		courseName: string | null;
		externalId: string;
		x: number;
		y: number;
	}>;
	dueDateUpdates: Array<{ id: string; dueDate: string | null }>;
}

/**
 * Decides what a sync run does, given the feed and the current state. The
 * plan can only ever create new tasks or refresh due dates — a user's edits
 * to title/notes/priority and their spatial x/y grouping are untouchable by
 * construction, and nothing is ever deleted.
 */
export function planLmsSync(
	events: LmsEvent[],
	existing: ExistingLmsTask[],
	bounds: PlacementBounds,
	occupied: Point[]
): LmsSyncPlan {
	const byExternalId = new Map(
		existing.filter((t) => t.externalId).map((t) => [t.externalId as string, t])
	);
	const creates: LmsSyncPlan['creates'] = [];
	const dueDateUpdates: LmsSyncPlan['dueDateUpdates'] = [];
	const taken = [...occupied];
	// Seeded from existing tasks so a feed entry matching a prior sync is
	// still treated as "seen"; also grows as we create, so a duplicated
	// feed entry (cross-listed assignment) only ever creates once.
	const seen = new Set(byExternalId.keys());

	for (const event of events) {
		const match = byExternalId.get(event.eventId);
		if (match) {
			if (match.dueDate !== event.dueDate) {
				dueDateUpdates.push({ id: match.id, dueDate: event.dueDate });
			}
			continue;
		}
		if (seen.has(event.eventId)) continue;
		seen.add(event.eventId);
		const slot = nextFreeSlot(taken, bounds);
		taken.push(slot);
		creates.push({
			title: event.title,
			dueDate: event.dueDate,
			courseName: event.courseName,
			externalId: event.eventId,
			x: Math.round(slot.x),
			y: Math.round(slot.y)
		});
	}
	return { creates, dueDateUpdates };
}

const ZONE_PAD = 20;
const ZONE_HEAD_CLEARANCE = 34;

/** The placeable region inside a zone: below the head row, inside the padding. */
export function zoneInnerBounds(zone: {
	x: number;
	y: number;
	width: number;
	height: number;
}): PlacementBounds {
	return {
		x: zone.x + ZONE_PAD,
		y: zone.y + ZONE_HEAD_CLEARANCE,
		width: Math.max(DEFAULT_CARD.width, zone.width - ZONE_PAD * 2),
		height: Math.max(DEFAULT_CARD.height, zone.height - ZONE_HEAD_CLEARANCE - ZONE_PAD)
	};
}

/** A synthetic region on bare table, below everything that already exists. */
export function looseBounds(
	content: Array<{ x: number; y: number; width?: number; height?: number }>
): PlacementBounds {
	let maxBottom = 0;
	for (const c of content) {
		maxBottom = Math.max(maxBottom, c.y + (c.height ?? DEFAULT_CARD.height));
	}
	return { x: 40, y: maxBottom + 60, width: 1400, height: 100000 };
}
