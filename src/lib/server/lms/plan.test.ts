import { describe, it, expect } from 'vitest';
import { planLmsSync, zoneInnerBounds, looseBounds, type LmsEvent } from './plan';
import { DEFAULT_CARD } from '$lib/zones';

const bounds = { x: 0, y: 0, width: 1200, height: 900 };

function event(overrides: Partial<LmsEvent> = {}): LmsEvent {
	return {
		eventId: 'ev-1',
		title: 'PS3',
		dueDate: '2026-08-20',
		courseName: 'CS 4641',
		...overrides
	};
}

describe('planLmsSync', () => {
	it('creates a task for an unseen event', () => {
		const plan = planLmsSync([event()], [], bounds, []);
		expect(plan.creates).toHaveLength(1);
		expect(plan.creates[0]).toMatchObject({
			externalId: 'ev-1',
			title: 'PS3',
			dueDate: '2026-08-20'
		});
		expect(plan.dueDateUpdates).toHaveLength(0);
	});

	it('is idempotent: a second sync of the same feed creates nothing', () => {
		const existing = [{ id: 't1', externalId: 'ev-1', dueDate: '2026-08-20' }];
		const plan = planLmsSync([event()], existing, bounds, []);
		expect(plan.creates).toHaveLength(0);
		expect(plan.dueDateUpdates).toHaveLength(0);
	});

	it('refreshes only dueDate on an existing task, and only when changed', () => {
		const existing = [{ id: 't1', externalId: 'ev-1', dueDate: '2026-08-19' }];
		const plan = planLmsSync([event({ title: 'renamed upstream' })], existing, bounds, []);
		expect(plan.creates).toHaveLength(0);
		expect(plan.dueDateUpdates).toEqual([{ id: 't1', dueDate: '2026-08-20' }]);
		// structurally: the plan has no way to express title/notes/position updates
	});

	it('never deletes: events absent from the feed produce no actions', () => {
		const existing = [{ id: 't-old', externalId: 'ev-gone', dueDate: '2026-01-01' }];
		const plan = planLmsSync([], existing, bounds, []);
		expect(plan.creates).toHaveLength(0);
		expect(plan.dueDateUpdates).toHaveLength(0);
	});

	it('spreads multiple new tasks across distinct non-overlapping slots', () => {
		const events = ['a', 'b', 'c'].map((id) => event({ eventId: id, title: id }));
		const plan = planLmsSync(events, [], bounds, []);
		const anchors = plan.creates.map((c) => `${c.x},${c.y}`);
		expect(new Set(anchors).size).toBe(3);
	});

	it('avoids positions already occupied by user tasks', () => {
		const plan = planLmsSync([event()], [], bounds, [{ x: 0, y: 0 }]);
		expect(plan.creates[0]).not.toMatchObject({ x: 0, y: 0 });
	});

	it('dedupes repeated event ids within a single feed: first occurrence wins', () => {
		const events = [event(), event({ title: 'cross-listed duplicate' })];
		const plan = planLmsSync(events, [], bounds, []);
		expect(plan.creates).toHaveLength(1);
		expect(plan.creates[0]).toMatchObject({ externalId: 'ev-1', title: 'PS3' });
	});
});

describe('zoneInnerBounds', () => {
	it('insets for padding and the zone-head row', () => {
		const b = zoneInnerBounds({ x: 100, y: 100, width: 400, height: 300 });
		expect(b.x).toBeGreaterThan(100);
		expect(b.y).toBeGreaterThanOrEqual(134); // below the head row
		expect(b.width).toBeLessThan(400);
	});

	it('never returns bounds smaller than one card', () => {
		const b = zoneInnerBounds({ x: 0, y: 0, width: 50, height: 40 });
		expect(b.width).toBeGreaterThanOrEqual(DEFAULT_CARD.width);
		expect(b.height).toBeGreaterThanOrEqual(DEFAULT_CARD.height);
	});
});

describe('looseBounds', () => {
	it('stays near the origin, inside the reachable canvas', () => {
		expect(looseBounds()).toEqual({ x: 40, y: 40, width: 1400, height: 4000 });
	});
});

describe('planLmsSync on loose bounds', () => {
	it('places a new task in a free slot even when the origin area is crowded', () => {
		// A full first row plus the start of the second, all inside looseBounds.
		const occupied = [
			{ x: 40, y: 40 },
			{ x: 272, y: 40 },
			{ x: 504, y: 40 },
			{ x: 736, y: 40 },
			{ x: 968, y: 40 },
			{ x: 1200, y: 40 },
			{ x: 40, y: 124 }
		];
		const plan = planLmsSync([event()], [], looseBounds(), occupied);

		expect(plan.creates).toHaveLength(1);
		const slot = plan.creates[0];
		// Reachable: within the near-origin region the canvas can actually show.
		expect(slot.x).toBeGreaterThanOrEqual(40);
		expect(slot.y).toBeGreaterThanOrEqual(40);
		expect(slot.y).toBeLessThan(1000);
		// And not stacked on top of anything already there.
		for (const o of occupied) {
			const apart =
				slot.x + DEFAULT_CARD.width <= o.x ||
				o.x + DEFAULT_CARD.width <= slot.x ||
				slot.y + DEFAULT_CARD.height <= o.y ||
				o.y + DEFAULT_CARD.height <= slot.y;
			expect(apart).toBe(true);
		}
	});
});
