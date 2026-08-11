# Google Calendar API Agenda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Table's ICS-based Google Calendar agenda with the Google Calendar API, so the side panel's **Today** section shows live events instead of a document Google regenerates on its own schedule.

**Architecture:** Four server modules with one direction of dependency — `oauth.ts` turns a refresh token into an access token, `client.ts` performs one authenticated GET per calendar, `agenda.ts` maps API payloads to the existing `AgendaEvent` shape as a pure function, and `service.ts` orchestrates and owns every failure decision. A one-time `scripts/gcal-auth.ts` obtains the refresh token outside the app.

**Tech Stack:** SvelteKit 2, TypeScript, Vitest, `fetch` (no new dependencies), `tsx` for the auth script.

**Spec:** `docs/superpowers/specs/2026-08-11-gcal-api-agenda-design.md`

## Global Constraints

- **No new runtime dependencies.** The integration calls two Google endpoints with `fetch`. Do not add `googleapis`, `@googleapis/calendar`, `google-auth-library`, or `dotenv`.
- **`AgendaEvent` keeps its exact shape** — `{ id, title, start, end, allDay, location }`. It is imported as a type by `src/lib/agenda.ts` and `src/lib/components/TodayPanel.svelte`; neither file may change.
- **`getAgenda(): Promise<AgendaEvent[]>` keeps its signature.** Its only consumer is `src/routes/(app)/+page.server.ts:16`.
- **`getAgenda()` never throws.** Unconfigured returns `[]`; total failure returns the previous cache.
- **The `ical` package stays in `package.json`.** `src/lib/server/lms/ical-parser.ts` still uses it. Only the `gcal/` module stops importing it.
- **OAuth scope is exactly** `https://www.googleapis.com/auth/calendar.events.readonly`.
- **Cache TTL stays 10 minutes; the agenda window stays 7 days.**
- **Tests never touch the network.** Stub `fetch` or mock the neighbouring module.
- **Test timezone is `America/New_York`**, pinned in `vite.config.ts`. August dates are EDT (UTC−4), so local midnight on `2026-08-11` serialises as `2026-08-11T04:00:00.000Z`.
- **Vitest runs with `expect: { requireAssertions: true }`** — every `it()` must assert.
- Run the full suite with `npm run test` (single pass). `npm run test:unit` is watch mode.

## Working Tree Note

`src/routes/(app)/+page.server.ts` has uncommitted changes, and `src/lib/server/tasks/forms.ts` is untracked. **Commit or stash that work before starting Task 5**, which edits one line of `+page.server.ts`. Tasks 1–4 touch no file you have in flight.

---

### Task 1: OAuth access tokens

**Files:**
- Create: `src/lib/server/gcal/oauth.ts`
- Test: `src/lib/server/gcal/oauth.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getAccessToken(): Promise<string>` — returns a Google OAuth access token, cached in memory until 60 seconds before it expires. Throws `Error` on a non-2xx token response.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/gcal/oauth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

function tokenResponse(accessToken: string, expiresIn = 3600) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ access_token: accessToken, expires_in: expiresIn })
	};
}

// The token cache lives in a module-level variable, so each test needs a fresh
// copy of the module rather than a shared one carrying the previous token.
async function freshOauth() {
	vi.resetModules();
	return import('./oauth');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.GCAL_CLIENT_ID = 'client-id';
	mockEnv.GCAL_CLIENT_SECRET = 'client-secret';
	mockEnv.GCAL_REFRESH_TOKEN = 'refresh-token';

	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('getAccessToken', () => {
	it('returns the access token from a successful refresh', async () => {
		fetchMock.mockResolvedValue(tokenResponse('access-1'));
		const { getAccessToken } = await freshOauth();
		expect(await getAccessToken()).toBe('access-1');
	});

	it('sends the refresh grant with the configured credentials', async () => {
		fetchMock.mockResolvedValue(tokenResponse('access-1'));
		const { getAccessToken } = await freshOauth();
		await getAccessToken();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://oauth2.googleapis.com/token');
		expect(init.method).toBe('POST');
		const body = new URLSearchParams(String(init.body));
		expect(body.get('grant_type')).toBe('refresh_token');
		expect(body.get('refresh_token')).toBe('refresh-token');
		expect(body.get('client_id')).toBe('client-id');
		expect(body.get('client_secret')).toBe('client-secret');
	});

	it('reuses the cached token within its lifetime', async () => {
		fetchMock.mockResolvedValue(tokenResponse('access-1'));
		const { getAccessToken } = await freshOauth();
		await getAccessToken();
		await getAccessToken();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('refetches once the token is inside the expiry skew', async () => {
		fetchMock.mockResolvedValueOnce(tokenResponse('access-1', 3600));
		const { getAccessToken } = await freshOauth();
		expect(await getAccessToken()).toBe('access-1');

		// 3600s lifetime minus the 60s skew means the cached token goes stale
		// at 3540s. Step just past that.
		vi.advanceTimersByTime(3541 * 1000);
		fetchMock.mockResolvedValueOnce(tokenResponse('access-2', 3600));
		expect(await getAccessToken()).toBe('access-2');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('throws when the token endpoint rejects the refresh token', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
		const { getAccessToken } = await freshOauth();
		await expect(getAccessToken()).rejects.toThrow('HTTP 400');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/server/gcal/oauth.test.ts`
Expected: FAIL — `Failed to load url ./oauth` / cannot find module.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/gcal/oauth.ts`:

```ts
import { env } from '$env/dynamic/private';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Treat a token as expired a minute early so a request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A Google OAuth access token for the configured refresh token, cached in
 * memory until shortly before it expires. Access tokens last an hour and the
 * agenda refreshes every ten minutes, so this makes one network call per hour
 * rather than one per agenda fetch.
 *
 * Throws on a failed refresh. Callers decide what that means — see
 * `service.ts`, which treats it as "serve the last good agenda and retry".
 */
export async function getAccessToken(): Promise<string> {
	if (cached && Date.now() < cached.expiresAt) return cached.token;

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: env.GCAL_REFRESH_TOKEN ?? '',
		client_id: env.GCAL_CLIENT_ID ?? '',
		client_secret: env.GCAL_CLIENT_SECRET ?? ''
	});

	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);

	const json = (await res.json()) as { access_token: string; expires_in: number };
	cached = {
		token: json.access_token,
		expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS
	};
	return cached.token;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/server/gcal/oauth.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gcal/oauth.ts src/lib/server/gcal/oauth.test.ts
git commit -m "feat(gcal): add oauth access token refresh"
```

---

### Task 2: Calendar API client

**Files:**
- Create: `src/lib/server/gcal/client.ts`
- Test: `src/lib/server/gcal/client.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface GoogleEventTime { date?: string; dateTime?: string }`
  - `interface GoogleEvent { id: string; status?: string; summary?: string; location?: string; start?: GoogleEventTime; end?: GoogleEventTime; attendees?: { self?: boolean; responseStatus?: string }[] }`
  - `listEvents(calendarId: string, timeMin: Date, timeMax: Date, accessToken: string): Promise<GoogleEvent[]>` — all pages concatenated. Throws `Error` on a non-2xx response.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/gcal/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listEvents } from './client';

const timeMin = new Date('2026-08-11T00:00:00Z');
const timeMax = new Date('2026-08-18T00:00:00Z');

function page(items: unknown[], nextPageToken?: string) {
	return { ok: true, status: 200, json: async () => ({ items, nextPageToken }) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('listEvents', () => {
	it('requests expanded, time-ordered instances inside the window', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listEvents('primary', timeMin, timeMax, 'access-token');

		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.pathname).toBe('/calendar/v3/calendars/primary/events');
		expect(url.searchParams.get('timeMin')).toBe('2026-08-11T00:00:00.000Z');
		expect(url.searchParams.get('timeMax')).toBe('2026-08-18T00:00:00.000Z');
		expect(url.searchParams.get('singleEvents')).toBe('true');
		expect(url.searchParams.get('orderBy')).toBe('startTime');
	});

	it('sends the access token as a bearer credential', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listEvents('primary', timeMin, timeMax, 'access-token');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer access-token');
	});

	it('percent-encodes a calendar id containing an @', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listEvents('me@example.com', timeMin, timeMax, 'access-token');
		expect(String(fetchMock.mock.calls[0][0])).toContain('/calendars/me%40example.com/events');
	});

	it('follows nextPageToken until it is absent', async () => {
		fetchMock
			.mockResolvedValueOnce(page([{ id: 'a' }], 'page-2'))
			.mockResolvedValueOnce(page([{ id: 'b' }]));

		const items = await listEvents('primary', timeMin, timeMax, 'access-token');

		expect(items.map((e) => e.id)).toEqual(['a', 'b']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page-2');
	});

	it('throws on a non-2xx response', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
		await expect(listEvents('nope', timeMin, timeMax, 'access-token')).rejects.toThrow('HTTP 404');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/server/gcal/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/gcal/client.ts`:

```ts
const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const PAGE_SIZE = 250;

export interface GoogleEventTime {
	/** Present on all-day events, as `YYYY-MM-DD`. */
	date?: string;
	/** Present on timed events, as RFC 3339 with an offset. */
	dateTime?: string;
}

export interface GoogleEvent {
	id: string;
	status?: string;
	summary?: string;
	location?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * Every event instance on one calendar that overlaps [timeMin, timeMax).
 *
 * `singleEvents=true` makes Google expand recurring events into concrete
 * instances server-side, which is why nothing here or in agenda.ts parses an
 * rrule. Instances arrive with their own stable ids.
 */
export async function listEvents(
	calendarId: string,
	timeMin: Date,
	timeMax: Date,
	accessToken: string
): Promise<GoogleEvent[]> {
	const items: GoogleEvent[] = [];
	let pageToken: string | undefined;

	do {
		const params = new URLSearchParams({
			timeMin: timeMin.toISOString(),
			timeMax: timeMax.toISOString(),
			singleEvents: 'true',
			orderBy: 'startTime',
			maxResults: String(PAGE_SIZE)
		});
		if (pageToken) params.set('pageToken', pageToken);

		// Calendar ids are email addresses, so the path segment needs encoding.
		const url = `${API_BASE}/${encodeURIComponent(calendarId)}/events?${params}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
		items.push(...(body.items ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return items;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/server/gcal/client.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gcal/client.ts src/lib/server/gcal/client.test.ts
git commit -m "feat(gcal): add calendar events api client"
```

---

### Task 3: Map API events to `AgendaEvent`

Rewrites `agenda.ts` from an ICS parser into a pure mapping function. The `rrule`/`exdate` expansion disappears because Task 2 asks Google to expand recurrences.

**Files:**
- Modify: `src/lib/server/gcal/agenda.ts` (replace entire contents)
- Test: `src/lib/server/gcal/agenda.test.ts` (replace entire contents)

**Interfaces:**
- Consumes: `GoogleEvent`, `GoogleEventTime` from `./client` (Task 2)
- Produces:
  - `interface AgendaEvent { id: string; title: string; start: string; end: string | null; allDay: boolean; location: string | null }` — unchanged from today
  - `toAgendaEvents(items: GoogleEvent[]): AgendaEvent[]` — mapping only. It does not sort; `service.ts` sorts once across all calendars.

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `src/lib/server/gcal/agenda.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toAgendaEvents } from './agenda';
import type { GoogleEvent } from './client';

function event(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
	return {
		id: 'e1',
		summary: 'Advising meeting',
		start: { dateTime: '2026-08-11T14:00:00Z' },
		end: { dateTime: '2026-08-11T15:00:00Z' },
		...overrides
	};
}

describe('toAgendaEvents', () => {
	it('maps a timed event to UTC ISO strings', () => {
		const [mapped] = toAgendaEvents([event({ location: 'Room 5' })]);
		expect(mapped).toEqual({
			id: 'e1',
			title: 'Advising meeting',
			start: '2026-08-11T14:00:00.000Z',
			end: '2026-08-11T15:00:00.000Z',
			allDay: false,
			location: 'Room 5'
		});
	});

	it('normalises a dateTime carrying an offset to UTC', () => {
		const [mapped] = toAgendaEvents([
			event({ start: { dateTime: '2026-08-11T10:00:00-04:00' }, end: undefined })
		]);
		expect(mapped.start).toBe('2026-08-11T14:00:00.000Z');
	});

	it('maps an all-day event to local midnight and flags it', () => {
		const [mapped] = toAgendaEvents([
			event({ start: { date: '2026-08-11' }, end: { date: '2026-08-12' } })
		]);
		// Tests are pinned to America/New_York; August is UTC-4.
		expect(mapped.start).toBe('2026-08-11T04:00:00.000Z');
		expect(mapped.allDay).toBe(true);
	});

	it("passes an all-day event's exclusive end date through unchanged", () => {
		// Google reports a one-day event as ending on the following day. The ICS
		// path did the same, so the panel's arithmetic is unaffected.
		const [mapped] = toAgendaEvents([
			event({ start: { date: '2026-08-11' }, end: { date: '2026-08-12' } })
		]);
		expect(mapped.end).toBe('2026-08-12T04:00:00.000Z');
	});

	it('returns a null end when the payload has none', () => {
		const [mapped] = toAgendaEvents([event({ end: undefined })]);
		expect(mapped.end).toBeNull();
	});

	it('drops cancelled instances of a recurring series', () => {
		expect(toAgendaEvents([event({ status: 'cancelled' })])).toEqual([]);
	});

	it('drops an event this account declined', () => {
		const declined = event({
			attendees: [{ self: true, responseStatus: 'declined' }]
		});
		expect(toAgendaEvents([declined])).toEqual([]);
	});

	it('keeps an event this account accepted', () => {
		const accepted = event({
			attendees: [{ self: true, responseStatus: 'accepted' }]
		});
		expect(toAgendaEvents([accepted])).toHaveLength(1);
	});

	it('keeps an event someone else declined', () => {
		const otherDeclined = event({
			attendees: [
				{ self: true, responseStatus: 'accepted' },
				{ responseStatus: 'declined' }
			]
		});
		expect(toAgendaEvents([otherDeclined])).toHaveLength(1);
	});

	it('falls back to a placeholder title and a null location', () => {
		const [mapped] = toAgendaEvents([event({ summary: undefined, location: undefined })]);
		expect(mapped.title).toBe('(untitled)');
		expect(mapped.location).toBeNull();
	});

	it('skips an event with no usable start', () => {
		expect(toAgendaEvents([event({ start: undefined })])).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/server/gcal/agenda.test.ts`
Expected: FAIL — `toAgendaEvents is not exported by ./agenda`.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `src/lib/server/gcal/agenda.ts`:

```ts
import type { GoogleEvent, GoogleEventTime } from './client';

export interface AgendaEvent {
	id: string;
	title: string;
	start: string;
	end: string | null;
	allDay: boolean;
	location: string | null;
}

/**
 * `YYYY-MM-DD` at midnight in the server's local zone.
 *
 * All-day events carry a bare date with no zone. Anchoring them to local
 * midnight — rather than UTC midnight — keeps them in the day the panel
 * buckets them into, and matches the convention the rest of the app uses.
 */
function localMidnight(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(year, month - 1, day).toISOString();
}

function toIso(time: GoogleEventTime | undefined): string | null {
	if (!time) return null;
	if (time.date) return localMidnight(time.date);
	if (time.dateTime) return new Date(time.dateTime).toISOString();
	return null;
}

/** True when this account is on the invite and turned it down. */
function declinedBySelf(event: GoogleEvent): boolean {
	return (event.attendees ?? []).some(
		(attendee) => attendee.self === true && attendee.responseStatus === 'declined'
	);
}

/**
 * Maps Calendar API items to the shape the Today panel renders.
 *
 * Display-only: nothing here ever touches tasks. Recurrence is already
 * expanded by the API (`singleEvents=true`), so each item is one concrete
 * occurrence with its own stable id. Sorting belongs to the caller, which is
 * the only place that sees more than one calendar.
 */
export function toAgendaEvents(items: GoogleEvent[]): AgendaEvent[] {
	const out: AgendaEvent[] = [];

	for (const event of items) {
		// Expanding a recurring series returns its cancelled occurrences as
		// tombstones rather than omitting them.
		if (event.status === 'cancelled') continue;
		if (declinedBySelf(event)) continue;

		const start = toIso(event.start);
		if (!start) continue;

		out.push({
			id: event.id,
			title: event.summary ?? '(untitled)',
			start,
			end: toIso(event.end),
			allDay: Boolean(event.start?.date),
			location: event.location || null
		});
	}

	return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/server/gcal/agenda.test.ts`
Expected: PASS — 11 tests.

Note: `npm run test` as a whole still fails at this point, because `service.ts` imports the now-deleted `upcomingEvents`. Task 4 fixes that.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gcal/agenda.ts src/lib/server/gcal/agenda.test.ts
git commit -m "refactor(gcal): map calendar api events instead of parsing ics"
```

---

### Task 4: Orchestration and failure policy

Rewrites `service.ts` to fetch through the API. The resilience contract in its docstring is preserved exactly, and gets tests for the first time.

**Files:**
- Modify: `src/lib/server/gcal/service.ts` (replace entire contents)
- Create: `src/lib/server/gcal/service.test.ts`

**Interfaces:**
- Consumes: `getAccessToken()` (Task 1), `listEvents()` (Task 2), `toAgendaEvents()` and `AgendaEvent` (Task 3)
- Produces: `getAgenda(): Promise<AgendaEvent[]>` — signature unchanged

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/gcal/service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockEnv, getAccessToken, listEvents } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	getAccessToken: vi.fn(),
	listEvents: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./oauth', () => ({ getAccessToken }));
vi.mock('./client', () => ({ listEvents }));

function event(summary: string, dateTime: string) {
	return { id: summary, summary, start: { dateTime }, end: { dateTime } };
}

// The 10-minute cache lives in a module-level variable, so each test needs a
// fresh copy of the module rather than one carrying the previous agenda.
async function freshService() {
	vi.resetModules();
	return import('./service');
}

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.GCAL_REFRESH_TOKEN = 'refresh-token';

	getAccessToken.mockReset().mockResolvedValue('access-token');
	listEvents.mockReset();

	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('getAgenda', () => {
	it('returns an empty agenda when no refresh token is configured', async () => {
		delete mockEnv.GCAL_REFRESH_TOKEN;
		const { getAgenda } = await freshService();

		expect(await getAgenda()).toEqual([]);
		expect(getAccessToken).not.toHaveBeenCalled();
	});

	it('reads the primary calendar when no ids are configured', async () => {
		listEvents.mockResolvedValue([]);
		const { getAgenda } = await freshService();
		await getAgenda();

		expect(listEvents).toHaveBeenCalledWith(
			'primary',
			expect.any(Date),
			expect.any(Date),
			'access-token'
		);
	});

	it('merges configured calendars into one list sorted by start', async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'a@example.com, b@example.com';
		listEvents
			.mockResolvedValueOnce([event('later', '2026-08-11T15:00:00Z')])
			.mockResolvedValueOnce([event('earlier', '2026-08-11T09:00:00Z')]);

		const { getAgenda } = await freshService();

		expect((await getAgenda()).map((e) => e.title)).toEqual(['earlier', 'later']);
	});

	it('serves the surviving calendar when another one fails', async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'good,bad';
		listEvents
			.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')])
			.mockRejectedValueOnce(new Error('HTTP 404'));

		const { getAgenda } = await freshService();

		expect((await getAgenda()).map((e) => e.title)).toEqual(['standup']);
	});

	it('serves cached events inside the TTL without refetching', async () => {
		listEvents.mockResolvedValue([event('standup', '2026-08-11T09:00:00Z')]);
		const { getAgenda } = await freshService();

		await getAgenda();
		await getAgenda();

		expect(listEvents).toHaveBeenCalledTimes(1);
	});

	it('serves the previous agenda and retries immediately when every calendar fails', async () => {
		listEvents.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);
		const { getAgenda } = await freshService();
		expect(await getAgenda()).toHaveLength(1);

		vi.advanceTimersByTime(11 * 60 * 1000);
		listEvents.mockRejectedValueOnce(new Error('HTTP 500'));
		expect(await getAgenda()).toHaveLength(1);

		// A total failure must not stamp the cache, or the stale agenda would be
		// served for another full TTL instead of retrying on the next request.
		listEvents.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);
		await getAgenda();
		expect(listEvents).toHaveBeenCalledTimes(3);
	});

	it('serves the previous agenda when the token refresh fails', async () => {
		listEvents.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);
		const { getAgenda } = await freshService();
		await getAgenda();

		vi.advanceTimersByTime(11 * 60 * 1000);
		getAccessToken.mockRejectedValueOnce(new Error('HTTP 400'));

		expect(await getAgenda()).toHaveLength(1);
	});

	it('returns an empty agenda when the very first fetch fails', async () => {
		listEvents.mockRejectedValue(new Error('HTTP 500'));
		const { getAgenda } = await freshService();

		expect(await getAgenda()).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/server/gcal/service.test.ts`
Expected: FAIL — `service.ts` still imports `upcomingEvents` from `./agenda`, which Task 3 removed.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `src/lib/server/gcal/service.ts`:

```ts
import { env } from '$env/dynamic/private';
import { getAccessToken } from './oauth';
import { listEvents } from './client';
import { toAgendaEvents, type AgendaEvent } from './agenda';

const TTL_MS = 10 * 60 * 1000;
const AGENDA_DAYS = 7;

let cache: { at: number; events: AgendaEvent[] } | null = null;

function calendarIds(): string[] {
	const ids = (env.GCAL_CALENDAR_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.length > 0 ? ids : ['primary'];
}

/**
 * Next 7 days of events across all configured calendars, cached 10 minutes.
 *
 * Unset GCAL_REFRESH_TOKEN means an empty agenda. A failing calendar is logged
 * and skipped so one bad calendar never blanks the whole rail: if at least one
 * calendar succeeds, the successes are served and cached. If every configured
 * calendar fails on a given round — including when the shared token refresh is
 * what failed — the previous cached agenda (if any) is served as-is and the
 * cache timestamp is left untouched, so the next call retries immediately
 * instead of serving stale data for the rest of the TTL.
 */
export async function getAgenda(): Promise<AgendaEvent[]> {
	if (!env.GCAL_REFRESH_TOKEN) return [];
	if (cache && Date.now() - cache.at < TTL_MS) return cache.events;

	let token: string;
	try {
		token = await getAccessToken();
	} catch (err) {
		// A dead or revoked refresh token fails every calendar at once, which is
		// the same situation as "nothing succeeded" below.
		console.error('gcal: access token refresh failed', err);
		return cache?.events ?? [];
	}

	const now = new Date();
	const windowEnd = new Date(now.getTime() + AGENDA_DAYS * 86_400_000);
	const all: AgendaEvent[] = [];
	let anySucceeded = false;

	for (const id of calendarIds()) {
		try {
			all.push(...toAgendaEvents(await listEvents(id, now, windowEnd, token)));
			anySucceeded = true;
		} catch (err) {
			console.error(`gcal: calendar ${id} fetch failed, skipping`, err);
		}
	}

	if (!anySucceeded) return cache?.events ?? [];

	all.sort((a, b) => a.start.localeCompare(b.start));
	cache = { at: Date.now(), events: all };
	return all;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/server/gcal/`
Expected: PASS — all four gcal test files green.

- [ ] **Step 5: Run the whole suite and the type check**

Run: `npm run test && npm run check`
Expected: Both pass. Nothing outside `gcal/` should have changed behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/gcal/service.ts src/lib/server/gcal/service.test.ts
git commit -m "feat(gcal): fetch the agenda from the calendar api"
```

---

### Task 5: Configuration swap

Retires `GCAL_ICAL_URLS` and points the panel's configured-or-not test at the new variable.

**Prerequisite:** commit or stash the in-flight changes to `src/routes/(app)/+page.server.ts`.

**Files:**
- Modify: `src/routes/(app)/+page.server.ts:24`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing new
- Produces: `gcalConfigured: boolean` in the page load data — unchanged name and type, new source

- [ ] **Step 1: Repoint the configured test**

In `src/routes/(app)/+page.server.ts`, replace line 24:

```ts
	const gcalConfigured = Boolean(env.GCAL_ICAL_URLS);
```

with:

```ts
	const gcalConfigured = Boolean(env.GCAL_REFRESH_TOKEN);
```

The comment above it still holds — it says the page checks "the same names `getAgenda()` reads", and `GCAL_REFRESH_TOKEN` is now that name. Leave it as is.

- [ ] **Step 2: Update `.env.example`**

In `.env.example`, delete these three lines:

```sh
# Comma-separated Google Calendar secret ICS URLs (Settings > your calendar >
# "Secret address in iCal format"). Unset =
GCAL_ICAL_URLS=
```

and put this in their place:

```sh
# Google Calendar agenda. Create a Desktop OAuth client in Google Cloud, enable
# the Calendar API, publish the consent screen, then run `npm run gcal:auth`
# once to obtain the refresh token. Unset = the panel shows its setup note
# instead of events.
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
GCAL_REFRESH_TOKEN=
# Comma-separated calendar ids (Calendar settings > your calendar > "Integrate
# calendar" > Calendar ID). Unset = the account's primary calendar.
GCAL_CALENDAR_IDS=
```

- [ ] **Step 3: Verify nothing still references the old variable**

Run: `grep -rn "GCAL_ICAL_URLS" src/ .env.example`
Expected: no matches. (`docs/` and `.env` still mention it; docs are history and `.env` is yours to edit at rollout.)

- [ ] **Step 4: Run the suite and the type check**

Run: `npm run test && npm run check`
Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/\(app\)/+page.server.ts .env.example
git commit -m "feat(gcal): configure the agenda with oauth credentials"
```

---

### Task 6: One-time authorisation script

**Files:**
- Create: `scripts/gcal-auth.ts`
- Modify: `package.json` (add one script)

**Interfaces:**
- Consumes: `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET` from the environment
- Produces: prints a refresh token to stdout. Writes no files.

This task has no automated test. It is an interactive one-shot tool that talks to Google's consent screen; a test would only assert that a string template is a string template. Step 4 verifies it by running it.

- [ ] **Step 1: Write the script**

Create `scripts/gcal-auth.ts`:

```ts
/**
 * One-time Google Calendar authorisation.
 *
 * Runs the consent flow against a loopback redirect and prints the refresh
 * token. Deliberately writes nothing: you paste the value into .env locally
 * and into `flyctl secrets set` for production, which keeps the credential out
 * of the repository like every other secret in this project.
 *
 * Usage: npm run gcal:auth
 */
import { createServer } from 'node:http';

const PORT = 8123;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

const clientId = process.env.GCAL_CLIENT_ID;
const clientSecret = process.env.GCAL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
	console.error('Set GCAL_CLIENT_ID and GCAL_CLIENT_SECRET in .env before running this.');
	process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
// Both are required. Without them Google returns an access token and no
// refresh token, and re-consenting is the only way to get one afterwards.
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

async function exchange(code: string): Promise<void> {
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId!,
			client_secret: clientSecret!,
			redirect_uri: REDIRECT_URI,
			grant_type: 'authorization_code'
		})
	});

	const body = (await res.json()) as { refresh_token?: string; error_description?: string };
	if (!res.ok || !body.refresh_token) {
		console.error(`\nToken exchange failed: ${body.error_description ?? `HTTP ${res.status}`}`);
		process.exit(1);
	}

	console.log('\nAdd this to .env, and to your Fly secrets:\n');
	console.log(`GCAL_REFRESH_TOKEN=${body.refresh_token}\n`);
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', REDIRECT_URI);
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');

	if (!code && !error) {
		res.writeHead(404).end();
		return;
	}

	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end(error ? `Authorisation failed: ${error}` : 'Authorised. Return to your terminal.');
	server.close();

	if (error) {
		console.error(`\nAuthorisation failed: ${error}`);
		process.exit(1);
	}
	void exchange(code!);
});

server.listen(PORT, () => {
	console.log('\nOpen this URL in the browser signed in to the calendar account:\n');
	console.log(`${authUrl}\n`);
	console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` immediately after `"db:migrate"`:

```json
		"gcal:auth": "tsx --env-file=.env scripts/gcal-auth.ts"
```

Remember the comma after the preceding entry. `--env-file` is how the script sees `.env`; this project has no `dotenv`, and adding one for a single script is not worth a dependency.

- [ ] **Step 3: Verify it type-checks and lints**

Run: `npm run check && npm run lint`
Expected: Both pass. If `prettier --check` complains about the new files, run `npm run format` and re-run.

- [ ] **Step 4: Run it for real**

Prerequisites, done once in the Google Cloud console: create a project, enable the Google Calendar API, create an **OAuth client ID** of type **Desktop app**, and **publish** the consent screen (leaving it in Testing expires the refresh token after seven days). Put the client id and secret in `.env`.

Run: `npm run gcal:auth`

Expected: the script prints a consent URL and waits. Opening it, signing in, and approving redirects the browser to a page reading "Authorised. Return to your terminal." The terminal prints a `GCAL_REFRESH_TOKEN=1//…` line and exits.

The unverified-app warning on the consent screen is expected for a self-authorised client; continue past it. If the domain administrator blocks third-party app access, the flow fails here and the administrator must trust this client id.

- [ ] **Step 5: Commit**

```bash
git add scripts/gcal-auth.ts package.json
git commit -m "feat(gcal): add one-time oauth authorisation script"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` — the **Google Calendar agenda** section (line 64) and the Fly secrets note (line 107)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Rewrite the agenda section**

In `README.md`, replace the paragraph beginning "Set `GCAL_ICAL_URLS` to one or more comma-separated…" with:

```markdown
Table reads your calendars through the Google Calendar API, which is free and needs no
billing account. Set it up once:

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and
   enable the **Google Calendar API**.
2. Under **APIs & Services > Credentials**, create an **OAuth client ID** of type
   **Desktop app**. Copy the client id and secret into `GCAL_CLIENT_ID` and
   `GCAL_CLIENT_SECRET`.
3. Under **APIs & Services > OAuth consent screen**, **publish** the app. A client left in
   Testing mode expires its refresh token after seven days, which shows up later as an
   agenda that empties itself a week after setup.
4. Run `npm run gcal:auth`, approve the consent screen, and put the printed value in
   `GCAL_REFRESH_TOKEN`. The unverified-app warning is expected — you are authorising your
   own client for your own account.
5. Optionally set `GCAL_CALENDAR_IDS` to a comma-separated list of calendar ids (Calendar
   settings > your calendar > **Integrate calendar** > **Calendar ID**). Unset reads your
   primary calendar.

Table asks only for `calendar.events.readonly`, the narrowest scope that works: it can read
events on the calendars you name and nothing else — no writes, no calendar management.

Events fill the side panel's **Today** section: today's events at the top, then the next few
days. It's display-only — nothing in it is editable — just a glance at what's on your
calendars alongside your tasks. Events you've declined are hidden, and an event already in
progress stays visible until it ends. Leave `GCAL_REFRESH_TOKEN` unset and the section
explains how to connect one.

If your account is on a Google Workspace domain you don't administer, the administrator may
need to trust your client id under **Admin console > Security > API controls**.
```

- [ ] **Step 2: Update the Fly secrets note**

In `README.md`, in the deployment section, replace:

```markdown
   These cover core functionality. If you're using the optional integrations above, also set `LMS_ICAL_URL`, `GCAL_ICAL_URLS`, `TASKS_FEED_TOKEN`, and/or `DASHBOARD_TOKEN` as needed.
```

with:

```markdown
   These cover core functionality. If you're using the optional integrations above, also set `LMS_ICAL_URL`, `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, `GCAL_REFRESH_TOKEN`, `GCAL_CALENDAR_IDS`, `TASKS_FEED_TOKEN`, and/or `DASHBOARD_TOKEN` as needed.
```

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rn "secret address\|GCAL_ICAL_URLS" README.md`
Expected: no matches.

- [ ] **Step 4: Check formatting**

Run: `npm run lint`
Expected: PASS. Run `npm run format` first if prettier objects.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(gcal): document the calendar api setup"
```

---

## Rollout

Landing the code with `GCAL_REFRESH_TOKEN` unset is safe: `getAgenda()` returns `[]` and the
panel shows its setup guide, exactly as it does today before configuration.

1. Set the four variables in `.env` and verify locally.
2. `flyctl secrets set GCAL_CLIENT_ID=… GCAL_CLIENT_SECRET=… GCAL_REFRESH_TOKEN=… GCAL_CALENDAR_IDS=…`
3. `flyctl secrets unset GCAL_ICAL_URLS`

## Manual Verification

Run these against the real app once Task 7 is done and the variables are set.

1. With `GCAL_REFRESH_TOKEN` unset, load the board — the **Today** section shows the setup
   guide and the server logs nothing.
2. Set all four variables, reload — today's events appear in order, with times.
3. Add an event in Google Calendar, wait out the 10-minute cache, reload — it appears.
4. Decline a meeting in Google Calendar, wait out the cache, reload — it disappears.
5. A weekly recurring event shows one instance per occurrence inside the 7-day window and
   none outside it.
6. Set a bogus `GCAL_REFRESH_TOKEN` and reload — the rail keeps its last agenda rather than
   emptying, and the server logs the failure.
7. Add a nonexistent calendar id alongside a good one and reload — the good calendar's
   events still render, and the bad id logs and is skipped.
8. Confirm an all-day event lands on the right day, and that an event currently in progress
   is still listed.
