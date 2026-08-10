# Table — Finished Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Table from prototype to a finished personal "digital brain": fix the zoom/placement dead-zone, harden the LMS (Canvas) sync per the 2026-08-09 spec, ship the read-only `/api/dashboard` endpoint, audit and fix view bugs, replace the clunky toolbar/dropdown UI with a real app shell, finish the inbox, and add a Google Calendar agenda.

**Architecture:** Pure logic stays in colocated-tested modules under `src/lib` (`zones.ts`, `bento.ts`, new `placement.ts`, `lms/plan.ts`, `dashboard/serialize.ts`, `gcal/agenda.ts`); routes and the scheduler stay thin executors. UI is Svelte 5 runes components sharing the warm-light token system in `app.css`.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Drizzle/better-sqlite3, vitest, `ical` (already installed — it expands RRULE via `.rrule.between()` and marks all-day starts with `start.dateOnly === true`), node-cron, web-push, Resend.

## Global Constraints

- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`) — match existing component style; tab indentation; prettier config as-is.
- Warm-light theme only. Use the existing CSS custom properties in `src/app.css`. **No dark theme** (the Pi wall display owns dark; see the 2026-08-09 spec §5).
- **No new npm dependencies.**
- Conventional Commits v1.0.0: lowercase imperative description, scope in parens, no trailing period.
- Commit directly on `main`. **Commit, do not push** — the user pushes.
- **Never launch the dev server or a browser to verify.** Verification = `npm test` (vitest), `npm run check` (svelte-check), `npm run lint`. The plan's final section collects manual verification steps for the user.
- Pure logic gets a colocated `*.test.ts`; route handlers and Svelte components stay thin and untested.
- The `tasks.source` DB enum value stays `'canvas'` (it labels the LMS source; no migration in this plan). The _module_ renames to `lms/`.
- Existing behavior that must survive every task: task drag/cluster/zone interactions in BlobView, push notifications, magic-link login.

---

### Task 1: Zoom reveals usable space (the world-growth fix)

The bug: `BlobView.svelte` clamps every drag/resize/composer placement to `viewportBounds`, which is capped at `worldSize` — and `worldSize` only grows from _committed_ content positions. Zooming out therefore shows empty space you can never actually drop anything onto. Fix: placement is allowed anywhere _currently visible_; the stored world size concept is deleted.

**Files:**

- Modify: `src/lib/zones.ts` (add pure function)
- Test: `src/lib/zones.test.ts` (extend existing file)
- Modify: `src/lib/components/BlobView.svelte:96-129` (delete `worldSize`, rewire `viewportBounds`)

**Interfaces:**

- Produces: `visibleWorldBounds(naturalWidth: number, naturalHeight: number, zoom: number): { minX: number; minY: number; maxX: number; maxY: number }` exported from `$lib/zones`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/zones.test.ts`:

```ts
import { visibleWorldBounds } from './zones';

describe('visibleWorldBounds', () => {
	it('equals the natural viewport at zoom 1', () => {
		expect(visibleWorldBounds(1000, 600, 1)).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 600 });
	});

	it('extends beyond the natural viewport when zoomed out', () => {
		// scale(0.5) around the center shows 2x the size, centered: [-500, 1500] clipped to >= 0
		expect(visibleWorldBounds(1000, 600, 0.5)).toEqual({ minX: 0, minY: 0, maxX: 1500, maxY: 900 });
	});

	it('grows monotonically as zoom decreases', () => {
		const z1 = visibleWorldBounds(1000, 600, 0.9);
		const z2 = visibleWorldBounds(1000, 600, 0.6);
		expect(z2.maxX).toBeGreaterThan(z1.maxX);
		expect(z2.maxY).toBeGreaterThan(z1.maxY);
	});
});
```

Adjust the import line to merge with the file's existing imports from `./zones`.

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/zones.test.ts` → FAIL (`visibleWorldBounds` not exported).

- [ ] **Step 3: Implement** — append to `src/lib/zones.ts`:

```ts
export interface ViewportBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * The world-coordinate region visible in a canvas of the given natural size at
 * the given zoom, where the canvas content scales around the natural center.
 * Placement is legal anywhere visible — zooming out reveals fresh space that
 * can be dragged onto immediately; there is no stored "world size".
 */
export function visibleWorldBounds(
	naturalWidth: number,
	naturalHeight: number,
	zoom: number
): ViewportBounds {
	const halfW = naturalWidth / (2 * zoom);
	const halfH = naturalHeight / (2 * zoom);
	const cx = naturalWidth / 2;
	const cy = naturalHeight / 2;
	return {
		minX: Math.max(0, cx - halfW),
		minY: Math.max(0, cy - halfH),
		maxX: cx + halfW,
		maxY: cy + halfH
	};
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/zones.test.ts` → PASS.

- [ ] **Step 5: Rewire BlobView** — in `src/lib/components/BlobView.svelte`:
  1. Delete the whole `worldSize` `$derived.by` block (lines ~104–121) and the `WORLD_PAD` constant.
  2. Replace the `viewportBounds` `$derived.by` block (lines ~234–247) with:

```ts
// The region of the world visible right now at the current zoom. Every
// drag/resize/composer placement is clamped to this — so zooming out is
// exactly what makes more space reachable.
let viewportBounds = $derived(
	visibleWorldBounds(canvasEl?.clientWidth ?? 0, canvasEl?.clientHeight ?? 0, zoom)
);
```

3. Add `visibleWorldBounds` to the existing `$lib/zones` import.

- [ ] **Step 6: Verify** — `npm run check` → no new errors; `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/zones.ts src/lib/zones.test.ts src/lib/components/BlobView.svelte
git commit -m "fix(canvas): allow placing items anywhere visible when zoomed out"
```

---

### Task 2: Rename `canvas/` module to `lms/`

Mechanical rename per spec §B1 — in this codebase "canvas" means the spatial canvas; the LMS integration must not squat on the word.

**Files:**

- Rename: `src/lib/server/canvas/` → `src/lib/server/lms/` (`git mv`)
- Modify: `src/lib/server/lms/ical-parser.ts` (rename export `parseCanvasIcal` → `parseLmsIcal`; keep behavior identical)
- Modify: `src/lib/server/lms/sync.ts` (rename export `syncCanvasAssignments` → `syncLmsAssignments`; env `LMS_ICAL_URL` with `CANVAS_ICAL_URL` fallback)
- Modify: `src/lib/server/scheduler/index.ts:10,23,28` (import path, function name, `LMS_SYNC_CRON ?? CANVAS_SYNC_CRON`)
- Modify: any `*.test.ts` referencing the old names (search `parseCanvasIcal`, `canvas/`)
- Modify: `.env.example` (document `LMS_ICAL_URL`, `LMS_SYNC_CRON`)

**Interfaces:**

- Produces: `syncLmsAssignments()` exported from `$lib/server/lms/sync`; `parseLmsIcal(icsText: string)` from `$lib/server/lms/ical-parser`. Tasks 4–5 rewrite the sync internals — this task changes names only.

- [ ] **Step 1: Rename** — `git mv src/lib/server/canvas src/lib/server/lms`, then `grep -rn "canvas" src/ --include="*.ts"` and update every import path, exported symbol (`parseCanvasIcal` → `parseLmsIcal`, `syncCanvasAssignments` → `syncLmsAssignments`), and log-message prefix in the moved module + scheduler. Do NOT touch `tasks.source === 'canvas'` values or the spatial-canvas UI code.

- [ ] **Step 2: Env names** — in `src/lib/server/lms/sync.ts` read `env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL`; in scheduler read `env.LMS_SYNC_CRON ?? env.CANVAS_SYNC_CRON ?? '0 */6 * * *'`. Append to `.env.example`:

```
# Canvas LMS assignment feed (the .ics URL from Canvas > Calendar > Calendar Feed)
LMS_ICAL_URL=
LMS_SYNC_CRON=0 */6 * * *
```

- [ ] **Step 3: Verify** — `npm test` → PASS; `npm run check` → clean; `grep -rn "syncCanvasAssignments\|parseCanvasIcal\|server/canvas" src/` → no hits.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(lms): rename canvas module to lms"
```

---

### Task 3: `nextFreeSlot` grid placement

Pure module per spec §B3, following the `zones.ts`/`bento.ts` split.

**Files:**

- Create: `src/lib/placement.ts`
- Test: `src/lib/placement.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_CARD`, `Point` from `$lib/zones`.
- Produces: `nextFreeSlot(occupied: Point[], bounds: PlacementBounds, card = DEFAULT_CARD): Point` and `interface PlacementBounds { x: number; y: number; width: number; height: number }` and `const PLACEMENT_GAP = 12`, all exported from `$lib/placement`.

- [ ] **Step 1: Write the failing tests** — `src/lib/placement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextFreeSlot, PLACEMENT_GAP } from './placement';
import { DEFAULT_CARD } from './zones';

const bounds = { x: 100, y: 100, width: 800, height: 600 };

describe('nextFreeSlot', () => {
	it('returns the top-left anchor when nothing is occupied', () => {
		expect(nextFreeSlot([], bounds)).toEqual({ x: 100, y: 100 });
	});

	it('skips an occupied top-left slot and moves right', () => {
		const slot = nextFreeSlot([{ x: 100, y: 100 }], bounds);
		expect(slot.y).toBe(100);
		expect(slot.x).toBeGreaterThanOrEqual(100 + DEFAULT_CARD.width);
	});

	it('wraps to the next row when a row is full', () => {
		// bounds fit exactly one card per row
		const narrow = { x: 0, y: 0, width: DEFAULT_CARD.width + 10, height: 600 };
		const slot = nextFreeSlot([{ x: 0, y: 0 }], narrow);
		expect(slot.x).toBe(0);
		expect(slot.y).toBeGreaterThanOrEqual(DEFAULT_CARD.height + PLACEMENT_GAP);
	});

	it('does not overlap arbitrary (non-grid) occupied positions', () => {
		const occupied = [{ x: 150, y: 130 }];
		const slot = nextFreeSlot(occupied, bounds);
		const apart =
			slot.x + DEFAULT_CARD.width <= 150 ||
			150 + DEFAULT_CARD.width <= slot.x ||
			slot.y + DEFAULT_CARD.height <= 130 ||
			130 + DEFAULT_CARD.height <= slot.y;
		expect(apart).toBe(true);
	});

	it('falls back to the last row instead of returning null when full', () => {
		const tiny = { x: 0, y: 0, width: DEFAULT_CARD.width, height: DEFAULT_CARD.height };
		const slot = nextFreeSlot([{ x: 0, y: 0 }], tiny);
		expect(slot).toEqual({ x: 0, y: 0 }); // best-effort anchor, never null
	});

	it('handles bounds smaller than a card without looping forever', () => {
		const slot = nextFreeSlot([], { x: 50, y: 50, width: 10, height: 10 });
		expect(slot).toEqual({ x: 50, y: 50 });
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/placement.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/placement.ts`:

```ts
import { DEFAULT_CARD, type Point } from './zones';

export interface PlacementBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Gap between auto-placed cards so a batch drop reads as a tidy grid. */
export const PLACEMENT_GAP = 12;

function overlapsAny(
	x: number,
	y: number,
	occupied: Point[],
	card: { width: number; height: number }
): boolean {
	for (const o of occupied) {
		const apart =
			x + card.width <= o.x ||
			o.x + card.width <= x ||
			y + card.height <= o.y ||
			o.y + card.height <= y;
		if (!apart) return true;
	}
	return false;
}

/**
 * Walks a grid inside `bounds` and returns the first anchor whose card rect
 * does not overlap any occupied card. When the bounds are full (or smaller
 * than one card), falls back to the last fitting row's start — a placed-
 * imperfectly card beats a dropped one, so this never returns null.
 */
export function nextFreeSlot(
	occupied: Point[],
	bounds: PlacementBounds,
	card = DEFAULT_CARD
): Point {
	const stepX = card.width + PLACEMENT_GAP;
	const stepY = card.height + PLACEMENT_GAP;
	const maxX = bounds.x + bounds.width - card.width;
	const maxY = bounds.y + bounds.height - card.height;
	for (let y = bounds.y; y <= maxY; y += stepY) {
		for (let x = bounds.x; x <= maxX; x += stepX) {
			if (!overlapsAny(x, y, occupied, card)) return { x, y };
		}
	}
	return { x: bounds.x, y: Math.max(bounds.y, maxY) };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/placement.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/placement.ts src/lib/placement.test.ts
git commit -m "feat(placement): add nextFreeSlot grid packing"
```

---

### Task 4: Pure LMS sync planner (zone-by-id, loose fallback, dueDate-only refresh)

Extract the sync's decision logic into a pure, fully-tested planner (spec §B2/§B3/§B5). The executor (Task 5) becomes a thin shell, so the "upsert path" is tested without a database.

**Files:**

- Create: `src/lib/server/lms/plan.ts`
- Test: `src/lib/server/lms/plan.test.ts`

**Interfaces:**

- Consumes: `nextFreeSlot`, `PlacementBounds` from `$lib/placement`; `DEFAULT_CARD`, `Point` from `$lib/zones`.
- Produces (all from `$lib/server/lms/plan`):
  - `interface LmsEvent { eventId: string; title: string; dueDate: string | null; courseName: string | null }`
  - `interface ExistingLmsTask { id: string; externalId: string | null; dueDate: string | null }`
  - `interface LmsSyncPlan { creates: Array<{ title: string; dueDate: string | null; courseName: string | null; externalId: string; x: number; y: number }>; dueDateUpdates: Array<{ id: string; dueDate: string | null }> }`
  - `planLmsSync(events: LmsEvent[], existing: ExistingLmsTask[], bounds: PlacementBounds, occupied: Point[]): LmsSyncPlan`
  - `zoneInnerBounds(zone: { x: number; y: number; width: number; height: number }): PlacementBounds`
  - `looseBounds(content: Array<{ x: number; y: number; width?: number; height?: number }>): PlacementBounds`

- [ ] **Step 1: Write the failing tests** — `src/lib/server/lms/plan.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/server/lms/plan.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/server/lms/plan.ts`:

```ts
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

	for (const event of events) {
		const match = byExternalId.get(event.eventId);
		if (match) {
			if (match.dueDate !== event.dueDate) {
				dueDateUpdates.push({ id: match.id, dueDate: event.dueDate });
			}
			continue;
		}
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
```

- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/server/lms/plan.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/lms/plan.ts src/lib/server/lms/plan.test.ts
git commit -m "feat(lms): add pure sync planner with loose-placement fallback"
```

---

### Task 5: LMS sync executor rewrite + manual trigger endpoint

Replace the throwing, name-addressed, stacking sync with a thin executor over the planner (spec §B2–B4). Zone addressed by `LMS_ZONE_ID`; missing/unset zone → warn and place loose; **never throw on zone config**.

**Files:**

- Modify: `src/lib/server/lms/sync.ts` (full rewrite)
- Create: `src/routes/api/lms/sync/+server.ts`
- Modify: `.env.example` (add `LMS_ZONE_ID`)

**Interfaces:**

- Consumes: `planLmsSync`, `zoneInnerBounds`, `looseBounds` from `./plan`; `parseLmsIcal` from `./ical-parser`.
- Produces: `syncLmsAssignments(): Promise<{ created: number; updated: number; placedLoose: boolean }>` — Task 9's topbar menu calls `POST /api/lms/sync` and shows this summary.

- [ ] **Step 1: Rewrite `src/lib/server/lms/sync.ts`:**

```ts
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, zones } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parseLmsIcal } from './ical-parser';
import { planLmsSync, zoneInnerBounds, looseBounds } from './plan';
import { randomUUID } from 'node:crypto';

export interface LmsSyncResult {
	created: number;
	updated: number;
	placedLoose: boolean;
}

export async function syncLmsAssignments(): Promise<LmsSyncResult> {
	const url = env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL;
	if (!url) {
		console.warn('LMS sync: LMS_ICAL_URL not set, skipping');
		return { created: 0, updated: 0, placedLoose: false };
	}

	const response = await fetch(url);
	if (!response.ok) throw new Error(`LMS feed fetch failed: HTTP ${response.status}`);
	const events = parseLmsIcal(await response.text());

	// Zone by id — ids survive renames. Missing/unset zone is never an error:
	// tasks go loose on bare table (a first-class state) with a warning.
	const zoneId = env.LMS_ZONE_ID;
	const zone = zoneId ? await db.query.zones.findFirst({ where: eq(zones.id, zoneId) }) : undefined;
	if (zoneId && !zone) {
		console.warn(`LMS sync: LMS_ZONE_ID "${zoneId}" matches no zone; placing tasks loose`);
	} else if (!zoneId) {
		console.warn('LMS sync: LMS_ZONE_ID not set; placing tasks loose');
	}

	const [activeTasks, allZones, existingLms] = await Promise.all([
		db.query.tasks.findMany({ where: eq(tasks.done, false) }),
		db.query.zones.findMany(),
		db.query.tasks.findMany({ where: eq(tasks.source, 'canvas') })
	]);

	const bounds = zone ? zoneInnerBounds(zone) : looseBounds([...activeTasks, ...allZones]);
	const occupied = activeTasks.map((t) => ({ x: t.x, y: t.y }));
	const plan = planLmsSync(events, existingLms, bounds, occupied);

	for (const create of plan.creates) {
		await db.insert(tasks).values({
			id: randomUUID(),
			title: create.title,
			notes: null,
			dueDate: create.dueDate,
			priority: null,
			done: false,
			completedAt: null,
			source: 'canvas',
			externalId: create.externalId,
			courseName: create.courseName,
			x: create.x,
			y: create.y,
			sortOrder: 0,
			createdAt: new Date().toISOString()
		});
	}
	for (const update of plan.dueDateUpdates) {
		await db.update(tasks).set({ dueDate: update.dueDate }).where(eq(tasks.id, update.id));
	}

	const result = {
		created: plan.creates.length,
		updated: plan.dueDateUpdates.length,
		placedLoose: !zone && plan.creates.length > 0
	};
	console.log(`LMS sync complete: ${result.created} created, ${result.updated} updated`);
	return result;
}
```

Note: the dedupe query deliberately includes done tasks — completing an assignment then re-syncing must not resurrect it.

- [ ] **Step 2: Create `src/routes/api/lms/sync/+server.ts`** (session-gated by the existing hooks redirect — no extra auth needed):

```ts
import { json } from '@sveltejs/kit';
import { syncLmsAssignments } from '$lib/server/lms/sync';

export const POST = async () => {
	try {
		return json(await syncLmsAssignments());
	} catch (err) {
		console.error('Manual LMS sync failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
```

- [ ] **Step 3: Append to `.env.example`** (under the LMS lines from Task 2):

```
# Zone id (not name) that synced assignments land in; unset = place loose on the table
LMS_ZONE_ID=
```

- [ ] **Step 4: Verify** — `npm test` → PASS; `npm run check` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/lms/sync.ts src/routes/api/lms/sync/+server.ts .env.example
git commit -m "feat(lms): zone-by-id sync with loose fallback and manual trigger"
```

---

### Task 6: Dashboard pure modules (serializer + auth decision)

Spec Part A's logic, as two pure tested modules. The route (Task 7) stays thin.

**Files:**

- Create: `src/lib/server/dashboard/serialize.ts`
- Test: `src/lib/server/dashboard/serialize.test.ts`
- Create: `src/lib/server/dashboard/auth.ts`
- Test: `src/lib/server/dashboard/auth.test.ts`

**Interfaces:**

- Consumes: `zoneForTask`, `taskCenter` from `$lib/zones`.
- Produces:
  - `buildDashboardPayload(taskRows, zoneRows, generatedAt: Date, timezone: string): DashboardPayload` where `taskRows` have `{ id, title, dueDate, priority, source, courseName, x, y }` (already-active tasks) and `zoneRows` have `{ id, name, color, x, y, width, height }`. Payload shape per spec §A1: `{ generatedAt, timezone, tasks: [{ id, title, dueDate, priority, source, courseName, zone: { id, name, color } | null }], zones: [{ id, name, color }] }`. No `x`/`y`/`sortOrder`/`notes`/`externalId` in the output.
  - `decideDashboardAuth(configuredToken: string | undefined, authorizationHeader: string | null, hasSession: boolean): 'ok' | 'unauthorized' | 'disabled'`

- [ ] **Step 1: Write the failing tests** — `src/lib/server/dashboard/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDashboardPayload } from './serialize';

const zoneRows = [
	{ id: 'z-big', name: 'School', color: 'sage', x: 0, y: 0, width: 600, height: 600 },
	{ id: 'z-small', name: 'Exams', color: 'blush', x: 0, y: 0, width: 300, height: 300 }
];

function task(overrides: Record<string, unknown> = {}) {
	return {
		id: 't1',
		title: 'a task',
		dueDate: null,
		priority: null,
		source: 'manual',
		courseName: null,
		x: 2000,
		y: 2000,
		...overrides
	};
}

describe('buildDashboardPayload', () => {
	it('resolves a loose task to zone null', () => {
		const p = buildDashboardPayload(
			[task()],
			zoneRows,
			new Date('2026-08-09T12:00:00Z'),
			'America/New_York'
		);
		expect(p.tasks[0].zone).toBeNull();
	});

	it('resolves overlapping zones to the smaller-area zone', () => {
		const p = buildDashboardPayload(
			[task({ x: 10, y: 10 })],
			zoneRows,
			new Date(),
			'America/New_York'
		);
		expect(p.tasks[0].zone).toEqual({ id: 'z-small', name: 'Exams', color: 'blush' });
	});

	it('sorts by dueDate asc with nulls last, then priority desc, then title', () => {
		const p = buildDashboardPayload(
			[
				task({ id: 'none', dueDate: null, title: 'zzz' }),
				task({ id: 'late', dueDate: '2026-09-01' }),
				task({ id: 'soon-low', dueDate: '2026-08-10', priority: 'low', title: 'b' }),
				task({ id: 'soon-high', dueDate: '2026-08-10', priority: 'high', title: 'a' })
			],
			zoneRows,
			new Date(),
			'America/New_York'
		);
		expect(p.tasks.map((t) => t.id)).toEqual(['soon-high', 'soon-low', 'late', 'none']);
	});

	it('ships only render fields — no coordinates or internals', () => {
		const p = buildDashboardPayload([task()], zoneRows, new Date(), 'America/New_York');
		expect(Object.keys(p.tasks[0]).sort()).toEqual(
			['courseName', 'dueDate', 'id', 'priority', 'source', 'title', 'zone'].sort()
		);
	});

	it('carries generatedAt and timezone through', () => {
		const p = buildDashboardPayload(
			[],
			[],
			new Date('2026-08-09T12:30:00.000Z'),
			'America/New_York'
		);
		expect(p.generatedAt).toBe('2026-08-09T12:30:00.000Z');
		expect(p.timezone).toBe('America/New_York');
	});
});
```

And `src/lib/server/dashboard/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideDashboardAuth } from './auth';

describe('decideDashboardAuth', () => {
	it('is disabled when no token is configured — even with a session or header', () => {
		expect(decideDashboardAuth(undefined, 'Bearer x', true)).toBe('disabled');
		expect(decideDashboardAuth('', null, true)).toBe('disabled');
	});

	it('allows a valid session cookie', () => {
		expect(decideDashboardAuth('secret', null, true)).toBe('ok');
	});

	it('allows a matching bearer token', () => {
		expect(decideDashboardAuth('secret', 'Bearer secret', false)).toBe('ok');
	});

	it('rejects a wrong token, a malformed header, and no header', () => {
		expect(decideDashboardAuth('secret', 'Bearer nope', false)).toBe('unauthorized');
		expect(decideDashboardAuth('secret', 'secret', false)).toBe('unauthorized');
		expect(decideDashboardAuth('secret', null, false)).toBe('unauthorized');
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/server/dashboard` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/server/dashboard/serialize.ts`:

```ts
import { zoneForTask, taskCenter } from '$lib/zones';

export interface DashboardZone {
	id: string;
	name: string;
	color: string;
}

export interface DashboardTask {
	id: string;
	title: string;
	dueDate: string | null;
	priority: string | null;
	source: string;
	courseName: string | null;
	zone: DashboardZone | null;
}

export interface DashboardPayload {
	generatedAt: string;
	timezone: string;
	tasks: DashboardTask[];
	zones: DashboardZone[];
}

interface TaskRow {
	id: string;
	title: string;
	dueDate: string | null;
	priority: string | null;
	source: string;
	courseName: string | null;
	x: number;
	y: number;
}

interface ZoneRow {
	id: string;
	name: string;
	color: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };
const rank = (p: string | null) => (p !== null && p in PRIORITY_RANK ? PRIORITY_RANK[p] : 3);

export function buildDashboardPayload(
	taskRows: TaskRow[],
	zoneRows: ZoneRow[],
	generatedAt: Date,
	timezone: string
): DashboardPayload {
	const zonesOut = zoneRows.map((z) => ({ id: z.id, name: z.name, color: z.color }));
	const byId = new Map(zonesOut.map((z) => [z.id, z]));

	const tasksOut: DashboardTask[] = taskRows.map((t) => {
		const hit = zoneForTask(taskCenter({ x: t.x, y: t.y }), zoneRows);
		return {
			id: t.id,
			title: t.title,
			dueDate: t.dueDate,
			priority: t.priority,
			source: t.source,
			courseName: t.courseName,
			zone: hit ? (byId.get(hit.id) ?? null) : null
		};
	});

	tasksOut.sort((a, b) => {
		if (a.dueDate !== b.dueDate) {
			if (a.dueDate === null) return 1;
			if (b.dueDate === null) return -1;
			return a.dueDate < b.dueDate ? -1 : 1;
		}
		const byPriority = rank(a.priority) - rank(b.priority);
		if (byPriority !== 0) return byPriority;
		return a.title.localeCompare(b.title);
	});

	return { generatedAt: generatedAt.toISOString(), timezone, tasks: tasksOut, zones: zonesOut };
}
```

And `src/lib/server/dashboard/auth.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export type DashboardAuthDecision = 'ok' | 'unauthorized' | 'disabled';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * DASHBOARD_TOKEN unset/empty means the route is disabled (404) — absence of
 * config must never mean absence of auth. A session cookie also grants access
 * so the endpoint is inspectable in a logged-in browser. Token comparison is
 * timing-safe (hashboth, then timingSafeEqual, so lengths always match).
 */
export function decideDashboardAuth(
	configuredToken: string | undefined,
	authorizationHeader: string | null,
	hasSession: boolean
): DashboardAuthDecision {
	if (!configuredToken) return 'disabled';
	if (hasSession) return 'ok';
	const match = authorizationHeader?.match(/^Bearer (.+)$/);
	if (!match) return 'unauthorized';
	return timingSafeEqual(digest(configuredToken), digest(match[1])) ? 'ok' : 'unauthorized';
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/server/dashboard` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dashboard
git commit -m "feat(dashboard): add payload serializer and token auth decision"
```

---

### Task 7: Dashboard route, hooks bearer short-circuit, TZ

**Files:**

- Create: `src/routes/api/dashboard/+server.ts`
- Modify: `src/hooks.server.ts`
- Modify: `fly.toml` (`[env]` block)
- Modify: `.env.example`

**Interfaces:**

- Consumes: `buildDashboardPayload` from `$lib/server/dashboard/serialize`; `decideDashboardAuth` from `$lib/server/dashboard/auth`; `listActiveTasks` from `$lib/server/tasks/service`; `listZones` from `$lib/server/zones/service`.

- [ ] **Step 1: Create `src/routes/api/dashboard/+server.ts`:**

```ts
import { json } from '@sveltejs/kit';
import { listActiveTasks } from '$lib/server/tasks/service';
import { listZones } from '$lib/server/zones/service';
import { buildDashboardPayload } from '$lib/server/dashboard/serialize';

export const GET = async () => {
	const [tasks, zones] = await Promise.all([listActiveTasks(), listZones()]);
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return json(buildDashboardPayload(tasks, zones, new Date(), timezone), {
		headers: { 'cache-control': 'no-store' }
	});
};
```

- [ ] **Step 2: Modify `src/hooks.server.ts`** — insert the dashboard short-circuit _before_ the session redirect (after `event.locals.user = user;`):

```ts
import { env } from '$env/dynamic/private';
import { decideDashboardAuth } from '$lib/server/dashboard/auth';

// inside handle, after event.locals.user = user:
if (event.url.pathname === '/api/dashboard') {
	const decision = decideDashboardAuth(
		env.DASHBOARD_TOKEN,
		event.request.headers.get('authorization'),
		!!user
	);
	if (decision === 'disabled') return new Response('Not found', { status: 404 });
	if (decision === 'unauthorized') return new Response('Unauthorized', { status: 401 });
	return resolve(event);
}
```

- [ ] **Step 3: `fly.toml`** — add to the existing `[env]` block:

```toml
  TZ = "America/New_York"
```

- [ ] **Step 4: `.env.example`** — append:

```
# Long random string; the Pi wall display sends it as "Authorization: Bearer <token>".
# Unset = /api/dashboard is disabled (404), never open.
DASHBOARD_TOKEN=
```

- [ ] **Step 5: Verify** — `npm test` → PASS; `npm run check` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/dashboard/+server.ts src/hooks.server.ts fly.toml .env.example
git commit -m "feat(dashboard): add read-only dashboard endpoint with bearer auth"
```

---

### Task 8: View bug audit + fixes

Systematic pass over the interactive views. This task is investigative: verify each suspect below against the actual code, fix what's real, skip what isn't (noting why). Add regression tests where the logic is pure; UI-only fixes get a manual-verification note in the commit body. One commit per confirmed fix (or one grouped `fix(views):` commit if the fixes are all one-liners).

**Files:**

- Inspect: `src/lib/components/BlobView.svelte`, `BentoView.svelte`, `MobileColumns.svelte`, `ListView.svelte`, `TaskCard.svelte`, `TaskDetailModal.svelte`, `AddTaskForm.svelte`, `src/lib/bento.ts`, `src/lib/listView.ts`, `src/routes/(app)/+page.svelte`
- Test: extend `src/lib/bento.test.ts` / `src/lib/listView.test.ts` for any pure-logic fix

**Seeded suspects (verify each; this list is a starting point, not a ceiling):**

1. **BentoView negative box size** — `BentoView.svelte:62-64` renders `width: rect.width - GUTTER * 2`. A treemap rect narrower than 16px produces a negative CSS width. Clamp with `Math.max(0, …)`.
2. **BentoView container collapse** — `.bento` relies on `flex: 1; min-height: 0` inside the page; confirm `containerHeight` is non-zero when the view mounts (especially after switching from another view) and that `rects` recompute. If the treemap renders empty until a window resize, bind dimensions differently (e.g. `bind:clientWidth` on a wrapper that always has layout).
3. **BentoView tiny-box usability** — a zone with 1 task inside a busy board can get a box too small to read its own header. Consider a minimum weight or `minmax` clamp so every group stays legible; keep the change inside `bento.ts` (weight computation) so it's testable.
4. **BlobView stale drag overrides** — `dragTask`/`dragZone` (`BlobView.svelte:49-50`) are never pruned. Once a task has been dragged (or even tapped — `up()` calls `dragTask.set(id, base)`), its map entry permanently shadows server props: positions changed by an LMS sync or another device never render until reload. Fix: delete the override once the persisted server prop matches it (e.g. `$effect` that prunes entries equal to their task's `x`/`y`, or delete after `persist()` resolves).
5. **BlobView persist failures are silent** — `persist()` ignores response status; a failed save leaves client and server permanently divergent with no signal. Log at minimum; Task 9 adds a toast helper you may call if this task lands after it (it won't — so `console.error` now, toast wired in Task 9's sweep).
6. **MobileColumns parity** — read the whole component; check: done-toggle behavior, add-task placement coordinates (does it use a sane x/y or stack at 0,0?), zone assignment display, and whether switching view to `list`/`bento` on mobile actually works from the page's `isMobile` branching (`+page.svelte:50-58` — note `list`/`bento` selections override `isMobile`, but blob on mobile forces `MobileColumns` with no way to see the real canvas; decide and document intended behavior).
7. **ListView** — check date/priority sort stability against `listView.ts` tests, overdue styling, and that zone dots use live zone colors.
8. **TaskDetailModal** — check Escape/backdrop close, that clearing the notes field persists as null (page action maps empty string → null), and that the due-date input round-trips `YYYY-MM-DD` without timezone drift.
9. **`+page.svelte` view switching** — `view` state resets to `blob` on every reload (fixed properly in Task 9 with localStorage — don't duplicate here; just confirm no other reset bugs).

**Steps:**

- [ ] **Step 1:** Read every file in the inspect list end-to-end. For each seeded suspect, decide: real bug / not a bug (why) / real but deferred to Task 9 (which item).
- [ ] **Step 2:** Write the findings to `docs/superpowers/audits/2026-08-09-view-audit.md` — one line per suspect: verdict + one-sentence reason. Add any new bugs found the same way.
- [ ] **Step 3:** Fix confirmed bugs. Pure-logic fixes get a failing test first (in `bento.test.ts`/`listView.test.ts`), then the fix, then a passing run. UI fixes: implement, then `npm run check`.
- [ ] **Step 4:** `npm test` → PASS; `npm run check` → clean.
- [ ] **Step 5:** Commit — one `fix(<area>): <bug>` per substantive fix; the audit doc goes in its own `docs: add view audit findings` commit.

---

### Task 9: App shell — topbar, segmented view switcher, user menu, toasts

Kill the day-project toolbar: the `<select>` view dropdown, the loose row of ghost buttons, the raw `alert()` calls. Build a proper shell used by every `(app)` page.

**Files:**

- Create: `src/lib/toast.svelte.ts`
- Create: `src/lib/components/Toasts.svelte`
- Create: `src/lib/components/TopBar.svelte`
- Create: `src/lib/components/ViewSwitcher.svelte`
- Modify: `src/routes/(app)/+layout.server.ts` (add `unreadCount`)
- Modify: `src/lib/server/notifications/log.ts` (add `countUnreadNotifications`)
- Modify: `src/routes/(app)/+layout.svelte` (render TopBar + Toasts)
- Modify: `src/routes/(app)/+page.svelte` (remove old toolbar; ViewSwitcher + localStorage persistence)
- Modify: `src/lib/client/push.ts` only if its error surface needs adapting (prefer not)

**Interfaces:**

- Produces:
  - `toast(message: string, tone?: 'info' | 'success' | 'error'): void` and `toasts` (reactive array) from `$lib/toast.svelte`
  - `TopBar` props: `{ user: { email: string } | null, unreadCount: number }`
  - `ViewSwitcher` props: `{ value: 'blob' | 'list' | 'bento' (bindable), options: Array<{ value: string; label: string }> }`
  - Layout data now includes `unreadCount: number` (used by TopBar badge; Task 10's inbox relies on the badge clearing after visiting).

- [ ] **Step 1: Toast store** — `src/lib/toast.svelte.ts`:

```ts
export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function toast(message: string, tone: Toast['tone'] = 'info', timeoutMs = 4000) {
	const id = nextId++;
	toasts.push({ id, message, tone });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, timeoutMs);
}
```

`Toasts.svelte`: fixed stack, bottom-center, `z-index` above modals; each toast a pill — `background: var(--surface)`, `border: 1px solid var(--border-strong)`, `border-radius: 999px`, `box-shadow: var(--shadow-raised)`, `padding: 0.5rem 1rem`; tone accents: error → `color: var(--danger)`, success → `color: var(--ok)`. Subtle enter animation (translateY + fade, ~160ms). No close button needed at 4s timeout.

- [ ] **Step 2: Unread count** — add to `src/lib/server/notifications/log.ts`:

```ts
import { and, isNull } from 'drizzle-orm';
// (merge with existing imports; this module already imports db/schema/eq)

export async function countUnreadNotifications(userId: string): Promise<number> {
	const rows = await db
		.select({ id: notifications.id })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
	return rows.length;
}
```

(Adapt to the module's existing import style after reading it.) Then `src/routes/(app)/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/notifications/log';

export const load: LayoutServerLoad = async ({ locals }) => {
	const unreadCount = locals.user ? await countUnreadNotifications(locals.user.id) : 0;
	return { user: locals.user, unreadCount };
};
```

- [ ] **Step 3: ViewSwitcher** — `src/lib/components/ViewSwitcher.svelte`: a segmented control, not a select.

```svelte
<script lang="ts">
	let {
		value = $bindable(),
		options
	}: {
		value: string;
		options: Array<{ value: string; label: string }>;
	} = $props();
</script>

<div class="seg" role="tablist" aria-label="View">
	{#each options as opt (opt.value)}
		<button
			type="button"
			role="tab"
			aria-selected={value === opt.value}
			class="seg-btn"
			class:active={value === opt.value}
			onclick={() => (value = opt.value)}
		>
			{opt.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface-2);
		border-radius: 999px;
	}
	.seg-btn {
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.32rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.seg-btn.active {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow-card);
	}
</style>
```

- [ ] **Step 4: TopBar** — `src/lib/components/TopBar.svelte`. Structure (fill in matching styles; height ~52px, `border-bottom: 1px solid var(--border)`, brand in `--font-display` weight 700):

```svelte
<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { subscribeToPush } from '$lib/client/push';
	import { toast } from '$lib/toast.svelte';
	import { env } from '$env/dynamic/public';

	let { user, unreadCount }: { user: { email: string } | null; unreadCount: number } = $props();
	let menuOpen = $state(false);
	let syncing = $state(false);

	async function enableNotifications() {
		menuOpen = false;
		try {
			await subscribeToPush(env.PUBLIC_VAPID_PUBLIC_KEY ?? '');
			toast('Notifications enabled', 'success');
		} catch (err) {
			toast(`Could not enable notifications: ${(err as Error).message}`, 'error');
		}
	}

	async function syncNow() {
		menuOpen = false;
		syncing = true;
		try {
			const res = await fetch('/api/lms/sync', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) {
				toast(body.error ?? 'Sync failed', 'error');
			} else {
				toast(
					`Synced — ${body.created} new, ${body.updated} updated${body.placedLoose ? ' (placed loose)' : ''}`,
					'success'
				);
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}
</script>
```

Markup: `<header class="topbar">` with:

- Left: `<a class="brand" href="/">Table</a>` (when not on `/`, this is the back affordance — style it plainly, no underline).
- Right nav: `Inbox` link with unread badge (`{#if unreadCount > 0}<span class="badge">{unreadCount}</span>{/if}` — small accent-filled pill), `History` link, then a circular user button (first letter of `user.email`, uppercase, `background: var(--accent); color: var(--accent-ink)`).
- User button toggles a popover (`position: absolute` under the button, `background: var(--surface)`, `border-radius: var(--radius-m)`, `box-shadow: var(--shadow-raised)`, min-width 220px): the email (muted, small, non-interactive), a divider, then menu items **Sync assignments** (disabled while `syncing`), **Enable notifications**, divider, **Log out** (a `<form method="POST" action="/logout">` submit styled as a menu item, `color: var(--danger)`).
- Close the popover on outside click (`svelte:window onclick` checking `!e.target.closest('.user-menu')`) and Escape.
- Nav links: `color: var(--muted)`, hover `var(--ink)`; the active page's link gets `color: var(--ink)` via `page.url.pathname` comparison.

- [ ] **Step 5: Layout** — `src/routes/(app)/+layout.svelte`:

```svelte
<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	let { data, children } = $props();
</script>

<div class="app-shell">
	<TopBar user={data.user} unreadCount={data.unreadCount} />
	<main>
		{@render children()}
	</main>
</div>
<Toasts />
```

Keep the existing `.app-shell`/`main` flex styles (main stays `flex: 1; min-height: 0`).

- [ ] **Step 6: Page toolbar** — `src/routes/(app)/+page.svelte`: delete the old `.toolbar` block entirely (h1, select, History/Inbox links, Enable notifications, email, logout — all now live in TopBar). Replace with a slim row: `<ViewSwitcher bind:value={view} options={[{ value: 'blob', label: 'Table' }, { value: 'list', label: 'List' }, { value: 'bento', label: 'Bento' }]} />`. Persist the view:

```ts
const VIEW_KEY = 'table:view';
let view = $state<'blob' | 'list' | 'bento'>('blob');
$effect(() => {
	const saved = localStorage.getItem(VIEW_KEY);
	if (saved === 'blob' || saved === 'list' || saved === 'bento') view = saved;
});
$effect(() => {
	localStorage.setItem(VIEW_KEY, view);
});
```

Also remove the now-unused `enableNotifications` function and `subscribeToPush`/`env` imports from the page.

- [ ] **Step 7: Sweep** — `grep -rn "alert(" src/` → replace any remaining call with `toast(…)`. Wire `console.error` + `toast('Could not save position', 'error')` into BlobView's `persist()` failure path (`if (!res.ok)`).

- [ ] **Step 8: Verify** — `npm run check` → clean; `npm test` → PASS; `npm run lint` → clean (run `npm run format` first if needed).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(shell): topbar with user menu, segmented view switcher, toasts"
```

---

### Task 10: Finish the inbox

**Files:**

- Modify: `src/routes/(app)/inbox/+page.server.ts`
- Modify: `src/routes/(app)/inbox/+page.svelte`

**Interfaces:**

- Consumes: layout's TopBar (already provides navigation home + unread badge).
- Produces: load returns `{ notifications: Array<{ id, type, content: { text: string }, sentAt, readAt }> }` — unchanged shape, so the page template contract holds.

- [ ] **Step 1: Batch the mark-read** — in `+page.server.ts`, replace the per-row update loop with one statement (rows are fetched first so the page still renders which ones _were_ unread):

```ts
import type { PageServerLoad } from './$types';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db.query.notifications.findMany({
		where: eq(notifications.userId, locals.user!.id),
		orderBy: (n, { desc }) => [desc(n.sentAt)]
	});

	if (rows.some((r) => !r.readAt)) {
		await db
			.update(notifications)
			.set({ readAt: new Date().toISOString() })
			.where(and(eq(notifications.userId, locals.user!.id), isNull(notifications.readAt)));
	}

	return {
		notifications: rows.map((r) => ({ ...r, content: JSON.parse(r.content) as { text: string } }))
	};
};
```

- [ ] **Step 2: Rebuild the page** — `+page.svelte`. Design requirements:
  - Page header row: `<h1>Inbox</h1>` styled like history's (1.4rem) + `<a class="btn btn-ghost" href="/">Back to the table</a>` on the right (parity with history; the brand link also works but an explicit affordance was the complaint).
  - Group notifications by calendar day of `sentAt`: "Today", "Yesterday", else `Mon, Aug 4` (`toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })`). Day headers: small caps, `font-size: 0.72rem`, `color: var(--muted)`, `letter-spacing: 0.04em`, `text-transform: uppercase`, margin above each group.
  - Each notification row keeps the current card styling but: unread rows (no `readAt` in the _loaded_ data) get the accent dot and `border-color: var(--border-strong)` + `background: var(--surface)`; read rows soften to `background: transparent; border-color: var(--border)`.
  - Type label: keep "Morning digest" / "Due soon", plus show only the time (not full date) in the row's `<time>` since the day header carries the date.
  - Empty state: centered block with a large muted glyph (e.g. "☕"), "All caught up." in `--font-display` 600, and a one-line muted sub: "Digests and due-date alerts land here."
  - Grouping helper is fine inline in the `<script>` (it's presentation, not domain logic).

- [ ] **Step 3: Verify** — `npm run check` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/(app)/inbox
git commit -m "feat(inbox): day grouping, batch mark-read, back nav, empty state"
```

---

### Task 11: History + login polish

**Files:**

- Modify: `src/routes/(app)/history/+page.svelte`
- Modify: `src/routes/login/+page.svelte`
- Modify: `src/routes/login/verify/+page.svelte`
- Inspect (don't restructure): corresponding `+page.server.ts` files

**Steps:**

- [ ] **Step 1: History** — bring to inbox parity:
  - Keep the header row (`History` + back link) — it matches Task 10's inbox.
  - Group completed tasks by completion day with the same day-header treatment as the inbox (Today / Yesterday / `Mon, Aug 4`).
  - Row layout: task card full-width in a 560px column, completed-time inline right-aligned in the row (`font-size: 0.75rem; color: var(--muted)`), not below.
  - Empty state matching inbox pattern: glyph "✓", "Nothing completed yet.", muted sub "Finished tasks move here from the table."

- [ ] **Step 2: Login** — read both pages first. Then:
  - Center a single card (max-width 380px, `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-l)`, `box-shadow: var(--shadow-card)`, padding 2rem) vertically ~35% from top.
  - Brand wordmark "Table" (`--font-display`, 700, 1.6rem) above a one-line muted tagline: "Everything on the table."
  - Email form: label, input, `btn btn-primary` full-width submit "Send magic link".
  - Verify page: same card; 6-char code input gets `font-size: 1.3rem; letter-spacing: 0.35em; text-align: center; font-variant-numeric: tabular-nums`; keep existing form actions/names untouched (server contracts unchanged).
  - Error/status messages: `color: var(--danger)` / muted, inside the card, no `alert()`.

- [ ] **Step 3: Verify** — `npm run check` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/(app)/history src/routes/login
git commit -m "style(pages): polish history grouping and login cards"
```

---

### Task 12: Google Calendar server modules (ICS agenda)

Table gains a read-only _agenda_ — events from one or more Google Calendar secret ICS URLs — rendered beside the board. Calendar events are **display-only**: they never become tasks, and the existing `/api/dashboard` contract is untouched (the Pi fetches its own Google feed; see memory/spec §2).

**Files:**

- Create: `src/lib/server/gcal/agenda.ts` (pure)
- Test: `src/lib/server/gcal/agenda.test.ts`
- Create: `src/lib/server/gcal/service.ts` (fetch + TTL cache)
- Modify: `.env.example`

**Interfaces:**

- Produces:
  - `interface AgendaEvent { id: string; title: string; start: string; end: string | null; allDay: boolean; location: string | null }` (`start`/`end` are ISO instants)
  - `upcomingEvents(icsText: string, from: Date, days: number): AgendaEvent[]` from `$lib/server/gcal/agenda`
  - `getAgenda(): Promise<AgendaEvent[]>` from `$lib/server/gcal/service` — next 7 days, all configured calendars, sorted by start; returns `[]` when `GCAL_ICAL_URLS` is unset; never throws (per-calendar failures log and skip).
- Facts about the installed `ical` package (verified): `ical.parseICS(text)` returns an object keyed by UID; VEVENTs have `.type === 'VEVENT'`, `.start`/`.end` as `Date`, `.summary`, `.location`; all-day starts have `.start.dateOnly === true`; recurring events expose `.rrule` with `.between(after: Date, before: Date, inclusive?: boolean): Date[]`; recurrence exceptions live in `.exdate` (object keyed by date-string, values are `Date`s).

- [ ] **Step 1: Write the failing tests** — `src/lib/server/gcal/agenda.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { upcomingEvents } from './agenda';

function ics(body: string[]): string {
	return ['BEGIN:VCALENDAR', ...body, 'END:VCALENDAR'].join('\r\n');
}

const from = new Date('2026-08-09T00:00:00Z');

describe('upcomingEvents', () => {
	it('includes a timed event inside the window', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:t1',
			'SUMMARY:Advising meeting',
			'DTSTART:20260811T140000Z',
			'DTEND:20260811T150000Z',
			'LOCATION:Room 5',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			title: 'Advising meeting',
			start: '2026-08-11T14:00:00.000Z',
			end: '2026-08-11T15:00:00.000Z',
			allDay: false,
			location: 'Room 5'
		});
	});

	it('excludes events outside the window', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:t2',
			'SUMMARY:Far future',
			'DTSTART:20261001T140000Z',
			'DTEND:20261001T150000Z',
			'END:VEVENT'
		]);
		expect(upcomingEvents(text, from, 7)).toHaveLength(0);
	});

	it('flags all-day events', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:a1',
			'SUMMARY:Reading day',
			'DTSTART;VALUE=DATE:20260812',
			'DTEND;VALUE=DATE:20260813',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		expect(events).toHaveLength(1);
		expect(events[0].allDay).toBe(true);
	});

	it('expands weekly recurrences into window occurrences', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:r1',
			'SUMMARY:CS lecture',
			'DTSTART:20260803T140000Z',
			'DTEND:20260803T152000Z',
			'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
			'END:VEVENT'
		]);
		const events = upcomingEvents(text, from, 7);
		// window 8/9–8/16 contains Mon 8/10 and Wed 8/12
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.title === 'CS lecture')).toBe(true);
		// occurrences keep the master's duration
		const first = events[0];
		expect(new Date(first.end!).getTime() - new Date(first.start).getTime()).toBe(80 * 60000);
		// distinct ids per occurrence
		expect(new Set(events.map((e) => e.id)).size).toBe(2);
	});

	it('sorts by start time', () => {
		const text = ics([
			'BEGIN:VEVENT',
			'UID:b',
			'SUMMARY:Later',
			'DTSTART:20260811T170000Z',
			'DTEND:20260811T180000Z',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'UID:a',
			'SUMMARY:Earlier',
			'DTSTART:20260810T090000Z',
			'DTEND:20260810T100000Z',
			'END:VEVENT'
		]);
		expect(upcomingEvents(text, from, 7).map((e) => e.title)).toEqual(['Earlier', 'Later']);
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/server/gcal` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/server/gcal/agenda.ts`:

```ts
import ical from 'ical';

export interface AgendaEvent {
	id: string;
	title: string;
	start: string;
	end: string | null;
	allDay: boolean;
	location: string | null;
}

/**
 * Expands an ICS text into concrete event occurrences inside [from, from+days).
 * Recurring events are expanded via the parsed rrule; exdates are respected.
 * Display-only: nothing here ever touches tasks.
 */
export function upcomingEvents(icsText: string, from: Date, days: number): AgendaEvent[] {
	const windowEnd = new Date(from.getTime() + days * 86_400_000);
	const parsed = ical.parseICS(icsText);
	const out: AgendaEvent[] = [];

	for (const [uid, ev] of Object.entries(parsed)) {
		if (ev.type !== 'VEVENT' || !ev.start) continue;
		const title = ev.summary ?? '(untitled)';
		const location = ev.location || null;
		const allDay = (ev.start as Date & { dateOnly?: boolean }).dateOnly === true;
		const durationMs = ev.end ? ev.end.getTime() - ev.start.getTime() : 0;

		if (ev.rrule) {
			const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => (d as Date).getTime()));
			for (const occurrence of ev.rrule.between(from, windowEnd, true)) {
				if (exdates.has(occurrence.getTime())) continue;
				out.push({
					id: `${uid}:${occurrence.toISOString()}`,
					title,
					start: occurrence.toISOString(),
					end: durationMs > 0 ? new Date(occurrence.getTime() + durationMs).toISOString() : null,
					allDay,
					location
				});
			}
		} else {
			if (ev.start >= from && ev.start < windowEnd) {
				out.push({
					id: uid,
					title,
					start: ev.start.toISOString(),
					end: ev.end ? ev.end.toISOString() : null,
					allDay,
					location
				});
			}
		}
	}

	out.sort((a, b) => a.start.localeCompare(b.start));
	return out;
}
```

(If `ical`'s TypeScript types don't declare `rrule`/`exdate`/`dateOnly`, add a minimal local type assertion — do not `any` the whole module.)

- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/server/gcal` → PASS.

- [ ] **Step 5: Service** — `src/lib/server/gcal/service.ts`:

```ts
import { env } from '$env/dynamic/private';
import { upcomingEvents, type AgendaEvent } from './agenda';

const TTL_MS = 10 * 60 * 1000;
const AGENDA_DAYS = 7;

let cache: { at: number; events: AgendaEvent[] } | null = null;

/**
 * Next 7 days of events across all configured calendars, cached 10 minutes.
 * Unset GCAL_ICAL_URLS means an empty agenda; a failing calendar is logged
 * and skipped so one bad feed never blanks the whole rail.
 */
export async function getAgenda(): Promise<AgendaEvent[]> {
	const urls = (env.GCAL_ICAL_URLS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (urls.length === 0) return [];
	if (cache && Date.now() - cache.at < TTL_MS) return cache.events;

	const all: AgendaEvent[] = [];
	for (const url of urls) {
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			all.push(...upcomingEvents(await res.text(), new Date(), AGENDA_DAYS));
		} catch (err) {
			console.error('gcal: calendar fetch failed, skipping', err);
		}
	}
	all.sort((a, b) => a.start.localeCompare(b.start));
	cache = { at: Date.now(), events: all };
	return all;
}
```

- [ ] **Step 6: `.env.example`** — append:

```
# Comma-separated Google Calendar secret ICS URLs (Settings > your calendar >
# "Secret address in iCal format"). Unset = no agenda rail in the UI.
GCAL_ICAL_URLS=
```

- [ ] **Step 7: Verify** — `npm test` → PASS; `npm run check` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/gcal src/lib/server/gcal/agenda.test.ts .env.example
git commit -m "feat(gcal): parse and cache google calendar ics agendas"
```

---

### Task 13: Agenda rail UI

**Files:**

- Create: `src/lib/components/AgendaRail.svelte`
- Modify: `src/routes/(app)/+page.server.ts` (load agenda)
- Modify: `src/routes/(app)/+page.svelte` (layout row: content + rail)

**Interfaces:**

- Consumes: `getAgenda()` from `$lib/server/gcal/service`; `AgendaEvent` type.
- Produces: `AgendaRail` props `{ events: AgendaEvent[] }`.

- [ ] **Step 1: Load** — in `+page.server.ts`, extend the existing load:

```ts
import { getAgenda } from '$lib/server/gcal/service';

export const load: PageServerLoad = async () => {
	const [tasks, zones, agenda] = await Promise.all([
		tasksService.listActiveTasks(),
		zonesService.listZones(),
		getAgenda().catch(() => [])
	]);
	return { tasks, zones, agenda };
};
```

- [ ] **Step 2: AgendaRail component** — design:
  - Props: `{ events }`. Group events by calendar day of `start` (local time): "Today", "Tomorrow", then `Wed, Aug 12`. Show at most the next 5 days that _have_ events.
  - Day header: same small-caps muted treatment as inbox/history groups.
  - Event row: time column (fixed ~3.2rem, `font-variant-numeric: tabular-nums`, `font-size: 0.78rem`, muted; "all day" for `allDay`) + title (0.85rem, ink, single-line ellipsis) + optional location under the title (0.72rem, muted, ellipsis).
  - Rows are plain — no cards, no borders; a 2px `border-left: 2px solid var(--border-strong)` on the group block gives structure. This is a _rail_, visually quieter than the board.
  - Rail header: "Agenda" in `--font-display` 600 0.95rem with a muted count.
  - If `events.length === 0`: render nothing (`{#if events.length > 0}` around the whole rail) — no empty chrome for the unconfigured case.
- [ ] **Step 3: Page layout** — in `+page.svelte`, wrap the view area:

```svelte
<div class="board-row">
	<div class="board-main">
		<!-- existing {#if view === …} block -->
	</div>
	{#if data.agenda.length > 0}
		<aside class="agenda-rail">
			<AgendaRail events={data.agenda} />
		</aside>
	{/if}
</div>
```

Styles: `.board-row { display: flex; gap: 1.25rem; flex: 1; min-height: 0; }`, `.board-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }`, `.agenda-rail { width: 250px; flex-shrink: 0; overflow-y: auto; }`. Below 1100px (`@media (max-width: 1100px)`) hide the rail (`display: none`) — mobile gets the board only; the agenda is a desk-monitor affordance.

The existing `{#if view === 'list'}…` block moves inside `.board-main` unchanged; BlobView's flex sizing must keep working (it relies on `flex: 1; min-height: 0` ancestry — verify `npm run check` and read the chain).

- [ ] **Step 4: Verify** — `npm run check` → clean; `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/AgendaRail.svelte src/routes/(app)/+page.server.ts src/routes/(app)/+page.svelte
git commit -m "feat(agenda): google calendar rail beside the board"
```

---

### Task 14: Task export ICS feed (Table → Google Calendar)

Requested mid-build by the user: tasks should reach their Google Calendar. Table publishes a token-protected ICS feed of active tasks that have due dates; the user subscribes to it in Google Calendar ("Other calendars → From URL"). No Google credentials, no write API — the feed is pull-based, matching the `DASHBOARD_TOKEN` pattern.

**Files:**

- Create: `src/lib/server/ics/export.ts` (pure)
- Test: `src/lib/server/ics/export.test.ts`
- Create: `src/routes/calendar.ics/+server.ts`
- Modify: `src/hooks.server.ts` (token short-circuit, same pattern as `/api/dashboard`)
- Modify: `.env.example`

**Interfaces:**

- Consumes: `decideDashboardAuth` pattern from Task 6 — but Google Calendar's feed fetcher cannot send headers, so the token arrives as a query parameter: `/calendar.ics?token=…`. Add `decideFeedAuth(configuredToken: string | undefined, presentedToken: string | null, hasSession: boolean)` to `src/lib/server/dashboard/auth.ts` reusing the same hashed timing-safe comparison (extract a shared `tokensMatch(a, b)` helper; do not duplicate the hashing code).
- Produces: `buildTasksIcs(tasks: Array<{ id: string; title: string; dueDate: string | null; done: boolean; courseName: string | null; notes: string | null }>, now: Date): string` — a VCALENDAR of all-day VEVENTs, one per not-done task with a non-null dueDate.

- [ ] **Step 1: Write the failing tests** — `src/lib/server/ics/export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTasksIcs } from './export';

const now = new Date('2026-08-09T12:00:00Z');

function task(overrides: Record<string, unknown> = {}) {
	return {
		id: 'abc-123',
		title: 'problem set 3',
		dueDate: '2026-08-20',
		done: false,
		courseName: null,
		notes: null,
		...overrides
	};
}

describe('buildTasksIcs', () => {
	it('emits an all-day VEVENT per active task with a due date', () => {
		const ics = buildTasksIcs([task()], now);
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics).toContain('BEGIN:VEVENT');
		expect(ics).toContain('UID:table-abc-123');
		expect(ics).toContain('DTSTART;VALUE=DATE:20260820');
		expect(ics).toContain('SUMMARY:problem set 3');
		expect(ics).toContain('END:VCALENDAR');
	});

	it('skips tasks without a due date and done tasks', () => {
		const ics = buildTasksIcs(
			[task({ id: 'no-due', dueDate: null }), task({ id: 'is-done', done: true })],
			now
		);
		expect(ics).not.toContain('no-due');
		expect(ics).not.toContain('is-done');
	});

	it('prefixes the course name into the summary when present', () => {
		const ics = buildTasksIcs([task({ courseName: 'CS 4641' })], now);
		expect(ics).toContain('SUMMARY:[CS 4641] problem set 3');
	});

	it('escapes ICS special characters in text fields', () => {
		const ics = buildTasksIcs([task({ title: 'a, b; c\nnewline' })], now);
		expect(ics).toContain('SUMMARY:a\\, b\\; c\\nnewline');
	});

	it('uses CRLF line endings and folds nothing shorter than 75 octets', () => {
		const ics = buildTasksIcs([task()], now);
		expect(ics).toContain('\r\n');
		expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/server/ics` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/server/ics/export.ts`. Requirements the tests encode:
  - `VERSION:2.0`, `PRODID:-//Table//EN`, `CALSCALE:GREGORIAN`, and `X-WR-CALNAME:Table tasks` headers.
  - Per task (skip `done` or null `dueDate`): `BEGIN:VEVENT`, `UID:table-<id>`, `DTSTAMP:<now as UTC basic format>`, `DTSTART;VALUE=DATE:<yyyymmdd>` (all-day; no DTEND needed for single-day), `SUMMARY:<[courseName] >title`, optional `DESCRIPTION:<notes>` when notes non-null, `END:VEVENT`.
  - Escape per RFC 5545: backslash, comma, semicolon → backslash-escaped; literal newline → `\n`.
  - Fold any content line longer than 75 octets (continuation lines start with a single space). CRLF (`\r\n`) line endings throughout.
- [ ] **Step 4: Run to verify pass** — `npm test -- src/lib/server/ics` → PASS.
- [ ] **Step 5: Auth + route** — extract `tokensMatch` in `src/lib/server/dashboard/auth.ts`, add `decideFeedAuth` (same disabled/unauthorized/ok semantics; token from query param). In `src/hooks.server.ts`, add a `/calendar.ics` short-circuit before the session redirect mirroring the dashboard one, reading `event.url.searchParams.get('token')` against env `TASKS_FEED_TOKEN`. Route `src/routes/calendar.ics/+server.ts`:

```ts
import { listActiveTasks } from '$lib/server/tasks/service';
import { buildTasksIcs } from '$lib/server/ics/export';

export const GET = async () => {
	const tasks = await listActiveTasks();
	return new Response(buildTasksIcs(tasks, new Date()), {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
};
```

Add auth tests for `decideFeedAuth` to `auth.test.ts` (mirror the dashboard matrix: unset → disabled; session → ok; right/wrong/missing token). `.env.example`:

```
# Token for the read-only tasks .ics feed (subscribe in Google Calendar via
# "Other calendars > From URL": https://your-app/calendar.ics?token=...).
# Unset = feed disabled (404).
TASKS_FEED_TOKEN=
```

- [ ] **Step 6: Verify** — `npm test` → PASS; `npm run check` → clean.
- [ ] **Step 7: Commit**

```bash
git add src/lib/server/ics src/lib/server/dashboard/auth.ts src/lib/server/dashboard/auth.test.ts src/routes/calendar.ics src/hooks.server.ts .env.example
git commit -m "feat(ics): publish token-protected tasks feed for calendar subscription"
```

---

### Task 15: Theming — light/dark mode, zone color tokens, ASCII robot mascot

Requested mid-build: the user wants a dark mode option ("this kind of dark mode with the little ascii robot is super cute") while keeping the colorful vibe. Design decisions locked in here; visual taste latitude within them.

**Supersedes** the "No dark theme" global constraint for Table's own UI (user override, 2026-08-09). Still binding: the Pi wall display owns its own palette — `/api/dashboard` continues to ship zone color _token names_, never hex, and nothing in this task touches that contract.

**Files:**

- Modify: `src/app.css` (dark token set + zone color custom properties)
- Modify: `src/app.html` (pre-paint theme script)
- Modify: `src/lib/zones.ts` (zone color CSS-var helper)
- Modify: `src/lib/components/TopBar.svelte` (theme toggle)
- Modify: `src/lib/components/BlobView.svelte`, `BentoView.svelte`, `ZoneColorPicker.svelte`, `TaskCard.svelte`, `MobileColumns.svelte`, `ListView.svelte` (zone colors via CSS vars)
- Create: `src/lib/components/Mascot.svelte`
- Modify: `src/routes/(app)/inbox/+page.svelte`, `src/routes/(app)/history/+page.svelte`, `src/routes/login/+page.svelte` (mascot in empty states / login card)

**Interfaces:**

- Produces: `zoneColorVars(key: string): { fill: string; border: string }` from `$lib/zones` returning `var(--zone-<key>-fill)` / `var(--zone-<key>-border)` strings for any of the six `ZONE_COLOR_KEYS` (unknown keys fall back to sage). The raw `ZONE_COLORS` hex map stays exported (light-theme source of truth; nothing else may import it for styling).
- Produces: `Mascot` component, props `{ mood?: 'happy' | 'sleepy' | 'wave' }` — a small ASCII robot in a `<pre>`, monospace, `color: var(--muted)`, `font-size: 0.7rem`, `line-height: 1.15`, `user-select: none`, `aria-hidden="true"`.

**Steps:**

- [ ] **Step 1: Tokens** — in `src/app.css`:
  1. Add zone color custom properties to `:root` (light values = the existing `ZONE_COLORS` hex, e.g. `--zone-sage-fill: #e7ebda; --zone-sage-border: #cbd3b4;` … all six).
  2. Add a `[data-theme='dark']` block on `:root[data-theme='dark']` redefining every token. Dark palette direction (tune freely within it): warm charcoal, never pure black — `--bg: #1c1915; --surface: #262219; --surface-2: #322d24; --ink: #f0e9dc; --muted: #9a9182; --border: #3a342a; --border-strong: #4d4436; --accent: #e9e2d2; --accent-hover: #f7f1e4; --accent-soft: #383226; --accent-ink: #26231d; --danger: #e07a6c; --danger-soft: #46271f; --ok: #a3bd85;` — priority pill bg/fg pairs get legible dark variants; shadows get higher alpha. Zone colors: muted deep versions that stay _recognizably colorful_ (e.g. sage `#2f3626`/`#4b5638`, sky `#273239`/`#3d4f5a`, butter `#3a3322`/`#5a4e30`, blush `#3a2a27`/`#57403b`, lilac `#312c39`/`#4a4258`, clay `#382c23`/`#554238`) — same _identity_, tuned for the dark ground.
  3. `body` gets `transition: background 0.2s ease, color 0.2s ease`.
- [ ] **Step 2: Pre-paint script** — in `src/app.html`, add to `<head>` before `%sveltekit.head%`:

```html
<script>
	try {
		var t = localStorage.getItem('table:theme');
		if (t === 'dark') document.documentElement.dataset.theme = 'dark';
	} catch (e) {}
</script>
```

Default is light; only an explicit dark choice is stored.

- [ ] **Step 3: Zone color plumbing** — add `zoneColorVars` to `zones.ts`; convert every component that inlines `ZONE_COLORS[…].fill/.border` into styles (BlobView zones + composer swatches + zone dot, BentoView boxes, ZoneColorPicker swatches, TaskCard dot, MobileColumns/ListView if they color by zone) to use the CSS-var strings. Grep `ZONE_COLORS` to find them all; after this step the only importers of the hex map are `zones.ts` itself and `app.css`'s values (hand-copied).
- [ ] **Step 4: Toggle** — TopBar gets a ghost icon button before the user menu: moon glyph when light ("Switch to dark"), sun when dark; onclick flips `document.documentElement.dataset.theme` and writes/removes `localStorage['table:theme']`. State via `let dark = $state(…)` initialized from the DOM attribute.
- [ ] **Step 5: Mascot** — `Mascot.svelte` renders ASCII art per mood, default `happy`. Starting art (improve freely, keep ≤6 lines × ≤14 chars):

```
   ___
  [o_o]
 /|___|\
  d   b
```

`sleepy` variant: `[-_-]` face + `z z` floating; `wave` variant: one arm up `\|___|/` → use for login. Place it: inbox empty state (sleepy, "All caught up."), history empty state (happy), login card top (wave, above the wordmark). Remove the glyph placeholders ("☕", "✓") those pages used.

- [ ] **Step 6: Contrast pass** — with dark active, check every hardcoded hex left in components (grep `#[0-9a-f]{3,6}` in `src/lib/components` and `src/routes`) — anything that doesn't read on dark must move to a token.
- [ ] **Step 7: Verify** — `npm run check` → clean; `npm test` → PASS; `npm run lint` → clean.
- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(theme): dark mode with zone color tokens and ascii mascot"
```

---

### Task 16: README, env docs, full verification

**Files:**

- Modify: `README.md`
- Verify: `.env.example` (all vars from Tasks 2, 5, 7, 12 present)

- [ ] **Step 1: README** — update to describe the finished product:
  - Intro: Table is a personal command center — spatial task canvas (blob view), list + bento views, Canvas LMS assignment sync, Google Calendar agenda, morning digest + due-date push, notification inbox, and a read-only dashboard API for external displays.
  - New sections (concise, matching existing README voice):
    - **Canvas LMS sync** — set `LMS_ICAL_URL` (Canvas > Calendar > Calendar Feed), optional `LMS_ZONE_ID` (zone id; find it via the zone's id in the DB or leave unset to place loose), `LMS_SYNC_CRON`. Manual trigger from the user menu.
    - **Google Calendar agenda** — `GCAL_ICAL_URLS` comma-separated secret ICS addresses; display-only rail.
    - **Dashboard API** — `GET /api/dashboard` with `Authorization: Bearer $DASHBOARD_TOKEN`; unset token disables the route; note `TZ` on Fly and the token-name-only color contract.
  - Update the "Extending Table" section paths (`canvas/` → `lms/`).
- [ ] **Step 2: Full verification suite** — run and confirm all clean:

```bash
npm test          # all vitest suites PASS
npm run check     # svelte-check: 0 errors
npm run lint      # prettier + eslint clean (npm run format first if needed)
npm run build     # production build succeeds
```

Fix anything that fails before committing (fixes go in their own appropriately-typed commits).

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document lms sync, agenda, and dashboard endpoint"
```

---

## Manual verification (for the user, after the work lands)

1. **Zoom fix:** zoom out to 50%, drag a task into the newly revealed right/bottom space — it should stay where dropped (previously it snapped back to the old boundary). Zone resize into revealed space should also work.
2. **Shell:** view switcher is a segmented control; chosen view survives reload. Topbar: Inbox badge shows unread count, clears after visiting inbox. User menu: email, sync, notifications, logout.
3. **Inbox:** notifications grouped by day, unread dots on first visit, badge cleared after; "Back to the table" link present.
4. **LMS:** set `LMS_ICAL_URL` + `LMS_ZONE_ID` (or leave zone unset), user menu → Sync assignments → toast summary; new tasks spread in a grid, not stacked. Rename the zone and sync again — still works. Sync twice — second run creates 0. Move/edit a synced task, sync — position and title survive.
5. **Dashboard:** `curl -H "Authorization: Bearer $DASHBOARD_TOKEN" $URL/api/dashboard` → JSON; wrong/no token → 401; unset token → 404. `flyctl secrets set DASHBOARD_TOKEN=…` and confirm `TZ=America/New_York` (now in fly.toml).
6. **Agenda:** set `GCAL_ICAL_URLS`, reload — rail on the right with today's events; recurring classes appear; unset → no rail at all.
