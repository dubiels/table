# Table — Dashboard endpoint & LMS sync hardening

**Date:** 2026-08-09
**Status:** Proposed

---

## 1. Motivation

A separate hardware project — a presence-activated wall display running on a Raspberry Pi
4 — needs to render today's schedule and upcoming assignment deadlines. Table already
ingests Canvas LMS assignments via `canvas/sync.ts` and stores them as tasks.

The naive approach is for the Pi to fetch and parse the Canvas `.ics` feed itself. That is
rejected: it means two independent parsers, two copies of the feed URL (one of them on an
SD card in a shared room), and a wall display that can disagree with the task app about
what is due.

**Table is the source of truth. The Pi is a dumb renderer.** This spec adds the read-only
endpoint that makes that possible, and fixes the LMS sync failure modes that become
user-visible once a wall display depends on them.

Two independently shippable parts. Part B should land first — an unreliable sync behind a
reliable endpoint is worse than no endpoint.

---

## 2. Non-goals

- **No write path.** The Pi never mutates Table state — no marking done, no creating
  tasks. It is a keyboardless display in a shared room, and `tasks`/`zones` have no
  `userId`. A write endpoint is a substantially larger security surface than a read one.
  Revisit only after multi-tenancy.
- **No Google Calendar in Table.** The Pi fetches its own Google ICS feed for the schedule
  section. Table owns assignments only.
- **No dark theme in Table.** The wall display is near-black with an amber accent; Table
  stays warm-light. These are different media (a phone in the hand vs. a wall panel in a
  dim room) and should not share tokens. See §5 for the one thing that *is* shared.
- **No new views or UI surfaces**, beyond the manual sync trigger in B4.

---

## Part A — Read-only dashboard endpoint

### A1. Route

`GET /api/dashboard`

Returns everything the display needs in a single request:

```jsonc
{
  "generatedAt": "2026-08-09T12:30:00.000Z",
  "timezone": "America/New_York",
  "tasks": [
    {
      "id": "…",
      "title": "problem set 3",
      "dueDate": "2026-08-09",      // YYYY-MM-DD, may be null
      "priority": "high",            // low | med | high | null
      "source": "canvas",            // manual | canvas
      "courseName": "CS 4641",       // may be null
      "zone": { "id": "…", "name": "School", "color": "sage" } // null when loose
    }
  ],
  "zones": [
    { "id": "…", "name": "School", "color": "sage" }
  ]
}
```

Requirements:

- Active tasks only (`done = false`), same source as `listActive`.
- Tasks with `dueDate = null` are **included**. The client decides what to show; the
  endpoint does not editorialise.
- Sorted by `dueDate` ascending, nulls last, then `priority` desc, then `title`.
- `zone` is resolved server-side via the existing pure functions —
  `zoneForTask(taskCenter(task), zones)`. Do not reimplement the geometry, and do not ship
  raw `x`/`y` to the client. The display consumes zone *identity*, not coordinates.
- Omit `x`, `y`, `sortOrder`, `notes`, `externalId`. Keep the payload to what renders.
- Cache-Control: `no-store`.

### A2. Auth

`hooks.server.ts` currently redirects every non-public path to `/login`. A headless Pi
cannot hold a session cookie, so add a bearer-token short-circuit **before** the session
check:

- New env var `DASHBOARD_TOKEN` (long random string; document in `.env.example`).
- If the path is `/api/dashboard` and `Authorization: Bearer <token>` matches, allow the
  request and skip the session redirect.
- Compare with a timing-safe equality check, not `===`.
- If `DASHBOARD_TOKEN` is unset or empty, the route is **disabled** and returns 404 — not
  open. Absence of config must never mean absence of auth.
- A valid session cookie should also grant access, so the endpoint is inspectable in a
  browser while logged in.

### A3. Timezone

`§6` already documents that cron runs in the container's timezone — UTC on Fly unless `TZ`
is set. This becomes a correctness bug once a display renders "due today": Table computing
in UTC and the Pi computing in Eastern disagree for a five-hour window every night, which
is exactly when someone is looking at a midnight deadline.

- Set `TZ=America/New_York` on the Fly machine.
- Return `dueDate` as the plain `YYYY-MM-DD` string already stored. Do not convert to
  instants or append a time.
- Include the `timezone` field in the response so the client can do relative-day math
  ("today" / "tomorrow") against the same zone the server used.

### A4. Tests

- Serialiser is a pure function in its own module with a colocated `*.test.ts`, per the
  §9 convention. The route handler stays thin.
- Cover: zone resolution for a loose task (expect `null`), a task inside overlapping zones
  (expect the smaller-area zone, matching `zoneForTask`), null `dueDate` ordering, and the
  auth matrix (no header → 404/401, wrong token → 401, unset env → 404).

---

## Part B — LMS sync hardening

Current failure modes in `canvas/sync.ts`, all of which become silent-stale-display bugs
once Part A ships.

### B1. Rename the module

`canvas/` → `lms/`. In this codebase "canvas" already means the infinite spatial canvas
(`zones.ts`, `BlobView.svelte`). Having `canvas/sync.ts` mean the LMS is a collision that
will mislead every future reader. Mechanical rename; do it in its own commit.

Env vars follow: `CANVAS_ICAL_URL` → `LMS_ICAL_URL`, `CANVAS_SYNC_CRON` →
`LMS_SYNC_CRON`. Both are currently undocumented — add all of them to `.env.example` as
part of this change.

### B2. Never throw on a missing zone

The sync currently requires a zone **literally named `Canvas`** and throws otherwise. A
zone rename is a one-click action with no warning, and the cron failure surfaces nowhere.

- Replace the name lookup with `LMS_ZONE_ID` (env, zone `id`). IDs survive renames.
- If the ID is unset, missing, or points to a deleted zone: **place tasks on bare table**
  and continue. Loose tasks are a first-class state the model already handles —
  `zoneForTask` returns `null`, Bento buckets them as `Uncategorized`. Sync must not be
  able to fail on zone configuration.
- Log a warning on fallback. Never throw.

This also removes the last place where a zone is addressed by name rather than geometry,
which restores the §4 invariant that grouping is computed, never stored.

### B3. Spread placement

New tasks currently land at the zone's top-left + 20px — *all of them* — so a sync pulling
six assignments stacks six cards nearly on top of each other, requiring manual dragging
every cycle.

- New pure module `src/lib/placement.ts` with colocated tests, following the `zones.ts` /
  `bento.ts` split:

  ```ts
  nextFreeSlot(
    occupied: Array<{ x: number; y: number }>,
    bounds: { x: number; y: number; width: number; height: number },
    card = DEFAULT_CARD
  ): { x: number; y: number }
  ```

- Walks a grid inside `bounds`, returns the first anchor whose card rect does not overlap
  an occupied card. Falls back to the last row when the zone is full rather than returning
  `null` — a placed-imperfectly task beats a dropped one.
- Reuse `DEFAULT_CARD` from `zones.ts`. Do not redefine card dimensions.
- For the bare-table fallback in B2, pass a synthetic bounds rect in an empty region.

### B4. Manual trigger

`POST /api/lms/sync` (session-gated, normal auth) plus a small toolbar button. Currently
the only way to exercise a sync change is to wait up to six hours or restart the process,
which makes B2 and B3 effectively untestable by hand. Returns a summary:
`{ created, updated, placedLoose }`.

### B5. Tests for the upsert path

The parser is tested; the upsert is not. Both of its behaviours are the quiet-breakage
kind:

- `externalId` dedupe — a second sync of the same feed creates nothing.
- Existing tasks get **only** `dueDate` refreshed; a user's edits to `title`, `notes`,
  `priority`, and crucially `x`/`y` survive. A sync that resets positions would silently
  undo the user's spatial grouping, which is the app's core interaction.
- Nothing is deleted when an event disappears from the feed.

---

## 5. The one shared thing

`ZONE_COLORS` (`sage | sky | butter | blush | lilac | clay`) should map to muted
dark-theme equivalents on the display, so a zone reads as the same *identity* in both
places while being tuned for a dim room. The endpoint returns the color **token name**,
never a hex value — the display owns its own palette. Do not export hex from Table for
this purpose.

---

## 6. Manual verification

Per §9, no self-verification by running the app. Steps for the user:

1. `flyctl secrets set DASHBOARD_TOKEN=…` and confirm `TZ=America/New_York` is set on the
   machine.
2. `curl -H "Authorization: Bearer …" $PUBLIC_APP_URL/api/dashboard` — expect JSON with
   populated `zone` objects and at least one `null` zone if a loose task exists.
3. Same curl with no header, and with a wrong token — expect 401. Unset the secret and
   expect 404.
4. Rename the LMS zone in the UI, trigger `POST /api/lms/sync` — expect success, with new
   tasks appearing loose on bare table rather than an error.
5. Trigger sync twice against the same feed — expect the second run to create nothing.
6. Move a synced task, edit its title, trigger sync — expect position and title preserved,
   due date refreshed.

---

## 7. Commits

Trunk-based, Conventional Commits, one concern each:

```
refactor(lms): rename canvas module to lms
fix(lms): fall back to loose placement when zone is missing
feat(placement): add nextFreeSlot grid packing
test(lms): cover upsert dedupe and field preservation
feat(lms): add manual sync trigger
feat(dashboard): add read-only dashboard endpoint
feat(auth): allow bearer token for dashboard endpoint
docs(env): document lms and dashboard env vars
```
