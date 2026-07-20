# Table Spatial Canvas Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Table from a kanban board of topic-columns into a spatial canvas where standalone tasks are dragged freely and named "zones" act as geometric categories, styled in a warm, light, Granola-inspired theme.

**Architecture:** Tasks store freeform `x`/`y` pixel positions and a `sortOrder` reused as z-index. Zones are rectangles (`x/y/width/height/color/name`). A task's category is derived purely from which zone contains its center point (`zoneForTask`, a shared pure function) — never stored. Desktop renders an absolutely-positioned drag canvas; mobile renders neat columns grouped by the same function. Drag positions persist via a JSON endpoint; content mutations stay as SvelteKit form actions.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Drizzle ORM + better-sqlite3, Zod, Vitest, node-cron. No new dependencies.

## Global Constraints

- Single warm **light** theme only — remove the `@media (prefers-color-scheme: dark)` block; no dark-mode tokens.
- No new npm dependencies (custom pointer-drag, no drag library).
- Membership is geometric and never persisted on the task row.
- Mobile (< 720px) is view/edit only — no drag-to-reposition, no zone drawing.
- Follow existing patterns: services in `src/lib/server/<domain>/service.ts`, pure logic unit-tested with Vitest (`npm test`), form actions in `+page.server.ts`, global styles via CSS custom properties in `src/app.css`.
- Exact token values are in the spec: `docs/superpowers/specs/2026-07-20-table-canvas-redesign-design.md`.

---

### Task 1: Warm light design system

**Files:**
- Modify: `src/app.css:1-68` (replace `:root` tokens; delete dark-mode block)

Independent of all other tasks (pure CSS). No unit test; verified via type/build check and visual inspection.

- [ ] **Step 1: Replace the `:root` token block and delete the dark-mode block**

In `src/app.css`, replace the entire `:root { ... }` block (lines ~3-39) and the whole `@media (prefers-color-scheme: dark) { ... }` block (lines ~41-68) with:

```css
:root {
	--font-display:
		-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
		'Segoe UI', Roboto, Arial, sans-serif;
	--font-body:
		-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial,
		sans-serif;

	--bg: #f3efe6;
	--surface: #fffdf9;
	--surface-2: #ece7db;
	--ink: #26231d;
	--muted: #857f70;
	--border: #e4ddcf;
	--border-strong: #d5ccba;
	--accent: #33302a;
	--accent-hover: #201e19;
	--accent-soft: #e7e1d3;
	--accent-ink: #fffdf9;
	--danger: #b4372b;
	--danger-soft: #f4e0dc;
	--ok: #5b7a3f;

	--prio-high-bg: #f4e0dc;
	--prio-high-fg: #b4372b;
	--prio-med-bg: #f5e7cc;
	--prio-med-fg: #9a6512;
	--prio-low-bg: #e6ead6;
	--prio-low-fg: #5b7a3f;

	--radius-s: 10px;
	--radius-m: 14px;
	--radius-l: 20px;
	--shadow-card: 0 1px 1px rgba(60, 50, 30, 0.04), 0 4px 14px rgba(60, 50, 30, 0.06);
	--shadow-raised: 0 8px 24px rgba(60, 50, 30, 0.12), 0 24px 60px rgba(60, 50, 30, 0.16);
}
```

Leave everything after the (now-deleted) dark block (base element styles, `.btn`, `.pill`, `.chip-due`) unchanged — those already consume the tokens above.

- [ ] **Step 2: Verify no dark-mode references remain**

Run: `grep -n "prefers-color-scheme" src/app.css`
Expected: no output.

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no new errors from `app.css` (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 4: Commit**

```bash
git add src/app.css
git commit -m "style: warm light Granola-inspired theme, drop dark mode"
```

---

### Task 2: `zoneForTask` geometric membership util

**Files:**
- Create: `src/lib/zones.ts`
- Test: `src/lib/zones.test.ts`

**Interfaces:**
- Produces:
  - `interface Point { x: number; y: number }`
  - `interface ZoneBounds { id: string; x: number; y: number; width: number; height: number }`
  - `const DEFAULT_CARD: { width: number; height: number }`
  - `function taskCenter(task: Point, card?: { width: number; height: number }): Point`
  - `function zoneForTask(point: Point, zones: ZoneBounds[]): ZoneBounds | null`
  - `type ZoneColor = 'sage' | 'sky' | 'butter' | 'blush' | 'lilac' | 'clay'`
  - `const ZONE_COLORS: Record<ZoneColor, { fill: string; border: string }>`
  - `const ZONE_COLOR_KEYS: ZoneColor[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/zones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { zoneForTask, taskCenter, ZONE_COLOR_KEYS, type ZoneBounds } from './zones';

const work: ZoneBounds = { id: 'work', x: 0, y: 0, width: 400, height: 400 };
const inbox: ZoneBounds = { id: 'inbox', x: 50, y: 50, width: 100, height: 100 };

describe('zoneForTask', () => {
	it('returns the zone whose bounds contain the point', () => {
		expect(zoneForTask({ x: 300, y: 300 }, [work])?.id).toBe('work');
	});

	it('returns null when the point is outside every zone', () => {
		expect(zoneForTask({ x: 500, y: 500 }, [work])).toBeNull();
	});

	it('breaks overlap ties by choosing the smallest-area zone', () => {
		expect(zoneForTask({ x: 100, y: 100 }, [work, inbox])?.id).toBe('inbox');
	});

	it('includes points exactly on the boundary', () => {
		expect(zoneForTask({ x: 0, y: 0 }, [work])?.id).toBe('work');
		expect(zoneForTask({ x: 400, y: 400 }, [work])?.id).toBe('work');
	});
});

describe('taskCenter', () => {
	it('offsets a top-left anchor by half the default card size', () => {
		const c = taskCenter({ x: 10, y: 20 });
		expect(c.x).toBeGreaterThan(10);
		expect(c.y).toBeGreaterThan(20);
	});
});

describe('ZONE_COLOR_KEYS', () => {
	it('exposes the six palette keys', () => {
		expect(ZONE_COLOR_KEYS).toEqual(['sage', 'sky', 'butter', 'blush', 'lilac', 'clay']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/zones.test.ts`
Expected: FAIL — cannot resolve `./zones`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/zones.ts`:

```ts
export interface Point {
	x: number;
	y: number;
}

export interface ZoneBounds {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Nominal card size used to derive a task's center from its top-left anchor. */
export const DEFAULT_CARD = { width: 220, height: 72 };

export function taskCenter(task: Point, card = DEFAULT_CARD): Point {
	return { x: task.x + card.width / 2, y: task.y + card.height / 2 };
}

/**
 * The zone a point belongs to. A point inside multiple overlapping zones
 * belongs to the smallest-area zone (most specific). Boundaries are inclusive.
 */
export function zoneForTask(point: Point, zones: ZoneBounds[]): ZoneBounds | null {
	const containing = zones.filter(
		(z) =>
			point.x >= z.x &&
			point.x <= z.x + z.width &&
			point.y >= z.y &&
			point.y <= z.y + z.height
	);
	if (containing.length === 0) return null;
	return containing.reduce((smallest, z) =>
		z.width * z.height < smallest.width * smallest.height ? z : smallest
	);
}

export type ZoneColor = 'sage' | 'sky' | 'butter' | 'blush' | 'lilac' | 'clay';

export const ZONE_COLORS: Record<ZoneColor, { fill: string; border: string }> = {
	sage: { fill: '#e7ebda', border: '#cbd3b4' },
	sky: { fill: '#dee7ec', border: '#bacbd6' },
	butter: { fill: '#f2e8cb', border: '#e1d09b' },
	blush: { fill: '#eeddd8', border: '#dcbeb6' },
	lilac: { fill: '#e6e1ec', border: '#c9bfd6' },
	clay: { fill: '#efddd3', border: '#ddbba6' }
};

export const ZONE_COLOR_KEYS: ZoneColor[] = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/zones.test.ts`
Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zones.ts src/lib/zones.test.ts
git commit -m "feat: geometric zone-membership util and zone palette"
```

---

### Task 3: Schema + migration (zones table, task positions, drop topics)

**Files:**
- Modify: `src/lib/server/db/schema.ts:15-33`
- Create: a new file under `drizzle/` (generated, then hand-edited for backfill)

**Interfaces:**
- Produces: `zones` table `{ id, name, color, x, y, width, height, createdAt }`; `tasks` table gains `x`, `y` (integer, not null, default 0) and loses `topicId`.

- [ ] **Step 1: Edit the schema**

In `src/lib/server/db/schema.ts`, replace the `topics` table (lines ~15-21) and `tasks` table (lines ~23-33) with:

```ts
export const zones = sqliteTable('zones', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	color: text('color').notNull().default('sage'),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	width: integer('width').notNull().default(320),
	height: integer('height').notNull().default(320),
	createdAt: text('created_at').notNull()
});

export const tasks = sqliteTable('tasks', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	notes: text('notes'),
	dueDate: text('due_date'),
	priority: text('priority', { enum: ['low', 'med', 'high'] }),
	done: integer('done', { mode: 'boolean' }).notNull().default(false),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: text('created_at').notNull()
});
```

Leave `users`, `sessions`, `pushSubscriptions`, `loginTokens`, `notifications` unchanged.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` file is created describing the zones table, the new task columns, and the drop of topics/topicId.

- [ ] **Step 3: Prepend a data backfill to the generated migration**

Open the generated `drizzle/0002_*.sql`. At the **top** of the file (before the generated DDL), add SQL that copies existing topics into zones and lays them out. Because SQLite runs statements top-to-bottom, insert the backfill before any `DROP TABLE topics`:

```sql
-- Backfill: turn each existing topic into a zone laid out left-to-right.
INSERT INTO zones (id, name, color, x, y, width, height, created_at)
SELECT
	id,
	name,
	CASE (sort_order % 6)
		WHEN 0 THEN 'sage' WHEN 1 THEN 'sky' WHEN 2 THEN 'butter'
		WHEN 3 THEN 'blush' WHEN 4 THEN 'lilac' ELSE 'clay' END,
	40 + (sort_order % 4) * 360,
	40 + (sort_order / 4) * 360,
	320,
	320,
	created_at
FROM topics
WHERE status = 'active';
```

If the generated DDL rebuilds `tasks` via a temp-table copy (drizzle's usual pattern for dropping a column in SQLite), ensure the copy assigns a scattered position. If drizzle instead emits `ALTER TABLE tasks ADD COLUMN x/y`, append after those adds:

```sql
-- Scatter existing tasks into their former topic's zone bounds.
UPDATE tasks
SET
	x = COALESCE((SELECT z.x FROM zones z WHERE z.id = tasks.topic_id), 60)
		+ (abs(random()) % 120),
	y = COALESCE((SELECT z.y FROM zones z WHERE z.id = tasks.topic_id), 60)
		+ (abs(random()) % 160)
WHERE 1 = 1;
```

(Run this UPDATE **before** the statement that drops the `topic_id` column.)

- [ ] **Step 4: Apply the migration to the dev database**

Run: `npm run db:migrate`
Expected: `Migrations applied.` with no error.

- [ ] **Step 5: Verify the resulting schema**

Run: `npx tsx -e "import Database from 'better-sqlite3'; const d=new Database('./data/table.sqlite'); console.log(d.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name)); console.log(d.prepare('PRAGMA table_info(zones)').all().map(c=>c.name));"`
Expected: tasks columns include `x`, `y`, no `topic_id`; zones columns include `name`, `color`, `x`, `y`, `width`, `height`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat: zones table and task positions; drop topics"
```

---

### Task 4: Zones service

**Files:**
- Create: `src/lib/server/zones/service.ts`
- Delete: `src/lib/server/topics/service.ts`
- Test: `src/lib/server/zones/service.test.ts`

**Interfaces:**
- Consumes: `zones` table (Task 3).
- Produces:
  - `type Zone = typeof zones.$inferSelect`
  - `createZone(input: { name: string; color?: ZoneColor; x?: number; y?: number; width?: number; height?: number }): Promise<Zone>`
  - `listZones(): Promise<Zone[]>`
  - `renameZone(id: string, name: string): Promise<void>`
  - `updateZoneGeometry(id: string, geo: { x: number; y: number; width: number; height: number }): Promise<void>`
  - `deleteZone(id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/zones/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rows: any[] = [];
vi.mock('../db', () => ({
	db: {
		insert: () => ({ values: (r: any) => { rows.push(r); return Promise.resolve(); } }),
		query: { zones: { findMany: () => Promise.resolve([...rows]) } },
		update: () => ({ set: (patch: any) => ({ where: () => { Object.assign(rows[0], patch); return Promise.resolve(); } }) }),
		delete: () => ({ where: () => { rows.length = 0; return Promise.resolve(); } })
	}
}));

import * as zonesService from './service';

describe('zones service', () => {
	beforeEach(() => { rows.length = 0; });

	it('creates a zone with defaults', async () => {
		const z = await zonesService.createZone({ name: 'Work' });
		expect(z.name).toBe('Work');
		expect(z.color).toBe('sage');
		expect(z.width).toBe(320);
		expect(z.id).toBeTruthy();
	});

	it('renames a zone', async () => {
		await zonesService.createZone({ name: 'Work' });
		await zonesService.renameZone(rows[0].id, 'Home');
		expect(rows[0].name).toBe('Home');
	});

	it('updates zone geometry', async () => {
		await zonesService.createZone({ name: 'Work' });
		await zonesService.updateZoneGeometry(rows[0].id, { x: 5, y: 6, width: 100, height: 200 });
		expect(rows[0]).toMatchObject({ x: 5, y: 6, width: 100, height: 200 });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/server/zones/service.test.ts`
Expected: FAIL — cannot resolve `./service`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/zones/service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { zones } from '../db/schema';
import type { ZoneColor } from '$lib/zones';

export type Zone = typeof zones.$inferSelect;

export async function createZone(input: {
	name: string;
	color?: ZoneColor;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}): Promise<Zone> {
	const row = {
		id: randomUUID(),
		name: input.name,
		color: input.color ?? 'sage',
		x: input.x ?? 60,
		y: input.y ?? 60,
		width: input.width ?? 320,
		height: input.height ?? 320,
		createdAt: new Date().toISOString()
	};
	await db.insert(zones).values(row);
	return row;
}

export async function listZones(): Promise<Zone[]> {
	return db.query.zones.findMany({ orderBy: (z, { asc }) => [asc(z.createdAt)] });
}

export async function renameZone(id: string, name: string): Promise<void> {
	await db.update(zones).set({ name }).where(eq(zones.id, id));
}

export async function updateZoneGeometry(
	id: string,
	geo: { x: number; y: number; width: number; height: number }
): Promise<void> {
	await db.update(zones).set(geo).where(eq(zones.id, id));
}

export async function deleteZone(id: string): Promise<void> {
	await db.delete(zones).where(eq(zones.id, id));
}
```

Then delete the old topics service:

```bash
git rm src/lib/server/topics/service.ts
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/server/zones/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/zones/ && git rm src/lib/server/topics/service.ts
git commit -m "feat: zones service, remove topics service"
```

---

### Task 5: Tasks service rewrite

**Files:**
- Modify: `src/lib/server/tasks/service.ts` (full rewrite)
- Test: `src/lib/server/tasks/service.test.ts` (create)

**Interfaces:**
- Consumes: `tasks` table (Task 3).
- Produces:
  - `type Task = typeof tasks.$inferSelect`
  - `createTask(input: { title: string; notes?: string; dueDate?: string; priority?: 'low'|'med'|'high'; x?: number; y?: number }): Promise<Task>`
  - `updateTask(id, patch: Partial<{ title: string; notes: string|null; dueDate: string|null; priority: 'low'|'med'|'high'|null }>): Promise<Task>`
  - `updateTaskPosition(id: string, x: number, y: number): Promise<void>` (also bumps `sortOrder` to front)
  - `toggleTaskDone(id: string): Promise<Task>`
  - `deleteTask(id: string): Promise<void>`
  - `listTasks(): Promise<Task[]>`
  - `listActiveTasks(): Promise<Task[]>` (not done)

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/tasks/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

let rows: any[] = [];
let maxOrder = 0;
vi.mock('../db', () => ({
	db: {
		insert: () => ({ values: (r: any) => { rows.push(r); return Promise.resolve(); } }),
		query: {
			tasks: {
				findMany: () => Promise.resolve([...rows]),
				findFirst: () => Promise.resolve(rows[0])
			}
		},
		update: () => ({ set: (patch: any) => ({ where: () => { Object.assign(rows[0], patch); return Promise.resolve(); } }) }),
		delete: () => ({ where: () => { rows.length = 0; return Promise.resolve(); } })
	}
}));

import * as tasksService from './service';

describe('tasks service', () => {
	beforeEach(() => { rows = []; maxOrder = 0; });

	it('creates a standalone task with a position and no topic', async () => {
		const t = await tasksService.createTask({ title: 'Buy milk', x: 12, y: 34 });
		expect(t.title).toBe('Buy milk');
		expect(t.x).toBe(12);
		expect(t.y).toBe(34);
		expect('topicId' in t).toBe(false);
	});

	it('updates a task position', async () => {
		await tasksService.createTask({ title: 'Buy milk', x: 0, y: 0 });
		await tasksService.updateTaskPosition(rows[0].id, 100, 200);
		expect(rows[0]).toMatchObject({ x: 100, y: 200 });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/server/tasks/service.test.ts`
Expected: FAIL — `createTask` still requires `topicId` / references removed columns.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/lib/server/tasks/service.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tasks } from '../db/schema';

export type Task = typeof tasks.$inferSelect;

async function nextSortOrder(): Promise<number> {
	const existing = await db.query.tasks.findMany({
		orderBy: (t, { desc }) => [desc(t.sortOrder)]
	});
	return (existing[0]?.sortOrder ?? -1) + 1;
}

export async function createTask(input: {
	title: string;
	notes?: string;
	dueDate?: string;
	priority?: 'low' | 'med' | 'high';
	x?: number;
	y?: number;
}): Promise<Task> {
	const row = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		done: false,
		x: input.x ?? 60,
		y: input.y ?? 60,
		sortOrder: await nextSortOrder(),
		createdAt: new Date().toISOString()
	};
	await db.insert(tasks).values(row);
	return row;
}

export async function listTasks(): Promise<Task[]> {
	return db.query.tasks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] });
}

export async function listActiveTasks(): Promise<Task[]> {
	return db.query.tasks.findMany({
		where: eq(tasks.done, false),
		orderBy: (t, { asc }) => [asc(t.sortOrder)]
	});
}

export async function updateTask(
	id: string,
	patch: Partial<{
		title: string;
		notes: string | null;
		dueDate: string | null;
		priority: 'low' | 'med' | 'high' | null;
	}>
): Promise<Task> {
	await db.update(tasks).set(patch).where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!updated) throw new Error(`Task ${id} not found`);
	return updated;
}

export async function updateTaskPosition(id: string, x: number, y: number): Promise<void> {
	await db.update(tasks).set({ x, y, sortOrder: await nextSortOrder() }).where(eq(tasks.id, id));
}

export async function toggleTaskDone(id: string): Promise<Task> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) throw new Error(`Task ${id} not found`);
	await db.update(tasks).set({ done: !existing.done }).where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	return updated!;
}

export async function deleteTask(id: string): Promise<void> {
	await db.delete(tasks).where(eq(tasks.id, id));
}
```

Note: `listAllActiveTasksWithTopics` and `moveTask` are intentionally removed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/server/tasks/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tasks/service.ts src/lib/server/tasks/service.test.ts
git commit -m "feat: standalone-task service with positions, drop topic coupling"
```

---

### Task 6: Notifications + scheduler decoupled from topics

**Files:**
- Modify: `src/lib/server/notifications/digest.ts:1-7`
- Modify: `src/lib/server/notifications/digest.test.ts:9-11`
- Modify: `src/lib/server/scheduler/index.ts:5,30,41`

**Interfaces:**
- Consumes: `listActiveTasks()` (Task 5).

- [ ] **Step 1: Update the failing test**

In `src/lib/server/notifications/digest.test.ts`, remove `topicName` from the three fixture objects (lines ~9-11) so they read:

```ts
			const tasks = [
				{ id: '1', title: 'Overdue thing', dueDate: '2026-07-17', done: false },
				{ id: '2', title: 'Due today thing', dueDate: '2026-07-18', done: false },
				{ id: '3', title: 'No due date', dueDate: null, done: false }
			];
```

- [ ] **Step 2: Run the test to confirm the type gap**

Run: `npm run check`
Expected: `digest.ts` still declares `topicName` in `DigestTask`; the test now omits it. (Vitest itself passes since types aren't enforced at runtime — the fix is for `check`.)

- [ ] **Step 3: Drop `topicName` from the digest interface**

In `src/lib/server/notifications/digest.ts`, change the `DigestTask` interface to:

```ts
export interface DigestTask {
	id: string;
	title: string;
	dueDate: string | null;
	done: boolean;
}
```

- [ ] **Step 4: Point the scheduler at `listActiveTasks`**

In `src/lib/server/scheduler/index.ts`:
- Line ~5: change the import to `import { listActiveTasks } from '../tasks/service';`
- Lines ~30 and ~41: replace `await listAllActiveTasksWithTopics()` with `await listActiveTasks()`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- src/lib/server/notifications/digest.test.ts && npm run check`
Expected: digest test PASS; no `check` errors referencing `topicName` or `listAllActiveTasksWithTopics`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/notifications/digest.ts src/lib/server/notifications/digest.test.ts src/lib/server/scheduler/index.ts
git commit -m "fix: loose tasks now included in digest and due-alerts"
```

---

### Task 7: Server load, actions, and position endpoint

**Files:**
- Modify: `src/routes/(app)/+page.server.ts` (full rewrite)
- Create: `src/routes/api/positions/+server.ts`

**Interfaces:**
- Consumes: zones service (Task 4), tasks service (Task 5).
- Produces: `load` returns `{ tasks: Task[]; zones: Zone[] }`. Actions: `createTask`, `updateTask`, `toggleTaskDone`, `deleteTask`, `createZone`, `renameZone`, `deleteZone`. Endpoint: `POST /api/positions`.

- [ ] **Step 1: Rewrite `+page.server.ts`**

Replace the entire contents of `src/routes/(app)/+page.server.ts` with:

```ts
import type { PageServerLoad, Actions } from './$types';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import * as zonesService from '$lib/server/zones/service';
import * as tasksService from '$lib/server/tasks/service';

export const load: PageServerLoad = async () => {
	const [tasks, zones] = await Promise.all([tasksService.listTasks(), zonesService.listZones()]);
	return { tasks, zones };
};

const newTaskSchema = z.object({
	title: z.string().min(1),
	dueDate: z.string().optional(),
	priority: z.enum(['low', 'med', 'high']).optional(),
	x: z.coerce.number().optional(),
	y: z.coerce.number().optional()
});

const zoneColor = z.enum(['sage', 'sky', 'butter', 'blush', 'lilac', 'clay']);

export const actions: Actions = {
	createTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newTaskSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Invalid task' });
		await tasksService.createTask({
			title: parsed.data.title,
			dueDate: parsed.data.dueDate || undefined,
			priority: parsed.data.priority,
			x: parsed.data.x,
			y: parsed.data.y
		});
	},

	updateTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		await tasksService.updateTask(String(data.id), {
			title: data.title ? String(data.title) : undefined,
			notes: data.notes ? String(data.notes) : null,
			dueDate: data.dueDate ? String(data.dueDate) : null,
			priority: (data.priority as 'low' | 'med' | 'high') || null
		});
	},

	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		await tasksService.toggleTaskDone(String(data.get('id')));
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		await tasksService.deleteTask(String(data.get('id')));
	},

	createZone: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const name = String(data.name ?? '').trim();
		if (!name) return fail(400, { error: 'Name required' });
		const color = zoneColor.safeParse(data.color);
		await zonesService.createZone({
			name,
			color: color.success ? color.data : undefined,
			x: data.x ? Number(data.x) : undefined,
			y: data.y ? Number(data.y) : undefined
		});
	},

	renameZone: async ({ request }) => {
		const data = await request.formData();
		await zonesService.renameZone(String(data.get('id')), String(data.get('name')));
	},

	deleteZone: async ({ request }) => {
		const data = await request.formData();
		await zonesService.deleteZone(String(data.get('id')));
	}
};
```

- [ ] **Step 2: Create the position endpoint**

Create `src/routes/api/positions/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';

interface PositionBody {
	kind: 'task' | 'zone';
	id: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as PositionBody;
	if (!body?.id || typeof body.x !== 'number' || typeof body.y !== 'number') {
		throw error(400, 'x, y and id are required');
	}
	if (body.kind === 'task') {
		await tasksService.updateTaskPosition(body.id, Math.round(body.x), Math.round(body.y));
	} else if (body.kind === 'zone') {
		await zonesService.updateZoneGeometry(body.id, {
			x: Math.round(body.x),
			y: Math.round(body.y),
			width: Math.round(body.width ?? 320),
			height: Math.round(body.height ?? 320)
		});
	} else {
		throw error(400, 'kind must be task or zone');
	}
	return json({ ok: true });
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors in `+page.server.ts` or the endpoint. (Board/Column are still referenced by `+page.svelte` — those errors are expected until Task 10 and are acceptable at this checkpoint.)

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(app)/+page.server.ts" src/routes/api/positions/+server.ts
git commit -m "feat: flat task/zone load, zone actions, drag-position endpoint"
```

---

### Task 8: TaskCard + creation affordance

**Files:**
- Modify: `src/lib/components/TaskCard.svelte` (remove move form; make draggable-friendly)
- Modify: `src/lib/components/TaskDetailModal.svelte` (no logic change; confirm it still compiles)
- Create: `src/lib/components/AddTaskForm.svelte` (title + optional due date + priority)

**Interfaces:**
- Consumes: `createTask` action (Task 7), `TaskDetailModal`.
- Produces: `AddTaskForm` with props `{ x?: number; y?: number }` posting to `?/createTask`. `TaskCard` with prop `task: { id; title; done; priority; dueDate }` and no internal up/down move UI.

- [ ] **Step 1: Rewrite `TaskCard.svelte` without the move form**

Replace `src/lib/components/TaskCard.svelte` with:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskDetailModal from './TaskDetailModal.svelte';

	let { task }: {
		task: { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null };
	} = $props();

	let showModal = $state(false);
	let today = new Date().toISOString().slice(0, 10);
	let overdue = $derived(!!task.dueDate && task.dueDate < today && !task.done);
</script>

<div class="card" class:done={task.done}>
	<div class="row-main">
		<form method="POST" action="?/toggleTaskDone" use:enhance>
			<input type="hidden" name="id" value={task.id} />
			<button class="done-toggle" class:checked={task.done} type="submit" aria-label="Toggle done">
				{#if task.done}✓{/if}
			</button>
		</form>
		<button class="title" type="button" onclick={() => (showModal = true)}>{task.title}</button>
	</div>

	{#if task.priority || task.dueDate}
		<div class="row-meta">
			{#if task.priority}
				<span class="pill pill-{task.priority}">
					{task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low'}
				</span>
			{/if}
			{#if task.dueDate}
				<span class="chip-due" class:overdue>{task.dueDate}</span>
			{/if}
		</div>
	{/if}
</div>

{#if showModal}
	<TaskDetailModal {task} onclose={() => (showModal = false)} />
{/if}

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.5rem 0.6rem;
		box-shadow: var(--shadow-card);
	}
	.row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.done-toggle {
		flex-shrink: 0;
		width: 1.05rem;
		height: 1.05rem;
		border: 1.5px solid var(--border-strong);
		border-radius: 50%;
		background: transparent;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}
	.done-toggle.checked {
		color: var(--ok);
		border-color: var(--ok);
	}
	.title {
		flex: 1;
		text-align: left;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		color: inherit;
	}
	.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}
	.row-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
</style>
```

- [ ] **Step 2: Create `AddTaskForm.svelte`**

Create `src/lib/components/AddTaskForm.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	let { x = 60, y = 60 }: { x?: number; y?: number } = $props();
	let open = $state(false);
</script>

<form class="add" method="POST" action="?/createTask" use:enhance={() => async ({ update }) => { await update(); open = false; }}>
	<input type="hidden" name="x" value={x} />
	<input type="hidden" name="y" value={y} />
	<div class="row">
		<input name="title" placeholder="Add something to the table…" required
			onfocus={() => (open = true)} />
		<button class="btn btn-primary" type="submit">Add</button>
	</div>
	{#if open}
		<div class="extra">
			<label><span>Due</span><input type="date" name="dueDate" /></label>
			<label><span>Priority</span>
				<select name="priority">
					<option value="">None</option>
					<option value="low">Low</option>
					<option value="med">Medium</option>
					<option value="high">High</option>
				</select>
			</label>
		</div>
	{/if}
</form>

<style>
	.add { display: flex; flex-direction: column; gap: 0.5rem; }
	.row { display: flex; gap: 0.5rem; }
	.row input { flex: 1; }
	.extra { display: flex; gap: 0.75rem; }
	.extra label { display: flex; flex-direction: column; gap: 0.2rem; }
	.extra span { font-size: 0.72rem; color: var(--muted); }
</style>
```

- [ ] **Step 3: Typecheck the components**

Run: `npm run check`
Expected: no errors in `TaskCard.svelte`, `AddTaskForm.svelte`, `TaskDetailModal.svelte`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/TaskCard.svelte src/lib/components/AddTaskForm.svelte
git commit -m "feat: simplify task card, add creation form with due/priority"
```

---

### Task 9: Desktop drag canvas

**Files:**
- Create: `src/lib/components/TableCanvas.svelte`

**Interfaces:**
- Consumes: `TaskCard`, `AddTaskForm`, `zoneForTask`/`taskCenter`/`ZONE_COLORS` (Task 2), `/api/positions` (Task 7), `?/createZone`, `?/renameZone`, `?/deleteZone`.
- Produces: `TableCanvas` with props `{ tasks: Task[]; zones: Zone[] }`.

- [ ] **Step 1: Create `TableCanvas.svelte`**

Create `src/lib/components/TableCanvas.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { ZONE_COLORS, type ZoneColor } from '$lib/zones';

	type Task = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; x: number; y: number; sortOrder: number };
	type Zone = { id: string; name: string; color: string; x: number; y: number; width: number; height: number };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	// Local mutable copies so drags feel instant before the server round-trip.
	let taskPos = $state(new Map(tasks.map((t) => [t.id, { x: t.x, y: t.y }])));
	let zonePos = $state(new Map(zones.map((z) => [z.id, { x: z.x, y: z.y, width: z.width, height: z.height }])));

	function colorOf(key: string) {
		return ZONE_COLORS[(key as ZoneColor)] ?? ZONE_COLORS.sage;
	}

	async function persist(kind: 'task' | 'zone', id: string, x: number, y: number, width?: number, height?: number) {
		await fetch('/api/positions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, id, x, y, width, height })
		});
	}

	function startDrag(e: PointerEvent, kind: 'task' | 'zone', id: string) {
		if ((e.target as HTMLElement).closest('button, input, select, a, form')) return;
		e.preventDefault();
		const store = kind === 'task' ? taskPos : zonePos;
		const start = store.get(id)!;
		const originX = e.clientX;
		const originY = e.clientY;
		const baseX = start.x;
		const baseY = start.y;

		function move(ev: PointerEvent) {
			const nx = Math.max(0, baseX + (ev.clientX - originX));
			const ny = Math.max(0, baseY + (ev.clientY - originY));
			store.set(id, { ...store.get(id)!, x: nx, y: ny });
		}
		function up() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const final = store.get(id)!;
			persist(kind, id, final.x, final.y, (final as any).width, (final as any).height);
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

<div class="toolbar">
	<AddTaskForm />
	<form method="POST" action="?/createZone" use:enhance style="display:flex; gap:0.5rem;">
		<input name="name" placeholder="New zone name" required />
		<button class="btn" type="submit">Add zone</button>
	</form>
</div>

<div class="canvas">
	{#each zones as zone (zone.id)}
		{@const p = zonePos.get(zone.id)!}
		{@const c = colorOf(zone.color)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="zone" style="left:{p.x}px; top:{p.y}px; width:{p.width}px; height:{p.height}px; background:{c.fill}; border-color:{c.border};"
			onpointerdown={(e) => startDrag(e, 'zone', zone.id)}>
			<div class="zone-head">
				<span class="zone-name">{zone.name}</span>
				<form method="POST" action="?/deleteZone" use:enhance>
					<input type="hidden" name="id" value={zone.id} />
					<button class="btn btn-ghost btn-icon" type="submit" aria-label="Delete zone">×</button>
				</form>
			</div>
		</div>
	{/each}

	{#each tasks as task (task.id)}
		{@const p = taskPos.get(task.id)!}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="floating" style="left:{p.x}px; top:{p.y}px; z-index:{task.sortOrder};"
			onpointerdown={(e) => startDrag(e, 'task', task.id)}>
			<TaskCard {task} />
		</div>
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	.canvas {
		position: relative;
		min-height: 70vh;
		width: 100%;
		overflow: auto;
	}
	.zone {
		position: absolute;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.5rem;
		cursor: grab;
	}
	.zone-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.zone-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
	}
	.floating {
		position: absolute;
		width: 220px;
		cursor: grab;
		touch-action: none;
	}
	.floating:active {
		cursor: grabbing;
	}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: no errors in `TableCanvas.svelte`.

- [ ] **Step 3: Manual drag verification**

Run: `npm run dev`, log in (dev magic-link token prints to console), then on a desktop-width window: add a task, drag it, reload — it stays put. Add a zone, drag a task inside it. Confirm no console errors and the POST to `/api/positions` returns 200 (Network tab).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/TableCanvas.svelte
git commit -m "feat: desktop freeform drag canvas with zones"
```

---

### Task 10: Mobile columns + page wiring + cleanup

**Files:**
- Create: `src/lib/components/MobileColumns.svelte`
- Modify: `src/routes/(app)/+page.svelte`
- Delete: `src/lib/components/Board.svelte`, `src/lib/components/Column.svelte`

**Interfaces:**
- Consumes: `zoneForTask`/`taskCenter` (Task 2), `TaskCard`, `AddTaskForm`, `TableCanvas` (Task 9).

- [ ] **Step 1: Create `MobileColumns.svelte`**

Create `src/lib/components/MobileColumns.svelte`:

```svelte
<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { zoneForTask, taskCenter, type ZoneBounds } from '$lib/zones';

	type Task = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; x: number; y: number };
	type Zone = ZoneBounds & { name: string };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	function tasksIn(zoneId: string | null) {
		return tasks.filter((t) => (zoneForTask(taskCenter(t), zones)?.id ?? null) === zoneId);
	}
</script>

<AddTaskForm />

<div class="col">
	<h2>On the table</h2>
	{#each tasksIn(null) as task (task.id)}<TaskCard {task} />{/each}
</div>

{#each zones as zone (zone.id)}
	<div class="col">
		<h2>{zone.name}</h2>
		{#each tasksIn(zone.id) as task (task.id)}<TaskCard {task} />{/each}
	</div>
{/each}

<style>
	.col { margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.col h2 { font-size: 1.05rem; margin-bottom: 0.3rem; }
</style>
```

- [ ] **Step 2: Rewrite `+page.svelte` to switch views by width**

Replace `src/routes/(app)/+page.svelte` with:

```svelte
<script lang="ts">
	import TableCanvas from '$lib/components/TableCanvas.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import { subscribeToPush } from '$lib/client/push';
	import { env } from '$env/dynamic/public';
	let { data } = $props();

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 720px)');
		const apply = () => (isMobile = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	async function enableNotifications() {
		try {
			await subscribeToPush(env.PUBLIC_VAPID_PUBLIC_KEY ?? '');
			alert('Notifications enabled.');
		} catch (err) {
			alert(`Could not enable notifications: ${(err as Error).message}`);
		}
	}
</script>

<div class="toolbar">
	<h1>On the table</h1>
	<button class="btn btn-ghost" onclick={enableNotifications}>Enable notifications</button>
</div>

{#if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<TableCanvas tasks={data.tasks} zones={data.zones} />
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}
	.toolbar h1 {
		font-size: 1.4rem;
	}
</style>
```

- [ ] **Step 3: Delete the obsolete board components**

```bash
git rm src/lib/components/Board.svelte src/lib/components/Column.svelte
```

- [ ] **Step 4: Full typecheck and build**

Run: `npm run check && npm run build`
Expected: both succeed with no errors (no dangling references to Board, Column, topics, `tasksByTopic`, or `topicName`).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (zones, tasks, zones-membership, digest, due-alerts, tokens).

- [ ] **Step 6: Manual verification (both widths)**

Run: `npm run dev`. Desktop: drag works, zones categorize by position. Narrow the window < 720px: view switches to columns ("On the table" + one per zone); adding a task and toggling done work. No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/MobileColumns.svelte "src/routes/(app)/+page.svelte"
git commit -m "feat: mobile columns view and responsive page wiring; remove board"
```

---

## Self-Review Notes

- **Spec coverage:** data model (T3), geometric membership (T2), zones service (T4), standalone tasks + positions (T5), notifications fix for loose tasks (T6), load/actions/endpoint (T7), creation affordance with due/priority (T8), desktop drag (T9), mobile columns + warm light theme (T1, T10). All spec sections map to a task.
- **Type consistency:** `zoneForTask(point, zones)` and `taskCenter(task)` used identically in T9/T10; `updateTaskPosition(id, x, y)` signature matches endpoint call in T7; `ZoneColor` enum shared by zones service (T4), page action (T7), and canvas (T9).
- **Migration caveat:** T3 Step 3 depends on drizzle-kit's generated SQL shape; the implementer must read the generated file and place the backfill relative to the actual DROP/ADD statements. This is called out explicitly in that step.
