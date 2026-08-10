import { describe, it, expect } from 'vitest';
import { decideDashboardAuth } from './auth';

describe('decideDashboardAuth', () => {
	it('is disabled when no token is configured — even with a session or header', () => {
		expect(decideDashboardAuth(undefined, 'Bearer x', true)).toBe('disabled');
		expect(decideDashboardAuth('', null, true)).toBe('disabled');
	});

	it('allows a valid session cookie', () => {
		expect(decideDashboardAuth('secret', null, true)).toBe('ok');
	});

	it('allows a matching bearer token', () => {
		expect(decideDashboardAuth('secret', 'Bearer secret', false)).toBe('ok');
	});

	it('rejects a wrong token, a malformed header, and no header', () => {
		expect(decideDashboardAuth('secret', 'Bearer nope', false)).toBe('unauthorized');
		expect(decideDashboardAuth('secret', 'secret', false)).toBe('unauthorized');
		expect(decideDashboardAuth('secret', null, false)).toBe('unauthorized');
	});
});
