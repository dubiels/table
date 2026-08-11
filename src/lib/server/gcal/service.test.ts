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
