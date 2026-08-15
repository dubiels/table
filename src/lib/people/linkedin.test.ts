import { describe, it, expect } from 'vitest';
import { linkedinHandle } from './linkedin';

describe('linkedinHandle', () => {
	it('reads the handle from a full profile URL', () => {
		expect(linkedinHandle('https://www.linkedin.com/in/devonreyes')).toBe('devonreyes');
	});

	it('ignores a trailing slash', () => {
		expect(linkedinHandle('https://www.linkedin.com/in/devonreyes/')).toBe('devonreyes');
	});

	it('ignores query strings and fragments', () => {
		expect(linkedinHandle('https://linkedin.com/in/devonreyes?trk=nav#about')).toBe('devonreyes');
	});

	// Rows written before normalizeLinkedinUrl existed may have no scheme.
	it('reads a handle from a bare host', () => {
		expect(linkedinHandle('linkedin.com/in/devonreyes')).toBe('devonreyes');
	});

	it('reads a handle from a regional subdomain', () => {
		expect(linkedinHandle('https://uk.linkedin.com/in/devonreyes')).toBe('devonreyes');
	});

	it('decodes an escaped handle', () => {
		expect(linkedinHandle('https://linkedin.com/in/devon%20reyes')).toBe('devon reyes');
	});

	// Company pages and posts are not profiles, so the card falls back to showing
	// the raw link rather than inventing a handle from the wrong path segment.
	it('returns null for a company page', () => {
		expect(linkedinHandle('https://www.linkedin.com/company/cadence')).toBeNull();
	});

	it('returns null for a post', () => {
		expect(linkedinHandle('https://www.linkedin.com/feed/update/urn:li:activity:123')).toBeNull();
	});

	it('returns null for a non-linkedin url', () => {
		expect(linkedinHandle('https://cadence.dev/team/devon')).toBeNull();
	});

	// A host merely containing "linkedin" is not linkedin.com.
	it('returns null for a lookalike host', () => {
		expect(linkedinHandle('https://notlinkedin.com/in/devonreyes')).toBeNull();
	});

	it('returns null for empty and missing values', () => {
		expect(linkedinHandle('')).toBeNull();
		expect(linkedinHandle(null)).toBeNull();
		expect(linkedinHandle(undefined)).toBeNull();
	});

	it('returns null when the profile path has no handle', () => {
		expect(linkedinHandle('https://linkedin.com/in/')).toBeNull();
	});
});
