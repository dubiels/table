# Blob view: canvas zoom

## Summary

Add zoom in/out to the blob canvas (`BlobView.svelte`), controlled by
on-screen `−`/`+` buttons with a percentage readout, plus `+`/`-` keyboard
shortcuts. Zoom is a view-only lens: it never changes stored task/zone
positions, only how the canvas is rendered and how screen-pixel interactions
translate to canvas coordinates.

## Core model: a growable "world"

Today, `clampPoint`/`clampRect` cap every task/zone position to the physical
canvas element's `clientWidth`/`clientHeight` — nothing can be placed or
dragged outside the visible viewport. For zoom-out to mean anything, that
has to change: the canvas becomes a fixed-size viewport onto a "world" that
can be bigger than what's currently on screen.

- `worldSize()` = the bounding box of every zone's and task's *current
  committed* position/size (from the `tasks`/`zones` props — not live drag
  state), padded by a fixed `WORLD_PAD = 40`px on all sides, floored at the
  canvas's natural (unscaled) size (`canvasEl.clientWidth`/`clientHeight`).
- With modest content this equals the natural viewport size, so behavior is
  unchanged from today. Once zones/tasks spread past the edge, `worldSize`
  grows to contain them.
- `clampPoint`/`clampRect` swap their ceiling from `canvasEl.clientWidth /
  clientHeight` to `worldSize()`. This is the one behavioral change outside
  zoom itself: drag, resize, and composer placement can now reach past the
  edge of what's currently visible on screen, because the world can now
  exceed the viewport.

## Zoom range

- **Max = 100%** — today's default, unscaled view. Zoom never goes in past
  this; there is no "bigger than normal" mode.
- **Min** = the scale that fits the entire `worldSize` inside the natural
  viewport: `min(1, naturalWidth / worldWidth, naturalHeight / worldHeight)`,
  floored at an absolute `20%` so one far-flung item can't make zoom
  effectively useless.
- Min is a `$derived` value off `tasks`/`zones` (committed props only, so it
  never fluctuates mid-drag). It recomputes automatically as content
  changes — e.g. adding a zone that no longer fits lowers the floor;
  deleting content raises it.
- If the current zoom level ends up below the (now higher) minimum — e.g.
  after a delete shrinks the world — it's clamped up automatically. Zoom
  never auto-*decreases*: growing the world only widens how far out you're
  *allowed* to go, it doesn't move your current view. The guarantee is only
  that zooming all the way out always shows everything, not that everything
  is always immediately visible without pressing `-`.
- Step size: **10% per press/click**, snapped to the `[min, 100%]` range.
- Not persisted — every fresh page load starts at 100%.

## Rendering and anchor

- All canvas content currently placed directly inside `.canvas` (zones,
  cluster-preview, tasks, composer) moves into a new inner
  `.canvas-world` wrapper, `position: absolute; inset: 0`, same box as
  `.canvas`.
- Zoom is applied as `transform: scale(zoom)` on `.canvas-world`, with
  `transform-origin: center center` — CSS handles center-anchored scaling
  natively, no manual position math needed for rendering.
- `.canvas-world` gets `transition: transform 150ms ease` so zoom changes
  animate smoothly instead of jumping.
- `.canvas` itself keeps its existing CSS (size, `overflow: hidden`) and
  remains the fixed reference viewport. Its `clientWidth`/`clientHeight`
  stay the "natural" (unscaled) size at every zoom level, since `transform`
  doesn't affect layout box size.

## Coordinate conversion

Stored positions stay in unscaled world units always. Three places convert
screen pixels to world units and need a `/ zoom` correction now that 1
screen pixel no longer equals 1 world unit whenever zoom ≠ 100%:

1. **Composer placement** (`openComposerAt`): converting the click's
   position (relative to `canvasEl`'s bounding rect) into world coordinates
   needs to account for the center-anchor scale, not just a flat subtract.
2. **Task/zone drag** (`startDrag`'s `move`): the raw `ev.clientX - originX`
   / `ev.clientY - originY` screen-pixel deltas divide by `zoom` before being
   added to the drag's base position.
3. **Zone resize** (`startResize`'s `move`): same correction — the
   `ev.clientX - originX` / `ev.clientY - originY` deltas divide by `zoom`.

`clampPoint`/`clampRect` themselves don't need zoom-awareness — they operate
purely in world units (now bounded by `worldSize()` instead of the raw
viewport), which is exactly the coordinate space these three conversions
produce.

## Controls

- A small `− 100% +` control, pinned to the canvas's top-right corner via
  `position: absolute`, rendered as a sibling of `.canvas-world` (inside
  `.canvas` but outside the scaled wrapper) so the control itself never
  shrinks or grows with zoom.
- `−`/`+` buttons disable at the range ends (`zoom <= min` / `zoom >= 1`).
- Keyboard `+`/`=` and `-`/`_` also zoom in/out, via a window-level keydown
  listener added while `BlobView` is mounted. Ignored whenever focus is
  inside a text input, textarea, select, or contenteditable element (so it
  doesn't hijack typing in the composer, zone rename input, or elsewhere).

## Unchanged / explicitly out of scope

- No panning or scrolling. Since max zoom is capped at today's normal size
  and zoom-out only ever shrinks the world *toward* the viewport, nothing
  is ever clipped — there's no scenario left that panning would solve.
- No zoom-level persistence across page loads.
- `TaskDetailModal` (task detail panel) renders outside `.canvas` entirely
  and is unaffected by zoom.
- Drag-to-cluster, zone rename, zone delete, tap-to-edit-task, and the
  click-to-place composer's own commit/cancel logic are all unchanged in
  behavior — only the coordinate math and clamp ceiling they rely on move
  to world units.

## Testing

- Manual verification (per project convention, no self-testing in dev
  server/browser by the assistant): zoom buttons at both range ends,
  keyboard shortcuts (including that they're ignored while typing in the
  composer/rename input), dragging and resizing a zone at a non-100% zoom
  level lands it where the cursor visually is, creating a task/zone via
  click at non-100% zoom places it at the click point, and that adding
  enough zones to exceed the viewport lowers the zoom-out floor so
  everything fits at minimum zoom.
