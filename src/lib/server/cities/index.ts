import { sqliteClient } from '../db';
import { createCitySearch } from './search';
import { resolveCity } from './resolve';

/** The app-wide city search, bound to the live database. */
export const citySearch = createCitySearch(sqliteClient);

/**
 * Applies the id-owns-the-text rule against the live dataset.
 *
 * The rule itself lives in `resolve.ts` and takes its lookup as an argument, so
 * it stays testable without a database.
 */
export function resolvePersonCity(input: { city?: string | null; cityId?: number | null }) {
	return resolveCity(input, citySearch);
}

export { cityLabel, citySecondaryLabel } from './label';
export { normalizeCityQuery, MIN_QUERY_LENGTH } from './normalize';
export { SEARCH_LIMIT, type CityMatch } from './search';
export { resolveCity, type ResolvedCity } from './resolve';
