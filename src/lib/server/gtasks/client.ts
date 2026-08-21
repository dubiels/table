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
export function toGoogleDue(plannedDate: string | null): string | null {
	return plannedDate ? `${plannedDate}T00:00:00.000Z` : null;
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

export async function insertTask(accessToken: string, body: GoogleTaskWrite): Promise<GoogleTask> {
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
