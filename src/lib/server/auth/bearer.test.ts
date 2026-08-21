import { describe, it, expect } from 'vitest';
import { tokensMatch, bearerToken, bearerMatches } from './bearer';

describe('tokensMatch', () => {
	it('matches identical tokens and rejects different ones', () => {
		expect(tokensMatch('secret', 'secret')).toBe(true);
		expect(tokensMatch('secret', 'nope')).toBe(false);
	});

	it('compares tokens of unequal length without throwing', () => {
		// timingSafeEqual rejects differing buffer lengths outright; hashing first
		// is what makes a short guess against a long token a plain false.
		expect(tokensMatch('a', 'a-much-longer-token')).toBe(false);
	});
});

describe('bearerToken', () => {
	it('extracts the credential', () => {
		expect(bearerToken('Bearer abc123')).toBe('abc123');
	});

	it('rejects a missing header and a bare token', () => {
		expect(bearerToken(null)).toBeNull();
		expect(bearerToken('abc123')).toBeNull();
		expect(bearerToken('Basic abc123')).toBeNull();
	});
});

describe('bearerMatches', () => {
	it('accepts the configured token and nothing else', () => {
		expect(bearerMatches('secret', 'Bearer secret')).toBe(true);
		expect(bearerMatches('secret', 'Bearer nope')).toBe(false);
		expect(bearerMatches('secret', 'secret')).toBe(false);
		expect(bearerMatches('secret', null)).toBe(false);
	});
});
