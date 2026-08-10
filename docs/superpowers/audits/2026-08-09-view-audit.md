# View bug audit — 2026-08-09

Static-analysis pass over the interactive views: `BlobView`, `BentoView`,
`MobileColumns`, `ListView`, `TaskCard`, `TaskDetailModal`, `AddTaskForm`,
`bento.ts`, `listView.ts`, `zones.ts`, and `(app)/+page.svelte`. No dev server
or browser was used; every verdict below is read off the code, the compiled
Svelte output, or a unit test.

## Suspect 0 — "zoom out → resize is still broken, the canvas is maxxed at the original size"

**Two real bugs, both fixed.** The reported symptom has two independent causes,
and one thing it is _not_.

**Not the cause: `viewportBounds` failing to track zoom.** Compiling
`BlobView.svelte` shows `viewportBounds` as `$.derived(() => visibleWorldBounds(…,
$.get(zoom)))` and every call site — including the `pointermove` closures in
`startResize`/`startDrag` — as `$.get(viewportBounds)`. `zoom` is `$state`, so a
zoom change marks the derived dirty and the next read recomputes it, freshly
reading `clientWidth` as it goes. At zoom 0.5 on a 1000px canvas the bounds do
reach `maxX = 1500`, which maps back to exactly the canvas's right edge. The
`.canvas` / `.canvas-world` CSS chain is consistent with that: `.canvas-world` is
`inset: 0` with `transform-origin: center center`, so world→screen is
`cx + (world - cx) * zoom`, the same mapping `visibleWorldBounds` inverts, and
`overflow: hidden` on `.canvas` clips at precisely the same place. Nothing else
in the tree still references a stored world size — commit 0380398 removed the
last one.

**Cause 1 — the clamp destroys work done while zoomed out.** `visibleWorldBounds`
at zoom 1 is exactly the natural viewport, and `zoom` resets to 1 on every
reload. So a zone grown (or a card placed) while zoomed out is out of bounds
again the moment the page reloads, and the _first pointermove on it clamps it
back in_: `startResize` computed `maxWidth = viewportBounds.maxX - start.x`, so a
1500px-wide zone collapsed to the canvas edge on a 1px drag; `startDrag`'s
`clampPoint` did the same to an off-screen card. The zoomed-out work is silently
undone, which is exactly "the canvas is maxxed at the original size".
**Repro:** zoom to 50%, drag a zone's resize handle well past the old right
edge, zoom back to 100% (or reload), nudge the handle — the zone snaps to the
natural canvas width. **Fix:** `boundsIncluding` (`zones.ts`) widens the clamp by
the footprint the item already occupies, so it can be dragged back into view but
never pushed further out. Commit `e4b24e5`.

**Cause 2 — the bounds go stale whenever the canvas is resized.**
`viewportBounds` read `canvasEl?.clientWidth` inside the derived. `clientWidth`
is a plain DOM read, not a signal, so the derived's only reactive dependencies
were `canvasEl` and `zoom`: the measurement froze at whatever the canvas was the
last time zoom changed. Enlarge the window and every placement, drag and resize
stays capped at the pre-resize size — again "maxxed at the original size", this
time literally the original. Shrinking the window has the mirror failure: items
can be dropped outside the visible area. **Fix:** `bind:clientWidth` /
`bind:clientHeight`, which are ResizeObserver-backed, matching how `BentoView`
already measures. Commit `fd88ce3`.

**Considered, left alone (by design):** at zoom < 1 the world origin stays pinned
at 0,0, so the top-left of the canvas is dead space and the new reach is
bottom-right only. That is the documented model, not a defect. It does mean
content beyond the natural viewport is invisible at zoom 1 with no panning — a
design limitation worth revisiting, but out of scope for a bug pass.

## Seeded suspects

| #   | Suspect                          | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BentoView negative box size      | **Real, fixed** (`f358fa5`). `rect.width - GUTTER * 2` goes negative under 16px; the browser drops the whole declaration and the box renders at its natural size over its neighbours. Moved to `insetRect` in `bento.ts` with a zero floor, so it is testable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | BentoView container collapse     | **Not a bug.** `.bento` already uses `bind:clientWidth` / `bind:clientHeight`, which Svelte 5 backs with a ResizeObserver — it fires after mount and on every later resize, including a fresh mount after a view switch. `rects` guards on `> 0`, so the only cost is one empty frame before the first observation.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | BentoView tiny-box usability     | **Real, fixed** (`382fd77`). Weight was the raw task count, so one dominant zone drove every other cell below its own header height. `MAX_WEIGHT_RATIO = 6` floors each weight at a sixth of the largest, preserving the ranking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | BlobView stale drag overrides    | **Real, fixed** (`42d441a`). Entries were only ever added — even a tap re-set one — so a position from an LMS sync or another device could never render, and both maps grew for every item ever touched. Overrides are now pruned on each props change, except for items with a pointer down or a save in flight.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | BlobView silent persist failures | **Real, fixed** (`0028f9c`). `persist()` ignored the response status and any rejection. Now logs both. `console.error` is the floor — Task 9's toast helper is the intended caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | MobileColumns parity             | **Partly real, fixed** (`b3dd282`). Done-toggle works (`TaskCard`'s form posts to `?/toggleTaskDone` on the same route). Zone display is fine — the column heading names the zone, so `TaskCard`'s dot is redundant. Placement was the bug: `<AddTaskForm />` with no coordinates falls through to `createTask`'s (60, 60) default, which is also `createZone`'s default anchor, so phone-added tasks landed inside the first default-placed zone. Now uses `findUncategorizedPoint(zones)`. On the `isMobile` branching: `list`/`bento` overriding `isMobile` while `blob` forces `MobileColumns` is **intended** — pointer-drag placement on a phone is not usable, and the column list is the mobile expression of the same data. Documented, not changed. |
| 7   | ListView                         | **Real, fixed** (`d13aea8`, `e5d2bd5`). Sort stability is fine (`Array.prototype.sort` is stable and ties return 0, preserving `sortOrder`), and the zone dots do read live colours via `categoryColorFor` / `dotColor`. Two genuine bugs: `today` came from `toISOString()` (UTC) while due dates are local calendar dates, so overdue styling and the Today/Overdue/Week filters were a day out for part of every day; and the category filter was keyed by zone _name_, so duplicate names shared a checkbox and a rename stranded the deselection.                                                                                                                                                                                                        |
| 8   | TaskDetailModal                  | **Not a bug.** Escape closes via `<svelte:window onkeydown>`; the backdrop closes via the overlay's `onclick` with `stopPropagation` on the modal. Clearing notes submits `''`, and the page action's `data.notes ? String(data.notes) : null` maps that to null (same for `dueDate`). The date input round-trips cleanly now that due dates are canonical `YYYY-MM-DD` — no parsing, no zone conversion, no drift.                                                                                                                                                                                                                                                                                                                                           |
| 9   | `+page.svelte` view switching    | **Deferred to Task 9** (localStorage view persistence). No _other_ reset bug: `bind:value` on the select matches the union type exactly, and switching views remounts cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Further findings

- **`today` is captured at component init** in `ListView` and `TaskCard` and never
  refreshes, so a tab left open across midnight keeps yesterday's overdue
  styling. Real but low-severity; a fix needs a timer or a visibility hook, which
  is more machinery than the bug is worth right now.
- **`intersects()` counts merely-touching rects as overlapping** (`a.right < b.x`
  is strict), so two zones can never sit flush — there is always a 1px seam.
  `taskOverlapsOthers` documents the opposite, stricter test for cards. Cosmetic;
  left alone.
- **New tasks stack on a single point.** `zoneCenterPoint` (Bento) and
  `findUncategorizedPoint` (Bento, MobileColumns) are deterministic, so several
  tasks added to the same group land exactly on top of each other in the blob
  view. `placement.ts`'s `nextFreeSlot` exists for this and is unused by the
  views. Pre-existing in Bento; the mobile fix matches Bento rather than
  diverging from it.
- **Zone drags can move tasks that are never saved.** `up()` persists only the
  member tasks still inside the zone after the drag, so one dragged out of it
  keeps an override the server never hears about. Pruning retires an override
  only once the props match it, so this one is never retired: the task holds the
  position it was dragged to for as long as the view is mounted, then reverts on
  the next full load. Showing where the user put it is the better of the two
  wrongs, but the underlying gap is that the drag does not persist it at all.
- **Server-side date handling has the same UTC bug** in
  `notifications/digest.ts` and `notifications/due-alerts.ts`. Out of scope for a
  view audit, but the same class as suspect 7 and worth a separate pass.
