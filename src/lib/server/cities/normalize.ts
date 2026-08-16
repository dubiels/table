/**
 * Folds typed input down to the form the `cities.search_key` column is stored in.
 *
 * Only the input side needs this. The stored side is ASCII by construction —
 * it comes from GeoNames' own `asciiname`, lowercased by the seeder — because
 * the seeder runs standalone under bare `tsx` and cannot import this module.
 * Rather than keep two copies of a normaliser in sync, only one side has one.
 */
export function normalizeCityQuery(input: string): string {
	return (
		input
			.normalize('NFD')
			// Strip the combining marks NFD just split off, so "Málaga" reaches
			// the stored "malaga".
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/** Below this a prefix search matches most of the planet, so it is not worth running. */
export const MIN_QUERY_LENGTH = 2;
