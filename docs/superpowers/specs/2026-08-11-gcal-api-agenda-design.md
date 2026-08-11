# Table — Google Calendar agenda via the Calendar API

**Date:** 2026-08-11
**Status:** Proposed

---

## 1. Motivation

The side panel's **Today** section reads Google Calendar through "secret address in iCal
format" URLs listed in `GCAL_ICAL_URLS`. Two problems follow from that choice.

**The data is stale.** Google regenerates the secret `.ics` document on its own schedule,
independent of the app. An event added in the morning can take hours to appear on the
board. The 10-minute cache in `service.ts` cannot fix this: it caches a document that was
already old when it arrived.

**It requires a Workspace policy change.** The account lives on a managed domain whose
admin restricts external calendar sharing, which hides the secret address. Enabling it
means loosening a domain-wide sharing ceiling — a permission grant that has nothing to do
with this app and that outlives it.

The Calendar API solves both. It returns live data on every call, and it authenticates as
the account owner rather than publishing to an outsider, so the sharing ceiling never
applies. The API costs nothing and needs no billing account.

Two smaller wins come free. Google expands recurring events server-side, which deletes the
hand-rolled `rrule` expansion in `agenda.ts`. And the API exposes attendance status, so
declined meetings stop appearing.

---

## 2. Non-goals

- **No write path.** The agenda stays display-only. The OAuth scope is read-only, so the
  app cannot create, edit, or delete events even by mistake.
- **No in-app connect flow.** No OAuth routes, no token table, no "Connect" button. Table
  configures every integration through environment variables, and a single-user
  self-hosted app gains little from a browser flow it runs once.
- **No push notifications.** Watch channels need a public callback route, renewal on cron,
  and state that survives restarts — heavy machinery for a rail that refreshes on page
  load.
- **No ICS fallback.** `GCAL_ICAL_URLS` is removed outright. Two sources mean two code
  paths and two sets of tests forever, to guard against a failure that degrades gracefully
  already.
- **No richer event display.** `AgendaEvent` keeps its exact shape. Attendees, organizers,
  conferencing links, and colors stay unread, and `SidePanel.svelte` stays untouched.
- **No change to the Canvas LMS feed.** `LMS_ICAL_URL` and `lms/ical-parser.ts` are a
  separate integration against a separate system. The `ical` dependency stays for them.

---

## 3. Architecture

Four server modules replace the current two, plus a script that runs outside the app. Each
has one job and one direction of dependency.

| Module | Exports | Knows about |
|---|---|---|
| `gcal/oauth.ts` *(new)* | `getAccessToken(): Promise<string>` | env, `fetch` |
| `gcal/client.ts` *(new)* | `listEvents(calendarId, timeMin, timeMax, token): Promise<GoogleEvent[]>` | `fetch` |
| `gcal/agenda.ts` *(rewrite)* | `toAgendaEvents(items: GoogleEvent[]): AgendaEvent[]`, `AgendaEvent` | nothing |
| `gcal/service.ts` *(rewrite)* | `getAgenda(): Promise<AgendaEvent[]>` | the three above |
| `scripts/gcal-auth.ts` *(new)* | one-time consent flow | `fetch`, `node:http` |

`agenda.ts` becomes a pure function over API payloads — no network, no clock, no config.
`client.ts` performs one HTTP call and knows nothing of caching or credentials.
`service.ts` holds all the orchestration and every policy decision about failure.

### 3.1 No new dependencies

The integration needs exactly two Google endpoints, so it calls them with `fetch` directly
rather than adding `googleapis` or `@googleapis/calendar`. Both packages pull a transitive
tree sized for the whole Google API surface to serve one POST and one GET. Hand-rolling
costs roughly 80 lines, keeps the 9-package runtime dependency list intact, and lets every
test stub `fetch` instead of mocking a client library.

### 3.2 Token handling — `oauth.ts`

`getAccessToken()` exchanges the long-lived refresh token for a short-lived access token:

```
POST https://oauth2.googleapis.com/token
  grant_type=refresh_token
  refresh_token=<GCAL_REFRESH_TOKEN>
  client_id=<GCAL_CLIENT_ID>
  client_secret=<GCAL_CLIENT_SECRET>
→ { access_token, expires_in, token_type }
```

The token is held in a module-level variable and reused until 60 seconds before
`expires_in` elapses, which keeps a normal 10-minute agenda refresh down to one token call
per hour. The function throws on a non-2xx response; `service.ts` decides what that means.

### 3.3 Fetching events — `client.ts`

```
GET https://www.googleapis.com/calendar/v3/calendars/{encoded id}/events
  ?timeMin=<ISO>&timeMax=<ISO>
  &singleEvents=true&orderBy=startTime&maxResults=250
  &pageToken=<from previous page>
  Authorization: Bearer <token>
```

`singleEvents=true` instructs Google to expand recurring events into concrete instances,
which is what removes the `rrule`/`exdate` logic from `agenda.ts`. The function follows
`nextPageToken` until it is absent and returns the concatenated `items`. Calendar ids are
percent-encoded, because they are email addresses.

### 3.4 Mapping — `agenda.ts`

`AgendaEvent` is unchanged:

```ts
interface AgendaEvent {
	id: string;
	title: string;
	start: string;      // ISO
	end: string | null; // ISO
	allDay: boolean;
	location: string | null;
}
```

`toAgendaEvents()` applies these rules:

- **Drop** items with `status === 'cancelled'`. With `singleEvents=true` Google returns
  cancelled instances of a recurring series as tombstones.
- **Drop** items carrying an attendee with `self === true` and
  `responseStatus === 'declined'`.
- **`allDay`** is `true` when `start.date` is present, `false` when `start.dateTime` is.
  This replaces the `dateOnly` probe against the `ical` library's `Date` subclass.
- **All-day times** convert `YYYY-MM-DD` to midnight in the server's local timezone before
  serialising, matching both the current behaviour and the local-midnight convention used
  elsewhere in the app.
  Google reports an all-day `end.date` as the *following* day, which the mapping passes
  through unchanged, exactly as the ICS path did.
- **Timed times** parse `start.dateTime` — RFC 3339 with an offset — and normalise to a
  UTC ISO string, as today.
- **`id`** comes straight from `event.id`. Expanded instances already carry unique,
  stable ids such as `abc123_20260811T140000Z`, so the synthetic `${uid}:${iso}` key
  disappears.
- **`title`** falls back to `(untitled)`; **`location`** falls back to `null`.

Sorting moves to `service.ts`, which is the only place that sees more than one calendar.

### 3.5 Orchestration — `service.ts`

```
GCAL_REFRESH_TOKEN unset      → return []
cache fresh (< 10 min)        → return cached
otherwise:
  token ← getAccessToken()
  ids ← GCAL_CALENDAR_IDS split on "," and trimmed, or ["primary"] when unset or empty
  for each id in ids:
      listEvents(id, now, now + 7d) → toAgendaEvents()
  merge, sort by start, cache, return
```

The existing resilience contract carries over verbatim: a failing calendar logs and is
skipped so one bad feed never blanks the rail; if at least one calendar succeeds, the
successes are cached and served; if every calendar fails, the previous cached agenda is
served and the cache timestamp is left untouched so the next call retries immediately
instead of serving stale data for the rest of the TTL.

One new failure mode fits that contract without changing it. A dead or revoked refresh
token fails every calendar at once, which lands in the "nothing succeeded" branch — the
board keeps showing the last good agenda and retries on every request.

### 3.6 Window semantics change

The ICS path included an event only when its *start* fell inside the 7-day window. The API
filters by overlap, so an event that began before now and ends after now comes back too.
The meeting you are currently in therefore appears on the rail. This is a deliberate
improvement for a section titled **Today**, and it is recorded here because it is a visible
behavioural difference rather than a pure refactor.

---

## 4. Configuration

Added to `.env.example` and the Fly secrets list:

```sh
# Google Calendar agenda. Run `npm run gcal:auth` once to obtain the refresh token.
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
GCAL_REFRESH_TOKEN=
# Comma-separated calendar ids. Find them in Calendar settings > your calendar >
# "Integrate calendar" > Calendar ID. Defaults to the account's primary calendar.
GCAL_CALENDAR_IDS=primary
```

Removed: `GCAL_ICAL_URLS`.

`src/routes/(app)/+page.server.ts` derives `gcalConfigured` from the same variable
`getAgenda()` reads, so the panel can distinguish "no calendar connected" from "a quiet
week" — two empty states that want different copy. That test moves from
`Boolean(env.GCAL_ICAL_URLS)` to `Boolean(env.GCAL_REFRESH_TOKEN)`. `TodayPanel.svelte`
consumes the flag unchanged.

**Scope:** `https://www.googleapis.com/auth/calendar.events.readonly` — the narrowest
scope that serves the feature. It permits reading events on calendars named in the
config and nothing else: no writes, no calendar management, no discovery of calendars the
config does not name.

**OAuth client type:** Desktop app, which permits a loopback redirect and spares the
script a registered public callback URL.

**Publish the consent screen.** A client left in Testing mode expires refresh tokens after
seven days, which presents later as an agenda that mysteriously empties a week after
setup. Publishing removes the expiry. The unverified-app warning during the one-time
script run is expected and harmless for a single self-authorised account.

**Workspace note.** The domain admin can restrict third-party app access under Admin
console → Security → API controls. If that blocks the client, the admin must trust this
one client id — a narrower grant than the external-sharing change the ICS route required,
and the reason this design is preferred.

---

## 5. The authorisation script

`scripts/gcal-auth.ts`, run as `npm run gcal:auth` through the existing `tsx` devDependency:

1. Start a `node:http` server on a loopback port.
2. Print the consent URL, including `access_type=offline` and `prompt=consent`. Both are
   required; without them Google returns an access token and no refresh token.
3. Receive `?code=` on the callback, exchange it for tokens, print the refresh token, and
   exit.

The script writes nothing. It prints the value and the operator places it in `.env` or in
`flyctl secrets set`, which keeps the credential out of the repository and matches how
every other secret in the project is handled.

---

## 6. Testing

Every test stubs `fetch`. No test reaches the network.

**`oauth.test.ts`**
- Returns the access token from a successful refresh.
- Reuses the cached token on a second call within its lifetime, issuing one HTTP call.
- Refetches once the token is inside the 60-second expiry skew.
- Throws on a non-2xx token response.

**`client.test.ts`**
- Sends `timeMin`, `timeMax`, `singleEvents=true`, and `orderBy=startTime`.
- Percent-encodes a calendar id containing `@`.
- Concatenates pages while `nextPageToken` is present, then stops.
- Sends the bearer token.

**`agenda.test.ts`** *(rewritten from the current ICS tests)*
- Maps a timed event to a UTC ISO start and end.
- Maps an all-day event to local midnight with `allDay: true`.
- Passes an all-day exclusive `end.date` through unchanged.
- Returns `end: null` when the payload has no end.
- Drops `status: 'cancelled'`.
- Drops an event the account declined, and keeps one it accepted.
- Keeps an event declined by *another* attendee.
- Falls back to `(untitled)` and `location: null`.

**`service.test.ts`** *(new)*
- Returns `[]` when `GCAL_REFRESH_TOKEN` is unset, without calling `fetch`.
- Merges two calendars into one list sorted by start.
- Serves the successes when one calendar of two fails.
- Serves the previous cache and leaves the timestamp untouched when every calendar fails,
  so the following call retries.
- Serves cached events inside the TTL without refetching.

The `service.ts` cases matter most. That resilience contract is documented in a docstring
today but never exercised, and it is the behaviour most likely to break during the swap.

---

## 7. Rollout

No database migration. No schema change. No change to `/api/dashboard` or to any route
contract, because `getAgenda()` keeps its signature and its single consumer at
`src/routes/(app)/+page.server.ts:16`.

1. Create the Cloud project, enable the Calendar API, create the Desktop OAuth client,
   publish the consent screen.
2. Land the code with `GCAL_REFRESH_TOKEN` unset — the agenda returns `[]` and the panel
   shows its setup guide, exactly as it does today before configuration.
3. Run `npm run gcal:auth`, set the four variables locally, verify.
4. `flyctl secrets set` the same four values and unset `GCAL_ICAL_URLS`.

Rewrite the **Google Calendar agenda** section of `README.md` to describe the OAuth setup
in place of the secret-address instructions.

### Manual verification

1. With `GCAL_REFRESH_TOKEN` unset, load the board — the **Today** section shows the setup
   guide, and the server logs nothing.
2. Set all four variables, reload — today's events appear, ordered, with times.
3. Add an event in Google Calendar, wait for the cache TTL, reload — it appears.
4. Decline a meeting in Google Calendar, wait for the TTL, reload — it disappears.
5. Confirm a weekly recurring event shows one instance per occurrence across the 7-day
   window, and none outside it.
6. Set a bogus `GCAL_REFRESH_TOKEN`, reload — the rail keeps its last agenda rather than
   emptying, and the server logs the failure.
7. Add a nonexistent calendar id alongside a good one, reload — the good calendar's events
   still render, and the bad id logs and is skipped.
