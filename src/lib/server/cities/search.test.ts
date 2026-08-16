import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCitySearch, type CitySearch } from './search';

/**
 * A real in-memory database rather than a mock.
 *
 * The rules under test — exact before prefix, aliases last, US-weighted
 * population — are expressed in SQL, so a fake query builder would assert
 * nothing about the behaviour that actually ships.
 */
const DDL = `
	CREATE TABLE cities (
		id integer PRIMARY KEY NOT NULL,
		name text NOT NULL,
		ascii_name text NOT NULL,
		search_key text NOT NULL,
		country_code text NOT NULL,
		country_name text NOT NULL,
		admin1_code text,
		admin1_name text,
		population integer NOT NULL
	);
	CREATE INDEX cities_search_key_idx ON cities (search_key);
	CREATE TABLE city_aliases (city_id integer NOT NULL, alias text NOT NULL);
	CREATE INDEX city_aliases_alias_idx ON city_aliases (alias);
`;

type Fixture = [
	id: number,
	name: string,
	countryCode: string,
	countryName: string,
	admin1Code: string | null,
	admin1Name: string | null,
	population: number
];

const CITIES: Fixture[] = [
	[5391959, 'San Francisco', 'US', 'United States', 'CA', 'California', 827526],
	[4726206, 'San Antonio', 'US', 'United States', 'TX', 'Texas', 1451853],
	[3583361, 'San Salvador', 'SV', 'El Salvador', '10', 'San Salvador', 525990],
	[3871336, 'Santiago', 'CL', 'Chile', '12', 'Santiago Metropolitan', 4837295],
	[5128581, 'New York City', 'US', 'United States', 'NY', 'New York', 8804190],
	[5345860, 'El Segundo', 'US', 'United States', 'CA', 'California', 17037],
	// The pair that a naive "US first, then population" sort gets wrong.
	[2950159, 'Berlin', 'DE', 'Germany', '16', 'Berlin', 3426354],
	[5090046, 'Berlin', 'US', 'United States', 'NH', 'New Hampshire', 10051],
	// Exact-versus-prefix, with population pointing the other way.
	[5232741, 'York', 'US', 'United States', 'PA', 'Pennsylvania', 43718],
	[4794120, 'Yorktown', 'US', 'United States', 'VA', 'Virginia', 195000],
	// Diacritics: stored ASCII, typed either way.
	[2514256, 'Málaga', 'ES', 'Spain', '51', 'Andalusia', 569130],
	// Begins with "sf", which is San Francisco's alias — the collision that
	// forces an exact alias to outrank a prefix name match.
	[2467454, 'Sfax', 'TN', 'Tunisia', '61', 'Sfax', 330440]
];

const ALIASES: [number, string][] = [
	[5128581, 'nyc'],
	[5391959, 'sf'],
	// An alias that collides with another city's real name, so the alias-ranks-last
	// rule has something to prove.
	[5232741, 'yorktown historic']
];

function asciiFold(value: string) {
	return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

let db: Database.Database;
let cities: CitySearch;

beforeEach(() => {
	db = new Database(':memory:');
	db.exec(DDL);

	const insert = db.prepare(
		`INSERT INTO cities (id, name, ascii_name, search_key, country_code, country_name, admin1_code, admin1_name, population)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const [id, name, countryCode, countryName, admin1Code, admin1Name, population] of CITIES) {
		const ascii = asciiFold(name);
		insert.run(
			id,
			name,
			ascii,
			ascii.toLowerCase(),
			countryCode,
			countryName,
			admin1Code,
			admin1Name,
			population
		);
	}

	const insertAlias = db.prepare('INSERT INTO city_aliases (city_id, alias) VALUES (?, ?)');
	for (const [cityId, alias] of ALIASES) insertAlias.run(cityId, alias);

	cities = createCitySearch(db);
});

describe('city search', () => {
	it('ranks an exact name match above a longer prefix match with more people', () => {
		const [first] = cities.search('york');
		// Yorktown is 4x the size, but "York" is what was typed.
		expect(first.name).toBe('York');
	});

	it('favours US cities without ignoring how much bigger a foreign one is', () => {
		// A close call goes local: San Francisco outranks Santiago despite
		// Santiago being nearly 6x its size.
		const names = cities.search('san').map((c) => c.name);
		expect(names.indexOf('San Francisco')).toBeLessThan(names.indexOf('Santiago'));

		// A landslide does not: Berlin, Germany is 340x its New Hampshire
		// namesake, and a plain US-first sort would get this backwards.
		expect(cities.search('berlin')[0].countryCode).toBe('DE');
	});

	it('still ranks two US cities by size alone', () => {
		// The weight is applied to both, so it cancels and population decides.
		const names = cities.search('san').map((c) => c.name);
		expect(names.indexOf('San Antonio')).toBeLessThan(names.indexOf('San Francisco'));
	});

	it('reaches a city through an alias', () => {
		expect(cities.search('nyc')[0].id).toBe(5128581);
	});

	it('ranks an exact name above an exact alias', () => {
		// "yorktown" is Yorktown's own name and part of York's alias.
		expect(cities.search('yorktown')[0].name).toBe('Yorktown');
	});

	it('ranks an exact alias above a name that merely starts with the query', () => {
		// Typing "sf" in full means San Francisco, not Sfax — something typed
		// whole beats something a longer name happens to begin with.
		expect(cities.search('sf')[0].id).toBe(5391959);
	});

	it('excludes alias matches when asked for names only', () => {
		expect(cities.search('nyc')).not.toHaveLength(0);
		expect(cities.search('nyc', { includeAliases: false })).toEqual([]);
	});

	it('matches a name typed without its diacritics, and with them', () => {
		expect(cities.search('malaga')[0].id).toBe(2514256);
		expect(cities.search('Málaga')[0].id).toBe(2514256);
	});

	it('ignores a query too short to mean anything', () => {
		expect(cities.search('s')).toEqual([]);
		expect(cities.search(' ')).toEqual([]);
	});

	it('honours the result limit', () => {
		expect(cities.search('san', { limit: 2 })).toHaveLength(2);
	});

	it('labels a matched city the way it will be stored', () => {
		expect(cities.search('san francisco')[0].label).toBe('San Francisco, CA');
		expect(cities.search('berlin')[0].label).toBe('Berlin, Germany');
	});

	it('finds a city by id, and returns null for one the dataset no longer has', () => {
		expect(cities.findById(5391959)?.label).toBe('San Francisco, CA');
		expect(cities.findById(999999999)).toBeNull();
	});

	it('resolves the three values already in this database', () => {
		// The backfill's real workload. Names only, as the script runs it.
		const resolve = (value: string) => cities.search(value, { limit: 1, includeAliases: false })[0];

		expect(resolve('San Francisco').id).toBe(5391959);
		expect(resolve('New York City').id).toBe(5128581);
		expect(resolve('El Segundo').id).toBe(5345860);
	});
});
