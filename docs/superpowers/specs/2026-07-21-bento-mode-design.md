# Table — Bento mode

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan

## Problem

Blob view shows category spatially (position on an infinite canvas) and List
view shows category as a flat filterable column, but neither gives a quick
"one tile per category, sized by how much is in it" overview. Bento mode adds
that: a tiled grid of category boxes that automatically size themselves to
how many tasks they hold.

## Vision

A third view, **Bento view**, selectable from the same toolbar dropdown that
already switches between Blob and List (`src/routes/(app)/+page.svelte`).
Selecting it shows every category as a "bento box" — a tile whose area is
proportional to how many active tasks it holds — tiled edge-to-edge (with a
small gutter) to fill the available screen. Tasks with no category get their
own "Uncategorized" box, an equal citizen in the grid rather than a special
side area.

Like List view, this is client-side only: plain `$state`, resets to Blob on
reload, no persistence, no new schema, no new server load logic. It reuses
the exact same `tasks`/`zones` data `+page.server.ts` already returns.

## Chosen approach: squarified treemap

Box area is proportional to task count (not a fixed grid of size tiers, not
uniform boxes). Using a plain "area ∝ count" layout without care produces
slivers for lopsided data (one huge category, several tiny ones), so the
layout uses a **squarified treemap** (Bruls/Huizing/van Wijk): given a list
of `{id, weight}` and a container width/height, it recursively lays out rows
along the shorter remaining edge, choosing row breaks that keep each box's
aspect ratio as close to square as possible. This is what actually delivers
"smart-sized, doesn't produce degenerate slivers" rather than just "area
proportional to count."

Weight per box: `max(taskCount, 1)` — so an empty category still renders at a
visible minimum-weight tile instead of disappearing or collapsing to nothing.
No separate min/max clamping beyond that; the squarified algorithm's
aspect-ratio optimization is what keeps tiles readable.

**Box order is not zone-creation order.** The treemap algorithm sorts items
descending by weight internally to produce good aspect ratios, so a
category's on-screen position shifts as task counts change — this is
intentional, matching "automatically resize/change shape and stack to fill
the screen."

Container size is read live via Svelte's `bind:clientWidth`/`clientHeight`
on the view's wrapper element. The full box layout is a `$derived` over
`(tasks, zones, containerWidth, containerHeight)`, so adding/completing/
deleting a task or resizing the window recomputes and reflows automatically
— no manual resize-event wiring beyond the `bind:` itself.

Rendered boxes are absolutely positioned within a `position: relative`
container at their computed `{x, y, width, height}` (px), inset by a small
fixed gutter (~8px) on each edge so tiles read as visually separated boxes
rather than an edge-to-edge grid. CSS `transition` on position/size gives the
reflow a smooth animated feel rather than a snap.

**Rejected alternatives:**
- *Grid with size tiers* (span 1/2/3 grid cells by count bucket) — simpler,
  but not truly proportional and was explicitly not what was asked for.
- *Uniform boxes that just wrap* — simplest, but not "smart-sized" at all.

## Grouping / Uncategorized

A new pure function `groupTasksByZone(tasks, zones)` (in the new
`src/lib/bento.ts`) produces one entry per real zone plus one synthetic
`Uncategorized` entry, using the existing `zoneForTask`/`taskCenter` spatial
logic — identical category derivation to Blob/List, so a task's category in
Bento always matches its category everywhere else.

Uncategorized has no `ZoneColor` (it isn't a real zone row), so its box uses
a neutral style — `var(--surface)` background, `var(--border)` outline —
instead of a swatch from `ZONE_COLORS`.

Per the empty-category decision: **every zone always gets a box**, even with
zero active tasks, at the algorithm's minimum weight, showing a muted
"No tasks yet" empty state alongside its "+ Add task" affordance.

## Box contents

Each box:
- Header: zone name + active task count.
- Background/border tinted from `ZONE_COLORS[zone.color]` (Uncategorized:
  neutral, as above).
- Body: a vertical, internally-scrollable list of the existing `TaskCard`
  component (same one `MobileColumns`/`ListView` already render) — clicking
  a card opens the existing `TaskDetailModal`, identical interaction to
  those views. No `zoneColor` dot passed to `TaskCard` (redundant — the box
  itself already conveys category via its background).
- Footer: the **existing `AddTaskForm` component, unchanged**, given a
  computed `x`/`y` (see below) so a task added from a box lands in the
  correct category via the same spatial model the rest of the app uses.

## Task creation — computing x/y per box

Tasks have no `zoneId` column; category is purely spatial
(`zoneForTask(taskCenter(task), zones)`). So "+ Add task" in a bento box must
submit an `(x, y)` that spatially lands in that box's category:

- **Real zone box:** a new `zoneCenterPoint(zone)` helper in `bento.ts`
  returns the top-left `(x, y)` whose `taskCenter` equals the zone's
  geometric center — trivially inside the zone's bounds (zones are
  axis-aligned rects with positive width/height).
- **Uncategorized box:** a new `findUncategorizedPoint(zones)` helper scans
  candidate points along a line (steps of 400px) until it finds one whose
  `taskCenter` isn't contained by any zone (checked via `zoneForTask`
  returning `null`), then converts back to the top-left `(x, y)` `AddTaskForm`
  expects. Falls back to a far-out point after a bounded number of
  candidates (25) in the pathological case of many zones — in practice never
  hit at realistic zone counts.

Both are pure and unit-testable. No backend changes: `?/createTask` already
accepts `x`/`y` exactly as Blob view's composer and `AddTaskForm` use them
today.

## Mobile behavior

Same precedent as List view: Bento is an explicit view choice that overrides
the `isMobile` → `MobileColumns` fallback in `+page.svelte`. At narrow
container widths the treemap naturally degenerates toward a single stacked
column since there's little width to split boxes side-by-side.

## Data model / backend changes

None. No schema changes, no new server load function, no new form actions.
Everything Bento mode needs (`tasks`, `zones`) is already returned by
`+page.server.ts`'s existing `load`, and task creation reuses the existing
`?/createTask` action untouched.

## New files

- `src/lib/bento.ts` + `src/lib/bento.test.ts` — `groupTasksByZone`,
  `computeTreemap`, `zoneCenterPoint`, `findUncategorizedPoint`. Pure,
  unit-tested, following the existing `zones.ts`/`listView.ts` convention.
- `src/lib/components/BentoView.svelte` — renders the treemap grid; reuses
  `TaskCard`, `AddTaskForm`, `TaskDetailModal` unchanged. Takes
  `tasks`/`zones` props, same shape as `BlobView`/`ListView`/`MobileColumns`.

## Changed files

- `src/routes/(app)/+page.svelte` — `view` state type becomes
  `'blob' | 'list' | 'bento'`; dropdown gets a third `<option value="bento">
  Bento view</option>`; render branch adds the `BentoView` case, evaluated
  before the `isMobile` branch (same as List view).

## Testing

Unit tests for the new pure functions in `bento.test.ts`:
- `groupTasksByZone` — correct bucketing including the Uncategorized case,
  matches `zoneForTask`/`taskCenter` semantics.
- `computeTreemap` — output rects exactly tile the input width/height with
  no gaps/overlaps, areas proportional to weights, empty-weight-1 items still
  produce a positive-area rect.
- `zoneCenterPoint` — returned point's `taskCenter` falls inside the zone's
  bounds.
- `findUncategorizedPoint` — returned point's `taskCenter` is outside every
  given zone.

Manual verification (per project convention, no self-testing in dev
server/browser by the assistant): confirm box sizes visibly track task
counts, empty-category boxes render correctly, adding a task from a box
files it into that same category in Blob/List view, Uncategorized catches
loose tasks, window resize reflows smoothly, and the dropdown's new option
works alongside the existing two.
