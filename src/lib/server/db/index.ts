import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const dbPath = env.DATABASE_PATH ?? './data/table.sqlite';

// `migrate.ts` does the same thing for the same reason, and this module needs it
// more: it opens the database at import, and `vite build`'s postbuild `analyse`
// step imports every server node — so a checkout without `data/` fails the build,
// not just the boot. The deploy checkout is exactly that, because `data/` is
// gitignored and `git clean -ffdx` removes it.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

// The raw handle, for the city search — its ranking is a single query with a
// CTE and a grouped rank, which reads far better as SQL than as a query builder,
// and taking a handle lets the tests run it against a real in-memory database
// instead of a mock that cannot interpret `where()`.
export const sqliteClient = sqlite;
