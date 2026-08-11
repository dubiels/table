# Google Tasks Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Table a two-way mirror with Google Tasks — badged Table tasks become real Google Tasks, everything in the Google default list is imported into Table, and edits, completion and deletion flow both ways.

**Architecture:** A pure planner (`gtasks/plan.ts`) holds every sync rule and does no I/O, so the whole rulebook is unit-tested without a network. A thin runner (`gtasks/sync.ts`) executes the plan against the Google Tasks REST API and SQLite. Outbound changes additionally fire immediately through `gtasks/push.ts`, with the reconciler as the retry path. This mirrors the existing `lms/plan.ts` + `lms/sync.ts` split.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Drizzle ORM + better-sqlite3, Vitest, `node-cron`, plain `fetch` against `tasks.googleapis.com/tasks/v1` (no `googleapis` SDK).

**Spec:** `docs/superpowers/specs/2026-08-11-google-tasks-sync-design.md`

## Global Constraints

- **Google ⊆ Table.** Everything in the Google default list appears in Table; only tasks with `googleSync` set go to Google.
- **Completed Google tasks Table has never seen are NEVER imported** — not on the first sync, not ever.
- **Task list is `@default`.** No multi-list support.
- **Conflicts resolve per-task, last-write-wins.** An exact timestamp tie goes to Google.
- **Deletion is mirrored both ways**, but only on an explicit `deleted: true` from Google — never inferred from a row's absence.
- **`updatedAt` is bumped only by title, notes, dueDate and done.** Never by position, category or priority.
- **After every successful write to Google, store the `updated` value from that write's own response.** Skipping this makes the next reconcile echo your own push back down as an inbound change.
- **A due date is required to CREATE a task in Google**, not to maintain an existing link. A linked task that loses its date is patched with `due: null`, never deleted or unlinked.
- **`GTASKS_ENABLED` unset disables everything** — cron, page-load sync, write-through and the UI controls.
- **Nothing in `gtasks/` may throw into a request path.** Failures are logged, recorded in `googleError`, and retried by the next reconcile.
- Dates crossing the boundary are date-only. Table uses `YYYY-MM-DD`; Google uses `YYYY-MM-DDT00:00:00.000Z`. **No timezone arithmetic anywhere.**
- Vitest runs with `expect: { requireAssertions: true }` — every test must assert.
- Commit messages follow Conventional Commits, lowercase imperative description, no trailing period.

## File Structure

**Created:**
| Path | Responsibility |
| --- | --- |
| `src/lib/server/google/oauth.ts` | Access token from refresh token (moved from `gcal/oauth.ts`) |
| `src/lib/server/google/oauth.test.ts` | Moved from `gcal/oauth.test.ts` |
| `src/lib/server/gtasks/client.ts` | REST wrapper + date mapping. Knows HTTP, knows no rules |
| `src/lib/server/gtasks/client.test.ts` | Request shaping, pagination, date mapping |
| `src/lib/server/gtasks/plan.ts` | The entire rulebook, pure, no I/O |
| `src/lib/server/gtasks/plan.test.ts` | Every rule, table-driven |
| `src/lib/server/gtasks/sync.ts` | Executes a plan against API + DB; cron/manual entry point |
| `src/lib/server/gtasks/push.ts` | Immediate single-task outbound |
| `src/routes/api/gtasks/sync/+server.ts` | `POST` manual full sync |
| `scripts/google-auth.ts` | Renamed from `gcal-auth.ts`, both scopes |

**Modified:**
| Path | Change |
| --- | --- |
| `src/lib/server/db/schema.ts` | 6 columns on `tasks`, 2 new tables, `source` gains `'google'` |
| `src/lib/server/tasks/service.ts` | `updatedAt` bumps, `setGoogleSync`, tombstone on delete |
| `src/lib/server/gcal/service.ts` | Import oauth from its new home |
| `src/lib/server/scheduler/index.ts` | Register the sync cron |
| `src/routes/(app)/+page.server.ts` | Stale-check on load; push after task mutations |
| `src/routes/(app)/+layout.server.ts` | Expose `gtasksConfigured` to the whole shell |
| `src/routes/(app)/+layout.svelte` | Pass the flag to `TopBar` |
| `src/lib/server/lms/sync.ts` | Its raw insert needs the new non-null columns |
| `src/lib/components/TaskCard.svelte` | Badge |
| `src/lib/components/TaskDetailModal.svelte` | "Send to Google Tasks" toggle |
| `src/lib/components/AddTaskForm.svelte` | Sticky composer checkbox |
| `src/lib/components/TopBar.svelte` | "Sync Google Tasks" menu item |
| `package.json` | `gcal:auth` → `google:auth` |
| `.env.example`, `README.md` | New config; retire the `.ics` feed |

**Deleted:** `src/lib/server/ics/export.ts`, `src/lib/server/ics/export.test.ts`, `src/routes/calendar.ics/+server.ts`, `src/lib/server/gcal/oauth.ts`, `src/lib/server/gcal/oauth.test.ts`, `scripts/gcal-auth.ts`

---

### Task 1: Schema and migration

**Files:**
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0005_*.sql` (generated, then hand-edited)

**Interfaces:**
- Consumes: nothing
- Produces: `tasks.updatedAt`, `tasks.googleSync`, `tasks.googleTaskId`, `tasks.googleSyncedAt`, `tasks.googleUpdatedAt`, `tasks.googleError`, `source: 'manual' | 'canvas' | 'google'`; tables `googleTaskTombstones` (`googleTaskId`, `deletedAt`) and `syncState` (`key`, `value`)

- [ ] **Step 1: Add the columns and tables to the schema**

In `src/lib/server/db/schema.ts`, change the import line and replace the `tasks` table, then append the two new tables:

```ts
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
```

```ts
export const tasks = sqliteTable(
	'tasks',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		notes: text('notes'),
		dueDate: text('due_date'),
		priority: text('priority', { enum: ['low', 'med', 'high'] }),
		done: integer('done', { mode: 'boolean' }).notNull().default(false),
		completedAt: text('completed_at'),
		source: text('source', { enum: ['manual', 'canvas', 'google'] })
			.notNull()
			.default('manual'),
		externalId: text('external_id'),
		courseName: text('course_name'),
		x: integer('x').notNull().default(0),
		y: integer('y').notNull().default(0),
		sortOrder: integer('sort_order').notNull().default(0),
		// Bumped only by a field Google can see: title, notes, dueDate, done.
		// Position, category and priority deliberately leave it alone — dirtiness
		// is `updatedAt !== googleSyncedAt`, so a drag that bumped it would fire
		// pointless API calls and let that drag win a conflict against a real edit
		// made on the phone.
		updatedAt: text('updated_at').notNull().default(''),
		// Intent (do I want this in Google?) kept separate from achievement
		// (is it?). Collapsed into one column, opting in could only succeed while
		// Google was reachable, and a failed create would leave nothing to retry.
		googleSync: integer('google_sync', { mode: 'boolean' }).notNull().default(false),
		googleTaskId: text('google_task_id'),
		/** The `updatedAt` value Google last received. */
		googleSyncedAt: text('google_synced_at'),
		/** Google's own `updated` stamp as of the last reconcile. */
		googleUpdatedAt: text('google_updated_at'),
		/** Last push failure, cleared on success. Drives the badge's error state. */
		googleError: text('google_error'),
		createdAt: text('created_at').notNull()
	},
	(t) => ({
		// An index rather than a column constraint: SQLite cannot ALTER TABLE ADD
		// COLUMN ... UNIQUE. A unique index also permits many NULLs, which is what
		// "most tasks are not linked" needs.
		googleTaskIdIdx: uniqueIndex('tasks_google_task_id_idx').on(t.googleTaskId)
	})
);
```

If drizzle-kit rejects the object form of that third argument, use the array form instead — the same index, newer syntax:

```ts
	(t) => [uniqueIndex('tasks_google_task_id_idx').on(t.googleTaskId)]
);

export const googleTaskTombstones = sqliteTable('google_task_tombstones', {
	// Written in the same transaction as a linked task's local delete. Without it
	// a failed Google delete would leave nothing recording what to delete.
	googleTaskId: text('google_task_id').primaryKey(),
	deletedAt: text('deleted_at').notNull()
});

export const syncState = sqliteTable('sync_state', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0005_*.sql` and a matching `drizzle/meta/0005_snapshot.json`.

- [ ] **Step 3: Verify the generated SQL, and add the backfill**

Open the generated `drizzle/0005_*.sql`. It must contain `CREATE UNIQUE INDEX` — **not** `ALTER TABLE tasks ADD COLUMN google_task_id text UNIQUE`, which SQLite rejects at runtime. If it generated the latter, split it by hand into a plain `ADD COLUMN` plus a `CREATE UNIQUE INDEX`.

Then append this line to the end of the file, so existing rows get a real `updatedAt` instead of the empty-string default:

```sql
UPDATE `tasks` SET `updated_at` = `created_at` WHERE `updated_at` = '';
```

- [ ] **Step 4: Run the migration and verify the shape**

Run:
```bash
npm run db:migrate && sqlite3 ./data/table.sqlite "PRAGMA table_info(tasks);" | grep -E 'updated_at|google_'
```
Expected: six rows — `updated_at`, `google_sync`, `google_task_id`, `google_synced_at`, `google_updated_at`, `google_error`.

- [ ] **Step 5: Verify the backfill left no empty stamps**

Run:
```bash
sqlite3 ./data/table.sqlite "SELECT count(*) FROM tasks WHERE updated_at = '';"
```
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat(db): add google tasks link columns and sync tables"
```

---

### Task 2: Share the OAuth client and widen its scopes

**Files:**
- Create: `src/lib/server/google/oauth.ts`, `src/lib/server/google/oauth.test.ts` (both `git mv`'d)
- Delete: `src/lib/server/gcal/oauth.ts`, `src/lib/server/gcal/oauth.test.ts`
- Modify: `src/lib/server/gcal/service.ts:2`, `package.json`
- Rename: `scripts/gcal-auth.ts` → `scripts/google-auth.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `getAccessToken(): Promise<string>` importable from `$lib/server/google/oauth`

The module already knows nothing about calendars — it exchanges a refresh token for an access token. Both features share one refresh token, so leaving it in `gcal/` would force `gtasks/` to import from `gcal/` and misstate the relationship.

- [ ] **Step 1: Move the module and its test**

```bash
mkdir -p src/lib/server/google
git mv src/lib/server/gcal/oauth.ts src/lib/server/google/oauth.ts
git mv src/lib/server/gcal/oauth.test.ts src/lib/server/google/oauth.test.ts
```

- [ ] **Step 2: Repoint the one importer**

In `src/lib/server/gcal/service.ts`, line 2:

```ts
import { getAccessToken } from '../google/oauth';
```

- [ ] **Step 3: Verify nothing else referenced the old path**

Run: `grep -rn "gcal/oauth\|from './oauth'" src/ scripts/`
Expected: no output. (`google/oauth.test.ts` imports `./oauth`, which now resolves correctly — if grep shows that line only, it is fine.)

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, same test count as before the move.

- [ ] **Step 5: Rename the auth script and widen its scopes**

```bash
git mv scripts/gcal-auth.ts scripts/google-auth.ts
```

In `scripts/google-auth.ts`, replace the `SCOPE` constant (line 15) with:

```ts
// Both scopes on one token: the Calendar agenda reads events, Google Tasks sync
// reads and writes tasks. Google returns a single refresh token covering both.
const SCOPE = [
	'https://www.googleapis.com/auth/calendar.events.readonly',
	'https://www.googleapis.com/auth/tasks'
].join(' ');
```

Update the docstring's first line from `One-time Google Calendar authorisation.` to `One-time Google authorisation for the Calendar and Tasks APIs.`, and its usage line from `npm run gcal:auth` to `npm run google:auth`.

- [ ] **Step 6: Rename the npm script**

In `package.json`, replace the `gcal:auth` line:

```json
"google:auth": "tsx --env-file=.env scripts/google-auth.ts"
```

- [ ] **Step 7: Verify the script still starts and asks for both scopes**

Run: `npm run google:auth`
Expected: it prints a consent URL. Confirm the URL's `scope` parameter contains both `calendar.events.readonly` and `auth/tasks`, then press Ctrl-C — do not complete the flow yet.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib/server/google src/lib/server/gcal scripts package.json
git commit -m "refactor(google): share the oauth client and widen its scopes

The token exchange never knew anything about calendars, and Tasks sync
needs the same refresh token. Requesting both scopes now means one
re-consent rather than two."
```

---

### Task 3: Google Tasks REST client

**Files:**
- Create: `src/lib/server/gtasks/client.ts`
- Test: `src/lib/server/gtasks/client.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface GoogleTask { id, title?, notes?, due?, status?, completed?, updated, deleted?, hidden?, parent? }`
  - `interface GoogleTaskWrite { title: string; notes: string | null; due: string | null; status: 'needsAction' | 'completed' }`
  - `toGoogleDue(dueDate: string | null): string | null`
  - `fromGoogleDue(due: string | undefined): string | null`
  - `listTasks(accessToken: string, options?: { updatedMin?: string }): Promise<GoogleTask[]>`
  - `insertTask(accessToken: string, body: GoogleTaskWrite): Promise<GoogleTask>`
  - `patchTask(accessToken: string, googleTaskId: string, body: GoogleTaskWrite): Promise<GoogleTask>`
  - `deleteTask(accessToken: string, googleTaskId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/gtasks/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	listTasks,
	insertTask,
	patchTask,
	deleteTask,
	toGoogleDue,
	fromGoogleDue
} from './client';

function page(items: unknown[], nextPageToken?: string) {
	return { ok: true, status: 200, json: async () => ({ items, nextPageToken }) };
}

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('date mapping', () => {
	it('sends a date-only due as UTC midnight', () => {
		expect(toGoogleDue('2026-08-11')).toBe('2026-08-11T00:00:00.000Z');
	});

	it('maps a missing due date to null in both directions', () => {
		expect(toGoogleDue(null)).toBeNull();
		expect(fromGoogleDue(undefined)).toBeNull();
	});

	it('reads a due stamp back as the same calendar date', () => {
		expect(fromGoogleDue('2026-08-11T00:00:00.000Z')).toBe('2026-08-11');
	});

	it('round-trips without shifting the date', () => {
		expect(fromGoogleDue(toGoogleDue('2026-01-01') as string)).toBe('2026-01-01');
	});
});

describe('listTasks', () => {
	it('asks for completed, hidden and deleted tasks', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listTasks('access-token');

		const url = new URL(fetchMock.mock.calls[0][0]);
		expect(url.pathname).toBe('/tasks/v1/lists/%40default/tasks');
		expect(url.searchParams.get('showCompleted')).toBe('true');
		expect(url.searchParams.get('showHidden')).toBe('true');
		expect(url.searchParams.get('showDeleted')).toBe('true');
	});

	it('omits updatedMin when none is given', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listTasks('access-token');
		expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('updatedMin')).toBe(false);
	});

	it('passes updatedMin through when given', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listTasks('access-token', { updatedMin: '2026-08-11T00:00:00.000Z' });
		expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('updatedMin')).toBe(
			'2026-08-11T00:00:00.000Z'
		);
	});

	it('sends the access token as a bearer credential', async () => {
		fetchMock.mockResolvedValue(page([]));
		await listTasks('access-token');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer access-token');
	});

	it('follows nextPageToken until it is absent', async () => {
		fetchMock
			.mockResolvedValueOnce(page([{ id: 'a', updated: 'u' }], 'page-2'))
			.mockResolvedValueOnce(page([{ id: 'b', updated: 'u' }]));

		const items = await listTasks('access-token');

		expect(items.map((t) => t.id)).toEqual(['a', 'b']);
		expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page-2');
	});

	it('throws on a non-2xx response', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
		await expect(listTasks('access-token')).rejects.toThrow('HTTP 403');
	});
});

describe('insertTask', () => {
	it('posts the task body and returns the created resource', async () => {
		fetchMock.mockResolvedValue(ok({ id: 'g1', updated: '2026-08-11T10:00:00.000Z' }));

		const created = await insertTask('access-token', {
			title: 'Ship it',
			notes: null,
			due: '2026-08-11T00:00:00.000Z',
			status: 'needsAction'
		});

		const [url, init] = fetchMock.mock.calls[0];
		expect(new URL(url).pathname).toBe('/tasks/v1/lists/%40default/tasks');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			title: 'Ship it',
			notes: null,
			due: '2026-08-11T00:00:00.000Z',
			status: 'needsAction'
		});
		expect(created.id).toBe('g1');
	});
});

describe('patchTask', () => {
	it('patches the named task and clears `completed` when un-completing', async () => {
		fetchMock.mockResolvedValue(ok({ id: 'g1', updated: '2026-08-11T11:00:00.000Z' }));

		await patchTask('access-token', 'g1', {
			title: 'Ship it',
			notes: null,
			due: null,
			status: 'needsAction'
		});

		const [url, init] = fetchMock.mock.calls[0];
		expect(new URL(url).pathname).toBe('/tasks/v1/lists/%40default/tasks/g1');
		expect(init.method).toBe('PATCH');
		// Google keeps a stale `completed` stamp unless it is explicitly nulled.
		expect(JSON.parse(init.body).completed).toBeNull();
	});

	it('does not null `completed` when completing', async () => {
		fetchMock.mockResolvedValue(ok({ id: 'g1', updated: '2026-08-11T11:00:00.000Z' }));
		await patchTask('access-token', 'g1', {
			title: 'Ship it',
			notes: null,
			due: null,
			status: 'completed'
		});
		expect('completed' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
	});
});

describe('deleteTask', () => {
	it('sends DELETE and does not parse the empty body', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204 });
		await deleteTask('access-token', 'g1');
		expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
	});

	it('treats a 404 as already deleted', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 404 });
		await expect(deleteTask('access-token', 'gone')).resolves.toBeUndefined();
	});

	it('throws on any other failure', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 500 });
		await expect(deleteTask('access-token', 'g1')).rejects.toThrow('HTTP 500');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/gtasks/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client"`

- [ ] **Step 3: Write the client**

Create `src/lib/server/gtasks/client.ts`:

```ts
const API_BASE = 'https://tasks.googleapis.com/tasks/v1/lists';
/** The list Google's own quick-capture writes to. Table syncs this and no other. */
const LIST_ID = '@default';
const PAGE_SIZE = 100;
const TIMEOUT_MS = 8000;

export interface GoogleTask {
	id: string;
	title?: string;
	notes?: string;
	/** RFC 3339, but date-only in meaning — Google discards the time portion. */
	due?: string;
	status?: 'needsAction' | 'completed';
	completed?: string;
	updated: string;
	deleted?: boolean;
	hidden?: boolean;
	parent?: string;
}

export interface GoogleTaskWrite {
	title: string;
	notes: string | null;
	due: string | null;
	status: 'needsAction' | 'completed';
}

/** Table's `YYYY-MM-DD` as the UTC-midnight stamp Google stores. */
export function toGoogleDue(dueDate: string | null): string | null {
	return dueDate ? `${dueDate}T00:00:00.000Z` : null;
}

/**
 * Google's stamp as Table's `YYYY-MM-DD`.
 *
 * A plain prefix, deliberately: Google documents that `due` records date
 * information only and discards the time, so the stamp is always UTC midnight
 * of the intended day. Parsing it into a Date and reformatting would drag the
 * server's timezone into a value that has none, moving the date by a day for
 * anyone west of UTC.
 */
export function fromGoogleDue(due: string | undefined): string | null {
	return due ? due.slice(0, 10) : null;
}

function tasksUrl(path = ''): string {
	// The list id is `@default`, so the path segment needs encoding.
	return `${API_BASE}/${encodeURIComponent(LIST_ID)}/tasks${path}`;
}

/**
 * Every task on the default list.
 *
 * All three `show*` flags are required. Google hides a task the moment it is
 * completed, so without `showHidden` a completion is indistinguishable from a
 * deletion; without `showDeleted` a deletion never arrives at all.
 *
 * `updatedMin` keeps periodic runs from re-fetching a lifetime of completed
 * tasks every few minutes. Absence of a task from a filtered response means
 * "unchanged", never "gone" — which is why deletion is only ever read from the
 * explicit `deleted` flag.
 */
export async function listTasks(
	accessToken: string,
	options?: { updatedMin?: string }
): Promise<GoogleTask[]> {
	const items: GoogleTask[] = [];
	let pageToken: string | undefined;

	do {
		const params = new URLSearchParams({
			showCompleted: 'true',
			showHidden: 'true',
			showDeleted: 'true',
			maxResults: String(PAGE_SIZE)
		});
		if (options?.updatedMin) params.set('updatedMin', options.updatedMin);
		if (pageToken) params.set('pageToken', pageToken);

		const res = await fetch(`${tasksUrl()}?${params}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const body = (await res.json()) as { items?: GoogleTask[]; nextPageToken?: string };
		items.push(...(body.items ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return items;
}

export async function insertTask(
	accessToken: string,
	body: GoogleTaskWrite
): Promise<GoogleTask> {
	// No `completed` handling here, unlike patchTask: a task being created has
	// no stale stamp to clear.
	const res = await fetch(tasksUrl(), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as GoogleTask;
}

export async function patchTask(
	accessToken: string,
	googleTaskId: string,
	body: GoogleTaskWrite
): Promise<GoogleTask> {
	const res = await fetch(tasksUrl(`/${encodeURIComponent(googleTaskId)}`), {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		// Google keeps a stale `completed` stamp when a task moves back to
		// needsAction unless the field is explicitly nulled.
		body: JSON.stringify(
			body.status === 'needsAction' ? { ...body, completed: null } : { ...body }
		),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as GoogleTask;
}

/**
 * Deletes a task. A 404 is success: the row is gone, which is what the caller
 * wanted, and treating it as a failure would leave a tombstone retrying forever.
 */
export async function deleteTask(accessToken: string, googleTaskId: string): Promise<void> {
	const res = await fetch(tasksUrl(`/${encodeURIComponent(googleTaskId)}`), {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/gtasks/client.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gtasks/client.ts src/lib/server/gtasks/client.test.ts
git commit -m "feat(gtasks): add the google tasks rest client

Date mapping is a string slice rather than Date parsing: Google stores a
due date as UTC midnight with no time meaning, so reformatting through a
Date would move the day for any server west of UTC."
```

---

### Task 4: The reconcile planner

**Files:**
- Create: `src/lib/server/gtasks/plan.ts`
- Test: `src/lib/server/gtasks/plan.test.ts`

**Interfaces:**
- Consumes: `nextFreeSlot` from `$lib/placement`, `looseBounds` from `../lms/plan`
- Produces:
  - `interface PlanTableTask { id, title, notes, dueDate, done, completedAt, updatedAt, googleSync, googleTaskId, googleSyncedAt, googleUpdatedAt, x, y }`
  - `interface PlanGoogleTask { id, title, notes, dueDate, done, completedAt, updated, deleted }` — **`dueDate` is Table's `YYYY-MM-DD`**; `sync.ts` maps it before calling
  - `interface SyncPlan` with `deleteInGoogle`, `createInGoogle`, `patchInGoogle`, `createInTable`, `patchInTable`, `deleteInTable`, `unlinkInTable`
  - `planGoogleTaskSync(input): SyncPlan`

`deleteInGoogle` entries carry `taskId: string | null`. Non-null means "clear this task's link once Google confirms"; null means the entry came from a tombstone, which is dropped on confirmation. Pairing them in one entry is what keeps a failed delete from unlinking a task whose Google copy still exists.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/gtasks/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planGoogleTaskSync, type PlanTableTask, type PlanGoogleTask } from './plan';

function tableTask(over: Partial<PlanTableTask> = {}): PlanTableTask {
	return {
		id: 't1',
		title: 'Write the spec',
		notes: null,
		dueDate: '2026-08-20',
		done: false,
		completedAt: null,
		updatedAt: '2026-08-11T10:00:00.000Z',
		googleSync: true,
		googleTaskId: 'g1',
		googleSyncedAt: '2026-08-11T10:00:00.000Z',
		googleUpdatedAt: '2026-08-11T10:00:01.000Z',
		x: 60,
		y: 60,
		...over
	};
}

function googleTask(over: Partial<PlanGoogleTask> = {}): PlanGoogleTask {
	return {
		id: 'g1',
		title: 'Write the spec',
		notes: null,
		dueDate: '2026-08-20',
		done: false,
		completedAt: null,
		updated: '2026-08-11T10:00:01.000Z',
		deleted: false,
		...over
	};
}

function plan(over: {
	tableTasks?: PlanTableTask[];
	googleTasks?: PlanGoogleTask[];
	tombstones?: { googleTaskId: string }[];
	fullFetch?: boolean;
}) {
	return planGoogleTaskSync({
		tableTasks: over.tableTasks ?? [],
		googleTasks: over.googleTasks ?? [],
		tombstones: over.tombstones ?? [],
		fullFetch: over.fullFetch ?? true
	});
}

describe('inbound capture', () => {
	it('imports an unknown open google task', () => {
		const result = plan({ googleTasks: [googleTask({ id: 'new', title: 'Buy milk' })] });

		expect(result.createInTable).toHaveLength(1);
		expect(result.createInTable[0]).toMatchObject({
			googleTaskId: 'new',
			title: 'Buy milk',
			dueDate: '2026-08-20',
			googleUpdatedAt: '2026-08-11T10:00:01.000Z'
		});
	});

	it('never imports an unknown completed google task', () => {
		const result = plan({
			googleTasks: [googleTask({ id: 'new', done: true, completedAt: '2026-08-11T09:00:00.000Z' })]
		});
		expect(result.createInTable).toEqual([]);
	});

	it('imports an undated google task, since the due-date rule is outbound only', () => {
		const result = plan({ googleTasks: [googleTask({ id: 'new', dueDate: null })] });
		expect(result.createInTable[0].dueDate).toBeNull();
	});

	it('gives each imported task its own free slot', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false, googleTaskId: null, x: 40, y: 40 })],
			googleTasks: [googleTask({ id: 'a' }), googleTask({ id: 'b' })]
		});

		const slots = result.createInTable.map((c) => `${c.x},${c.y}`);
		expect(new Set(slots).size).toBe(2);
	});
});

describe('the four-case matrix', () => {
	it('does nothing when neither side changed', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [googleTask()] });
		expect(result.patchInTable).toEqual([]);
		expect(result.patchInGoogle).toEqual([]);
	});

	it('pulls google changes down when only google changed', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [googleTask({ title: 'Renamed on the phone', updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.patchInTable).toHaveLength(1);
		expect(result.patchInTable[0]).toMatchObject({
			taskId: 't1',
			title: 'Renamed on the phone',
			googleUpdatedAt: '2026-08-11T12:00:00.000Z'
		});
	});

	it('pushes table changes up when only table changed', () => {
		const result = plan({
			tableTasks: [
				tableTask({ title: 'Renamed in Table', updatedAt: '2026-08-11T12:00:00.000Z' })
			],
			googleTasks: [googleTask()]
		});

		expect(result.patchInGoogle).toHaveLength(1);
		expect(result.patchInGoogle[0]).toMatchObject({ googleTaskId: 'g1', title: 'Renamed in Table' });
	});

	it('gives the later edit the whole task when both changed', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Table wins', updatedAt: '2026-08-11T13:00:00.000Z' })],
			googleTasks: [googleTask({ title: 'Google loses', updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.patchInGoogle[0].title).toBe('Table wins');
		expect(result.patchInTable).toEqual([]);
	});

	it('resolves an exact tie to google', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Table', updatedAt: '2026-08-11T12:00:00.000Z' })],
			googleTasks: [googleTask({ title: 'Google', updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.patchInTable[0].title).toBe('Google');
		expect(result.patchInGoogle).toEqual([]);
	});

	it('takes completion from google for a task it already knows', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [
				googleTask({
					done: true,
					completedAt: '2026-08-11T12:00:00.000Z',
					updated: '2026-08-11T12:00:00.000Z'
				})
			]
		});

		expect(result.patchInTable[0]).toMatchObject({
			done: true,
			completedAt: '2026-08-11T12:00:00.000Z'
		});
	});
});

describe('deletion', () => {
	it('mirrors an explicit google deletion into table', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [googleTask({ deleted: true })]
		});
		expect(result.deleteInTable).toEqual([{ taskId: 't1' }]);
	});

	it('plans a google delete for each tombstone', () => {
		const result = plan({ tombstones: [{ googleTaskId: 'gone' }] });
		expect(result.deleteInGoogle).toEqual([{ googleTaskId: 'gone', taskId: null }]);
	});

	it('deletes in google and unlinks when the toggle is turned off', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false })],
			googleTasks: [googleTask()]
		});

		expect(result.deleteInGoogle).toEqual([{ googleTaskId: 'g1', taskId: 't1' }]);
		expect(result.patchInTable).toEqual([]);
		expect(result.patchInGoogle).toEqual([]);
	});

	it('unlinks rather than deletes when a linked task vanishes from a full fetch', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [], fullFetch: true });

		expect(result.deleteInTable).toEqual([]);
		expect(result.unlinkInTable).toHaveLength(1);
		expect(result.unlinkInTable[0].taskId).toBe('t1');
	});

	it('ignores absence on an incremental fetch, where it only means unchanged', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [], fullFetch: false });
		expect(result.unlinkInTable).toEqual([]);
	});
});

describe('outbound creation', () => {
	it('creates in google once intent is set and a due date exists', () => {
		const result = plan({
			tableTasks: [tableTask({ googleTaskId: null, googleSyncedAt: null, googleUpdatedAt: null })]
		});

		expect(result.createInGoogle).toEqual([
			{ taskId: 't1', title: 'Write the spec', notes: null, dueDate: '2026-08-20' }
		]);
	});

	it('holds the intent, creating nothing, while there is no due date', () => {
		const result = plan({
			tableTasks: [
				tableTask({ googleTaskId: null, googleSyncedAt: null, googleUpdatedAt: null, dueDate: null })
			]
		});

		expect(result.createInGoogle).toEqual([]);
		expect(result.unlinkInTable).toEqual([]);
	});

	it('patches a linked task that lost its due date instead of deleting it', () => {
		const result = plan({
			tableTasks: [tableTask({ dueDate: null, updatedAt: '2026-08-11T13:00:00.000Z' })],
			googleTasks: [googleTask()]
		});

		expect(result.deleteInGoogle).toEqual([]);
		expect(result.patchInGoogle[0].dueDate).toBeNull();
	});

	it('ignores a task that was never opted in', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false, googleTaskId: null })]
		});

		expect(result.createInGoogle).toEqual([]);
		expect(result.deleteInGoogle).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/gtasks/plan.test.ts`
Expected: FAIL — `Failed to resolve import "./plan"`

- [ ] **Step 3: Write the planner**

Create `src/lib/server/gtasks/plan.ts`:

```ts
import { nextFreeSlot } from '$lib/placement';
import { looseBounds } from '../lms/plan';

export interface PlanTableTask {
	id: string;
	title: string;
	notes: string | null;
	dueDate: string | null;
	done: boolean;
	completedAt: string | null;
	updatedAt: string;
	googleSync: boolean;
	googleTaskId: string | null;
	googleSyncedAt: string | null;
	googleUpdatedAt: string | null;
	x: number;
	y: number;
}

export interface PlanGoogleTask {
	id: string;
	title: string;
	notes: string | null;
	/** Table's vocabulary — `YYYY-MM-DD`. sync.ts maps it before calling. */
	dueDate: string | null;
	done: boolean;
	completedAt: string | null;
	updated: string;
	deleted: boolean;
}

export interface SyncPlan {
	/**
	 * `taskId` non-null means "clear that task's link once Google confirms";
	 * null means the entry came from a tombstone, dropped on confirmation.
	 * Pairing the delete with its consequence is what stops a failed delete
	 * from unlinking a task whose Google copy still exists.
	 */
	deleteInGoogle: { googleTaskId: string; taskId: string | null }[];
	createInGoogle: { taskId: string; title: string; notes: string | null; dueDate: string }[];
	patchInGoogle: {
		taskId: string;
		googleTaskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		done: boolean;
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

/**
 * Decides what one reconcile round does, given both sides and nothing else.
 *
 * Pure by construction: no database, no network, no clock. Every rule the
 * mirror has is expressed here and covered by plan.test.ts, which is the point
 * of the split — the cases most likely to silently eat data are the ones that
 * would otherwise only be reachable through a mocked Google API.
 */
export function planGoogleTaskSync(input: {
	tableTasks: PlanTableTask[];
	googleTasks: PlanGoogleTask[];
	tombstones: { googleTaskId: string }[];
	/**
	 * False when the fetch was filtered by `updatedMin`. Absence of a task then
	 * means "unchanged" rather than "gone", so the unlink-on-absence rule must
	 * not fire.
	 */
	fullFetch: boolean;
}): SyncPlan {
	const plan: SyncPlan = {
		deleteInGoogle: [],
		createInGoogle: [],
		patchInGoogle: [],
		createInTable: [],
		patchInTable: [],
		deleteInTable: [],
		unlinkInTable: []
	};

	// First, so a delete never races a create that could reuse its slot.
	for (const tombstone of input.tombstones) {
		plan.deleteInGoogle.push({ googleTaskId: tombstone.googleTaskId, taskId: null });
	}

	const byGoogleId = new Map<string, PlanTableTask>();
	for (const t of input.tableTasks) {
		if (t.googleTaskId) byGoogleId.set(t.googleTaskId, t);
	}

	const seenGoogleIds = new Set<string>();
	// Grows as tasks are placed, so a batch import lays out as a tidy column
	// instead of stacking every new card on the same anchor.
	const occupied = input.tableTasks.map((t) => ({ x: t.x, y: t.y }));

	for (const g of input.googleTasks) {
		seenGoogleIds.add(g.id);
		const t = byGoogleId.get(g.id);

		if (g.deleted) {
			// Guarded on googleSync: if the user has already opted out, the Google
			// row being gone is the consequence of that, not a reason to destroy
			// the Table task they kept.
			if (t && t.googleSync) plan.deleteInTable.push({ taskId: t.id });
			continue;
		}

		if (!t) {
			// Google ⊆ Table, with one exception: a completed task Table has never
			// seen is never imported, so connecting to a long-lived list does not
			// drag years of someone's archive into Table's history.
			if (g.done) continue;
			const slot = nextFreeSlot(occupied, looseBounds());
			occupied.push(slot);
			plan.createInTable.push({
				googleTaskId: g.id,
				title: g.title,
				notes: g.notes,
				dueDate: g.dueDate,
				googleUpdatedAt: g.updated,
				x: Math.round(slot.x),
				y: Math.round(slot.y)
			});
			continue;
		}

		// Opted out: the table pass below deletes it in Google. Patching either
		// side first would fight that.
		if (!t.googleSync) continue;

		const googleChanged = g.updated !== t.googleUpdatedAt;
		const tableDirty = t.updatedAt !== t.googleSyncedAt;
		if (!googleChanged && !tableDirty) continue;

		// Parsed rather than compared as strings, so the result does not depend on
		// both sides formatting their timestamps to the same precision.
		const googleWins =
			!tableDirty || (googleChanged && Date.parse(t.updatedAt) <= Date.parse(g.updated));

		if (googleWins) {
			plan.patchInTable.push({
				taskId: t.id,
				title: g.title,
				notes: g.notes,
				dueDate: g.dueDate,
				done: g.done,
				completedAt: g.completedAt,
				googleUpdatedAt: g.updated
			});
		} else {
			plan.patchInGoogle.push({
				taskId: t.id,
				googleTaskId: g.id,
				title: t.title,
				notes: t.notes,
				dueDate: t.dueDate,
				done: t.done
			});
		}
	}

	for (const t of input.tableTasks) {
		if (t.googleSync && !t.googleTaskId) {
			// The due-date rule gates creation only. With no date the intent is
			// simply held: the badge stays in its outline state and the create
			// happens the moment a date is set.
			if (t.dueDate) {
				plan.createInGoogle.push({
					taskId: t.id,
					title: t.title,
					notes: t.notes,
					dueDate: t.dueDate
				});
			}
			continue;
		}

		if (!t.googleSync && t.googleTaskId) {
			plan.deleteInGoogle.push({ googleTaskId: t.googleTaskId, taskId: t.id });
			continue;
		}

		if (t.googleSync && t.googleTaskId && !seenGoogleIds.has(t.googleTaskId) && input.fullFetch) {
			// Deliberately not a deletion. Google purges deleted tasks after a
			// retention window, so for a Table that was down across it, absence is
			// indistinguishable from "never existed". Unlinking preserves the task;
			// deleting would destroy it on a guess.
			plan.unlinkInTable.push({ taskId: t.id, reason: 'no longer in Google Tasks' });
		}
	}

	return plan;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/gtasks/plan.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gtasks/plan.ts src/lib/server/gtasks/plan.test.ts
git commit -m "feat(gtasks): add the pure reconcile planner

Every rule the mirror has lives here and is covered without a network,
including the cases most likely to silently eat data: both-sides-dirty
resolution, unlink-rather-than-delete on ambiguous absence, and never
importing a completed task Table has not seen."
```

---

### Task 5: The sync runner

**Files:**
- Create: `src/lib/server/gtasks/sync.ts`
- Modify: `src/lib/server/tasks/service.ts` (add `nextSortOrder` export)

**Interfaces:**
- Consumes: `planGoogleTaskSync` (Task 4), `listTasks`/`insertTask`/`patchTask`/`deleteTask`/`toGoogleDue`/`fromGoogleDue` (Task 3), `getAccessToken` (Task 2), schema (Task 1)
- Produces:
  - `isGoogleTasksEnabled(): boolean`
  - `interface GoogleTaskSyncResult { ok, imported, updatedLocally, deletedLocally, pushed, deletedRemotely, failed }`
  - `syncGoogleTasks(options?: { full?: boolean }): Promise<GoogleTaskSyncResult>`
  - `readSyncState(key): Promise<string | null>`, `writeSyncState(key, value): Promise<void>`

- [ ] **Step 1: Export `nextSortOrder` from the tasks service**

The runner inserts tasks and needs the same ordering rule the composer uses. In `src/lib/server/tasks/service.ts`, change line 8 from `async function nextSortOrder()` to:

```ts
export async function nextSortOrder(): Promise<number> {
```

- [ ] **Step 2: Write the runner**

Create `src/lib/server/gtasks/sync.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, googleTaskTombstones, syncState } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { nextSortOrder } from '../tasks/service';
import {
	listTasks,
	insertTask,
	patchTask,
	deleteTask,
	toGoogleDue,
	fromGoogleDue,
	type GoogleTask
} from './client';
import { planGoogleTaskSync, type PlanGoogleTask } from './plan';

const LAST_SYNC_KEY = 'gtasks:lastSyncAt';
/** Absorbs clock drift between Table and Google when filtering by updatedMin. */
const SKEW_MS = 5 * 60 * 1000;

export interface GoogleTaskSyncResult {
	ok: boolean;
	imported: number;
	updatedLocally: number;
	deletedLocally: number;
	pushed: number;
	deletedRemotely: number;
	failed: number;
}

const EMPTY: GoogleTaskSyncResult = {
	ok: false,
	imported: 0,
	updatedLocally: 0,
	deletedLocally: 0,
	pushed: 0,
	deletedRemotely: 0,
	failed: 0
};

/**
 * Both halves matter: the flag is the deliberate switch, and the refresh token
 * is what any call would actually need. Missing either means every part of the
 * feature stays dark rather than erroring per request.
 */
export function isGoogleTasksEnabled(): boolean {
	return env.GTASKS_ENABLED === 'true' && Boolean(env.GCAL_REFRESH_TOKEN);
}

export async function readSyncState(key: string): Promise<string | null> {
	const row = await db.query.syncState.findFirst({ where: eq(syncState.key, key) });
	return row?.value ?? null;
}

export async function writeSyncState(key: string, value: string): Promise<void> {
	await db
		.insert(syncState)
		.values({ key, value })
		.onConflictDoUpdate({ target: syncState.key, set: { value } });
}

/** Google's wire shape in Table's vocabulary, so the planner never sees RFC 3339. */
function toPlanGoogleTask(g: GoogleTask): PlanGoogleTask {
	return {
		id: g.id,
		title: g.title ?? '',
		notes: g.notes ?? null,
		dueDate: fromGoogleDue(g.due),
		done: g.status === 'completed',
		completedAt: g.completed ?? null,
		updated: g.updated,
		deleted: g.deleted === true
	};
}

/**
 * One reconcile round.
 *
 * `full: true` skips the `updatedMin` filter and lets the planner act on a
 * linked task's absence. Periodic runs are incremental so a lifetime of
 * completed tasks is not re-fetched every few minutes; the manual refresh and
 * the very first run are full.
 *
 * Never throws. A round that cannot reach Google reports `ok: false` and leaves
 * every local record untouched, so the next round retries from the same state.
 */
export async function syncGoogleTasks(
	options?: { full?: boolean }
): Promise<GoogleTaskSyncResult> {
	if (!isGoogleTasksEnabled()) return { ...EMPTY };

	const lastSyncAt = await readSyncState(LAST_SYNC_KEY);
	const full = options?.full === true || lastSyncAt === null;

	let token: string;
	let googleRows: GoogleTask[];
	try {
		token = await getAccessToken();
		googleRows = await listTasks(token, {
			updatedMin: full
				? undefined
				: new Date(Date.parse(lastSyncAt as string) - SKEW_MS).toISOString()
		});
	} catch (err) {
		console.error('gtasks: fetch failed, keeping local state', err);
		return { ...EMPTY };
	}

	const [tableRows, tombstoneRows] = await Promise.all([
		db.query.tasks.findMany(),
		db.query.googleTaskTombstones.findMany()
	]);

	const plan = planGoogleTaskSync({
		tableTasks: tableRows.map((t) => ({
			id: t.id,
			title: t.title,
			notes: t.notes,
			dueDate: t.dueDate,
			done: t.done,
			completedAt: t.completedAt,
			updatedAt: t.updatedAt,
			googleSync: t.googleSync,
			googleTaskId: t.googleTaskId,
			googleSyncedAt: t.googleSyncedAt,
			googleUpdatedAt: t.googleUpdatedAt,
			x: t.x,
			y: t.y
		})),
		googleTasks: googleRows.map(toPlanGoogleTask),
		tombstones: tombstoneRows.map((row) => ({ googleTaskId: row.googleTaskId })),
		fullFetch: full
	});

	const result: GoogleTaskSyncResult = { ...EMPTY, ok: true };
	const startedAt = new Date().toISOString();

	// Deletes first, matching the plan's own ordering.
	for (const entry of plan.deleteInGoogle) {
		try {
			await deleteTask(token, entry.googleTaskId);
			if (entry.taskId === null) {
				await db
					.delete(googleTaskTombstones)
					.where(eq(googleTaskTombstones.googleTaskId, entry.googleTaskId));
			} else {
				// Only after Google confirms: unlinking on a failed delete would
				// strand a live Google task with nothing pointing at it.
				await db
					.update(tasks)
					.set({
						googleSync: false,
						googleTaskId: null,
						googleSyncedAt: null,
						googleUpdatedAt: null,
						googleError: null
					})
					.where(eq(tasks.id, entry.taskId));
			}
			result.deletedRemotely++;
		} catch (err) {
			console.error(`gtasks: delete ${entry.googleTaskId} failed`, err);
			result.failed++;
		}
	}

	for (const create of plan.createInGoogle) {
		try {
			const created = await insertTask(token, {
				title: create.title,
				notes: create.notes,
				due: toGoogleDue(create.dueDate),
				status: 'needsAction'
			});
			await markPushed(create.taskId, created);
			result.pushed++;
		} catch (err) {
			await recordError(create.taskId, err);
			result.failed++;
		}
	}

	for (const patch of plan.patchInGoogle) {
		try {
			const updated = await patchTask(token, patch.googleTaskId, {
				title: patch.title,
				notes: patch.notes,
				due: toGoogleDue(patch.dueDate),
				status: patch.done ? 'completed' : 'needsAction'
			});
			await markPushed(patch.taskId, updated);
			result.pushed++;
		} catch (err) {
			await recordError(patch.taskId, err);
			result.failed++;
		}
	}

	for (const create of plan.createInTable) {
		await db.insert(tasks).values({
			id: randomUUID(),
			title: create.title,
			notes: create.notes,
			dueDate: create.dueDate,
			priority: null,
			done: false,
			completedAt: null,
			source: 'google',
			externalId: null,
			courseName: null,
			x: create.x,
			y: create.y,
			sortOrder: await nextSortOrder(),
			updatedAt: startedAt,
			googleSync: true,
			googleTaskId: create.googleTaskId,
			// Both stamps set so the task reads as clean on the next round rather
			// than immediately echoing itself back up to Google.
			googleSyncedAt: startedAt,
			googleUpdatedAt: create.googleUpdatedAt,
			googleError: null,
			createdAt: startedAt
		});
		result.imported++;
	}

	for (const patch of plan.patchInTable) {
		const updatedAt = new Date().toISOString();
		await db
			.update(tasks)
			.set({
				title: patch.title,
				notes: patch.notes,
				dueDate: patch.dueDate,
				done: patch.done,
				completedAt: patch.completedAt,
				updatedAt,
				googleSyncedAt: updatedAt,
				googleUpdatedAt: patch.googleUpdatedAt,
				googleError: null
			})
			.where(eq(tasks.id, patch.taskId));
		result.updatedLocally++;
	}

	for (const del of plan.deleteInTable) {
		await db.delete(tasks).where(eq(tasks.id, del.taskId));
		result.deletedLocally++;
	}

	for (const unlink of plan.unlinkInTable) {
		await db
			.update(tasks)
			.set({
				googleSync: false,
				googleTaskId: null,
				googleSyncedAt: null,
				googleUpdatedAt: null,
				googleError: unlink.reason
			})
			.where(eq(tasks.id, unlink.taskId));
	}

	await writeSyncState(LAST_SYNC_KEY, startedAt);
	console.log(
		`gtasks sync: ${result.imported} imported, ${result.updatedLocally} updated, ` +
			`${result.deletedLocally} deleted locally, ${result.pushed} pushed, ` +
			`${result.deletedRemotely} deleted remotely, ${result.failed} failed`
	);
	return result;
}

/**
 * Records that Google now holds this exact version.
 *
 * `googleUpdatedAt` comes from the write's own response, not from a later
 * fetch. Google stamps `updated` at write time, so without this the next
 * reconcile would see Google as newer than Table and echo our own push back
 * down as an inbound change.
 */
export async function markPushed(taskId: string, googleTask: GoogleTask): Promise<void> {
	const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
	if (!row) return;
	await db
		.update(tasks)
		.set({
			googleTaskId: googleTask.id,
			googleSyncedAt: row.updatedAt,
			googleUpdatedAt: googleTask.updated,
			googleError: null
		})
		.where(eq(tasks.id, taskId));
}

export async function recordError(taskId: string, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`gtasks: push for task ${taskId} failed`, err);
	await db.update(tasks).set({ googleError: message }).where(eq(tasks.id, taskId));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors in `src/lib/server/gtasks/`.

- [ ] **Step 4: Verify the existing suite still passes**

Run: `npm test`
Expected: PASS — `nextSortOrder` becoming exported changes no behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gtasks/sync.ts src/lib/server/tasks/service.ts
git commit -m "feat(gtasks): execute a reconcile plan against google and sqlite

Stores the `updated` value from each write's own response, so a push is
not read back as an inbound change on the next round. Unlink-on-delete
is applied only after Google confirms, so a failed delete never strands
a live Google task with nothing pointing at it."
```

---

### Task 6: Scheduling, manual refresh and the page-load stale check

**Files:**
- Create: `src/routes/api/gtasks/sync/+server.ts`
- Modify: `src/lib/server/scheduler/index.ts`, `src/routes/(app)/+page.server.ts`, `src/lib/components/TopBar.svelte`

**Interfaces:**
- Consumes: `syncGoogleTasks`, `isGoogleTasksEnabled`, `readSyncState` (Task 5)
- Produces: `POST /api/gtasks/sync` returning `GoogleTaskSyncResult` as JSON; `gtasksConfigured` on the board's load data

- [ ] **Step 1: Register the cron job**

In `src/lib/server/scheduler/index.ts`, add to the imports:

```ts
import { syncGoogleTasks } from '../gtasks/sync';
```

Add below the `lmsSyncCron` const (line 22):

```ts
const gtasksSyncCron = env.GTASKS_SYNC_CRON ?? '*/5 * * * *';
```

And below the LMS `cron.schedule` block:

```ts
	// syncGoogleTasks() already swallows its own failures and reports ok:false;
	// the catch is a belt for anything unexpected, so one bad round never kills
	// the scheduled job.
	cron.schedule(gtasksSyncCron, () =>
		syncGoogleTasks().catch((err) => console.error('Google Tasks sync job failed', err))
	);
```

- [ ] **Step 2: Add the manual refresh route**

Create `src/routes/api/gtasks/sync/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { syncGoogleTasks } from '$lib/server/gtasks/sync';

export const POST = async () => {
	try {
		// Always full: a manual refresh is the one moment the user is watching, so
		// it is worth paying for the unfiltered fetch that can also detect a task
		// that has vanished from Google.
		return json(await syncGoogleTasks({ full: true }));
	} catch (err) {
		console.error('Manual Google Tasks sync failed', err);
		return json({ error: (err as Error).message }, { status: 502 });
	}
};
```

- [ ] **Step 3: Add the page-load stale check**

In `src/routes/(app)/+page.server.ts`, add to the imports:

```ts
import { syncGoogleTasks, isGoogleTasksEnabled, readSyncState } from '$lib/server/gtasks/sync';
```

Add above `export const load`:

```ts
/** Long enough that a reload is not a sync, short enough to catch the walk back from the bus. */
const STALE_MS = 60_000;
/** A board that renders now beats a board that renders correct-to-the-second. */
const LOAD_SYNC_BUDGET_MS = 4000;

/**
 * Brings Google Tasks up to date before the board renders, but only when it is
 * actually stale and only for as long as it is worth waiting.
 *
 * The cron job is what keeps the mirror fresh in general; this exists for the
 * case the cron cannot serve — you ticked something off on your phone a minute
 * ago and just opened Table. On timeout or failure the board renders whatever
 * the database already holds.
 */
async function syncGoogleTasksIfStale(): Promise<void> {
	if (!isGoogleTasksEnabled()) return;
	const lastSyncAt = await readSyncState('gtasks:lastSyncAt');
	if (lastSyncAt && Date.now() - Date.parse(lastSyncAt) < STALE_MS) return;

	await Promise.race([
		syncGoogleTasks(),
		new Promise((resolve) => setTimeout(resolve, LOAD_SYNC_BUDGET_MS))
	]).catch((err) => console.error('gtasks: load-time sync failed', err));
}
```

Then change the `load` function body so the sync runs before the tasks are read — a sync that lands after the read would not appear until the next navigation:

```ts
export const load: PageServerLoad = async () => {
	await syncGoogleTasksIfStale();
	// getAgenda() already swallows per-calendar failures; the catch is a belt for
	// anything unexpected, because a calendar must never stop the board loading.
	const [tasks, zones, agenda] = await Promise.all([
		tasksService.listActiveTasks(),
		zonesService.listZones(),
		getAgenda().catch(() => [])
	]);
	const lmsConfigured = Boolean(env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL);
	const gcalConfigured = Boolean(env.GCAL_REFRESH_TOKEN);
	return { tasks, zones, agenda, lmsConfigured, gcalConfigured };
};
```

- [ ] **Step 4: Expose the feature flag to the whole app shell**

`GTASKS_ENABLED` unset must hide every control, not just stop the syncing — and the controls live in three components at two different depths. Putting the flag on the *layout* load rather than the page load means any of them can read it from `page.data` without prop-drilling through the board.

In `src/routes/(app)/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/notifications/log';
import { isGoogleTasksEnabled } from '$lib/server/gtasks/sync';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// This load reads only `locals`, so SvelteKit has nothing to invalidate it on
	// during client-side navigation. The inbox marks notifications read and then
	// invalidates this key so the topbar badge clears without a full reload.
	depends('app:notifications');
	const unreadCount = locals.user ? await countUnreadNotifications(locals.user.id) : 0;
	// On the layout rather than the board's own load: the composer, the task
	// modal and the user menu all need it, at three different depths.
	return { user: locals.user, unreadCount, gtasksConfigured: isGoogleTasksEnabled() };
};
```

In `src/routes/(app)/+layout.svelte`, pass it to the topbar:

```svelte
	<TopBar user={data.user} unreadCount={data.unreadCount} gtasksConfigured={data.gtasksConfigured} />
```

- [ ] **Step 5: Add the menu item**

In `src/lib/components/TopBar.svelte`, replace the props line and add the state below `let digesting = $state(false);`:

```ts
	let {
		user,
		unreadCount,
		gtasksConfigured = false
	}: { user: { email: string } | null; unreadCount: number; gtasksConfigured?: boolean } = $props();
```

```ts
	let gtasksSyncing = $state(false);
```

Extend the `ApiBody` type with the runner's fields:

```ts
	type ApiBody = {
		error?: string;
		ok?: boolean;
		created?: number;
		updated?: number;
		/** Still worth surfacing: it means LMS_ZONE_ID named no zone this run. */
		placedLoose?: boolean;
		imported?: number;
		updatedLocally?: number;
		pushed?: number;
		failed?: number;
	};
```

Add the handler below `syncNow`:

```ts
	async function syncGoogleTasksNow() {
		closeMenu();
		gtasksSyncing = true;
		toast('Syncing Google Tasks…');
		try {
			const res = await fetch('/api/gtasks/sync', { method: 'POST' });
			const body = await readJson(res);
			if (!res.ok) {
				toast(body?.error ?? `Google Tasks sync failed (HTTP ${res.status})`, 'error');
			} else if (!body?.ok) {
				// ok:false is the runner reporting it never reached Google, not a
				// crash — say so rather than claiming a successful empty sync.
				toast('Google Tasks sync failed — could not reach Google', 'error');
			} else {
				toast(
					`Google Tasks synced — ${body.imported} in, ${body.pushed} out` +
						(body.failed ? `, ${body.failed} failed` : ''),
					body.failed ? 'error' : 'success'
				);
				await invalidateAll();
			}
		} catch {
			toast('Google Tasks sync failed', 'error');
		} finally {
			gtasksSyncing = false;
		}
	}
```

Add the button in the popover, directly after the "Sync assignments" button:

```svelte
						{#if gtasksConfigured}
							<button
								type="button"
								class="item"
								disabled={gtasksSyncing}
								onclick={syncGoogleTasksNow}
							>
								Sync Google Tasks
							</button>
						{/if}
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run check && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/scheduler/index.ts src/routes/api/gtasks src/routes/\(app\)/+page.server.ts src/routes/\(app\)/+layout.server.ts src/routes/\(app\)/+layout.svelte src/lib/components/TopBar.svelte
git commit -m "feat(gtasks): sync on a cron, on demand, and when the board is stale

The cron keeps the mirror fresh for the digest and the wall display; the
load-time check covers the case it cannot, which is opening Table right
after ticking something off on the phone."
```

---

### Task 7: `updatedAt` bumps in the task service

**Files:**
- Modify: `src/lib/server/tasks/service.ts`
- Test: `src/lib/server/tasks/service.test.ts` (existing file — add cases)

**Interfaces:**
- Consumes: schema (Task 1)
- Produces: `createTask` accepts `googleSync?: boolean`; `setGoogleSync(id, googleSync): Promise<void>`; `deleteTask` writes a tombstone for a linked task

- [ ] **Step 1: Teach the test's db mock about transactions**

`service.test.ts` mocks `../db` with a hand-rolled fake (lines 5–34). `deleteTask` is about to use a transaction, which the fake has no method for. Add this property to the mocked `db` object, after the existing `delete` block:

```ts
		transaction: (fn: (tx: unknown) => void) => {
			fn({
				insert: () => ({
					values: () => ({ onConflictDoNothing: () => ({ run: () => {} }) })
				}),
				delete: () => ({
					where: () => ({
						run: () => {
							rows.length = 0;
						}
					})
				})
			});
		}
```

- [ ] **Step 2: Write the failing tests**

Append this describe block to `src/lib/server/tasks/service.test.ts`, inside the existing `describe('tasks service', ...)`. It asserts against `rows[0]` rather than re-reading through the service, matching the style of the two cases already there — the mock's `findFirst` always returns `rows[0]` regardless of the id it is given.

```ts
	it('stamps a new task with its creation time', async () => {
		const t = await tasksService.createTask({ title: 'Fresh' });
		expect(t.updatedAt).toBe(t.createdAt);
	});

	it('bumps updatedAt when a field Google can see changes', async () => {
		const t = await tasksService.createTask({ title: 'Before' });
		await tasksService.updateTask(t.id, { title: 'After' });
		expect(rows[0].updatedAt).not.toBe('');
		expect(Date.parse(rows[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(t.updatedAt));
	});

	it('bumps updatedAt on completion', async () => {
		const t = await tasksService.createTask({ title: 'Toggle me' });
		await tasksService.toggleTaskDone(t.id);
		expect(rows[0].completedAt).not.toBeNull();
		expect(rows[0].updatedAt).toBe(rows[0].completedAt);
	});

	it('does NOT bump updatedAt when only the priority changes', async () => {
		const t = await tasksService.createTask({ title: 'Priority only' });
		await tasksService.updateTask(t.id, { priority: 'high' });
		expect(rows[0].priority).toBe('high');
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});

	it('does NOT bump updatedAt when a card is moved', async () => {
		const t = await tasksService.createTask({ title: 'Dragged' });
		await tasksService.updateTaskPosition(t.id, 500, 500);
		// Dirtiness is `updatedAt !== googleSyncedAt`, so a drag that bumped this
		// would fire a pointless push and could win a conflict against a real edit
		// made on the phone.
		expect(rows[0].x).toBe(500);
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});

	it('records the opt-in without marking the task dirty', async () => {
		const t = await tasksService.createTask({ title: 'Opt me in' });
		await tasksService.setGoogleSync(t.id, true);
		expect(rows[0].googleSync).toBe(true);
		expect(rows[0].updatedAt).toBe(t.updatedAt);
	});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/tasks/service.test.ts`
Expected: FAIL — `updatedAt` is `undefined` on new tasks, and `setGoogleSync` is not a function.

- [ ] **Step 4: Implement the bumps**

In `src/lib/server/tasks/service.ts`, add the imports and constant at the top:

```ts
import { tasks, googleTaskTombstones } from '../db/schema';
```

```ts
/**
 * The fields Google can see. Everything else — priority, position, category —
 * is invisible to Google, so changing it is not something Google can be behind
 * on and must not mark the task dirty.
 */
const GOOGLE_VISIBLE_FIELDS = ['title', 'notes', 'dueDate'] as const;
```

Replace `createTask` so it stamps `updatedAt` and accepts the opt-in:

```ts
export async function createTask(input: {
	title: string;
	notes?: string;
	dueDate?: string;
	priority?: 'low' | 'med' | 'high';
	googleSync?: boolean;
	x?: number;
	y?: number;
}): Promise<Task> {
	const now = new Date().toISOString();
	const row = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes ?? null,
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		done: false,
		completedAt: null,
		source: 'manual' as const,
		externalId: null,
		courseName: null,
		x: input.x ?? 60,
		y: input.y ?? 60,
		sortOrder: await nextSortOrder(),
		updatedAt: now,
		googleSync: input.googleSync ?? false,
		googleTaskId: null,
		googleSyncedAt: null,
		googleUpdatedAt: null,
		googleError: null,
		createdAt: now
	};
	await db.insert(tasks).values(row);
	return row;
}
```

Replace `updateTask`:

```ts
export async function updateTask(
	id: string,
	patch: Partial<{
		title: string;
		notes: string | null;
		dueDate: string | null;
		priority: 'low' | 'med' | 'high' | null;
	}>
): Promise<Task> {
	const touchesGoogle = GOOGLE_VISIBLE_FIELDS.some((field) => field in patch);
	await db
		.update(tasks)
		.set(touchesGoogle ? { ...patch, updatedAt: new Date().toISOString() } : patch)
		.where(eq(tasks.id, id));
	const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!updated) throw new Error(`Task ${id} not found`);
	return updated;
}
```

Replace `toggleTaskDone`'s update call so it bumps too:

```ts
	const now = new Date().toISOString();
	await db
		.update(tasks)
		.set({ done, completedAt: done ? now : null, updatedAt: now })
		.where(eq(tasks.id, id));
```

`updateTaskPosition` is left exactly as it is — that is the point of the test above.

Add `setGoogleSync` and a `getTask` reader:

```ts
export async function getTask(id: string): Promise<Task> {
	const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!row) throw new Error(`Task ${id} not found`);
	return row;
}

/**
 * Records the opt-in itself. Deliberately does not bump `updatedAt`: wanting a
 * task in Google is not a change to the task's content, and the planner detects
 * this from `googleSync` against `googleTaskId` rather than from dirtiness.
 */
export async function setGoogleSync(id: string, googleSync: boolean): Promise<void> {
	await db.update(tasks).set({ googleSync }).where(eq(tasks.id, id));
}
```

Replace `deleteTask` so a linked task leaves a tombstone:

```ts
/**
 * Deletes a task, leaving a tombstone when it was linked to Google.
 *
 * The tombstone and the delete share one transaction because they are one fact:
 * once the row is gone there is nothing left recording which Google task it
 * owned, so a delete that committed without its tombstone would leak a task in
 * Google that nothing will ever clean up.
 */
export async function deleteTask(id: string): Promise<void> {
	const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
	if (!existing) return;

	db.transaction((tx) => {
		if (existing.googleTaskId) {
			tx.insert(googleTaskTombstones)
				.values({ googleTaskId: existing.googleTaskId, deletedAt: new Date().toISOString() })
				.onConflictDoNothing()
				.run();
		}
		tx.delete(tasks).where(eq(tasks.id, id)).run();
	});
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/tasks/service.test.ts`
Expected: PASS, 8 tests, including the three "does NOT bump" cases.

- [ ] **Step 6: Give the LMS sync's raw insert the new columns**

`lms/sync.ts:46` inserts into `tasks` directly rather than through the service, so it does not get `updatedAt` from `createTask`. Add these two lines to its `values({...})` object, after `sortOrder: 0,`:

```ts
			updatedAt: new Date().toISOString(),
			googleSync: false,
```

A Canvas assignment therefore arrives un-badged, and is pushed to Google only if you opt it in like any other task.

- [ ] **Step 7: Run the whole suite**

Run: `npm run check && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/tasks/service.ts src/lib/server/tasks/service.test.ts src/lib/server/lms/sync.ts
git commit -m "feat(tasks): track updatedAt for fields google can see

Position and priority deliberately leave the stamp alone. Dirtiness is
updatedAt vs googleSyncedAt, so a drag that bumped it would push for no
reason and could beat a real edit made on the phone in a conflict."
```

---

### Task 8: Immediate outbound push

**Files:**
- Create: `src/lib/server/gtasks/push.ts`
- Modify: `src/routes/(app)/+page.server.ts`

**Interfaces:**
- Consumes: `getTask` (Task 7), `markPushed`/`recordError`/`isGoogleTasksEnabled` (Task 5), client (Task 3)
- Produces: `pushTaskNow(taskId: string): Promise<void>`, `pushDeletionNow(googleTaskId: string): Promise<void>` — neither ever throws

- [ ] **Step 1: Write the push module**

Create `src/lib/server/gtasks/push.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { googleTaskTombstones } from '../db/schema';
import { getAccessToken } from '../google/oauth';
import { getTask } from '../tasks/service';
import { insertTask, patchTask, deleteTask, toGoogleDue } from './client';
import { isGoogleTasksEnabled, markPushed, recordError } from './sync';

/**
 * Sends one task to Google right now, so a change made in Table shows up on the
 * phone in seconds rather than at the next cron tick.
 *
 * Never throws. A failure is recorded in `googleError` and left dirty, which is
 * exactly the state the reconciler retries — so the user's action always
 * succeeds locally whether or not Google is reachable.
 */
export async function pushTaskNow(taskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return;

	try {
		const task = await getTask(taskId);
		if (!task.googleSync) return;
		// The due-date rule gates creation only: an existing link is maintained
		// with `due: null` rather than being severed.
		if (!task.googleTaskId && !task.dueDate) return;

		const token = await getAccessToken();
		const body = {
			title: task.title,
			notes: task.notes,
			due: toGoogleDue(task.dueDate),
			status: task.done ? ('completed' as const) : ('needsAction' as const)
		};

		const saved = task.googleTaskId
			? await patchTask(token, task.googleTaskId, body)
			: await insertTask(token, body);

		await markPushed(taskId, saved);
	} catch (err) {
		await recordError(taskId, err).catch(() => {});
	}
}

/**
 * Deletes one Google task right now and drops its tombstone on success.
 *
 * Never throws. A failure leaves the tombstone in place, which is the whole
 * reason it is written: the next reconcile finds it and tries again.
 */
export async function pushDeletionNow(googleTaskId: string): Promise<void> {
	if (!isGoogleTasksEnabled()) return;

	try {
		await deleteTask(await getAccessToken(), googleTaskId);
		await db
			.delete(googleTaskTombstones)
			.where(eq(googleTaskTombstones.googleTaskId, googleTaskId));
	} catch (err) {
		console.error(`gtasks: immediate delete of ${googleTaskId} failed, tombstone kept`, err);
	}
}
```

- [ ] **Step 2: Wire the push into the board's actions**

In `src/routes/(app)/+page.server.ts`, add to the imports (`isGoogleTasksEnabled` is already imported from Task 6):

```ts
import { pushTaskNow, pushDeletionNow } from '$lib/server/gtasks/push';
```

Replace the four task actions:

```ts
	createTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = newTaskSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'Invalid task' });
		const task = await tasksService.createTask({
			title: parsed.data.title,
			dueDate: parsed.data.dueDate || undefined,
			priority: parsed.data.priority,
			// Honoured only with a due date: an undated Google task never reaches
			// the calendar grid, which is the whole point of pushing it.
			googleSync: parsed.data.googleSync === true && Boolean(parsed.data.dueDate),
			x: parsed.data.x,
			y: parsed.data.y
		});
		await pushTaskNow(task.id);
	},

	updateTask: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = String(data.id);
		await tasksService.updateTask(id, {
			title: data.title ? String(data.title) : undefined,
			notes: data.notes ? String(data.notes) : null,
			dueDate: data.dueDate ? String(data.dueDate) : null,
			priority: (data.priority as 'low' | 'med' | 'high') || null
		});
		// An unchecked checkbox is not submitted at all, so absence is a real
		// "off" — but only when the control was rendered. Guarded on the feature
		// flag, or turning the integration off for a day and editing a task would
		// silently clear an opt-in that nothing on screen was showing.
		if (isGoogleTasksEnabled()) await tasksService.setGoogleSync(id, data.googleSync === 'on');
		await pushTaskNow(id);
	},

	toggleTaskDone: async ({ request }) => {
		const data = await request.formData();
		const task = await tasksService.toggleTaskDone(String(data.get('id')));
		await pushTaskNow(task.id);
	},

	deleteTask: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		// Read before the delete: afterwards there is no row left to tell us which
		// Google task it owned. deleteTask() writes the tombstone that makes this
		// retry-safe if the Google call below fails.
		const existing = await tasksService.getTask(id).catch(() => null);
		await tasksService.deleteTask(id);
		if (existing?.googleTaskId) await pushDeletionNow(existing.googleTaskId);
	},
```

Turning the toggle **off** in the modal leaves `googleSync` false with `googleTaskId` still set. `pushTaskNow` returns early on `!task.googleSync`, so the Google task is removed by the next reconcile through the planner's opt-out rule rather than from the request. That is deliberate: the delete and the unlink must be paired, and the planner already pairs them.

- [ ] **Step 3: Add `googleSync` to the composer schema**

In `src/lib/server/tasks/forms.ts`, add to `newTaskSchema`:

```ts
	// An unchecked checkbox is never submitted, so absence means false. A checked
	// one posts the string "on".
	googleSync: z.preprocess((value) => value === 'on', z.boolean()),
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npm run check && npm test`
Expected: no errors; all tests pass. `forms.test.ts` needs no change — its assertions use `toMatchObject` and per-field checks, so the extra `googleSync: false` key does not break them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/gtasks/push.ts src/routes/\(app\)/+page.server.ts src/lib/server/tasks/forms.ts
git commit -m "feat(gtasks): push table changes to google immediately

Failures never reach the request: they are recorded in googleError and
left dirty, which is exactly the state the reconciler retries. Table
never blocks on Google being up."
```

---

### Task 9: The badge, the toggle and the composer checkbox

**Files:**
- Modify: `src/lib/components/TaskCard.svelte`, `src/lib/components/TaskDetailModal.svelte`, `src/lib/components/AddTaskForm.svelte`

**Interfaces:**
- Consumes: `googleSync`, `googleTaskId`, `googleError` on the task rows the board already loads
- Produces: no new module exports

- [ ] **Step 1: Add the badge to the card**

In `src/lib/components/TaskCard.svelte`, extend the `task` prop type:

```ts
		task: {
			id: string;
			title: string;
			done: boolean;
			priority: string | null;
			dueDate: string | null;
			googleSync?: boolean;
			googleTaskId?: string | null;
			googleError?: string | null;
		};
```

Add below the `overdue` derivation:

```ts
	// null hides the badge entirely: a task nobody asked to mirror should carry
	// no mark at all, or every card on the board grows one.
	let googleState = $derived(
		!task.googleSync && !task.googleTaskId
			? null
			: task.googleError
				? 'error'
				: task.googleSync && task.googleTaskId
					? 'synced'
					: 'pending'
	);

	let googleLabel = $derived(
		googleState === 'error'
			? `Google Tasks: ${task.googleError}`
			: googleState === 'pending'
				? 'Waiting to reach Google Tasks'
				: 'In Google Tasks'
	);
```

Add the badge markup immediately after the `{#if zoneColor}` block:

```svelte
	{#if googleState}
		<span class="gmark gmark-{googleState}" title={googleLabel}>
			<!-- Drawn rather than set in type, like the topbar icons: a glyph would
			     ignore the span's colour and so could not carry the three states. -->
			<svg
				viewBox="0 0 24 24"
				width="11"
				height="11"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M8 12.5l2.5 2.5L16 9.5" />
			</svg>
			<span class="sr-only">{googleLabel}</span>
		</span>
	{/if}
```

And the styles, plus a shift of `.zone-dot` so the two marks do not overlap:

```css
	.zone-dot {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		border: 1px solid;
	}
	.gmark {
		position: absolute;
		top: 0.3rem;
		right: 1.15rem;
		display: inline-flex;
		line-height: 0;
	}
	.gmark-synced {
		color: var(--ok);
	}
	.gmark-pending {
		color: var(--muted);
	}
	.gmark-error {
		color: var(--danger);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
```

Also change `.row-main`'s `padding-right` from `0.9rem` to `1.8rem`, so a long title cannot run under the two marks.

- [ ] **Step 2: Add the toggle to the modal**

In `src/lib/components/TaskDetailModal.svelte`, add `import { page } from '$app/state';` to the script, extend the `task` prop type with `googleSync?: boolean; googleTaskId?: string | null; googleError?: string | null;`, and add below the `$props()` call:

```ts
	// Mirrors the date input rather than the saved value, so the toggle enables
	// the moment a date is typed instead of after a save-and-reopen.
	let dueDate = $state(task.dueDate ?? '');
	let googleSync = $state(task.googleSync ?? false);
	// From the layout load, so this component does not have to be handed the flag
	// through the two views that render it.
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);
	// Creation needs a date; an existing link does not, and is maintained with a
	// null due date rather than severed.
	let canSync = $derived(Boolean(dueDate) || Boolean(task.googleTaskId));

	$effect(() => {
		if (!canSync) googleSync = false;
	});
```

Change the due-date input to bind:

```svelte
			<label>
				<span>Due date</span>
				<input type="date" name="dueDate" bind:value={dueDate} />
			</label>
```

Add after the Priority label, inside the same form:

```svelte
			{#if gtasksConfigured}
				<label class="check">
					<input type="checkbox" name="googleSync" bind:checked={googleSync} disabled={!canSync} />
					<span>Send to Google Tasks</span>
				</label>
				{#if !canSync}
					<p class="hint">Needs a due date — an undated task never reaches the calendar grid.</p>
				{/if}
				{#if task.googleError}
					<p class="hint hint-error">Google Tasks: {task.googleError}</p>
				{/if}
			{/if}
```

This pairs with the `isGoogleTasksEnabled()` guard on `setGoogleSync` in Task 8: the action treats an absent checkbox as "off", which is only true when the control was actually rendered.

And the styles:

```css
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.check span {
		font-size: 0.88rem;
		color: var(--ink);
	}

	.hint {
		margin: -0.35rem 0 0;
		font-size: 0.74rem;
		color: var(--muted);
	}

	.hint-error {
		color: var(--danger);
	}
```

- [ ] **Step 3: Add the composer checkbox**

In `src/lib/components/AddTaskForm.svelte`, add `import { page } from '$app/state';` and this to the script:

```ts
	const STORAGE_KEY = 'table:gtasks-default';

	let dueDate = $state('');
	// Sticky, because pushing everything should cost one click ever rather than
	// one per task.
	let googleSync = $state(false);
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);
	let canSync = $derived(Boolean(dueDate));

	// No reactive dependencies, so this runs once after mount to seed the sticky
	// preference. The server has no localStorage to read and renders it unticked.
	$effect(() => {
		try {
			googleSync = localStorage.getItem(STORAGE_KEY) === 'true';
		} catch {
			// Blocked storage: the checkbox still works, it just will not persist.
		}
	});

	function rememberGoogleSync(on: boolean) {
		googleSync = on;
		try {
			localStorage.setItem(STORAGE_KEY, String(on));
		} catch {
			// As above.
		}
	}
```

Reset the fields in the `enhance` callback so the next task starts clean but keeps the sticky preference:

```svelte
	use:enhance={() =>
		async ({ update }) => {
			await update();
			open = false;
			dueDate = '';
		}}
```

Replace the `{#if open}` block:

```svelte
	{#if open}
		<div class="extra">
			<label><span>Due</span><input type="date" name="dueDate" bind:value={dueDate} /></label>
			<label
				><span>Priority</span>
				<select name="priority">
					<option value="">None</option>
					<option value="low">Low</option>
					<option value="med">Medium</option>
					<option value="high">High</option>
				</select>
			</label>
		</div>
		{#if gtasksConfigured}
			<label class="gsync">
				<input
					type="checkbox"
					name="googleSync"
					checked={googleSync}
					disabled={!canSync}
					onchange={(e) => rememberGoogleSync(e.currentTarget.checked)}
				/>
				<span>Also add to Google Tasks{canSync ? '' : ' — needs a due date'}</span>
			</label>
		{/if}
	{/if}
```

And the styles:

```css
	.gsync {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.gsync span {
		font-size: 0.72rem;
		color: var(--muted);
	}
```

- [ ] **Step 4: Typecheck, lint and run the suite**

Run: `npm run check && npm run lint && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/TaskCard.svelte src/lib/components/TaskDetailModal.svelte src/lib/components/AddTaskForm.svelte
git commit -m "feat(gtasks): badge mirrored tasks and add the opt-in controls

The badge carries three states because a task can be in Google, on its
way there, or stuck — and a stuck one has no other way to say so. The
composer checkbox is sticky so pushing everything costs one click ever."
```

---

### Task 10: Retire the .ics feed and update the docs

**Files:**
- Delete: `src/lib/server/ics/export.ts`, `src/lib/server/ics/export.test.ts`, `src/routes/calendar.ics/+server.ts`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

Google Tasks sync supersedes it. Leaving both would put every badged task on the calendar twice — once as a checkable Google Task, once as an `.ics` all-day event that ticking the Google Task off does not remove.

- [ ] **Step 1: Delete the feed**

```bash
git rm -r src/lib/server/ics src/routes/calendar.ics
```

- [ ] **Step 2: Verify nothing still references it**

Run: `grep -rn "TASKS_FEED_TOKEN\|calendar.ics\|ics/export\|buildTasksIcs" src/ static/ README.md .env.example`
Expected: only the `.env.example` and `README.md` hits, which the next steps remove.

- [ ] **Step 3: Update `.env.example`**

Delete these four lines:

```
# Token for the read-only tasks .ics feed (subscribe in Google Calendar via
# "Other calendars > From URL": https://your-app/calendar.ics?token=...).
# Unset = feed disabled (404).
TASKS_FEED_TOKEN=
```

Append in their place:

```
# Google Tasks two-way sync. Needs the Google Tasks API enabled in the same
# Cloud project as the Calendar integration above, and a GCAL_REFRESH_TOKEN
# carrying the tasks scope — re-run `npm run google:auth` after enabling it.
# Unset = the whole feature is off: no cron, no push, no UI controls.
GTASKS_ENABLED=
GTASKS_SYNC_CRON=*/5 * * * *
```

- [ ] **Step 4: Update the README**

Replace the whole `## Tasks → Google Calendar` section (lines 103–112) with:

````markdown
## Google Tasks sync

Table mirrors tasks two ways with Google Tasks. Badged tasks become real Google
Tasks — visible on the Google Calendar grid on their due date, and in the Google
Tasks mobile app — and anything you add in Google Tasks comes back into Table.

The relationship is deliberately one-sided: **everything in Google is in Table,
but not everything in Table is in Google.** Table stays the place for everything;
Google holds the subset you chose, and those cards carry a badge.

Setup, on top of the Calendar steps above:

1. Enable the **Google Tasks API** in the same Google Cloud project.
2. Run `npm run google:auth` and replace `GCAL_REFRESH_TOKEN` with the new value.
   The existing token carries only the calendar scope, so every Tasks call would
   return 403 until it is replaced.
3. Set `GTASKS_ENABLED=true`. `GTASKS_SYNC_CRON` controls the inbound poll
   (default every five minutes); you can also sync on demand from the user menu.

How it behaves:

- **Opting in.** Tick "Send to Google Tasks" in a task's detail modal, or "Also
  add to Google Tasks" in the composer, which remembers its last setting. A task
  needs a due date before it can be sent — an undated Google Task never appears
  on the calendar grid, only in the Tasks side panel.
- **Coming back.** Tasks created in Google Tasks are imported as Uncategorized.
  Tasks already completed in Google are never imported, so connecting to a
  long-lived list does not dump its archive into Table's history.
- **Edits and completion** flow both ways. If the same task changed on both
  sides between syncs, the more recent edit wins the whole task.
- **Deletion is mirrored** — delete on either side and it goes from both. Table
  only ever acts on an explicit deletion from Google, never on a task merely
  going missing, so an outage cannot quietly destroy your tasks.
- **Failures are visible.** A task Google rejected keeps a warning badge with
  the reason, and retries on every sync. Table never blocks on Google being up:
  the change is saved locally either way.

Canvas assignments can be pushed like any other task. Priority and the course
name stay in Table — Google Tasks has no field for either.
````

Then update the two other places that name the old script:

- Line 81: `Run `npm run gcal:auth`` → `Run `npm run google:auth``
- Line 89: replace the scope paragraph with:

```
Table asks for `calendar.events.readonly` and `tasks`: read-only on the calendars
you name, read and write on your Google Tasks list, and nothing else — no
calendar writes, no calendar management.
```

Finally, in the Fly deploy section (line 142), replace `TASKS_FEED_TOKEN` with `GTASKS_ENABLED` in the list of optional secrets.

- [ ] **Step 5: Verify the retirement is complete**

Run: `grep -rn "TASKS_FEED_TOKEN\|calendar.ics\|gcal:auth" src/ README.md .env.example package.json`
Expected: no output.

- [ ] **Step 6: Run everything**

Run: `npm run check && npm run lint && npm test && npm run build`
Expected: all pass. The build is what proves no route still imports the deleted module.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ics)!: retire the tasks .ics feed for google tasks sync

BREAKING CHANGE: /calendar.ics and TASKS_FEED_TOKEN are removed. Any
calendar subscribed to that URL will stop updating; badge the tasks you
want on the calendar instead. Keeping both would show every badged task
twice, and ticking the Google Task off would not remove the .ics twin."
```

---

## Manual verification

Nothing automated touches Google. Run these against a real account after Task 9, then again after Task 10.

Prerequisites (see the project memory note — a 403 here is almost always a scope problem, not a bug):

1. Google Tasks API enabled in the Cloud project.
2. `GCAL_REFRESH_TOKEN` regenerated via `npm run google:auth`.
3. `GTASKS_ENABLED=true`.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Create a task with a due date, tick "Also add to Google Tasks" | It appears in the Google Tasks app and on the Calendar grid on that date; the card shows a solid badge |
| 2 | Tick it complete in the Google Tasks app, then use the menu's "Sync Google Tasks" | Table shows it done |
| 3 | Add a task in the Google Tasks app | It appears in Table as Uncategorized within five minutes |
| 4 | Add a task in Google and complete it before Table's next sync | Table never imports it |
| 5 | Rename a linked task in Table | The rename reaches Google within seconds |
| 6 | Delete a linked task in Table, then delete a different one in Google | Each disappears from the other side |
| 7 | Clear the due date on a linked task, then re-add one | It stays in the Google Tasks list, leaves the grid, and returns to the grid as the same task — not a duplicate |
| 8 | Turn the modal toggle off on a linked task | The Google task is gone by the next sync; the Table task survives without a badge |
| 9 | Disconnect the network, edit a linked task, reconnect, sync | The edit saves locally, the badge turns to its error state, and the next sync settles it and clears the badge |
| 10 | Drag a linked card to another bento category | No Google request is made and the badge does not change to pending |
