/**
 * Rebuilds the bundled city dataset from GeoNames.
 *
 * A maintenance tool, not part of any build or deploy — run it by hand when you
 * want fresher data, then commit the .tsv.gz it writes. Everything downstream
 * (the seeder, the matcher) reads that committed file, so a stale dataset is a
 * deliberate state rather than a broken one.
 *
 * Usage:
 *   curl -O https://download.geonames.org/export/dump/cities5000.zip
 *   curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   curl -O https://download.geonames.org/export/dump/countryInfo.txt
 *   unzip cities5000.zip
 *   npx tsx scripts/build-cities.ts <dir-holding-those-files>
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const sourceDir = process.argv[2];
if (!sourceDir) {
	console.error('Usage: tsx scripts/build-cities.ts <dir-with-geonames-files>');
	process.exit(1);
}

const OUT = path.join(process.cwd(), 'src/lib/server/cities/cities.tsv.gz');

/** Longest alias we will keep. Anything past this is a descriptive phrase, not a name someone types. */
const MAX_ALIAS_LENGTH = 40;

const read = (name: string) => fs.readFileSync(path.join(sourceDir, name), 'utf8');

// `US.CA` -> `California`. For the US the code half is already the postal
// abbreviation, which is what the display label wants; elsewhere the code is
// an opaque number and only the name is worth showing.
const admin1Names = new Map<string, string>();
for (const line of read('admin1CodesASCII.txt').split('\n')) {
	const [code, name] = line.split('\t');
	if (code && name) admin1Names.set(code, name);
}

const countryNames = new Map<string, string>();
for (const line of read('countryInfo.txt').split('\n')) {
	if (line.startsWith('#') || !line.trim()) continue;
	const cols = line.split('\t');
	if (cols[0] && cols[4]) countryNames.set(cols[0], cols[4]);
}

/**
 * Aliases worth indexing: the ones a person might actually type.
 *
 * GeoNames ships every exonym in every script, which is tens of thousands of
 * entries no one will ever enter into this field. Keeping only short ASCII
 * strings leaves the useful cases — NYC, SF, LA — and discards the rest.
 */
function usefulAliases(raw: string, name: string, asciiName: string): string[] {
	if (!raw) return [];
	const seen = new Set([name.toLowerCase(), asciiName.toLowerCase()]);
	const out: string[] = [];
	for (const candidate of raw.split(',')) {
		const alias = candidate.trim();
		if (!alias || alias.length > MAX_ALIAS_LENGTH) continue;
		if (!/^[\x20-\x7E]+$/.test(alias)) continue;
		const key = alias.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(alias);
	}
	return out;
}

const rows: string[] = [];
let skipped = 0;

for (const line of read('cities5000.txt').split('\n')) {
	if (!line.trim()) continue;
	const c = line.split('\t');
	const [id, name, asciiName, alternateNames] = c;
	const countryCode = c[8];
	const admin1Code = c[10] ?? '';
	const population = c[14] ?? '0';

	const countryName = countryNames.get(countryCode);
	if (!id || !name || !asciiName || !countryCode || !countryName) {
		skipped++;
		continue;
	}

	const admin1Name = admin1Names.get(`${countryCode}.${admin1Code}`) ?? '';
	const aliases = usefulAliases(alternateNames ?? '', name, asciiName);

	// Tabs are the field separator and pipes join the aliases, so neither may
	// survive inside a value.
	const clean = (v: string) => v.replace(/[\t|]/g, ' ').trim();

	rows.push(
		[
			id,
			clean(name),
			clean(asciiName),
			countryCode,
			clean(countryName),
			clean(admin1Code),
			clean(admin1Name),
			population,
			aliases.map(clean).join('|')
		].join('\t')
	);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zlib.gzipSync(Buffer.from(rows.join('\n'), 'utf8'), { level: 9 }));

const bytes = fs.statSync(OUT).size;
console.log(
	`Wrote ${rows.length} cities to ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} MB gzipped)`
);
if (skipped) console.log(`Skipped ${skipped} rows missing an id, name or known country.`);
