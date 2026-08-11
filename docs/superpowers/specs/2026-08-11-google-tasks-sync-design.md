# Google Tasks two-way sync — design

Date: 2026-08-11

## Summary

Table gains a two-way mirror with Google Tasks. Tasks you badge in Table are
created as real Google Tasks, where they appear on the Google Calendar grid on
their due date and in the Google Tasks mobile app. Tasks you create in Google
Tasks are imported into Table. Edits, completion and deletion flow both ways.

The governing rule is an asymmetry:

> **Everything in Google is in Table. Not everything in Table is in Google.**

Table stays the everything-bucket. Google holds the subset you deliberately put
there — and you can see which subset at a glance, because those cards carry a
badge.

## Decisions

| Question                   | Decision                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| Google entity              | Google Tasks (`tasks.googleapis.com/tasks/v1`), not calendar events     |
| Sync scope                 | Full mirror, including inbound capture                                  |
| Task list                  | `@default` — the list Google's quick-capture writes to                  |
| Inbound of completed tasks | Never imported, first sync or any later sync                            |
| Conflict policy            | Per-task last-write-wins                                                |
| Deletion                   | Mirrored both ways                                                      |
| Outbound timing            | Immediate write-through, retried by the reconciler on failure           |
| Inbound timing             | Cron (~5 min), manual refresh, and a stale check on page load           |
| Opt-in control             | Toggle in the task detail modal, plus a sticky checkbox in the composer |
| Due date                   | Required before a task can be pushed                                    |
| Canvas assignments         | Pushable, same opt-in as any task                                       |
| `.ics` tasks feed          | Retired entirely                                                        |
| Code structure             | Pure planner + thin runner, mirroring `lms/plan.ts`                     |

### Why Google Tasks and not calendar events

Calendar events have no completion state. The round-trip requirement — tick it
off in Google, see it done in Table — only exists for Google Tasks. Tasks also
render inside the Calendar UI on their due date, so nothing is lost visually.

### Why a due date is required outbound

A Google Task with no due date never appears on the Calendar grid; it lives only
in the Tasks side panel. Pushing an undated task produces something you can't
see where you expect it, which reads as a sync failure. The toggle is therefore
disabled until the task has a due date. This gates opt-in only; an already-linked
task that later loses its date is handled differently, and non-destructively —
see "The due-date rule governs creation, not maintenance".

This binds **outbound only**. An undated task quick-captured on your phone is
still imported into Table, because Google ⊆ Table is absolute.

### Why completed Google tasks are never imported

Backfilling a long-lived default list would flood Table's history with years of
someone else's archive. The rule is stated as an invariant rather than a
first-sync special case, so there is no "connected at" cutoff to store and no
divergence between the first run and every later one.

The rule applies only to Google tasks Table has never seen. A task Table already
knows about absolutely takes its completion state from Google — that is the
headline feature.

## Data model

One migration.

```
tasks
  + updatedAt        text    NOT NULL           -- backfilled to createdAt
  + googleSync       integer NOT NULL DEFAULT 0 -- boolean: opt-in intent
  + googleTaskId     text    UNIQUE             -- achieved link; null = not in Google
  + googleSyncedAt   text                       -- the updatedAt value Google last received
  + googleUpdatedAt  text                       -- Google's own `updated` stamp at last reconcile
  + googleError      text                       -- last push failure, cleared on success
  ~ source           'manual' | 'canvas' | 'google'   -- new third value

google_task_tombstones            -- new table
    googleTaskId  text PRIMARY KEY
    deletedAt     text NOT NULL

sync_state                        -- new table
    key    text PRIMARY KEY       -- 'gtasks:lastSyncAt'
    value  text NOT NULL
```

SQLite cannot add a `NOT NULL` column without a default, so `updatedAt` is added
as `NOT NULL DEFAULT ''` and backfilled with `UPDATE tasks SET updated_at =
created_at` in the same migration.

### `updatedAt` is deliberately narrow

It is bumped **only** when a field Google can see changes: title, notes, due
date, done. Dragging a card between categories and changing its priority do not
touch it.

This is load-bearing, not fussiness. Dirty-detection is
`updatedAt !== googleSyncedAt`, so a bump means "Google owes us a write", and
conflict resolution compares `updatedAt` against Google's `updated`. If a drag
bumped it, every reshuffle of the bento grid would fire pointless API calls
_and_ let that drag win a conflict against a real edit made on your phone.

Priority is excluded for the same reason: Google Tasks has no priority field, so
a priority change is not something Google can be behind on.

### Intent and achievement are separate columns

`googleSync` records that you want this task in Google. `googleTaskId` records
that it is. Collapsing them into one column would mean the opt-in toggle can
only succeed when Google is reachable — a failed create would leave no trace and
no way to retry. Split, the toggle is a local write that always succeeds, and
the reconciler carries out the intent whenever Google is next reachable.

Turning the toggle **off** means "remove this from Google": the Google task is
deleted and the link cleared. The Table task survives either way.

### Two stamps rather than a dirty flag

`googleSyncedAt` answers "does Google have our latest?" and `googleUpdatedAt`
answers "has Google changed since we looked?" Comparing both against current
state yields all four cases — clean, Table-dirty, Google-dirty, both-dirty —
with no mutable flag that can drift away from reality.

**After every successful write to Google, store the `updated` value from the
write's own response** into `googleUpdatedAt`, and the task's current
`updatedAt` into `googleSyncedAt`. Skipping this is the single most likely bug
in the whole feature: Google stamps `updated` at write time, so without it the
next reconcile sees Google as newer than Table and immediately echoes our own
push back down as an inbound change.

### Why not reuse `externalId`

Canvas assignments are pushable, so one task can need a Canvas id and a Google
id simultaneously. `externalId` holds one value.

### Tombstones

Deletion is mirrored and Table hard-deletes rows. If the Google delete call
fails, the only record of what to delete is gone. A tombstone row is written in
the same transaction as the local delete and dropped once Google confirms — the
minimum needed to make deletion retry-safe without adopting a full outbox.

## Module layout

```
src/lib/server/google/oauth.ts   ← moved from gcal/oauth.ts, shared by both features
src/lib/server/gtasks/
  client.ts   REST wrapper: list / insert / patch / delete
  plan.ts     pure reconcile planner — the entire rulebook, unit-tested, no I/O
  sync.ts     executes a plan against the API and the DB; cron + manual entry point
  push.ts     single-task immediate outbound for create / edit / toggle / delete
```

`gcal/oauth.ts` moves to `google/oauth.ts`. It is already generic — it exchanges
a refresh token for an access token and knows nothing about calendars — and both
features share one refresh token. Leaving it in `gcal/` would force `gtasks/` to
import from `gcal/`, misstating the relationship between two sibling features.

## Field mapping

| Table                    | Google Tasks                           | Notes                                                |
| ------------------------ | -------------------------------------- | ---------------------------------------------------- |
| `title`                  | `title`                                | verbatim, no prefixing                               |
| `notes`                  | `notes`                                |                                                      |
| `dueDate` (`YYYY-MM-DD`) | `due` (`YYYY-MM-DDT00:00:00.000Z`)     | lossless; see below                                  |
| `done`                   | `status` (`needsAction` / `completed`) |                                                      |
| `completedAt`            | `completed`                            |                                                      |
| `priority`               | —                                      | Table-only; Google Tasks has no equivalent           |
| `courseName`             | —                                      | Table-only, deliberately not prefixed into the title |
| —                        | `parent`, `position`, `links`          | read and ignored                                     |

**Dates are lossless in both directions.** Google documents that `due` records
date information only — the time portion is discarded on write and cannot be
read or written. Table's `dueDate` is already date-only. Outbound appends
`T00:00:00.000Z`; inbound takes the first ten characters. No timezone
arithmetic is involved anywhere, and none should be introduced.

**Un-completing:** send `status: 'needsAction'` together with `completed: null`.

**No course prefix.** The retired `.ics` feed rendered Canvas assignments as
`[COURSE] Title`. Google titles are written verbatim instead, because a prefix
Table adds on the way out is a prefix Table would read back on the way in —
producing `[MATH 101] [MATH 101] Problem Set 3` after one round trip through an
edit. Symmetric mapping is worth more than the prefix.

## The reconcile planner

`plan.ts` exports one pure function. It performs no I/O, so every rule below is
a table-driven unit test.

```ts
planGoogleTaskSync(input: {
  tableTasks: TableTaskRow[];      // id, title, notes, dueDate, done, completedAt,
                                   // updatedAt, googleSync, googleTaskId,
                                   // googleSyncedAt, googleUpdatedAt
  googleTasks: GoogleTaskRow[];    // id, title, notes, due, status, completed,
                                   // updated, deleted, hidden, parent
  tombstones: { googleTaskId: string; deletedAt: string }[];
  fullFetch: boolean;
  now: Date;
}): SyncPlan
```

```ts
interface SyncPlan {
	deleteInGoogle: { googleTaskId: string }[];
	createInGoogle: { taskId: string; title: string; notes: string | null; due: string }[];
	patchInGoogle: {
		taskId: string;
		googleTaskId: string;
		title: string;
		notes: string | null;
		due: string | null;
		status: 'needsAction' | 'completed';
	}[];
	createInTable: {
		googleTaskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		googleUpdatedAt: string;
		x: number;
		y: number;
	}[];
	patchInTable: {
		taskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		done: boolean;
		completedAt: string | null;
		googleUpdatedAt: string;
	}[];
	deleteInTable: { taskId: string }[];
	unlinkInTable: { taskId: string; reason: string }[];
}
```

`unlinkInTable` clears `googleTaskId` **and** sets `googleSync` to false. Both
are required: leaving the intent set would make the very next reconcile create a
fresh Google task, resurrecting something the user deleted in Google.

### Rules

Tombstones are planned first, so a delete is never racing a create that reuses
its slot.

**1. Tombstones.** Every tombstone becomes a `deleteInGoogle`.

**2. For each Google row `g`,** matched to the Table task `t` where
`t.googleTaskId === g.id`:

| Condition                                       | Action                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| `g.deleted` and `t` exists                      | `deleteInTable(t)` — mirrored deletion                  |
| `g.deleted` and no `t`                          | ignore                                                  |
| not deleted, no `t`, `g.status === 'completed'` | **ignore** — completed tasks are never imported         |
| not deleted, no `t`, still open                 | `createInTable`, `source: 'google'`, `googleSync: true` |
| not deleted, `t` exists                         | fall through to the four-case matrix below              |

For a linked pair, let `googleChanged = g.updated !== t.googleUpdatedAt` and
`tableDirty = t.updatedAt !== t.googleSyncedAt`:

| `tableDirty` | `googleChanged` | Action                                                                                   |
| ------------ | --------------- | ---------------------------------------------------------------------------------------- |
| no           | no              | nothing                                                                                  |
| no           | yes             | `patchInTable` — Google's values win by default                                          |
| yes          | no              | `patchInGoogle`                                                                          |
| yes          | yes             | compare `t.updatedAt` against `g.updated`; the later wins whole. Exact tie → Google wins |

The loser's change is discarded. That is the accepted cost of per-task
last-write-wins; ties resolve to Google deterministically rather than by chance,
and are essentially impossible given Google's millisecond precision.

**3. For each Table task `t`:**

| Condition                                                              | Action                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `googleSync`, no `googleTaskId`, has a due date                        | `createInGoogle`                                                                   |
| `googleSync`, no `googleTaskId`, no due date                           | nothing — intent is held until a date exists; the badge stays in its outline state |
| not `googleSync`, has `googleTaskId`                                   | `deleteInGoogle` + clear the link locally                                          |
| `googleSync`, has `googleTaskId`, absent from a **full** fetch         | `unlinkInTable`, reason "no longer in Google"                                      |
| `googleSync`, has `googleTaskId`, absent from an **incremental** fetch | nothing — absence means unchanged                                                  |

### The due-date rule governs creation, not maintenance

A task must have a due date before Table will **create** it in Google. An
already-linked task that later loses its date — because you cleared it, or a
Canvas sync rescheduled the assignment to no date — keeps its link and is
patched with `due: null`. It stays in your Google Tasks list and drops off the
calendar grid.

The two alternatives are both worse. Deleting it destroys a Google task in
response to an edit that never asked for a deletion. Unlinking it leaves an
unmanaged orphan in Google, so re-adding a due date later creates a _second_
Google task for the same thing. Patching `due: null` keeps one Google task,
destroys nothing, and puts the task straight back on the grid the moment a date
returns.

### Deletion fails safe on ambiguity

Deletion is mirrored only on an explicit `deleted: true` flag from Google, never
inferred from a row's absence. Google purges deleted tasks after a retention
window; if Table were offline across that window, absence would be
indistinguishable from "never existed". On a full fetch, an unexplained absence
therefore **unlinks and flags** rather than deleting.

The consequence, stated plainly: a task deleted in Google while Table is down
for an extended period may survive in Table as an unlinked task. That is the
safe direction to fail.

## Fetching

`client.ts` calls `GET /tasks/v1/lists/@default/tasks` with
`showCompleted=true`, `showHidden=true`, `showDeleted=true`, paginating on
`nextPageToken`. All three flags are required: completed tasks become hidden and
would otherwise vanish from the response, making completion indistinguishable
from deletion.

Periodic runs pass `updatedMin = lastSyncAt − 5 min` to avoid re-fetching a
lifetime of completed tasks every five minutes. The skew absorbs clock drift
between Table and Google. First run and manual refresh pass no `updatedMin` and
are marked `fullFetch: true`.

`lastSyncAt` lives in a new one-row-per-key table:

```
sync_state
    key    text PRIMARY KEY   -- 'gtasks:lastSyncAt'
    value  text NOT NULL
```

A missing key means a full fetch. Since deletion is never inferred from absence,
full and incremental fetches are semantically identical to the planner apart
from the one unlink rule above — the flag exists only to gate that rule.

## Outbound write-through

`push.ts` fires the matching Google call after the local DB write commits, for
any task with `googleSync` set. It stores `googleTaskId`, `googleSyncedAt`,
`googleUpdatedAt` from the response and clears `googleError`.

On failure it logs, writes `googleError`, and returns. It **never throws into
the request path** — your action always succeeds locally, and the task is left
dirty for the next reconcile to carry out. Calls carry a 5-second timeout;
a timeout is treated as a failure and falls through to the same path.

Retry policy is deliberately simple: a dirty task is retried on every reconcile,
forever. There is no attempt counter and no backoff. The escape hatch for a task
Google will never accept — a task assigned from Docs or Chat, whose fields the
API refuses to patch — is the error badge plus turning the toggle off. This is
a knowing simplification for a single-user app; if stuck tasks turn out to be
common, an attempt counter is the natural next step.

## Inbound triggers

- **Cron** — `GTASKS_SYNC_CRON`, default `*/5 * * * *`, registered in
  `scheduler/index.ts` beside the existing LMS job.
- **Manual** — a "Sync Google Tasks" item in the user menu, mirroring
  "Sync assignments", backed by `POST /api/gtasks/sync`. Always a full fetch.
- **Page load** — `(app)/+page.server.ts` awaits a sync if `lastSyncAt` is more
  than 60 seconds old, capped at 4 seconds. On timeout or error it renders
  current database state. This covers "I ticked it off on my phone in the
  corridor and just opened Table"; the cron covers everything else.

## Inbound placement

Imported tasks land as **Uncategorized**, which in Table means coordinates
falling inside no zone rectangle. Reuse the existing machinery: `nextFreeSlot`
over `looseBounds()` from `lms/plan.ts`, the same path Canvas assignments take
when they have no zone. No new placement code.

## UI

**Badge** — `TaskCard.svelte`, beside the existing zone dot. Drawn as inline SVG
rather than a text glyph, matching how the topbar icons are drawn. Three states:

| State   | Meaning                                                          |
| ------- | ---------------------------------------------------------------- |
| solid   | linked and clean                                                 |
| outline | intent recorded, not yet in Google, or dirty and awaiting a push |
| warning | `googleError` is set; `title` carries the message                |

**Toggle** — `TaskDetailModal.svelte` gains "Send to Google Tasks". Disabled
with an inline explanation when the task has no due date. Shows `googleError`
when set.

**Composer** — `AddTaskForm.svelte` gains an "Also add to Google Tasks"
checkbox, its last state remembered in `localStorage` so pushing everything
costs one click ever rather than one per task. Ticking it expands the optional
Due/Priority row and requires a due date, since the box cannot be honoured
without one.

**Failures** surface through the existing `toast.svelte.ts`.

## Out of scope

Stated so the plan does not quietly grow:

- **Subtask hierarchy.** Table has no parent/child concept. A Google child task
  imports as a flat top-level Table task; Table never sets `parent` on push. If
  you nest a linked task under another in Google, the nesting is ignored while
  title, notes, due date and status keep syncing.
- **Multiple task lists.** `@default` only.
- **Dashboard API changes.** `/api/dashboard` and the Pi wall display are
  untouched; the badge is not exposed in that payload.
- **Priority sync.** No Google field exists to carry it.

## Retirements

The `.ics` tasks feed is superseded and removed entirely:

- delete `src/lib/server/ics/export.ts` and `export.test.ts`
- delete `src/routes/calendar.ics/+server.ts`
- remove `TASKS_FEED_TOKEN` from `.env.example`
- remove the "Tasks → Google Calendar" section from `README.md`

## Configuration

Additions to `.env.example`:

```
# Google Tasks two-way sync. Requires the Google Tasks API enabled in the same
# Cloud project as the Calendar integration, and a GCAL_REFRESH_TOKEN carrying
# the tasks scope (re-run npm run google:auth after enabling this).
GTASKS_ENABLED=
GTASKS_SYNC_CRON=*/5 * * * *
```

`GCAL_CLIENT_ID` and `GCAL_CLIENT_SECRET` are reused unchanged.

**`GCAL_REFRESH_TOKEN` must be regenerated.** The current token carries only
`calendar.events.readonly`. `scripts/gcal-auth.ts` is renamed to
`scripts/google-auth.ts` (npm script `google:auth`) and requests both scopes:

```
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/tasks
```

Setup steps for the README:

1. Enable the **Google Tasks API** in the existing Google Cloud project.
2. Run `npm run google:auth` and replace `GCAL_REFRESH_TOKEN` with the new value.
3. Set `GTASKS_ENABLED=true`.
4. Mirror both into `flyctl secrets set` for production.

Unset `GTASKS_ENABLED` disables every part of the feature — cron, page-load
sync, write-through, and the UI controls — matching how every other integration
in Table is gated.

## Testing

`plan.ts` carries the weight, since it holds every rule and needs no network:

- all four dirty/changed combinations, including both-dirty resolving by timestamp and the tie going to Google
- an unknown completed Google task is ignored; a known one is applied
- `deleted: true` mirrors into `deleteInTable`
- absence unlinks on a full fetch and is ignored on an incremental one
- a linked task losing its due date keeps its link and patches `due: null`
- an unlinked task with intent set but no due date plans no action
- toggling `googleSync` off deletes in Google
- tombstones plan a delete
- inbound tasks receive non-overlapping Uncategorized coordinates

`client.ts` tests mirror `gcal/client.test.ts`: request shaping, the three
`show*` flags, pagination across `nextPageToken`, and date mapping in both
directions.

Existing suites to update: anything referencing `ics/export`, and `tasks/service`
tests for the new `updatedAt` bump rules — specifically that
`updateTaskPosition` does **not** bump it.

## Implementation stages

One spec, five stages, each independently reviewable:

1. **Foundation** — migration; move `gcal/oauth.ts` → `google/oauth.ts`; widen
   the auth script's scopes; `gtasks/client.ts`.
2. **Rulebook** — `gtasks/plan.ts` and its tests. No I/O, no wiring.
3. **Inbound** — `gtasks/sync.ts`, the cron job, `POST /api/gtasks/sync`, the
   page-load stale check. Google → Table works end to end.
4. **Outbound** — `gtasks/push.ts` write-through, `updatedAt` bumps in
   `tasks/service.ts`, and the UI: badge, modal toggle, composer checkbox.
5. **Cleanup** — retire the `.ics` feed; update `README.md` and `.env.example`.

## Manual verification

No automated end-to-end test touches Google. After stage 4:

1. Create a task with a due date, tick "Also add to Google Tasks". Confirm it
   appears in the Google Tasks app and on the Calendar grid on that date.
2. Tick it complete in the Google Tasks app. Within five minutes — or
   immediately via the menu's "Sync Google Tasks" — confirm Table shows it done.
3. Add a task in the Google Tasks app. Confirm it appears in Table as
   Uncategorized.
4. Add a task in Google and complete it before Table's next sync. Confirm Table
   never imports it.
5. Rename a linked task in Table; confirm the rename reaches Google.
6. Delete a linked task in Table; confirm it disappears from Google. Then delete
   one in Google; confirm it disappears from Table.
7. Clear the due date on a linked task; confirm it stays in the Google Tasks
   list but leaves the calendar grid, then re-add a date and confirm it returns
   to the grid as the same task rather than a duplicate.
8. Stop the network, edit a linked task, confirm the edit succeeds locally and
   the badge shows an error, then restore the network and confirm the next sync
   settles it.
