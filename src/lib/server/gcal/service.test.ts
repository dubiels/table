import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockEnv, getAccessToken, listEvents } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	getAccessToken: vi.fn(),
	listEvents: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('../google/oauth', () => ({
	getAccessToken,
	hasGoogleAccount: (account: string) =>
		Boolean(mockEnv[account === 'second' ? 'GCAL_REFRESH_TOKEN_2' : 'GCAL_REFRESH_TOKEN'])
}));
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

	getAccessToken
		.mockReset()
		.mockImplementation(async (account = 'primary') =>
			account === 'second' ? 'access-token-2' : 'access-token'
		);
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

		const callsBeforeRetry = listEvents.mock.calls.length;
		expect(await getAgenda()).toHaveLength(1);
		expect(listEvents).toHaveBeenCalledTimes(callsBeforeRetry);
	});

	it('returns an empty agenda when the very first fetch fails', async () => {
		listEvents.mockRejectedValue(new Error('HTTP 500'));
		const { getAgenda } = await freshService();

		expect(await getAgenda()).toEqual([]);
	});

	it('dedupes an event that appears on two calendars under the same id', async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'mine@example.com, team@example.com';
		listEvents
			.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')])
			.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);

		const { getAgenda } = await freshService();

		expect((await getAgenda()).map((e) => e.title)).toEqual(['standup']);
	});

	it('fetches a repeated calendar id only once', async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'primary,primary';
		listEvents.mockResolvedValue([event('standup', '2026-08-11T09:00:00Z')]);

		const { getAgenda } = await freshService();
		await getAgenda();

		expect(listEvents).toHaveBeenCalledTimes(1);
	});

	it('refetches inside the TTL when forced', async () => {
		listEvents
			.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')])
			.mockResolvedValueOnce([event('standup-2', '2026-08-11T10:00:00Z')]);
		const { getAgenda } = await freshService();

		await getAgenda();
		const forced = await getAgenda({ force: true });

		expect(listEvents).toHaveBeenCalledTimes(2);
		expect(forced.map((e) => e.title)).toEqual(['standup-2']);
	});
});

describe('refreshAgenda', () => {
	it('reports ok and the event count on success', async () => {
		listEvents.mockResolvedValue([event('standup', '2026-08-11T09:00:00Z')]);
		const { refreshAgenda } = await freshService();

		expect(await refreshAgenda()).toEqual({ ok: true, events: 1 });
	});

	it('reports ok:false when every calendar fails, without blanking the previous agenda', async () => {
		listEvents.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);
		const { getAgenda, refreshAgenda } = await freshService();
		await getAgenda();

		listEvents.mockRejectedValueOnce(new Error('HTTP 500'));
		expect(await refreshAgenda()).toEqual({ ok: false, events: 0 });

		expect(await getAgenda()).toHaveLength(1);
	});

	it('reports ok:false when no refresh token is configured', async () => {
		delete mockEnv.GCAL_REFRESH_TOKEN;
		const { refreshAgenda } = await freshService();

		expect(await refreshAgenda()).toEqual({ ok: false, events: 0 });
		expect(getAccessToken).not.toHaveBeenCalled();
	});
});

describe('configuredCalendars', () => {
	it("falls back to the account's primary calendar when none are named", async () => {
		const { configuredCalendars } = await freshService();

		expect(configuredCalendars()).toEqual([
			{ id: 'primary', account: 'primary', label: 'primary' }
		]);
	});

	it("lists the second account's calendars after the first account's", async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'me@example.com';
		mockEnv.GCAL_REFRESH_TOKEN_2 = 'refresh-token-2';
		mockEnv.GCAL_CALENDAR_IDS_2 = 'work@example.com';
		mockEnv.GCAL_CALENDAR_LABELS = 'me@example.com=Personal,work@example.com=Chapter One';
		const { configuredCalendars } = await freshService();

		expect(configuredCalendars()).toEqual([
			{ id: 'me@example.com', account: 'primary', label: 'Personal' },
			{ id: 'work@example.com', account: 'second', label: 'Chapter One' }
		]);
	});

	it('ignores the second account until it has a refresh token', async () => {
		mockEnv.GCAL_CALENDAR_IDS_2 = 'work@example.com';
		const { configuredCalendars } = await freshService();

		expect(configuredCalendars().map((c) => c.id)).toEqual(['primary']);
	});
});

describe('two accounts', () => {
	it('reads each account with its own token and tags events with their calendar', async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'me@example.com';
		mockEnv.GCAL_REFRESH_TOKEN_2 = 'refresh-token-2';
		mockEnv.GCAL_CALENDAR_IDS_2 = 'work@example.com';
		listEvents
			.mockResolvedValueOnce([event('lunch', '2026-08-11T12:00:00Z')])
			.mockResolvedValueOnce([event('standup', '2026-08-11T09:00:00Z')]);

		const { getAgenda } = await freshService();
		const agenda = await getAgenda();

		expect(listEvents).toHaveBeenCalledWith(
			'me@example.com',
			expect.any(Date),
			expect.any(Date),
			'access-token'
		);
		expect(listEvents).toHaveBeenCalledWith(
			'work@example.com',
			expect.any(Date),
			expect.any(Date),
			'access-token-2'
		);
		expect(agenda.map((e) => [e.title, e.calendarId])).toEqual([
			['standup', 'work@example.com'],
			['lunch', 'me@example.com']
		]);
	});

	it("keeps serving one account when the other account's token is dead", async () => {
		mockEnv.GCAL_CALENDAR_IDS = 'me@example.com';
		mockEnv.GCAL_REFRESH_TOKEN_2 = 'refresh-token-2';
		mockEnv.GCAL_CALENDAR_IDS_2 = 'work@example.com';
		getAccessToken.mockImplementation(async (account = 'primary') => {
			if (account === 'second') throw new Error('HTTP 400');
			return 'access-token';
		});
		listEvents.mockResolvedValue([event('lunch', '2026-08-11T12:00:00Z')]);

		const { getAgenda } = await freshService();

		expect((await getAgenda()).map((e) => e.title)).toEqual(['lunch']);
		expect(listEvents).toHaveBeenCalledTimes(1);
	});

	it('fetches the whole of today, not just what is left of it', async () => {
		vi.setSystemTime(new Date(2026, 7, 11, 16, 30));
		listEvents.mockResolvedValue([]);
		const { getAgenda } = await freshService();
		await getAgenda();

		const [, from] = listEvents.mock.calls[0];
		expect(from).toEqual(new Date(2026, 7, 11, 0, 0, 0, 0));
	});
});
