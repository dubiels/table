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
	// Supplied as a bitmap rather than a path: the mark is a π glyph, and tracing
	// a typeface by hand would be a guess. It has no alpha channel, so the
	// component renders bitmap marks on a light tile — otherwise it would be a
	// white square against the dark theme.
	physicalintelligence: {
		title: 'Physical Intelligence',
		src: '/logos/physical-intelligence.png',
		hex: '111111'
	}
};
