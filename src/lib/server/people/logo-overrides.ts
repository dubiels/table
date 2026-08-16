import type { CompanyLogo } from './logo';

/**
 * Marks for companies `simple-icons` does not carry.
 *
 * It has notability thresholds — roughly, a brand has to be widely recognised —
 * which most young companies will not clear no matter how well known they are
 * in your particular corner of the world. Physical Intelligence, for instance,
 * is absent from all 3,450 entries.
 *
 * Keys are the company name reduced the same way `logo.ts` reduces it:
 * lowercased, `&` to "and", `+` to "plus", everything else non-alphanumeric
 * dropped. So "Physical Intelligence" is keyed `physicalintelligence`.
 *
 * To add one: find the company's SVG mark, make sure it is a single `<path>` in
 * a 24×24 viewBox — most brand SVGs are not, and need flattening in a vector
 * editor first — and paste the `d` attribute below. `hex` is the brand colour
 * with no leading `#`.
 */
export const LOGO_OVERRIDES: Record<string, CompanyLogo> = {
	// Example of the shape, kept as documentation rather than a real mark: a
	// wordmark traced by hand would be a guess, and a wrong logo is worse than
	// none. Replace `path` with the real one when you have it.
	// physicalintelligence: {
	// 	title: 'Physical Intelligence',
	// 	path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0z',
	// 	hex: '111111'
	// }
};
