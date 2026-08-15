import { describe, it, expect } from 'vitest';
import {
	normalizeLinkedinUrl,
	quickAddPersonSchema,
	updatePersonSchema,
	flagSchema
} from './forms';

describe('normalizeLinkedinUrl', () => {
	it('adds the scheme to a bare profile path', () => {
		expect(normalizeLinkedinUrl('linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('leaves an already-absolute url alone', () => {
		expect(normalizeLinkedinUrl('https://www.linkedin.com/in/devonreyes')).toBe(
			'https://www.linkedin.com/in/devonreyes'
		);
	});

	it('upgrades http to https', () => {
		expect(normalizeLinkedinUrl('http://linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('trims surrounding whitespace before deciding', () => {
		expect(normalizeLinkedinUrl('  linkedin.com/in/devonreyes  ')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	// A pasted value is never rejected — it is the user's own contact detail, and
	// storing it imperfectly beats refusing it.
	it('returns undefined for an empty or whitespace-only value', () => {
		expect(normalizeLinkedinUrl('')).toBeUndefined();
		expect(normalizeLinkedinUrl('   ')).toBeUndefined();
	});
});

describe('quickAddPersonSchema', () => {
	it('accepts a name alone', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: 'Devon Reyes' });
		expect(parsed.success).toBe(true);
	});

	it('accepts a name with the optional note', () => {
		const parsed = quickAddPersonSchema.safeParse({
			name: 'Devon Reyes',
			notes: 'met at Ana&apos;s dinner, builds scheduling infra'
		});
		expect(parsed.data?.notes).toContain('scheduling infra');
	});

	// The browser posts every rendered control, so an untouched note arrives as
	// an empty string rather than an absent key.
	it('treats a blank note as absent', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: 'Devon Reyes', notes: '' });
		expect(parsed.data?.notes).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(quickAddPersonSchema.safeParse({ name: '' }).success).toBe(false);
	});

	it('rejects a whitespace-only name', () => {
		expect(quickAddPersonSchema.safeParse({ name: '   ' }).success).toBe(false);
	});

	it('trims the stored name', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: '  Devon Reyes  ' });
		expect(parsed.data?.name).toBe('Devon Reyes');
	});
});

describe('updatePersonSchema', () => {
	it('accepts every field filled in', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes',
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party",
			metOn: '2026-01-14',
			notes: 'Ask about queue design.'
		});
		expect(parsed.success).toBe(true);
	});

	it('normalises the linkedin url as part of parsing', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes'
		});
		expect(parsed.data?.linkedinUrl).toBe('https://linkedin.com/in/devonreyes');
	});

	it('treats every blank optional field as absent', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: '',
			email: '',
			phone: '',
			company: '',
			role: '',
			city: '',
			metAt: '',
			metOn: '',
			notes: ''
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data?.email).toBeUndefined();
		expect(parsed.data?.metOn).toBeUndefined();
	});

	// Deliberately loose: rejecting a number copied off a napkin fails worse than
	// storing it imperfectly, and the user is the only reader.
	it('accepts an email that is not a valid address', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			email: 'devon at cadence dot dev'
		});
		expect(parsed.success).toBe(true);
	});

	it('rejects an empty name', () => {
		expect(updatePersonSchema.safeParse({ name: '' }).success).toBe(false);
	});
});

describe('flagSchema', () => {
	it('accepts a name and a known colour', () => {
		const parsed = flagSchema.safeParse({ name: 'SF', color: 'sky' });
		expect(parsed.success).toBe(true);
	});

	it('defaults the colour to sage', () => {
		const parsed = flagSchema.safeParse({ name: 'SF' });
		expect(parsed.data?.color).toBe('sage');
	});

	it('rejects a colour outside the palette', () => {
		expect(flagSchema.safeParse({ name: 'SF', color: 'neon' }).success).toBe(false);
	});

	it('rejects an empty flag name', () => {
		expect(flagSchema.safeParse({ name: '  ' }).success).toBe(false);
	});
});
