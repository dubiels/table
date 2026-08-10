# Bento Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Bento view" to the toolbar view switcher that tiles every category into a squarified-treemap grid, box area proportional to task count.

**Architecture:** A new pure module `src/lib/bento.ts` provides grouping (`groupTasksByZone`) and layout (`computeTreemap`) plus two task-creation helper points (`zoneCenterPoint`, `findUncategorizedPoint`), all following the existing `zones.ts`/`listView.ts` pure-function convention. A new `BentoView.svelte` component consumes that module and reuses the existing `TaskCard`/`AddTaskForm`/`TaskDetailModal` components unchanged. `+page.svelte` gets a third view-switcher option.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Vitest, existing `zoneForTask`/`taskCenter` spatial model from `src/lib/zones.ts`.

## Global Constraints

- Client-side only: plain `$state`/`$derived`, no persistence, resets to Blob view on reload. (spec: Vision)
- No backend/schema changes — reuse `+page.server.ts`'s existing `load` and the existing `?/createTask` action untouched. (spec: Data model)
- Weight per box: `max(taskCount, 1)` — empty categories still render at a visible minimum. (spec: Chosen approach)
- Box order is not zone-creation order — the treemap sorts by weight internally; this is intentional. (spec: Chosen approach)
- Uncategorized is a synthetic entry with no `ZoneColor`; it renders with `var(--surface)`/`var(--border)`, not a `ZONE_COLORS` swatch. (spec: Grouping / Uncategorized)
- Every zone always gets a box, even with zero active tasks. (spec: Grouping / Uncategorized)
- No `zoneColor` dot passed to `TaskCard` inside a bento box (redundant with the box's own background). (spec: Box contents)
- No self-testing in dev server/browser — this project's convention is manual verification steps handed to the user instead.

---

### Task 1: `src/lib/bento.ts` — pure grouping + treemap + task-placement helpers

**Files:**
- Create: `src/lib/bento.ts`
- Test: `src/lib/bento.test.ts`

**Interfaces:**
- Consumes: `Point`, `ZoneBounds`, `zoneForTask`, `taskCenter`, `DEFAULT_CARD` from `src/lib/zones.ts` (all already exist, see `src/lib/zones.ts:1-51`).
- Produces (used by Task 2):
  - `export const UNCATEGORIZED_ID = 'uncategorized'`
  - `export type BentoTask = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; notes: string | null; x: number; y: number }`
  - `export type BentoZone = ZoneBounds & { name: string; color: string }`
  - `export interface BentoGroup { id: string; name: string; color: string | null; tasks: BentoTask[]; weight: number }`
  - `export interface TreemapItem { id: string; weight: number }`
  - `export interface TreemapRect { id: string; x: number; y: number; width: number; height: number }`
  - `export function groupTasksByZone(tasks: BentoTask[], zones: BentoZone[]): BentoGroup[]`
  - `export function computeTreemap(items: TreemapItem[], width: number, height: number): TreemapRect[]`
  - `export function zoneCenterPoint(zone: ZoneBounds): Point`
  - `export function findUncategorizedPoint(zones: ZoneBounds[]): Point`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/bento.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
	groupTasksByZone,
	computeTreemap,
	zoneCenterPoint,
	findUncategorizedPoint,
	UNCATEGORIZED_ID,
	type BentoTask,
	type BentoZone
} from './bento';
import { taskCenter, zoneForTask, type ZoneBounds } from './zones';

function task(overrides: Partial<BentoTask> & { id: string }): BentoTask {
	return {
		title: 'Untitled',
		done: false,
		priority: null,
		dueDate: null,
		notes: null,
		x: -1000,
		y: -1000,
		...overrides
	};
}

const work: BentoZone = { id: 'work', name: 'Work', color: 'sky', x: 0, y: 0, width: 400, height: 400 };
const home: BentoZone = { id: 'home', name: 'Home', color: 'blush', x: 500, y: 0, width: 200, height: 200 };

describe('groupTasksByZone', () => {
	it('buckets tasks into their owning zone, matching zoneForTask/taskCenter', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const inHome = task({ id: '2', x: 550, y: 50 });
		const loose = task({ id: '3', x: -1000, y: -1000 });
		const groups = groupTasksByZone([inWork, inHome, loose], [work, home]);

		expect(groups).toHaveLength(3); // work, home, uncategorized
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
		expect(byId.work.tasks.map((t) => t.id)).toEqual(['1']);
		expect(byId.home.tasks.map((t) => t.id)).toEqual(['2']);
		expect(byId[UNCATEGORIZED_ID].tasks.map((t) => t.id)).toEqual(['3']);
		expect(byId[UNCATEGORIZED_ID].name).toBe('Uncategorized');
		expect(byId[UNCATEGORIZED_ID].color).toBeNull();
	});

	it('always includes every zone, even with zero tasks, at weight 1', () => {
		const groups = groupTasksByZone([], [work, home]);
		const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
		expect(byId.work.tasks).toEqual([]);
		expect(byId.work.weight).toBe(1);
		expect(byId[UNCATEGORIZED_ID].weight).toBe(1);
	});

	it('weight is max(taskCount, 1)', () => {
		const tasks = [1, 2, 3].map((n) => task({ id: String(n), x: 100, y: 100 }));
		const groups = groupTasksByZone(tasks, [work]);
		expect(groups.find((g) => g.id === 'work')?.weight).toBe(3);
	});
});

describe('computeTreemap', () => {
	it('produces one rect per item, all with positive area, inside the container bounds', () => {
		const items = [
			{ id: 'a', weight: 5 },
			{ id: 'b', weight: 3 },
			{ id: 'c', weight: 1 },
			{ id: 'd', weight: 1 } // empty-category minimum weight
		];
		const rects = computeTreemap(items, 800, 600);
		expect(rects).toHaveLength(4);
		for (const r of rects) {
			expect(r.width).toBeGreaterThan(0);
			expect(r.height).toBeGreaterThan(0);
			expect(r.x).toBeGreaterThanOrEqual(-0.01);
			expect(r.y).toBeGreaterThanOrEqual(-0.01);
			expect(r.x + r.width).toBeLessThanOrEqual(800.01);
			expect(r.y + r.height).toBeLessThanOrEqual(600.01);
		}
	});

	it('tiles the full container with no gaps/overlaps (areas sum to the container area)', () => {
		const items = [
			{ id: 'a', weight: 10 },
			{ id: 'b', weight: 6 },
			{ id: 'c', weight: 4 },
			{ id: 'd', weight: 2 },
			{ id: 'e', weight: 1 }
		];
		const width = 1000;
		const height = 500;
		const rects = computeTreemap(items, width, height);
		const summedArea = rects.reduce((sum, r) => sum + r.width * r.height, 0);
		expect(summedArea).toBeCloseTo(width * height, 0);
	});

	it('sizes each box area proportional to its weight', () => {
		const items = [
			{ id: 'big', weight: 9 },
			{ id: 'small', weight: 1 }
		];
		const rects = computeTreemap(items, 1000, 100);
		const totalArea = 1000 * 100;
		const totalWeight = 10;
		const byId = Object.fromEntries(rects.map((r) => [r.id, r]));
		expect(byId.big.width * byId.big.height).toBeCloseTo(totalArea * (9 / totalWeight), 0);
		expect(byId.small.width * byId.small.height).toBeCloseTo(totalArea * (1 / totalWeight), 0);
	});

	it('returns an empty array for zero items or a zero-sized container', () => {
		expect(computeTreemap([], 800, 600)).toEqual([]);
		expect(computeTreemap([{ id: 'a', weight: 1 }], 0, 0)).toEqual([]);
	});
});

describe('zoneCenterPoint', () => {
	it("returns a top-left point whose taskCenter is the zone's geometric center", () => {
		const zone: ZoneBounds = { id: 'z', x: 100, y: 200, width: 300, height: 150 };
		const point = zoneCenterPoint(zone);
		const center = taskCenter(point);
		expect(center.x).toBeCloseTo(100 + 150);
		expect(center.y).toBeCloseTo(200 + 75);
		expect(zoneForTask(center, [zone])?.id).toBe('z');
	});
});

describe('findUncategorizedPoint', () => {
	it("returns a point whose taskCenter is outside every given zone", () => {
		const zones: ZoneBounds[] = [work, home];
		const point = findUncategorizedPoint(zones);
		expect(zoneForTask(taskCenter(point), zones)).toBeNull();
	});

	it('handles no zones at all', () => {
		const point = findUncategorizedPoint([]);
		expect(zoneForTask(taskCenter(point), [])).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/lib/bento.test.ts`
Expected: FAIL — `Cannot find module './bento'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/bento.ts`:

```ts
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
	weight: number;
}

export function groupTasksByZone(tasks: BentoTask[], zones: BentoZone[]): BentoGroup[] {
	const byZone = new Map<string, BentoTask[]>(zones.map((z) => [z.id, []]));
	const uncategorized: BentoTask[] = [];

	for (const task of tasks) {
		const hit = zoneForTask(taskCenter(task), zones);
		if (hit) byZone.get(hit.id)!.push(task);
		else uncategorized.push(task);
	}

	const groups: BentoGroup[] = zones.map((zone) => {
		const zoneTasks = byZone.get(zone.id) ?? [];
		return {
			id: zone.id,
			name: zone.name,
			color: zone.color,
			tasks: zoneTasks,
			weight: Math.max(zoneTasks.length, 1)
		};
	});

	groups.push({
		id: UNCATEGORIZED_ID,
		name: 'Uncategorized',
		color: null,
		tasks: uncategorized,
		weight: Math.max(uncategorized.length, 1)
	});

	return groups;
}

export interface TreemapItem {
	id: string;
	weight: number;
}

export interface TreemapRect {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Squarified treemap (Bruls/Huizing/van Wijk): recursively lays out rows
 * along the container's current shorter edge, choosing each row's break
 * point to keep box aspect ratios as close to square as possible.
 */
export function computeTreemap(items: TreemapItem[], width: number, height: number): TreemapRect[] {
	if (items.length === 0 || width <= 0 || height <= 0) return [];

	const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
	const totalArea = width * height;
	const sorted = [...items].sort((a, b) => b.weight - a.weight);

	const rects: TreemapRect[] = [];
	let container: Rect = { x: 0, y: 0, width, height };
	let remaining = sorted;

	while (remaining.length > 0) {
		const shortSide = Math.min(container.width, container.height);
		let row: TreemapItem[] = [remaining[0]];
		let rest = remaining.slice(1);

		while (rest.length > 0) {
			const candidate = [...row, rest[0]];
			const current = worstRatio(row, shortSide, totalWeight, totalArea);
			const next = worstRatio(candidate, shortSide, totalWeight, totalArea);
			if (next <= current) {
				row = candidate;
				rest = rest.slice(1);
			} else {
				break;
			}
		}

		container = layoutRow(row, container, totalWeight, totalArea, rects);
		remaining = rest;
	}

	return rects;
}

function worstRatio(
	row: TreemapItem[],
	shortSide: number,
	totalWeight: number,
	totalArea: number
): number {
	const areas = row.map((item) => (item.weight / totalWeight) * totalArea);
	const rowArea = areas.reduce((sum, a) => sum + a, 0);
	const thickness = rowArea / shortSide;
	let worst = 1;
	for (const area of areas) {
		const extent = area / thickness;
		const ratio = Math.max(thickness / extent, extent / thickness);
		if (ratio > worst) worst = ratio;
	}
	return worst;
}

/** Places `row` as a strip along the container's current shorter edge, returns the remaining container. */
function layoutRow(
	row: TreemapItem[],
	container: Rect,
	totalWeight: number,
	totalArea: number,
	rects: TreemapRect[]
): Rect {
	const areas = row.map((item) => (item.weight / totalWeight) * totalArea);
	const rowArea = areas.reduce((sum, a) => sum + a, 0);
	const shortSide = Math.min(container.width, container.height);
	const thickness = rowArea / shortSide;
	const horizontal = container.width <= container.height; // strip spans full width, stacks items left-to-right

	let offset = 0;
	for (let i = 0; i < row.length; i++) {
		const extent = areas[i] / thickness;
		if (horizontal) {
			rects.push({ id: row[i].id, x: container.x + offset, y: container.y, width: extent, height: thickness });
		} else {
			rects.push({ id: row[i].id, x: container.x, y: container.y + offset, width: thickness, height: extent });
		}
		offset += extent;
	}

	return horizontal
		? { x: container.x, y: container.y + thickness, width: container.width, height: container.height - thickness }
		: { x: container.x + thickness, y: container.y, width: container.width - thickness, height: container.height };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/lib/bento.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bento.ts src/lib/bento.test.ts
git commit -m "feat: add bento treemap grouping/layout pure functions"
```

---

### Task 2: `src/lib/components/BentoView.svelte` — the tiled grid

**Files:**
- Create: `src/lib/components/BentoView.svelte`

**Interfaces:**
- Consumes from Task 1 (`src/lib/bento.ts`): `groupTasksByZone`, `computeTreemap`, `zoneCenterPoint`, `findUncategorizedPoint`, `UNCATEGORIZED_ID`, `BentoTask`, `BentoZone`, `TreemapRect`.
- Consumes from `src/lib/zones.ts`: `ZONE_COLORS`, `ZoneColor`.
- Reuses unchanged: `TaskCard.svelte` (props: `task`, `zoneColor?`, `onclick?` — see `src/lib/components/TaskCard.svelte:4-18`), `AddTaskForm.svelte` (props: `x?`, `y?` — see `src/lib/components/AddTaskForm.svelte:3`), `TaskDetailModal.svelte` (props: `task`, `onclose` — see `src/lib/components/TaskDetailModal.svelte:4-16`).
- Produces (used by Task 3): a Svelte component with props `{ tasks: BentoTask[]; zones: BentoZone[] }`, same shape as `BlobView`/`ListView`/`MobileColumns`.

- [ ] **Step 1: Write the component**

Create `src/lib/components/BentoView.svelte`:

```svelte
<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import {
		groupTasksByZone,
		computeTreemap,
		zoneCenterPoint,
		findUncategorizedPoint,
		UNCATEGORIZED_ID,
		type BentoTask,
		type BentoZone
	} from '$lib/bento';
	import { ZONE_COLORS, type ZoneColor } from '$lib/zones';

	let { tasks, zones }: { tasks: BentoTask[]; zones: BentoZone[] } = $props();

	let containerWidth = $state(0);
	let containerHeight = $state(0);

	const GUTTER = 8;

	let groups = $derived(groupTasksByZone(tasks, zones));
	let rects = $derived(
		containerWidth > 0 && containerHeight > 0
			? computeTreemap(
					groups.map((g) => ({ id: g.id, weight: g.weight })),
					containerWidth,
					containerHeight
				)
			: []
	);

	function rectFor(id: string) {
		return rects.find((r) => r.id === id) ?? null;
	}

	function colorOf(color: string | null) {
		return color ? (ZONE_COLORS[color as ZoneColor] ?? ZONE_COLORS.sage) : null;
	}

	function addPointFor(groupId: string) {
		if (groupId === UNCATEGORIZED_ID) return findUncategorizedPoint(zones);
		const zone = zones.find((z) => z.id === groupId);
		return zone ? zoneCenterPoint(zone) : findUncategorizedPoint(zones);
	}

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);
</script>

<div class="bento" bind:clientWidth={containerWidth} bind:clientHeight={containerHeight}>
	{#each groups as group (group.id)}
		{@const rect = rectFor(group.id)}
		{#if rect}
			{@const c = colorOf(group.color)}
			{@const point = addPointFor(group.id)}
			<div
				class="box"
				style="left:{rect.x + GUTTER}px; top:{rect.y + GUTTER}px; width:{rect.width -
					GUTTER * 2}px; height:{rect.height - GUTTER * 2}px; background:{c?.fill ??
					'var(--surface)'}; border-color:{c?.border ?? 'var(--border)'};"
			>
				<div class="box-head">
					<span class="box-name">{group.name}</span>
					<span class="box-count">{group.tasks.length}</span>
				</div>
				<div class="box-body">
					{#if group.tasks.length === 0}
						<p class="empty">No tasks yet</p>
					{:else}
						{#each group.tasks as task (task.id)}
							<TaskCard {task} onclick={() => (openTaskId = task.id)} />
						{/each}
					{/if}
				</div>
				<div class="box-foot">
					<AddTaskForm x={point.x} y={point.y} />
				</div>
			</div>
		{/if}
	{/each}
</div>

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	.bento {
		position: relative;
		flex: 1;
		min-height: 0;
		width: 100%;
	}
	.box {
		position: absolute;
		display: flex;
		flex-direction: column;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.6rem;
		gap: 0.4rem;
		overflow: hidden;
		transition:
			left 200ms ease,
			top 200ms ease,
			width 200ms ease,
			height 200ms ease;
	}
	.box-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		font-family: var(--font-display);
		font-weight: 600;
	}
	.box-count {
		font-size: 0.78rem;
		color: var(--muted);
		font-weight: 500;
	}
	.box-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.empty {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
	.box-foot {
		flex-shrink: 0;
	}
</style>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: No errors in `BentoView.svelte` or `bento.ts` (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/BentoView.svelte
git commit -m "feat: add BentoView treemap grid component"
```

---

### Task 3: Wire Bento view into the toolbar switcher

**Files:**
- Modify: `src/routes/(app)/+page.svelte`

**Interfaces:**
- Consumes from Task 2: `BentoView.svelte` with props `{ tasks: BentoTask[]; zones: BentoZone[] }` (structurally compatible with `data.tasks`/`data.zones` — same fields `ListView`/`BlobView` already consume from `+page.server.ts`'s `load`).

- [ ] **Step 1: Add the import and widen the view type**

In `src/routes/(app)/+page.svelte`, change:

```svelte
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
```

to:

```svelte
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
```

and change:

```svelte
	let view = $state<'blob' | 'list'>('blob');
```

to:

```svelte
	let view = $state<'blob' | 'list' | 'bento'>('blob');
```

- [ ] **Step 2: Add the dropdown option**

Change:

```svelte
			<select class="btn btn-ghost view-select" bind:value={view}>
				<option value="blob">Blob view</option>
				<option value="list">List view</option>
			</select>
```

to:

```svelte
			<select class="btn btn-ghost view-select" bind:value={view}>
				<option value="blob">Blob view</option>
				<option value="list">List view</option>
				<option value="bento">Bento view</option>
			</select>
```

- [ ] **Step 3: Add the render branch**

Change:

```svelte
{#if view === 'list'}
	<ListView tasks={data.tasks} zones={data.zones} />
{:else if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<BlobView tasks={data.tasks} zones={data.zones} />
{/if}
```

to:

```svelte
{#if view === 'list'}
	<ListView tasks={data.tasks} zones={data.zones} />
{:else if view === 'bento'}
	<BentoView tasks={data.tasks} zones={data.zones} />
{:else if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<BlobView tasks={data.tasks} zones={data.zones} />
{/if}
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `npm run check && npm run test`
Expected: No type errors; all existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/\(app\)/+page.svelte
git commit -m "feat: add Bento view to the toolbar view switcher"
```

---

## Manual Verification (assistant does not self-test in dev server/browser)

After all three tasks land, hand these steps to the user:

1. `npm run dev`, open the app, switch the toolbar dropdown to "Bento view".
2. Confirm box sizes visibly track task counts (a category with more active tasks renders a visibly bigger tile).
3. Confirm every zone renders a box even with zero tasks, showing "No tasks yet" and a working "+ Add task" row.
4. Add a task from inside a bento box; confirm it appears in that same category in Blob and List view.
5. Confirm a loose (out-of-zone) task shows up in the "Uncategorized" box, and adding a task from Uncategorized's own "+ Add task" also lands as uncategorized elsewhere.
6. Resize the browser window and confirm the grid reflows smoothly (animated, not a snap).
7. Confirm the dropdown's three options (Blob/List/Bento) all still work switching back and forth.
