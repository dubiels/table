# Agent API

A token-authenticated JSON API over Tasks and Dinner Table, for a machine
client. Complete payloads in one call, replayable writes, and no query
interpretation — the caller does its own language understanding.

Everything here is additive. The web UI, its form actions, and `/api/dashboard`
are untouched by it.

## Authentication

Set `AGENT_TOKEN` to a long random string. Every request sends it as a bearer
token:

```
Authorization: Bearer <AGENT_TOKEN>
```

| Situation                         | Response                                     |
| --------------------------------- | -------------------------------------------- |
| `AGENT_TOKEN` unset or empty      | `404` with a plain-text body, on every route |
| Missing, malformed or wrong token | `401` with a JSON error                      |
| Valid token                       | the route runs                               |

The 404 is deliberate: an unconfigured API must be indistinguishable from one
that does not exist, so a missing environment variable can never leave the
routes open.

Session cookies do **not** work here, unlike `/api/dashboard`. The credential is
separate so it can be revoked on its own — clearing `AGENT_TOKEN` cuts the agent
off without touching how anyone signs in.

## Conventions

- Request and response bodies are JSON objects.
- `PATCH` is a true patch: an **absent key is left alone**, and an explicit
  `null` **clears** the field. This is the one thing to get right — sending
  `{"notes": null}` erases the notes, sending `{}` does nothing.
- Dates the user picked (`dueDate`, `plannedDate`, `metOn`, `occurredOn`,
  `lastSpokeAt`) are `YYYY-MM-DD` local calendar dates, with no time and no
  zone. Timestamps (`createdAt`, `updatedAt`, `archivedAt`) are ISO 8601
  instants.
- Reads send `Cache-Control: no-store`.

## Idempotency

Every write accepts an optional key, either as a header or as a body field. The
header wins if both are present.

```
Idempotency-Key: <your-key>
```

```json
{ "title": "Draft the memo", "idempotencyKey": "your-key" }
```

A repeated key returns the **original** result rather than performing the write
again, with `Idempotency-Replayed: true` on the response.

| Case                                        | Behaviour                                                    |
| ------------------------------------------- | ------------------------------------------------------------ |
| First use of a key                          | The write runs; its 2xx result is stored                     |
| Same key, same route, finished              | The original status and body are replayed                    |
| Same key, same route, still running         | `409 idempotency_key_in_flight`                              |
| Same key, a different route                 | `409 idempotency_key_reused`                                 |
| The first attempt failed (non-2xx or threw) | The key is released, so a corrected retry is a fresh attempt |

Failures are deliberately not stored. A cached `400` would be permanent: you
would fix the payload, retry under the key you already used, and be handed the
old rejection forever.

`PUT /tasks/{id}/done` is safe to replay even without a key, because it states
the target rather than toggling.

## Errors

```json
{
	"error": {
		"code": "invalid_body",
		"message": "Request failed validation",
		"details": [{ "path": "title", "message": "title cannot be empty" }]
	}
}
```

`details` is present only on validation failures.

| Status | Code                        | Meaning                                                  |
| ------ | --------------------------- | -------------------------------------------------------- |
| 400    | `invalid_body`              | Body is not JSON, is not an object, or failed the schema |
| 400    | `invalid_query`             | A query parameter was not a recognised value             |
| 401    | `unauthorized`              | Missing, malformed or wrong bearer token                 |
| 404    | `not_found`                 | The task, person, flag or zone does not exist            |
| 409    | `idempotency_key_reused`    | The key belongs to a different operation                 |
| 409    | `idempotency_key_in_flight` | An earlier request with this key has not finished        |
| 500    | `internal`                  | Unexpected server fault. Safe to retry with the same key |

A route reached while `AGENT_TOKEN` is unset returns `404` with a plain-text
body and no JSON envelope.

## Categories are positions

A task has no category column. It belongs to a zone when the centre of its card
falls inside that zone's rectangle — one truth, rendered two ways: the canvas
draws the coordinates, the bento view groups by them.

So writes take `zoneId` and the server translates it to coordinates, choosing
the first free slot in that zone exactly as a bento drop does.

| `zoneId`  | Effect                                                          |
| --------- | --------------------------------------------------------------- |
| Omitted   | On create, the default anchor. On patch, the task does not move |
| A zone id | Placed in a free slot inside that zone                          |
| `null`    | Moved clear of every zone — uncategorised                       |

An unknown zone id is a `404`, never a silent no-op.

---

# Reads

## `GET /api/agent/tasks`

Every task, with every field.

| Query              | Default | Meaning                                                                |
| ------------------ | ------- | ---------------------------------------------------------------------- |
| `includeCompleted` | `true`  | Set `false` to return only open tasks                                  |
| `since`            | none    | Return only tasks whose latest stamp is at or after this ISO timestamp |

```json
{
	"tasks": [
		{
			"id": "0f4c…",
			"title": "Draft the Q3 memo",
			"notes": "for Tuesday",
			"dueDate": "2026-09-15",
			"plannedDate": "2026-09-01",
			"priority": "high",
			"done": false,
			"completedAt": null,
			"zone": { "id": "9ab1…", "name": "Work", "color": "sage" },
			"source": "manual",
			"courseName": null,
			"externalId": null,
			"personId": null,
			"position": { "x": 60, "y": 60 },
			"google": {
				"sync": true,
				"taskId": "MTIzNDU2",
				"syncedAt": "2026-08-21T10:04:00.000Z",
				"updatedAt": "2026-08-21T10:04:01.000Z",
				"error": null
			},
			"createdAt": "2026-08-20T09:00:00.000Z",
			"updatedAt": "2026-08-21T10:04:00.000Z"
		}
	]
}
```

Sorted newest activity first. `source` is `manual`, `canvas` or `google`.

> **`since` is a bandwidth hint, not a change feed.**
> `updatedAt` moves only for fields Google can see — title, notes, planned date
> and done. Priority, position, category, the person link and the due date
> deliberately leave it alone, because dirtiness against Google is defined as
> `updatedAt !== googleSyncedAt`, and a drag that bumped it would fire pointless
> API calls and let that drag win a conflict against a real edit made on a
> phone. `since` therefore also considers `createdAt` and `completedAt`, but it
> can still miss a priority or category change. **Do a full read periodically.**

## `GET /api/agent/people`

Every person, with their flags, reach-out log, notes, to-meet status and
archived state.

| Query             | Default | Meaning                             |
| ----------------- | ------- | ----------------------------------- |
| `includeArchived` | `true`  | Set `false` to omit archived people |

```json
{
	"people": [
		{
			"id": "7c2e…",
			"name": "Devon Reyes",
			"status": "met",
			"archived": false,
			"archivedAt": null,
			"linkedinUrl": "https://linkedin.com/in/devonreyes",
			"email": "devon@example.com",
			"phone": null,
			"company": "Cadence",
			"role": "Founder",
			"city": "San Francisco, CA",
			"cityId": 5391959,
			"metAt": "Ana's dinner party",
			"metOn": "2026-08-01",
			"lastSpokeAt": "2026-08-20",
			"notes": "Building developer tooling. Offered to intro me to Priya.",
			"flags": [{ "id": "f1a2…", "name": "SF", "color": "sky" }],
			"touchpoints": [
				{
					"id": "t9b0…",
					"occurredOn": "2026-08-20",
					"note": "coffee, talked hiring",
					"createdAt": "2026-08-20T18:12:00.000Z"
				}
			],
			"createdAt": "2026-08-01T20:00:00.000Z",
			"updatedAt": "2026-08-20T18:12:00.000Z"
		}
	]
}
```

`status` is `met` or `to_meet`. Someone with `to_meet` has no meeting date and
no last-spoke date — they are a wishlist entry, not a quiet contact.

Flags are resolved to names inline, so grouping people by flag needs no second
call. Touchpoints are newest first.

## `GET /api/agent/meta`

Categories and flags.

```json
{
	"zones": [
		{
			"id": "9ab1…",
			"name": "Work",
			"color": "sage",
			"bounds": { "x": 60, "y": 60, "width": 320, "height": 320 }
		}
	],
	"flags": [{ "id": "f1a2…", "name": "SF", "color": "sky" }]
}
```

Colors are palette keys: `sage`, `sky`, `butter`, `blush`, `lilac`, `clay`,
`ember`.

`bounds` is the rectangle that defines the category. You do not need it to file
a task — send `zoneId` and the server picks the slot.

---

# Writes — tasks

## `POST /api/agent/tasks` → `201`

| Field         | Type                             | Notes                                      |
| ------------- | -------------------------------- | ------------------------------------------ |
| `title`       | string                           | Required, non-empty                        |
| `notes`       | string \| null                   |                                            |
| `dueDate`     | `YYYY-MM-DD` \| null             | Table's own deadline. Never sent to Google |
| `plannedDate` | `YYYY-MM-DD` \| null             | The day Google sees                        |
| `priority`    | `low` \| `med` \| `high` \| null |                                            |
| `personId`    | string \| null                   | Must exist                                 |
| `zoneId`      | string \| null                   | See _Categories are positions_             |
| `googleSync`  | boolean                          | Honoured only alongside a `plannedDate`    |

```json
{ "title": "Draft the Q3 memo", "plannedDate": "2026-09-01", "zoneId": "9ab1…" }
```

Returns `{ "task": { … } }`.

`googleSync` without a planned date is ignored rather than rejected: an undated
Google task never reaches the calendar grid, which is the whole point of pushing
it. This matches the board's composer. Sending a task to Google is choosing
which day to put it on, so it is `plannedDate` — the shiftable day you plan to
do the work — that gates syncing, not `dueDate`, the last-possible day.

## `PATCH /api/agent/tasks/{id}` → `200`

Accepts `title`, `notes`, `dueDate`, `plannedDate`, `priority`, `personId`,
`zoneId`. At least one key is required; an empty patch is a `400`.

There is no `googleSync` field here: opting in is create-only. A task made
without a planned date, or with `googleSync` omitted, has no way to reach
Google through this endpoint afterward — the web form covers that case with
the detail panel and the badge, which this API does not yet have.

```json
{ "priority": "low", "notes": null, "personId": "7c2e…" }
```

Returns `{ "task": { … } }`.

A field re-sent with the value it already holds is not written, so echoing a
whole record back does not mark the task dirty against Google.

## `PUT /api/agent/tasks/{id}/done` → `200`

```json
{ "done": true }
```

Returns `{ "task": { … } }`. Sets `completedAt` when completing and clears it
when reopening. States the target rather than toggling, so it is safe to replay.

## `DELETE /api/agent/tasks/{id}` → `200`

No body. Returns `{ "deleted": "<id>" }`.

A task mirrored into Google is deleted there too. That deletion is tombstoned in
the same transaction as the local delete, so a failure to reach Google is
retried by the next reconcile rather than leaking a task on the phone.

# Writes — people

## `POST /api/agent/people` → `201`

| Field                               | Type                 | Notes                                             |
| ----------------------------------- | -------------------- | ------------------------------------------------- |
| `name`                              | string               | Required, non-empty                               |
| `status`                            | `met` \| `to_meet`   | Defaults to `met`                                 |
| `linkedinUrl`                       | string \| null       | A bare host is upgraded to `https://`             |
| `email`, `phone`, `company`, `role` | string \| null       | Stored as given                                   |
| `city`                              | string \| null       | Free text unless `cityId` is set                  |
| `cityId`                            | number \| null       | A GeoNames id                                     |
| `metAt`                             | string \| null       | Free text: "Ana's dinner party"                   |
| `metOn`                             | `YYYY-MM-DD` \| null | Defaults to today for `met`, absent for `to_meet` |
| `lastSpokeAt`                       | `YYYY-MM-DD` \| null | Defaults to `metOn`                               |
| `notes`                             | string \| null       |                                                   |
| `flagIds`                           | string[]             | Every id must exist                               |

Returns `{ "person": { … } }`.

A `cityId` owns the text beside it: when it resolves, `city` is rewritten from
the matched row and whatever you sent is discarded. An id that matches nothing
is not an error — it degrades to free text, and `cityId` comes back `null`.

Names are **not** de-duplicated. Two people may share a name, and deciding they
are the same person is a judgement this API does not make. Use an idempotency
key to make a retry safe.

## `PATCH /api/agent/people/{id}` → `200`

Same fields as create, minus `flagIds`, all optional. At least one key required.

`city` and `cityId` move as a pair — send either and both are re-derived, with
the half you did not send taken from the stored record.

## `POST /api/agent/people/{id}/archive` → `200`

No body. Returns `{ "id", "archived": true, "archivedAt" }`.

## `DELETE /api/agent/people/{id}/archive` → `200`

Restores. Returns `{ "id", "archived": false, "archivedAt": null }`.

There is no way to delete a person. A hand-written paragraph about someone met
once cannot be recovered from anywhere, so the archive is the floor.

# Writes — touchpoints

## `POST /api/agent/people/{id}/touchpoints` → `201`

```json
{ "occurredOn": "2026-08-20", "note": "coffee, talked hiring" }
```

Returns `{ "touchpoint": { … } }`.

The person's `lastSpokeAt` moves forward only if this is their most recent
contact. Logging a coffee you had forgotten about from March will not rewrite
"last spoke" to March when you also spoke last week.

# Writes — flags

## `POST /api/agent/flags` → `201`

```json
{ "name": "SF", "color": "sky" }
```

Returns `{ "flag": { … } }`.

Matching is case-insensitive: posting `sf` when `SF` exists returns the existing
flag rather than creating a near-duplicate. The name is stored as first typed.
`color` defaults to `sage`.

## `POST /api/agent/people/{id}/flags` → `200`

```json
{ "flagId": "f1a2…" }
```

Returns `{ "personId", "flag" }`. Attaching a flag the person already carries is
a no-op, not an error.

## `DELETE /api/agent/people/{id}/flags/{flagId}` → `200`

No body. Returns `{ "personId", "flagId", "detached": true }`.

Succeeds whether or not the flag was attached — the end state it asks for is
already true otherwise, and a `404` would make a retry after a successful
detach look like a failure.

---

## What writes trigger

Every write goes through the same service functions the web UI's form actions
call, so Google Tasks two-way sync, conflict handling and tombstones apply
unchanged. Nothing here writes to the database directly.

Task writes are followed by an immediate Google push when the integration is
configured and the task opts in. That push is bounded and never throws: if
Google is unreachable the write still succeeds locally and the next reconcile
retries it.

## Worked example

```sh
TOKEN=…
BASE=https://your-host/api/agent

# What categories exist?
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/meta"

# File a task in one, safely retryable.
curl -s -X POST "$BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: memo-2026-08-21" \
  -d '{"title":"Draft the Q3 memo","dueDate":"2026-09-01","zoneId":"9ab1…"}'

# Log that you spoke to someone.
curl -s -X POST "$BASE/people/7c2e…/touchpoints" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"occurredOn":"2026-08-21","note":"call about the intro"}'

# Tick it off.
curl -s -X PUT "$BASE/tasks/0f4c…/done" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```
