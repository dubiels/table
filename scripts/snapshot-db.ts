import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A consistent copy of the database, for the deploy to fall back to.
 *
 * `VACUUM INTO` rather than a file copy, because the app runs in WAL mode: at
 * any moment an arbitrary amount of committed data lives in the `-wal` sidecar
 * and not in the main file. Copying `table.sqlite` alone silently loses
 * everything written since the last checkpoint, and copying all three files
 * while the server is running can capture them mid-write. `VACUUM INTO` asks
 * SQLite itself for a single consistent file, which is the only cheap way to be
 * sure — and it works on a live database, so the service does not have to stop.
 *
 *   npx tsx scripts/snapshot-db.ts <source.sqlite> <destination.sqlite>
 */
const [source, destination] = process.argv.slice(2);

if (!source || !destination) {
	console.error('usage: snapshot-db.ts <source.sqlite> <destination.sqlite>');
	process.exit(1);
}

if (!fs.existsSync(source)) {
	// Not an error: the first deploy onto a fresh machine has nothing to snapshot
	// yet, and failing here would block the very deploy that creates the file.
	console.log(`snapshot: ${source} does not exist yet, nothing to snapshot`);
	process.exit(0);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
// VACUUM INTO refuses to overwrite, which is a feature — a destination that
// already exists means two deploys share a timestamp, and clobbering the older
// snapshot would destroy the thing being kept for safety.
if (fs.existsSync(destination)) {
	console.error(`snapshot: ${destination} already exists, refusing to overwrite`);
	process.exit(1);
}

const db = new Database(source, { readonly: false });
db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
db.close();

const { size } = fs.statSync(destination);
console.log(`snapshot: ${destination} (${(size / 1_048_576).toFixed(1)} MB)`);
