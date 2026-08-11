import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTasks, insertTask, patchTask, deleteTask, toGoogleDue, fromGoogleDue } from './client';

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
