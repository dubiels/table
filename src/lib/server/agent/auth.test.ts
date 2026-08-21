import { describe, it, expect } from 'vitest';
import { decideAgentAuth } from './auth';

describe('decideAgentAuth', () => {
	it('is disabled when no token is configured, even with a valid-looking header', () => {
		expect(decideAgentAuth(undefined, 'Bearer x')).toBe('disabled');
		expect(decideAgentAuth('', 'Bearer x')).toBe('disabled');
	});

	it('allows a matching bearer token', () => {
		expect(decideAgentAuth('secret', 'Bearer secret')).toBe('ok');
	});

	it('rejects a wrong token, a malformed header, and no header', () => {
		expect(decideAgentAuth('secret', 'Bearer nope')).toBe('unauthorized');
		expect(decideAgentAuth('secret', 'secret')).toBe('unauthorized');
		expect(decideAgentAuth('secret', null)).toBe('unauthorized');
	});

	it('does not accept the dashboard token', () => {
		// The two credentials are separate so they can be revoked separately;
		// sharing one would make that impossible.
		expect(decideAgentAuth('agent-token', 'Bearer dashboard-token')).toBe('unauthorized');
	});
});
