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
