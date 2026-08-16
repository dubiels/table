import { describe, it, expect } from 'vitest';
import { companyLogo, companyLogos, normalizeCompanyName, resolveLogo } from './logo';

describe('companyLogo', () => {
	it('finds a well-known company by its plain name', () => {
		const logo = companyLogo('Stripe');
		expect(logo).not.toBeNull();
		expect(logo?.title).toBe('Stripe');
		expect(logo?.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
		expect(logo?.path?.length).toBeGreaterThan(10);
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
	it('returns null for a company nothing carries', () => {
		expect(companyLogo('Acme Widgets Incorporated')).toBeNull();
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
		const logos = companyLogos(['Stripe', 'Acme Widgets Incorporated']);
		expect(logos).toHaveProperty('Stripe');
		expect(logos).not.toHaveProperty('Acme Widgets Incorporated');
	});

	it('skips empty and repeated names', () => {
		const logos = companyLogos(['Stripe', 'Stripe', null, undefined, '']);
		expect(Object.keys(logos)).toEqual(['Stripe']);
	});
});

// The override mechanism is tested against fixtures, never against whatever the
// owner of this machine happens to have added: `logo-overrides.local.ts` is
// git-ignored, so a test asserting its contents would fail on a fresh clone.
describe('resolveLogo', () => {
	const bundled = { stripe: { title: 'Stripe', path: 'M0 0', hex: '635BFF' } };
	const overrides = {
		examplecorp: { title: 'Example Corp', src: '/logos/example.png', hex: '111111' }
	};

	it('finds a bundled mark', () => {
		expect(resolveLogo('Stripe', {}, bundled)?.title).toBe('Stripe');
	});

	it('finds an override the bundled set lacks', () => {
		expect(resolveLogo('Example Corp', overrides, bundled)?.src).toBe('/logos/example.png');
	});

	// Overrides exist precisely because the bundled set is wrong or absent.
	it('prefers an override over a bundled mark of the same name', () => {
		const shadowing = { stripe: { title: 'Stripe', src: '/logos/mine.png', hex: '000000' } };
		expect(resolveLogo('Stripe', shadowing, bundled)?.src).toBe('/logos/mine.png');
	});

	it('normalises the name before looking in either source', () => {
		expect(resolveLogo('example-corp!', overrides, bundled)?.title).toBe('Example Corp');
	});

	it('returns null when neither source has it', () => {
		expect(resolveLogo('Nobody Ltd', overrides, bundled)).toBeNull();
	});

	it('returns null for empty and missing names', () => {
		expect(resolveLogo('', overrides, bundled)).toBeNull();
		expect(resolveLogo(null, overrides, bundled)).toBeNull();
		expect(resolveLogo('!!!', overrides, bundled)).toBeNull();
	});

	it('accepts a Map as the bundled source, which is how it is built', () => {
		const asMap = new Map(Object.entries(bundled));
		expect(resolveLogo('Stripe', {}, asMap)?.title).toBe('Stripe');
	});
});

describe('normalizeCompanyName', () => {
	it('lowercases and strips punctuation', () => {
		expect(normalizeCompanyName('Example Corp')).toBe('examplecorp');
	});

	it('spells out & and + so they match the packaged slugs', () => {
		expect(normalizeCompanyName('Ben & Jerry')).toBe('benandjerry');
		expect(normalizeCompanyName('C++')).toBe('cplusplus');
	});
});
