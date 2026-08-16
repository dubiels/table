import type { Database, Statement } from 'better-sqlite3';
import type { CityMatch } from '$lib/people/types';
import { cityLabel, citySecondaryLabel, type CityRow } from './label';
import { MIN_QUERY_LENGTH, normalizeCityQuery } from './normalize';

export type { CityMatch };

/** Enough to choose from without turning the field into a list to read. */
export const SEARCH_LIMIT = 8;

/**
 * How much a US city's population counts for, relative to a foreign one.
 *
 * A plain "US first, then population" sort is the obvious reading of a US-first
 * preference, and it is wrong: it puts Berlin, New Hampshire (10k) above Berlin,
 * Germany (3.4M), because sorting by country before size ignores size entirely.
 *
 * Weighting instead of ordering keeps the preference without that cliff. At 8×,
 * San Francisco (827k) outranks Santiago (4.8M) — the local answer wins a close
 * call — while Berlin, Germany still beats its New Hampshire namesake by two
 * orders of magnitude. Raise it to favour US matches harder; drop it to 1 for a
 * neutral worldwide ranking.
 */
const US_WEIGHT = 8;

type Row = CityRow & { id: number; population: number };

/**
 * Prefix search over city names and aliases, ranked so the place you meant comes
 * first.
 *
 *   rank 0  the name matches exactly          "berlin" → Berlin
 *   rank 1  an alias matches exactly          "sf"     → San Francisco
 *   rank 2  the name starts with what you typed
 *   rank 3  an alias starts with what you typed
 *
 * then by population with US cities weighted up (see `US_WEIGHT`).
 *
 * The middle two tiers are the interesting ones, and they are in that order for
 * a reason: with aliases ranked strictly below every name match, typing "sf"
 * returns Sfax, Tunisia — a prefix hit on a real name — ahead of the city the
 * alias exists to find. Something typed in full is a stronger signal than
 * something a longer name merely begins with, whichever table it came from.
 *
 * The prefix test is a range scan rather than `LIKE 'x%'` because SQLite only
 * optimises LIKE into an index seek under conditions this schema does not
 * guarantee. Both indexed columns are ASCII by construction, so `￿` is a
 * safe upper bound for any prefix.
 */
const NAME_HITS = `
		SELECT id AS city_id, CASE WHEN search_key = ? THEN 0 ELSE 2 END AS rank
		  FROM cities
		 WHERE search_key >= ? AND search_key < ?`;

const ALIAS_HITS = `
		UNION ALL
		SELECT city_id, CASE WHEN alias = ? THEN 1 ELSE 3 END AS rank
		  FROM city_aliases
		 WHERE alias >= ? AND alias < ?`;

const RANKED = `
	SELECT c.id, c.name, c.country_code AS countryCode, c.country_name AS countryName,
	       c.admin1_code AS admin1Code, c.admin1_name AS admin1Name, c.population,
	       MIN(h.rank) AS rank
	  FROM hits h
	  JOIN cities c ON c.id = h.city_id
	 GROUP BY c.id
	 ORDER BY rank ASC,
	          (c.population * CASE WHEN c.country_code = 'US' THEN ${US_WEIGHT} ELSE 1 END) DESC,
	          c.name ASC
	 LIMIT ?
`;

const SEARCH_SQL = `WITH hits AS (${NAME_HITS}${ALIAS_HITS}\n\t)${RANKED}`;

/**
 * The same ranking with the alias table left out, so every hit is a match on a
 * city's own name.
 *
 * The backfill uses this: applying an alias match unattended across a whole
 * column is a much larger bet than accepting one in a dropdown you are looking
 * at, and aliases are the loosest signal in the dataset.
 */
const SEARCH_NAMES_ONLY_SQL = `WITH hits AS (${NAME_HITS}\n\t)${RANKED}`;

const BY_ID_SQL = `
	SELECT id, name, country_code AS countryCode, country_name AS countryName,
	       admin1_code AS admin1Code, admin1_name AS admin1Name, population
	  FROM cities
	 WHERE id = ?
`;

/**
 * Binds the queries to a database handle.
 *
 * Taking the handle rather than importing the app's lets the tests run this
 * against a real in-memory SQLite with fixture rows — which matters here,
 * because the ranking rules being asserted live in the SQL itself.
 */
export function createCitySearch(database: Database) {
	// Prepared on first use, not at module load: compiling a statement against a
	// table that does not exist yet throws, and this module is imported by the
	// app long before anyone has necessarily run the migration.
	let searchStatement: Statement<unknown[]> | null = null;
	let namesOnlyStatement: Statement<unknown[]> | null = null;
	let byIdStatement: Statement<unknown[]> | null = null;

	const toMatch = (row: Row): CityMatch => ({
		id: row.id,
		label: cityLabel(row),
		name: row.name,
		secondary: citySecondaryLabel(row),
		countryCode: row.countryCode,
		population: row.population
	});

	return {
		/**
		 * `includeAliases: false` restricts results to matches on a city's own
		 * name — see `SEARCH_NAMES_ONLY_SQL`.
		 */
		search(input: string, { limit = SEARCH_LIMIT, includeAliases = true } = {}): CityMatch[] {
			const q = normalizeCityQuery(input);
			if (q.length < MIN_QUERY_LENGTH) return [];
			// U+FFFF sorts above every ASCII byte, so this bounds the prefix range.
			const upper = `${q}￿`;

			if (!includeAliases) {
				namesOnlyStatement ??= database.prepare(SEARCH_NAMES_ONLY_SQL);
				return (namesOnlyStatement.all(q, q, upper, limit) as Row[]).map(toMatch);
			}

			searchStatement ??= database.prepare(SEARCH_SQL);
			const rows = searchStatement.all(q, q, upper, q, q, upper, limit) as Row[];
			return rows.map(toMatch);
		},

		/**
		 * Null for an id that is not in the dataset — which is a state that has to
		 * work, since the seed tables are rebuildable and carry no foreign key.
		 */
		findById(id: number): CityMatch | null {
			byIdStatement ??= database.prepare(BY_ID_SQL);
			const row = byIdStatement.get(id) as Row | undefined;
			return row ? toMatch(row) : null;
		}
	};
}

export type CitySearch = ReturnType<typeof createCitySearch>;
