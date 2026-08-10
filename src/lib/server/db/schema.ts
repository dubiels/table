import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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

export const tasks = sqliteTable('tasks', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	notes: text('notes'),
	dueDate: text('due_date'),
	priority: text('priority', { enum: ['low', 'med', 'high'] }),
	done: integer('done', { mode: 'boolean' }).notNull().default(false),
	completedAt: text('completed_at'),
	source: text('source', { enum: ['manual', 'canvas'] })
		.notNull()
		.default('manual'),
	externalId: text('external_id'),
	courseName: text('course_name'),
	x: integer('x').notNull().default(0),
	y: integer('y').notNull().default(0),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: text('created_at').notNull()
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
