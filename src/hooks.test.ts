import { describe, it, expect } from 'vitest';
import { reroute } from './hooks';

/** `reroute` receives the parsed URL; only the hostname and pathname matter here. */
function at(href: string) {
	return reroute({ url: new URL(href), fetch: globalThis.fetch });
}

describe('reroute', () => {
	it('sends the dinner subdomain root to /dinner', () => {
		expect(at('https://dinner.example.com/')).toBe('/dinner');
	});

	it('leaves the main domain alone', () => {
		expect(at('https://table.example.com/')).toBeUndefined();
	});

	// Only the root is remapped, so API routes, the service worker and the login
	// flow keep working when reached through the subdomain.
	it('leaves non-root paths on the subdomain alone', () => {
		expect(at('https://dinner.example.com/login')).toBeUndefined();
		expect(at('https://dinner.example.com/api/dashboard')).toBeUndefined();
	});

	it('leaves a host that merely contains "dinner" alone', () => {
		expect(at('https://mydinnerparty.example.com/')).toBeUndefined();
	});

	it('handles localhost without a subdomain', () => {
		expect(at('http://localhost:5173/')).toBeUndefined();
	});
});
