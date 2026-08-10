import { describe, it, expect } from 'vitest';
import { decideDashboardAuth, decideFeedAuth } from './auth';

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

describe('decideFeedAuth', () => {
	it('is disabled when no token is configured — even with a session or query token', () => {
		expect(decideFeedAuth(undefined, 'x', true)).toBe('disabled');
		expect(decideFeedAuth('', null, true)).toBe('disabled');
	});

	it('allows a valid session cookie', () => {
		expect(decideFeedAuth('secret', null, true)).toBe('ok');
	});

	it('allows a matching query token', () => {
		expect(decideFeedAuth('secret', 'secret', false)).toBe('ok');
	});

	it('rejects a wrong token and no token', () => {
		expect(decideFeedAuth('secret', 'nope', false)).toBe('unauthorized');
		expect(decideFeedAuth('secret', null, false)).toBe('unauthorized');
	});
});
