import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { normalizeLinkedinUrl, addPersonSchema, updatePersonSchema, flagSchema } from './forms';

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

	// Mobile keyboards auto-capitalise the first character typed into a field,
	// so a capitalised scheme is realistic input, not a contrived edge case.
	it('normalises a capitalised https scheme instead of doubling it', () => {
		expect(normalizeLinkedinUrl('HTTPS://linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('normalises a mixed-case http scheme and upgrades it to https', () => {
		expect(normalizeLinkedinUrl('Http://linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('normalises an upper-case http scheme and upgrades it to https', () => {
		expect(normalizeLinkedinUrl('HTTP://linkedin.com/in/devonreyes')).toBe(
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

describe('addPersonSchema', () => {
	it('accepts a name alone, because everything else is optional', () => {
		const parsed = addPersonSchema.safeParse({ name: 'Devon Reyes' });
		expect(parsed.success).toBe(true);
	});

	it('accepts every field the dialog offers', () => {
		const parsed = addPersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes',
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party",
			metOn: '2026-01-14',
			lastSpokeAt: '2026-03-02',
			notes: 'builds scheduling infra'
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data).toMatchObject({
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party",
			metOn: '2026-01-14',
			lastSpokeAt: '2026-03-02'
		});
	});

	// The add form and the edit form must offer the same fields, so a person can
	// be entered completely in one go rather than half now and half discovered
	// later. Compared as key sets so a field added to one and not the other fails.
	it('accepts exactly the same fields as updatePersonSchema', () => {
		expect(Object.keys(addPersonSchema.shape).sort()).toEqual(
			Object.keys(updatePersonSchema.shape).sort()
		);
	});

	it('normalises the linkedin url as part of parsing', () => {
		const parsed = addPersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes'
		});
		expect(parsed.data?.linkedinUrl).toBe('https://linkedin.com/in/devonreyes');
	});

	// The browser posts every rendered control, so untouched fields arrive as
	// empty strings rather than absent keys. All seven, not a sample.
	it('treats every blank optional field as absent', () => {
		const parsed = addPersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: '',
			email: '',
			phone: '',
			company: '',
			role: '',
			city: '',
			metAt: '',
			metOn: '',
			lastSpokeAt: '',
			notes: ''
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data?.linkedinUrl).toBeUndefined();
		expect(parsed.data?.email).toBeUndefined();
		expect(parsed.data?.phone).toBeUndefined();
		expect(parsed.data?.company).toBeUndefined();
		expect(parsed.data?.role).toBeUndefined();
		expect(parsed.data?.city).toBeUndefined();
		expect(parsed.data?.metAt).toBeUndefined();
		expect(parsed.data?.metOn).toBeUndefined();
		expect(parsed.data?.lastSpokeAt).toBeUndefined();
		expect(parsed.data?.notes).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(addPersonSchema.safeParse({ name: '' }).success).toBe(false);
	});

	it('rejects a whitespace-only name', () => {
		expect(addPersonSchema.safeParse({ name: '   ' }).success).toBe(false);
	});

	it('trims the stored name', () => {
		const parsed = addPersonSchema.safeParse({ name: '  Devon Reyes  ' });
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
			lastSpokeAt: '2026-03-02',
			notes: 'Ask about queue design.'
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data?.lastSpokeAt).toBe('2026-03-02');
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
			lastSpokeAt: '',
			notes: ''
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data?.linkedinUrl).toBeUndefined();
		expect(parsed.data?.email).toBeUndefined();
		expect(parsed.data?.phone).toBeUndefined();
		expect(parsed.data?.company).toBeUndefined();
		expect(parsed.data?.role).toBeUndefined();
		expect(parsed.data?.city).toBeUndefined();
		expect(parsed.data?.metAt).toBeUndefined();
		expect(parsed.data?.metOn).toBeUndefined();
		expect(parsed.data?.lastSpokeAt).toBeUndefined();
		expect(parsed.data?.notes).toBeUndefined();
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

	// Compile-time guard: the inferred colour type must stay the FlagColor
	// literal union, not widen to `string`. If the cast in forms.ts ever goes
	// back to `as [string, ...string[]]`, `'neon'` becomes assignable and this
	// `@ts-expect-error` starts reporting as unused, which fails `npm run check`.
	it('infers a FlagColor literal union for color, not string', () => {
		type InferredColor = z.infer<typeof flagSchema>['color'];
		// @ts-expect-error 'neon' is not a valid FlagColor
		const bogus: InferredColor = 'neon';
		expect(bogus).toBe('neon');
	});
});

describe('cityId', () => {
	// The combobox always renders the hidden field, so an untouched form posts it
	// empty rather than omitting it.
	it('treats the empty string the browser posts as no city id', () => {
		const parsed = addPersonSchema.safeParse({ name: 'Devon Reyes', city: 'Berlin', cityId: '' });
		expect(parsed.success && parsed.data.cityId).toBeUndefined();
	});

	it('coerces the string a form posts into a number', () => {
		const parsed = addPersonSchema.safeParse({
			name: 'Devon Reyes',
			city: 'San Francisco, CA',
			cityId: '5391959'
		});
		expect(parsed.success && parsed.data.cityId).toBe(5391959);
	});

	it('rejects an id that is not a positive whole number', () => {
		for (const cityId of ['abc', '-1', '0', '1.5']) {
			expect(updatePersonSchema.safeParse({ name: 'Devon Reyes', cityId }).success).toBe(false);
		}
	});

	it('accepts free text with no id, because not everywhere is in the dataset', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			city: "my parents' place"
		});
		expect(parsed.success && parsed.data.city).toBe("my parents' place");
	});
});
