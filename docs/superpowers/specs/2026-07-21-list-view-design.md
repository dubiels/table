# Table — List View

**Date:** 2026-07-21
**Status:** Approved (design), pending implementation plan

## Problem

The only way to see tasks today is the spatial canvas (or its mobile-columns
fallback), where category is read off zone position. That's great for a quick
spatial overview but bad for scanning everything at once, sorting by due date,
or filtering down to "what's overdue in Category X." There's no classic
spreadsheet-style list.

## Vision

A **List view**, selectable from the view dropdown already stubbed out in the
toolbar (`src/routes/(app)/+page.svelte`, currently a single "Table view"
option). It shows the exact same set of tasks as the canvas view — same
active/non-done tasks, same category derivation — just as one flat,
filterable, sortable table instead of spatial lumps.

Explicitly **not** grouped by category with subheaders (that's what
`MobileColumns` already does) — this is a true single list, with category as
just another column and filter.

## Chosen approach

**New client-side view mode, no new route, no persistence.** The dropdown in
`+page.svelte` gets a real bound value (`'table' | 'list'`) and a second
option. Selecting "List view" swaps `TableCanvas` for a new
`ListView.svelte`, the same way `isMobile` already swaps `TableCanvas` for
`MobileColumns`. The selection is plain `$state`, resets to table view on
reload — no localStorage, no URL query param, no server involvement.

Rejected: persisting the choice (extra state-management surface for a
low-stakes preference) and a URL-driven view param (adds routing complexity
this app's toolbar doesn't otherwise use).

`ListView` receives the same `tasks`/`zones` props already loaded by
`+page.server.ts` — no new load logic, no new schema, no new service
functions. Category membership reuses the existing pure functions
`zoneForTask`/`taskCenter` from `src/lib/zones.ts`, so a task's category in
the list is always identical to its category on the canvas.

## Layout

A flat table with these columns, in order:

| Done | Title | Category | Due date | Priority | Notes |
|------|-------|----------|----------|----------|-------|

- **Done** — the same circular toggle button as `TaskCard`, submits the
  existing `?/toggleTaskDone` form action inline, does not open the row.
- **Title** — plain text.
- **Category** — the owning zone's name (via `zoneForTask`), or "—" for a
  loose task.
- **Due date** — the raw date string, styled overdue (red/flagged) the same
  way `TaskCard` already computes `overdue`.
- **Priority** — same low/med/high pill styling as `TaskCard`.
- **Notes** — single-line truncated preview (CSS `text-overflow: ellipsis`),
  empty if none.

Column headers are clickable and toggle sort direction on the clicked field;
clicking a different header switches the sort field (ascending first).
Default/initial sort: due date ascending, tasks with no due date sorted last.
Only one sort field active at a time (no multi-column sort).

## Filters

A filter bar above the table, all client-side (`$derived` over the already-
loaded `tasks` array — no server round-trip):

- **Category** — multi-select checklist of zone names plus a "No category"
  entry for loose tasks. Default: all selected.
- **Due date** — single-select: All / Overdue / Today / This week / No date.
  Default: All.
- **Priority** — single-select: All / Low / Med / High. Default: All.

Filters compose with AND semantics across the three groups.

## Row interactions

Identical to the canvas view, reusing existing components/actions unchanged:

- Clicking anywhere on a row except the done-toggle opens the existing
  `TaskDetailModal` (same component `TableCanvas`/`MobileColumns` already
  use) — no changes needed to that component.
- The done-toggle button toggles done inline via the existing
  `?/toggleTaskDone` action, without opening the modal.
- Delete/edit continue to happen through `TaskDetailModal`'s existing forms.

## Data model / backend changes

None. No schema changes, no new server load function, no new form actions.
Everything list view needs (`tasks`, `zones`) is already returned by
`+page.server.ts`'s existing `load`.

## New files

- `src/lib/components/ListView.svelte` — self-contained: local filter state,
  local sort state, table markup and styles. Takes `tasks`/`zones` props,
  same shape as `TableCanvas`/`MobileColumns` already receive.

## Changed files

- `src/routes/(app)/+page.svelte` — view dropdown becomes a bound `<select>`
  with two options ("Table view" / "List view"); render branch swaps in
  `ListView` when selected (independent of the existing `isMobile` branch —
  list view should also work on mobile widths, replacing `MobileColumns`
  when explicitly chosen).

## Testing

No new backend logic to unit test. Manual verification: confirm the task set
and category assignment in list view exactly matches canvas view for a given
data set; confirm sort/filter interactions and the done-toggle/modal parity
described above.
