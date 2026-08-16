import * as simpleIcons from 'simple-icons';
import { LOGO_OVERRIDES } from './logo-overrides';

/**
 * A company's mark, resolved from the name we already store.
 *
 * Server-side on purpose. `simple-icons` is ~3,450 brands and several megabytes;
 * a dynamic lookup in the browser cannot be tree-shaken, so the whole set would
 * ship to every visitor. Resolving here means only the matched path string
 * travels — a few hundred bytes per distinct company on the page.
 *
 * Nothing is fetched. No third party learns which companies your contacts work
 * for, which would quietly undo part of the point of self-hosting this.
 */

export interface CompanyLogo {
	title: string;
	/**
	 * A single SVG path in a 24×24 viewBox — how every simple-icons mark arrives.
	 * Absent on an override supplying a bitmap instead.
	 */
	path?: string;
	/**
	 * A URL to an image, for an override whose mark is not available as a path.
	 * Served from our own `static/`, never a third party.
	 */
	src?: string;
	/** Brand colour as a bare hex triplet, no leading hash. */
	hex: string;
}

/**
 * `simple-icons` keys its exports as `siStripe`, so a name has to be reduced to
 * the same shape it slugs titles into: lowercased, with everything that is not
 * a letter or digit dropped. "Ben & Jerry's" and "ben-and-jerrys" both have to
 * land on the same entry as the package's own `benandjerrys` slug, hence the
 * ampersand becoming "and" before anything else is stripped.
 */
function normalize(name: string): string {
	return name
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/\+/g, 'plus')
		.replace(/[^a-z0-9]/g, '');
}

/** Built once: 3,450 entries re-keyed on every render would be silly. */
const BY_NORMALIZED_NAME = new Map<string, CompanyLogo>();
for (const icon of Object.values(simpleIcons)) {
	// The module also exports helpers; only the icon objects have a path.
	if (!icon || typeof icon !== 'object' || !('path' in icon)) continue;
	const entry = icon as { title: string; slug: string; path: string; hex: string };
	// Slug first, then title — the slug is the package's own canonical form, and
	// the title is what a person would actually type into the Company field.
	for (const key of [entry.slug, entry.title]) {
		const normalized = normalize(key);
		if (normalized && !BY_NORMALIZED_NAME.has(normalized)) {
			BY_NORMALIZED_NAME.set(normalized, {
				title: entry.title,
				path: entry.path,
				hex: entry.hex
			});
		}
	}
}

/**
 * The logo for a company name, or null when nothing matches.
 *
 * Null is the common case for young companies — `simple-icons` has notability
 * thresholds a startup will not clear — so callers must render nothing rather
 * than a placeholder. `logo-overrides.ts` is where to add one by hand.
 */
export function companyLogo(name: string | null | undefined): CompanyLogo | null {
	if (!name) return null;
	const normalized = normalize(name);
	if (!normalized) return null;
	return LOGO_OVERRIDES[normalized] ?? BY_NORMALIZED_NAME.get(normalized) ?? null;
}

/** Resolves a whole page's worth at once, keyed by the name as stored. */
export function companyLogos(names: (string | null | undefined)[]): Record<string, CompanyLogo> {
	const out: Record<string, CompanyLogo> = {};
	for (const name of names) {
		if (!name || out[name]) continue;
		const logo = companyLogo(name);
		if (logo) out[name] = logo;
	}
	return out;
}
