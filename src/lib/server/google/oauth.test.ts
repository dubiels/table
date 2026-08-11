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
