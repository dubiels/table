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
	/** Ids of canvas-sourced tasks the feed no longer vouches for. */
	deletes: string[];
}

/**
 * Decides what a sync run does, given the feed and the current state. A user's
 * edits to title/notes/priority and their spatial x/y grouping stay untouchable
 * by construction: the plan has no way to express an update to them.
 *
 * Removal is keyed on absence from the feed, because absence is the only signal
 * available. The Canvas .ics feed carries no submission state — its events hold
 * nothing but SUMMARY, DTSTART, UID, URL and a description — so nothing can tell
 * a handed-in assignment from a neglected one. What the parser does guarantee is
 * a window running from today forward, which makes "no longer in the feed" mean
 * past its due date, dropped upstream, or never gradeable to begin with (the
 * course calendar's class meetings). All three are read as done and swept.
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
	const feedIds = new Set(events.map((e) => e.eventId));
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
	// An empty feed is far likelier to be a Canvas outage or a truncated response
	// than a semester with nothing left in it, and a sweep on that evidence would
	// clear the panel with no way back — the next sync can only re-create what
	// the window still reaches. Absence only counts against a task when there is
	// a feed for it to be absent from.
	const deletes = events.length
		? existing.filter((t) => t.externalId && !feedIds.has(t.externalId)).map((t) => t.id)
		: [];

	return { creates, dueDateUpdates, deletes };
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

/**
 * A synthetic region on bare table for tasks with no zone to land in. It is
 * deliberately anchored near the origin rather than below existing content:
 * the canvas has no panning and a zoom floor of 0.5, so it reaches only about
 * 1.5x the viewport. Anything parked below the fold is unreachable forever,
 * and each sync would push the next batch further out. Overlap is not a
 * concern here — `nextFreeSlot` walks this region and skips occupied cards.
 */
export function looseBounds(): PlacementBounds {
	return { x: 40, y: 40, width: 1400, height: 4000 };
}
