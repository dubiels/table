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
	it('starts below all existing content', () => {
		const b = looseBounds([
			{ x: 0, y: 500, height: 300 },
			{ x: 200, y: 100 } // a card, DEFAULT_CARD.height tall
		]);
		expect(b.y).toBeGreaterThan(800);
	});
});
