# Table — Spatial Canvas Redesign

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan

## Problem

Table currently behaves exactly like Apple Reminders: every task must live in a
topic, and the UI is a kanban board of topic-columns. Grouping is mandatory and
primary; there is no way to just put a standalone thing "on the table."

We want to invert this. **Putting a task on the table is the primary action.**
Categorization becomes an optional, secondary, spatial layer.

## Vision

"Table" becomes a **spatial canvas**. Tasks are objects with freeform x/y
positions you drag anywhere. **Zones** are named, colored rectangles you draw on
the table; they act as categories. A task's category is derived purely from which
zone it currently sits inside — nothing is stored on the task, so there is no
stale state.

- Everything is unfolded by default (no collapsed sections).
- **Desktop:** scattered freeform canvas — drag tasks and zones anywhere.
- **Mobile (< ~720px):** neat columns — one per zone plus an "On the table"
  column for loose tasks. View/edit only; no drag-to-reposition.

## Chosen approach

**Custom pointer-drag canvas, no new dependencies.** Absolutely-positioned cards
and zone rectangles on a fixed logical coordinate space, dragged with native
pointer events. Positions persisted via a lightweight JSON endpoint so a drag
does not trigger a full page re-render. This matches the app's existing
vanilla-Svelte + form-actions style and adds zero UI libraries.

Rejected: a drag/resize library (adds a dependency the app doesn't have) and a
minimal "loose area" bolt-on (doesn't deliver the standalone-primary vision).

## Data model

### `tasks`
- **Drop `topicId`** entirely — category is geometric, never stored.
- **Add `x`, `y`** (integer canvas pixels; top-left anchor of the card).
- **Repurpose `sortOrder` as z-order** (stacking; bring-to-front on drag).
- Keep `title`, `notes`, `dueDate`, `priority`, `done`, `createdAt`.

### `topics` → `zones`
New shape: `{ id, name, color, x, y, width, height, createdAt }`.
Drop `status` and `sortOrder`; add geometry + `color` (a key into the zone
palette, see Design language).

### Migration
- Each existing topic becomes a zone, laid out left-to-right across the canvas.
- Each topic's tasks get scattered to x/y inside that zone's bounds.
- Any task without a topic lands loose on the table.
- Zones receive default colors cycling through the zone palette.

## Membership rule (pure, shared)

A single pure function lives in `src/lib/zones.ts` and is used by BOTH the desktop
canvas render and the mobile grouping:

```
zoneForTask(task, zones) -> zone | null
```

- A task belongs to the zone whose bounds contain the task's **center point**.
- If multiple zones overlap and both contain the center, the **smallest-area**
  containing zone wins (most specific, deterministic).
- Center point outside all zones → `null` → "On the table" (loose).

## Server changes

- **`zones/service.ts`** (replaces `topics/service.ts`): `createZone`,
  `renameZone`, `updateZoneGeometry(id, x, y, width, height)`, `deleteZone`,
  `listZones`.
- **`tasks/service.ts`**:
  - `createTask` takes `{ title, dueDate?, priority?, x, y }` (no `topicId`).
  - Add `updateTaskPosition(id, x, y, z)`.
  - Remove the up/down `moveTask` (obsolete with drag).
  - Replace `listAllActiveTasksWithTopics` with `listActiveTasks()` returning all
    not-done tasks with **no topic join**. This also fixes a latent bug: today's
    inner-join means a loose/uncategorized task would silently vanish from the
    morning digest and due-alerts.
- **`+page.server.ts` actions**: `createTask` (title + optional dueDate/priority +
  position), `createZone`, `renameZone`, `resizeZone`/`moveZone`, `deleteZone`.
  Keep `toggleTaskDone`, `updateTask`, `deleteTask`. Drop `createTopic`,
  `archiveTopic`, `moveTopic`, `moveTask`.
- **`load`**: return `{ tasks, zones }` (flat), not `tasksByTopic`.
- **Persistence endpoint**: `POST /api/positions` (JSON) for drag persistence of
  task x/y/z and zone geometry — keeps dragging smooth. Content mutations
  (create/toggle/update/delete) stay as form actions.
- **Notifications**: `digest.ts` `DigestTask` drops the unused `topicName` field;
  scheduler calls `listActiveTasks()`. `due-alerts.ts` is unaffected.
- **Tests**: update `digest.test.ts` (remove `topicName`) and any topic-based
  fixtures; add a `zones.test.ts` for `zoneForTask` (containment, overlap
  tie-break, loose case).

## UI & components

- **`TableCanvas.svelte`** (desktop): zone rectangles rendered behind, draggable
  task cards in front, everything unfolded. Drag a card → persist x/y + bring to
  front. Create/rename/resize/delete zones. Cards keep the existing priority pill
  + due chip and the click-to-open edit modal.
- **`MobileColumns.svelte`** (< ~720px): one neat column per zone (in zone order)
  plus an "On the table" column for loose tasks, grouped via `zoneForTask`.
  Check-done, edit content, add tasks. No repositioning / zone-drawing on mobile.
- **`TaskCard.svelte`**: reused in both; loses the up/down move form.
- **`TaskDetailModal.svelte`**: unchanged behavior (title/notes/due/priority/
  delete).
- **Add affordance**: gains optional **due date + priority at creation**, so a
  task no longer has to be created-then-edited to get a due date/severity — this
  was the original request that surfaced the whole redesign.
- **`Board.svelte` / `Column.svelte`**: removed (replaced by the two views above).

## Design language — warm light, Granola-inspired

Light mode only. The dark-mode `@media (prefers-color-scheme: dark)` block is
removed. The look is calm, warm, and paper-like — reinforcing the physical-table
metaphor: a warm oat/cream table you scatter white note-cards onto.

### Core tokens (replace current `:root`)
```
--bg:            #F3EFE6;  /* warm oat — the table surface */
--surface:       #FFFDF9;  /* warm white — note cards */
--surface-2:     #ECE7DB;  /* recessed warm */
--ink:           #26231D;  /* warm near-black text */
--muted:         #857F70;  /* warm grey text */
--border:        #E4DDCF;
--border-strong: #D5CCBA;
--accent:        #C05C36;  /* warm clay/terracotta — primary actions */
--accent-hover:  #A94E2C;
--accent-soft:   #F3E1D8;
--accent-ink:    #FFFFFF;
--danger:        #B4372B;
--danger-soft:   #F4E0DC;
--ok:            #5B7A3F;  /* warm sage-green */
```

### Priority tints (warmed, still semantic)
```
--prio-high-bg: #F4E0DC; --prio-high-fg: #B4372B;
--prio-med-bg:  #F5E7CC; --prio-med-fg:  #9A6512;
--prio-low-bg:  #E6EAD6; --prio-low-fg:  #5B7A3F;
```

### Zone palette (soft, low-saturation fills so cards read on top)
Zones store a `color` key; each maps to a fill + border:
```
sage   fill #E7EBDA border #CBD3B4
sky    fill #DEE7EC border #BACBD6
butter fill #F2E8CB border #E1D09B
blush  fill #EEDDD8 border #DCBEB6
lilac  fill #E6E1EC border #C9BFD6
clay   fill #EFDDD3 border #DDBBA6
```

### Type & shape
- Keep the system sans stack (SF/Segoe/Roboto). Optionally warm the display via
  slightly tighter tracking; no web-font dependency.
- Rounded, soft cards. Radii unchanged (`10/14/20px`). Softer, warmer shadows:
  ```
  --shadow-card:   0 1px 1px rgba(60,50,30,0.04), 0 4px 14px rgba(60,50,30,0.06);
  --shadow-raised: 0 8px 24px rgba(60,50,30,0.12), 0 24px 60px rgba(60,50,30,0.16);
  ```
- Cards may carry a very subtle warm paper feel (border + soft shadow, no skeuo).

### Motion
- Card lifts slightly (scale + raised shadow) while dragging; settles on drop.
- Everything else keeps the current gentle 0.12–0.18s easing.

## Out of scope (YAGNI)
- Multi-user / sharing.
- Zone nesting or non-rectangular zones.
- Drag-to-reposition on mobile.
- Undo/redo for canvas moves.
- Auto-layout / auto-scatter (user chose freeform).

## Success criteria
- A task can be added directly to the table with optional due date + priority,
  with no zone required.
- Dragging a task/zone persists across reload.
- A task's displayed category always matches the zone it visually sits in.
- Loose tasks appear in the morning digest and due-alerts.
- Mobile shows tidy columns (zones + "On the table") and stays fully usable.
- The whole app is a single warm light theme; no dark-mode flash.
