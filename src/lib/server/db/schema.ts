import {
	sqliteTable,
	text,
	integer,
	index,
	uniqueIndex,
	primaryKey
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	createdAt: text('created_at').notNull()
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	expiresAt: text('expires_at').notNull()
});

export const zones = sqliteTable('zones', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	color: text('color').notNull().default('sage'),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	width: integer('width').notNull().default(320),
	height: integer('height').notNull().default(320),
	createdAt: text('created_at').notNull()
});

export const tasks = sqliteTable(
	'tasks',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		notes: text('notes'),
		dueDate: text('due_date'),
		priority: text('priority', { enum: ['low', 'med', 'high'] }),
		done: integer('done', { mode: 'boolean' }).notNull().default(false),
		completedAt: text('completed_at'),
		source: text('source', { enum: ['manual', 'canvas', 'google'] })
			.notNull()
			.default('manual'),
		externalId: text('external_id'),
		courseName: text('course_name'),
		// The one seam between the board and Dinner Table, and it points this way
		// on purpose: a task may be about a person, a person never owns tasks.
		// Invisible to Google, so like priority and position it must never bump
		// `updatedAt` — see GOOGLE_VISIBLE_FIELDS in tasks/service.ts.
		personId: text('person_id'),
		x: integer('x').notNull().default(0),
		y: integer('y').notNull().default(0),
		sortOrder: integer('sort_order').notNull().default(0),
		// Bumped only by a field Google can see: title, notes, dueDate, done.
		// Position, category and priority deliberately leave it alone — dirtiness
		// is `updatedAt !== googleSyncedAt`, so a drag that bumped it would fire
		// pointless API calls and let that drag win a conflict against a real edit
		// made on the phone.
		updatedAt: text('updated_at').notNull().default(''),
		// Intent (do I want this in Google?) kept separate from achievement
		// (is it?). Collapsed into one column, opting in could only succeed while
		// Google was reachable, and a failed create would leave nothing to retry.
		googleSync: integer('google_sync', { mode: 'boolean' }).notNull().default(false),
		googleTaskId: text('google_task_id'),
		/** The `updatedAt` value Google last received. */
		googleSyncedAt: text('google_synced_at'),
		/** Google's own `updated` stamp as of the last reconcile. */
		googleUpdatedAt: text('google_updated_at'),
		/** Last push failure, cleared on success. Drives the badge's error state. */
		googleError: text('google_error'),
		createdAt: text('created_at').notNull()
	},
	(t) => ({
		// An index rather than a column constraint: SQLite cannot ALTER TABLE ADD
		// COLUMN ... UNIQUE. A unique index also permits many NULLs, which is what
		// "most tasks are not linked" needs.
		googleTaskIdIdx: uniqueIndex('tasks_google_task_id_idx').on(t.googleTaskId)
	})
);

export const googleTaskTombstones = sqliteTable('google_task_tombstones', {
	// Written in the same transaction as a linked task's local delete. Without it
	// a failed Google delete would leave nothing recording what to delete.
	googleTaskId: text('google_task_id').primaryKey(),
	deletedAt: text('deleted_at').notNull()
});

/**
 * One row per idempotency key the agent API has been handed.
 *
 * The agent retries, so every write it makes must be safe to replay. The key is
 * claimed by inserting this row *before* the work runs, not after: two retries
 * that arrive together interleave across an await, and a check-then-write would
 * let both of them past.
 *
 * `response` holds the JSON body the first attempt returned, so a replay is
 * answered with the original result rather than a second row being created.
 * It stays null while the first attempt is still in flight, which is what
 * distinguishes "already done, here it is" from "already running".
 */
export const agentIdempotency = sqliteTable('agent_idempotency', {
	key: text('key').primaryKey(),
	// A key is scoped to the route that claimed it. The same key arriving at a
	// different route is an agent bug — two unrelated writes collapsing into one
	// — and is refused rather than silently replaying the wrong resource.
	route: text('route').notNull(),
	status: integer('status'),
	response: text('response'),
	createdAt: text('created_at').notNull()
});

export const syncState = sqliteTable('sync_state', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	createdAt: text('created_at').notNull()
});

export const loginTokens = sqliteTable('login_tokens', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	tokenHash: text('token_hash').notNull(),
	codeHash: text('code_hash').notNull(),
	attemptCount: integer('attempt_count').notNull().default(0),
	expiresAt: text('expires_at').notNull(),
	used: integer('used', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull()
});

export const notifications = sqliteTable('notifications', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	type: text('type', { enum: ['morning_digest', 'due_alert'] }).notNull(),
	content: text('content').notNull(),
	sentAt: text('sent_at').notNull(),
	readAt: text('read_at')
});

export const people = sqliteTable('people', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// Someone you have met, or someone you want to. A `to_meet` record carries no
	// meeting date and no last-spoke date, and "who have I gone quiet on" must
	// never sweep in a person you have never spoken to — which is why this is a
	// column rather than just another flag.
	status: text('status', { enum: ['met', 'to_meet'] })
		.notNull()
		.default('met'),
	linkedinUrl: text('linkedin_url'),
	email: text('email'),
	phone: text('phone'),
	company: text('company'),
	// Separate from company: they display as one line ("Founder, Cadence") but
	// answer different questions, and either may be worth filtering on.
	role: text('role'),
	// The canonical label of `cityId` when one is set — the service derives it
	// rather than trusting what was posted. Free text otherwise: a vCard import
	// or a village GeoNames has never heard of still records somewhere.
	city: text('city'),
	// GeoNames id. Deliberately no foreign key: `cities` is a rebuildable seed
	// table, and a constraint would either block a reseed or cascade into people.
	// A dangling id reads as "unmatched", a state that already has to work.
	cityId: integer('city_id'),
	/** Free text: "Ana's dinner party", "Recurse pairing night". */
	metAt: text('met_at'),
	/** ISO date. Defaults to today when adding, because you add someone right after meeting them. */
	metOn: text('met_on'),
	// Seeded from `metOn` — meeting someone is the first time you spoke to them —
	// then moved by hand as you talk again. A single date, deliberately: the full
	// history of conversations belongs to the Touchpoints work, which will
	// supersede this column rather than sit beside it.
	lastSpokeAt: text('last_spoke_at'),
	/** Who they are, what they can help with. The field the later LLM phase reads. */
	notes: text('notes'),
	// Archive rather than delete: a hand-written paragraph about someone you met
	// once cannot be recovered from anywhere, precisely because no import exists.
	archivedAt: text('archived_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

/**
 * One recorded contact with someone — a coffee, a call, a reply to their email.
 *
 * Append-only in practice: the log is the history, and `people.lastSpokeAt` is a
 * denormalised copy of the most recent date so the grid can sort and filter on
 * it without reading every touchpoint on every render.
 */
export const touchpoints = sqliteTable('touchpoints', {
	id: text('id').primaryKey(),
	personId: text('person_id')
		.notNull()
		.references(() => people.id),
	/** ISO date, not a timestamp: you remember the day you spoke, not the minute. */
	occurredOn: text('occurred_on').notNull(),
	note: text('note'),
	createdAt: text('created_at').notNull()
});

export const flags = sqliteTable('flags', {
	id: text('id').primaryKey(),
	// Exact-match backstop only. SQLite compares text case-sensitively, so
	// case-insensitive reuse ("sf" finding "SF") is enforced in the service.
	name: text('name').notNull().unique(),
	color: text('color').notNull().default('sage'),
	createdAt: text('created_at').notNull()
});

export const peopleFlags = sqliteTable(
	'people_flags',
	{
		personId: text('person_id')
			.notNull()
			.references(() => people.id),
		flagId: text('flag_id')
			.notNull()
			.references(() => flags.id),
		createdAt: text('created_at').notNull()
	},
	(t) => ({
		// A composite primary key makes the same flag twice on one person
		// unrepresentable. The uniqueIndex workaround elsewhere in this file
		// exists only because SQLite cannot ALTER TABLE ADD COLUMN ... UNIQUE;
		// that does not apply to a new table.
		pk: primaryKey({ columns: [t.personId, t.flagId] })
	})
);

/**
 * The places a person can be, from GeoNames — every settlement over 5,000
 * people, worldwide.
 *
 * Seeded from the bundled `cities.tsv.gz` by `scripts/seed-cities.ts`, never
 * written by the app. Treat it as read-only reference data that happens to live
 * in the same file as the records.
 */
export const cities = sqliteTable(
	'cities',
	{
		/** The GeoNames id, which is the stable identity the `people.cityId` points at. */
		id: integer('id').primaryKey(),
		/** Display name, which may carry diacritics: "Malmö". */
		name: text('name').notNull(),
		/** GeoNames' own transliteration, already stripped of diacritics. */
		asciiName: text('ascii_name').notNull(),
		// `asciiName` lowercased. The seeder cannot import the app's normaliser —
		// it runs standalone under bare tsx — so rather than duplicate one and let
		// the two drift, the stored side is ASCII by construction and only the
		// user's input gets normalised at query time.
		searchKey: text('search_key').notNull(),
		countryCode: text('country_code').notNull(),
		countryName: text('country_name').notNull(),
		/** For the US this is the postal abbreviation ("CA"); elsewhere an opaque code. */
		admin1Code: text('admin1_code'),
		admin1Name: text('admin1_name'),
		population: integer('population').notNull()
	},
	(t) => ({
		// The only index this table needs. The ranking sorts on a computed
		// expression (population weighted by country), which no index can serve,
		// and at 69k rows sorting the matches is not the expensive part anyway.
		searchKeyIdx: index('cities_search_key_idx').on(t.searchKey)
	})
);

/**
 * Other names a city answers to — "NYC", "SF", "Frisco".
 *
 * Kept apart from `cities` so an alias hit can rank below a hit on the city's
 * real name: aliases are the loosest signal in the dataset.
 */
export const cityAliases = sqliteTable(
	'city_aliases',
	{
		cityId: integer('city_id').notNull(),
		/** Lowercased ASCII, matching how the query normalises input. */
		alias: text('alias').notNull()
	},
	(t) => ({
		aliasIdx: index('city_aliases_alias_idx').on(t.alias)
	})
);

/**
 * One row, holding the version of the dataset currently loaded.
 *
 * This is what makes seeding idempotent — it runs on every container start, and
 * reloading 69k rows each boot would be pure waste.
 */
export const cityDatasetMeta = sqliteTable('city_dataset_meta', {
	id: integer('id').primaryKey(),
	version: text('version').notNull(),
	cityCount: integer('city_count').notNull(),
	loadedAt: text('loaded_at').notNull()
});
