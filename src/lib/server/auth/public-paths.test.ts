import { describe, it, expect } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
	it('lets the login flow through', () => {
		expect(isPublicPath('/login')).toBe(true);
		expect(isPublicPath('/login/verify')).toBe(true);
	});

	it('lets the PWA shell through', () => {
		expect(isPublicPath('/manifest.json')).toBe(true);
		expect(isPublicPath('/service-worker.js')).toBe(true);
	});

	// The deploy step polls this while the app is starting, and `/` answers 303
	// for an unauthenticated request — a redirect is not a health signal.
	it('lets the health check through', () => {
		expect(isPublicPath('/api/health')).toBe(true);
	});

	it('gates everything else', () => {
		expect(isPublicPath('/')).toBe(false);
		expect(isPublicPath('/dinner')).toBe(false);
		expect(isPublicPath('/api/positions')).toBe(false);
	});

	// `startsWith` matching is the existing behaviour and is preserved, but it
	// must not let a lookalike route in through a public prefix.
	it('does not treat a longer unrelated path as public', () => {
		expect(isPublicPath('/api/healthcheck-internal')).toBe(false);
		expect(isPublicPath('/logins')).toBe(false);
	});
});
