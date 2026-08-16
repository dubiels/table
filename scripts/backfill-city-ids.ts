/**
 * Points existing free-text cities at their canonical dataset entries.
 *
 * A one-time migration that has to run *after* seeding and needs the matcher, so
 * it is a script rather than a SQL migration. Idempotent — it only considers
 * rows that have a city and no id yet — and reversible by clearing `city_id`.
 *
 * Unlike the seeder this never runs in the container, so it is free to import
 * from `src/`.
 *
 * Usage:
 *   npx tsx scripts/backfill-city-ids.ts          # report only
 *   npx tsx scripts/backfill-city-ids.ts --apply  # write
 */
import Database from 'better-sqlite3';
import { createCitySearch } from '../src/lib/server/cities/search';

const apply = process.argv.includes('--apply');
const dbPath = process.env.DATABASE_PATH ?? './data/table.sqlite';

const db = new Database(dbPath);
const cities = createCitySearch(db);

const rows = db
	.prepare(
		`SELECT id, name, city FROM people
		  WHERE city IS NOT NULL AND TRIM(city) <> '' AND city_id IS NULL
		  ORDER BY city, name`
	)
	.all() as { id: string; name: string; city: string }[];

if (rows.length === 0) {
	console.log('Nothing to backfill — every person with a city already has an id.');
	db.close();
	process.exit(0);
}

const update = db.prepare('UPDATE people SET city_id = ?, city = ? WHERE id = ?');

const matched: string[] = [];
const aliasOnly: string[] = [];
const unmatched: string[] = [];

const run = db.transaction(() => {
	for (const row of rows) {
		// Names only. Auto-applying an alias across a whole column is a much larger
		// bet than accepting one in a dropdown you are looking at.
		const [best] = cities.search(row.city, { limit: 1, includeAliases: false });

		if (best) {
			matched.push(`  ${row.name}: "${row.city}" → ${best.label} (${best.id})`);
			if (apply) update.run(best.id, best.label, row.id);
			continue;
		}

		// Reported, never applied — so a near miss is visible rather than silent.
		const [viaAlias] = cities.search(row.city, { limit: 1 });
		if (viaAlias) {
			aliasOnly.push(`  ${row.name}: "${row.city}" ~ ${viaAlias.label} (${viaAlias.id})`);
		} else {
			unmatched.push(`  ${row.name}: "${row.city}"`);
		}
	}
});

run();
db.close();

console.log(`${apply ? 'Applied' : 'Would apply'} ${matched.length} of ${rows.length} rows.\n`);
if (matched.length) console.log(`Matched on city name:\n${matched.join('\n')}\n`);
if (aliasOnly.length)
	console.log(`Alias-only, NOT applied — set these by hand if right:\n${aliasOnly.join('\n')}\n`);
if (unmatched.length) console.log(`No match, left as free text:\n${unmatched.join('\n')}\n`);
if (!apply) console.log('Dry run. Re-run with --apply to write.');
