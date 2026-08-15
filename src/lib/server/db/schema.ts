import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

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
	linkedinUrl: text('linkedin_url'),
	email: text('email'),
	phone: text('phone'),
	company: text('company'),
	// Separate from company: they display as one line ("Founder, Cadence") but
	// answer different questions, and either may be worth filtering on.
	role: text('role'),
	city: text('city'),
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
