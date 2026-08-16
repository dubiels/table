import { describe, it, expect } from 'vitest';
import { companyLogo, companyLogos } from './logo';

describe('companyLogo', () => {
	it('finds a well-known company by its plain name', () => {
		const logo = companyLogo('Stripe');
		expect(logo).not.toBeNull();
		expect(logo?.title).toBe('Stripe');
		expect(logo?.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
		expect(logo?.path.length).toBeGreaterThan(10);
	});

	it('ignores case', () => {
		expect(companyLogo('stripe')?.title).toBe('Stripe');
		expect(companyLogo('STRIPE')?.title).toBe('Stripe');
	});

	it('ignores spaces and punctuation', () => {
		expect(companyLogo('  Stripe  ')?.title).toBe('Stripe');
	});

	it('matches a two-word brand written either way', () => {
		expect(companyLogo('GitHub')?.title).toBe('GitHub');
		expect(companyLogo('git hub')?.title).toBe('GitHub');
	});

	// The Company field holds what a person types, which is a title, not a slug.
	it('matches on the title as well as the slug', () => {
		expect(companyLogo('Google Chrome')).not.toBeNull();
	});

	// Null is the ordinary outcome for a young company, not an error — callers
	// must render nothing rather than a placeholder.
	it('returns null for a company it does not carry', () => {
		expect(companyLogo('Physical Intelligence')).toBeNull();
	});

	it('returns null for empty and missing names', () => {
		expect(companyLogo('')).toBeNull();
		expect(companyLogo('   ')).toBeNull();
		expect(companyLogo(null)).toBeNull();
		expect(companyLogo(undefined)).toBeNull();
	});

	it('returns null rather than throwing on a name of pure punctuation', () => {
		expect(companyLogo('!!!')).toBeNull();
	});
});

describe('companyLogos', () => {
	it('resolves several names at once, keyed as stored', () => {
		const logos = companyLogos(['Stripe', 'GitHub']);
		expect(Object.keys(logos).sort()).toEqual(['GitHub', 'Stripe']);
	});

	it('omits names with no match rather than mapping them to null', () => {
		const logos = companyLogos(['Stripe', 'Physical Intelligence']);
		expect(logos).toHaveProperty('Stripe');
		expect(logos).not.toHaveProperty('Physical Intelligence');
	});

	it('skips empty and repeated names', () => {
		const logos = companyLogos(['Stripe', 'Stripe', null, undefined, '']);
		expect(Object.keys(logos)).toEqual(['Stripe']);
	});
});
