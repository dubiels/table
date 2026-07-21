# Blob view: click-to-place composer

## Summary

Replace the two text-input forms in the toolbar above the freeform canvas
(add-task, add-zone) with a single click-to-place composer: clicking anywhere
on the canvas opens an inline text cursor at that point, with a small
Task/Zone toggle above it and expandable fields (due date/priority, or zone
color) below. The view is renamed from "Table view" to "Blob view" throughout
the code, not just in the UI label.

## Rename scope

"Table" as the name for this view is renamed to "Blob" everywhere it
currently appears as an identifier or label:

- `src/lib/components/TableCanvas.svelte` → `src/lib/components/BlobView.svelte`
- `src/routes/(app)/+page.svelte`: import updated; `view` state type changes
  from `'table' | 'list'` to `'blob' | 'list'`; the `<select>` option value
  and label become `value="blob"` / `Blob view`.

Out of scope: internal CSS class names inside the component (`.canvas`,
`.floating`, etc.) were never named "table" — they don't need touching.
Historical docs/plans under `docs/superpowers/` referencing the old "canvas"
terminology are left alone (they're a record of past work, not live code).

## Toolbar removal

`BlobView.svelte`'s `.toolbar` block (currently `<AddTaskForm />` plus the
"New zone name" + "Add zone" form) is deleted entirely. `AddTaskForm.svelte`
itself is untouched — `MobileColumns.svelte` still uses it for the mobile
columns view, which is out of scope here.

In its place: a small muted hint line, e.g. "Click anywhere to add a task",
shown above the canvas so the new interaction isn't undiscoverable on first
load.

## Click-to-place composer

### Trigger

Clicking anywhere on the canvas that is **not** an existing task card, a
zone-head button/input, a zone resize handle, or the composer itself opens
the composer, anchored at the click point (canvas-relative coordinates).

This includes clicking empty space *inside* an existing zone's blob outline —
same trigger, same composer. Because the new item's `(x, y)` lands inside
that zone's bounds, `zoneForTask` (existing spatial logic, unchanged) picks
it up as belonging to that zone automatically. No separate category field is
added anywhere — category stays purely spatial, as it is today.

Zone dragging currently treats a sub-threshold pointer movement on a zone as
a "tap" that just reverts jitter and does nothing else
(`TableCanvas.svelte:332-343` in the `up` handler of `startDrag`). That
tap-with-no-effect case is where the composer now opens instead.

### Layout

- A two-option pill toggle, **Task** / **Zone**, positioned just above the
  text input.
- A text input at the click point, autofocused on open.
- Below the input, an always-visible fields row (no progressive reveal):
  - **Task** mode: `Due date` (date input) + `Priority` (select: None/Low/Medium/High)
    — same fields and same values as today's `AddTaskForm` extras.
  - **Zone** mode: 6 color swatches, one per `ZONE_COLORS` key
    (`sage, sky, butter, blush, lilac, clay`), `sage` pre-selected.

Toggling Task ⇄ Zone swaps the fields row but preserves whatever text is
already typed in the name/title input.

The composer's position is clamped to stay fully within the canvas bounds
(reuse the existing `clampPoint`-style logic), using the composer's
approximate rendered size, so it never renders off the visible area near an
edge or corner.

### Commit / cancel

- **Enter** in the text input commits:
  - Task mode → calls the existing `?/createTask` action with
    `title`, `dueDate`, `priority`, and `x`/`y` set to the click point
    (top-left anchor, matching how existing cards are positioned).
  - Zone mode → calls the existing `?/createZone` action with `name`,
    `color` (selected swatch), `x`/`y` at the click point, and
    `width`/`height` defaulted to `320`/`320` (today's server default),
    immediately resizable afterward via the existing resize handle.
- **Escape** cancels and discards unconditionally, regardless of typed text.
- **Blur** (clicking away without pressing Enter) commits if the name/title
  is non-empty, otherwise cancels with no side effect — the same
  commit-on-blur-if-non-empty pattern the existing zone-rename input already
  uses (`commitRename` in `TableCanvas.svelte`).
- Clicking a different empty spot while a composer is already open first
  resolves the current one (commit-if-non-empty / cancel-if-empty, same as
  blur), then opens a fresh composer at the new point.

### Unchanged behavior

Drag-to-cluster (creating a zone by dragging two loose tasks together), zone
rename, zone resize, zone delete, task drag, and tap-to-edit-task all
continue to work exactly as they do today. This feature only replaces how a
*new* task or zone gets created from the canvas.

## Data flow

No schema or server-action changes. `?/createTask` and `?/createZone`
already accept everything the composer needs (`title`/`name`, `x`, `y`,
`dueDate`, `priority`, `color`, `width`, `height`). This is a client-side
interaction change only.

## Testing

- Existing `listView.ts` / zone-spatial logic tests are untouched (no logic
  there changes).
- Manual verification (per project convention, no self-testing in dev
  server/browser by the assistant): clicking empty canvas, clicking inside a
  zone, toggling Task/Zone, Enter/Escape/blur commit paths, and the renamed
  dropdown option are the key paths to check by hand.
