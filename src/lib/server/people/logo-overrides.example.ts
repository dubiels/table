import type { CompanyLogo } from './logo';

/**
 * Template for `logo-overrides.local.ts`, which is deliberately not in version
 * control. Copy this file to that name and edit it.
 *
 * The mechanism is public; the contents are yours. Whose logos you keep says
 * who you know, so `logo-overrides.local.ts` and `static/logos/` are both
 * git-ignored — and both are absent from `.dockerignore`, so `fly deploy` still
 * carries them to your own instance.
 *
 * Why you will need this: `simple-icons` covers ~3,450 brands but has notability
 * thresholds most young companies will not clear, however well known they are in
 * your particular corner of the world.
 *
 * Keys are the company name reduced the way `normalizeCompanyName` reduces it —
 * lowercased, `&` to "and", `+` to "plus", everything else non-alphanumeric
 * dropped. "Example Corp" is keyed `examplecorp`.
 *
 * Prefer `path`: a single `<path>` in a 24×24 viewBox scales cleanly and takes
 * the brand colour. Most brand SVGs are several paths and need flattening in a
 * vector editor first. Fall back to `src` when the mark is only available as a
 * bitmap — put the image in `static/logos/` and point at it. Bitmaps render on
 * a light tile, because a logo exported without an alpha channel would
 * otherwise be a white square against the dark theme.
 */
export const LOGO_OVERRIDES: Record<string, CompanyLogo> = {
	// A vector mark, drawn in the brand's own colour:
	// examplecorp: {
	// 	title: 'Example Corp',
	// 	path: 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0z',
	// 	hex: '635BFF'
	// },
	//
	// A bitmap mark, served from static/logos/:
	// exampleco: {
	// 	title: 'Example Co',
	// 	src: '/logos/example-co.png',
	// 	hex: '111111'
	// }
};
