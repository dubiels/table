import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';

/**
 * A real database for the agent API's tests, built by running the shipped
 * migrations.
 *
 * The alternative — a hand-written fake query builder, as `tasks/service.test.ts`
 * uses — cannot interpret a `where()`, so it would prove nothing about a write
 * that has to land, be read back, and be found again by an idempotent replay.
 * Running `drizzle/` rather than a copied DDL block means the schema under test
 * cannot drift from the one production migrates to.
 */
export function createTestDb() {
	const testSqlite = new Database(':memory:');
	const testDb = drizzle(testSqlite, { schema });
	migrate(testDb, { migrationsFolder: './drizzle' });
	// The migrator switches foreign keys on; `db/index.ts` never does, so the app
	// runs with them off and `deleteFlag` cleans its join rows by hand precisely
	// because `ON DELETE CASCADE` is declared but not enforced. Leaving them on
	// here would test a database the app does not have.
	testSqlite.pragma('foreign_keys = OFF');
	return { testDb, testSqlite };
}

/**
 * Empties every table, so one in-memory database can serve a whole file.
 *
 * The database is created once in a hoisted factory — it has to exist before
 * `vi.mock` hands it to the modules under test — so tests are isolated by
 * clearing it rather than by rebuilding it.
 */
export function resetTestDb(testSqlite: Database.Database): void {
	const tables = testSqlite
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.all() as { name: string }[];
	for (const { name } of tables) {
		if (name === '__drizzle_migrations') continue;
		testSqlite.prepare(`DELETE FROM "${name}"`).run();
	}
}
