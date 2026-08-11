# Table — Creating and clearing categories from bento mode

**Date:** 2026-08-11
**Status:** Approved (design)

## Problem

Bento mode can move a task between categories by dragging its card
(`feat(bento): drag cards between boxes to recategorize them`), but it cannot
do the two things either side of that move:

1. **Create a category.** Zones can only be made on the canvas, by clustering
   cards or by the click-to-place composer. A user working in bento has to
   switch views to add a box.
2. **Take a category off a task.** The drag path can do this in principle —
   dropping on the "Uncategorized" box moves a task out of every zone — but
   that box only renders when something is already loose or when no zones
   exist at all (`groupTasksByZone`). On the common board, every task
   categorized, there is no target to drop onto and no other control.

## Constraint that shapes everything

A category is a **zone**: a rectangle on the canvas. Bento boxes are derived
from that geometry, not from a field on the task. So "create a category" means
"create a rectangle somewhere sensible on a canvas the user cannot see", and
"remove a task's category" means "move the task to a point inside no zone".
`dropPointFor` already states this; both features are geometry problems wearing
UI clothes.

## Design

### 1. Geometry: `nextFreeZoneRect`

A new pure function in `src/lib/bento.ts`:

```ts
nextFreeZoneRect(zones: ZoneBounds[]): { x, y, width, height }
```

It walks a grid of `NEW_ZONE_SIZE` (320×320, matching `createZone`'s defaults)
plus a gap, row by row from the canvas origin, and returns the first cell that
intersects no existing zone. Bento-created zones therefore tile in beside what
is already on the canvas instead of stacking on one default spot — which
matters beyond tidiness, because overlapping zones change which box a task
resolves into (`zoneForTask` picks the smallest containing zone).

The scan is bounded. If no free cell is found within the scanned rows, it falls
back to a rect below every existing zone, which cannot overlap anything.

`overlapsAny` in `placement.ts` cannot serve here: it assumes every rect is one
card-sized box, and zones have arbitrary size. Instead `zones.ts` — where the
geometry primitives live — gains:

```ts
rectsOverlap(a: Rect, b: Rect, gap = 0): boolean
```

`BlobView`'s local `intersects` looks like the same function but is not, and is
left alone. It treats touching edges as overlapping, deliberately and by its own
comment, because its job is spotting a near miss before it happens. The new
primitive treats touching as clear, matching `overlapsAny`: a rect laid flush
against another covers none of it. Two predicates, not one duplicated.

### 2. Create a category

A trailing dashed **"+ New category"** box, appended after the real groups and
packed by `packColumns` like any other box, but with a small fixed row weight
so it never claims a column's worth of height.

Clicking it swaps the label for an inline text input: autofocused, `Escape`
cancels, `Enter` or blur-with-text submits. This is the shape `BlobView`
already uses after clustering a zone into existence.

Submit posts to the **existing** `?/createZone` form action with the name and
the rect from §1. No server change is needed. No color picker: the action
already assigns the next palette color by zone count, and recoloring lives on
the canvas where `ZoneColorPicker` is. After `invalidateAll` the new box
appears in the board, empty, with its own `+` ready for a first task.

An empty or whitespace-only name cancels rather than creating a zone called
"New group".

### 3. Remove a category from a task

While a card is being dragged, an **Uncategorized** box appears at the end of
the board; dropping onto it runs the existing
`dropPointFor(UNCATEGORIZED_ID, …)` path, which already finds a loose point
that avoids other loose cards. `endDrag` needs no new branch.

`groupTasksByZone` gains an `options: { alwaysIncludeUncategorized?: boolean }`
parameter. BentoView passes true while a drag is armed. The existing rule — an
empty Uncategorized box earns its place only when something is loose, or when
there are no zones at all — is unchanged at rest.

Two consequences, both accepted:

- The board reflows when the box appears mid-drag. Mitigated by giving the
  drag-time box a fixed small row weight, so columns barely move.
- `dropTargets` measures every box rect once, when the drag arms. The box must
  therefore exist **before** that measurement — so it renders while
  `drag !== null`, not while `drag.active`.

## Testing

Unit tests in `bento.test.ts` and `zones.test.ts`, following the existing
style: pure functions, real data, no mocks.

- `rectsOverlap`: overlap, touching edges, separated, gap making neighbours
  count as overlapping.
- `nextFreeZoneRect`: empty board returns the origin cell; a board with zones
  returns a non-overlapping rect; odd-sized and off-grid zones are still
  avoided; a crowded board still returns something that overlaps nothing.
- `groupTasksByZone` with `alwaysIncludeUncategorized`: adds an empty
  Uncategorized group when every task is categorized, and does not duplicate
  the group when tasks are already loose.

Manual verification steps are handed to the user rather than driven from here.

## Out of scope

Deleting a category from bento, renaming or recoloring a category from bento,
and a keyboard path for recategorizing. That last one is a real gap — drag is
mouse and touch only, and the detail modal has no category control despite a
comment in `BentoView` claiming it does — but it is its own piece of work.
