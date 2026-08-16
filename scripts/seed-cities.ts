/**
 * Loads the bundled GeoNames extract into the `cities` and `city_aliases` tables.
 *
 * Runs on every container start, right after migrations. Deliberately
 * self-contained — no imports from `src/` — because the Dockerfile copies this
 * file out flat and runs it under bare `tsx`, where `$lib` does not resolve.
 * `migrate.ts` is standalone for the same reason.
 *
 * Idempotent: the loaded dataset's content hash is recorded, and a run whose
 * hash already matches does nothing. Reloading 69k rows on every boot would be
 * pure waste.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dbPath = process.env.DATABASE_PATH ?? './data/table.sqlite';

// `./cities.tsv.gz` is where the Dockerfile lands it; the src path is where it
// lives in a dev checkout. Trying both means one script serves both.
const CANDIDATES = [
	process.env.CITIES_DATA_PATH,
	'./cities.tsv.gz',
	'./src/lib/server/cities/cities.tsv.gz'
].filter((p): p is string => !!p);

const dataPath = CANDIDATES.find((p) => fs.existsSync(p));
if (!dataPath) {
	console.error(`No city dataset found. Looked in: ${CANDIDATES.join(', ')}`);
	process.exit(1);
}

const raw = fs.readFileSync(dataPath);
const version = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const current = db.prepare('SELECT version FROM city_dataset_meta WHERE id = 1').get() as
	{ version: string } | undefined;

if (current?.version === version) {
	console.log(`City dataset ${version} already loaded — nothing to do.`);
	db.close();
	process.exit(0);
}

const text = zlib.gunzipSync(raw).toString('utf8');

const insertCity = db.prepare(
	`INSERT INTO cities
	   (id, name, ascii_name, search_key, country_code, country_name, admin1_code, admin1_name, population)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertAlias = db.prepare('INSERT INTO city_aliases (city_id, alias) VALUES (?, ?)');

let cityCount = 0;
let aliasCount = 0;

const load = db.transaction(() => {
	// A reseed replaces the dataset wholesale. Nothing outside these tables
	// depends on their row identity — `people.city_id` holds a GeoNames id, which
	// is stable across releases, and is checked at read time rather than by a
	// foreign key.
	db.prepare('DELETE FROM city_aliases').run();
	db.prepare('DELETE FROM cities').run();

	for (const line of text.split('\n')) {
		if (!line) continue;
		const [
			id,
			name,
			asciiName,
			countryCode,
			countryName,
			admin1Code,
			admin1Name,
			population,
			aliases
		] = line.split('\t');
		if (!id || !name) continue;

		insertCity.run(
			Number(id),
			name,
			asciiName,
			asciiName.toLowerCase(),
			countryCode,
			countryName,
			admin1Code || null,
			admin1Name || null,
			Number(population) || 0
		);
		cityCount++;

		if (!aliases) continue;
		for (const alias of aliases.split('|')) {
			if (!alias) continue;
			insertAlias.run(Number(id), alias.toLowerCase());
			aliasCount++;
		}
	}

	db.prepare('DELETE FROM city_dataset_meta').run();
	db.prepare(
		'INSERT INTO city_dataset_meta (id, version, city_count, loaded_at) VALUES (1, ?, ?, ?)'
	).run(version, cityCount, new Date().toISOString());
});

load();
db.close();

console.log(`Loaded ${cityCount} cities and ${aliasCount} aliases from ${dataPath} (${version}).`);
