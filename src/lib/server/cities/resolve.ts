import type { CityMatch } from './search';

/** Only the lookup matters here, so a test can pass a two-line fake. */
export type CityLookup = { findById(id: number): CityMatch | null };

export type ResolvedCity = { city: string | null; cityId: number | null };

/**
 * Decides what actually gets stored for a city, given what the form posted.
 *
 * The rule is that a matched id owns the text: when `cityId` resolves, the
 * stored `city` is rewritten from the matched row and the posted text is
 * discarded. That is what makes this field standardised rather than merely
 * autocompleted — without it a stale tab, a browser autofill, or a hand-crafted
 * POST could leave an id describing one place beside the name of another, and
 * every later grouping would quietly disagree with what is on screen.
 *
 * An id that resolves to nothing is not an error. The seed tables are
 * rebuildable and carry no foreign key, so a stale id degrades to the same
 * honest state as free text: keep what the person typed, store no id.
 */
export function resolveCity(
	input: { city?: string | null; cityId?: number | null },
	lookup: CityLookup
): ResolvedCity {
	const typed = input.city?.trim() || null;

	if (input.cityId == null) return { city: typed, cityId: null };

	const match = lookup.findById(input.cityId);
	if (!match) return { city: typed, cityId: null };

	return { city: match.label, cityId: match.id };
}
