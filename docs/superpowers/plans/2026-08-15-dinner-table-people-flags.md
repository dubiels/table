# Dinner Table — People and Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dinner Table — a contact book at `/dinner` for people you have met in person, with reusable flags, a card grid, search, and archive.

**Architecture:** A bounded module inside the existing Table SvelteKit app. Three new SQLite tables (`people`, `flags`, `people_flags`), a server service layer under `src/lib/server/people/`, one route with form actions at `src/routes/(app)/dinner/`, and Svelte 5 components under `src/lib/components/people/`. All interesting logic lives in two pure modules (`search.ts`, `forms.ts`) that are unit-tested without a database; the service layer stays thin, mirroring how `lms/plan.ts` and `gtasks/plan.ts` already split from their `sync.ts`.

**Tech Stack:** SvelteKit 2 (Svelte 5, runes mode forced), Drizzle ORM + better-sqlite3, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-dinner-table-people-flags-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Module boundary:** nothing under `src/lib/server/people/` or `src/routes/(app)/dinner/` may import from `src/lib/server/tasks/`, `zones/`, `lms/`, `gcal/`, or `gtasks/`. The dependency arrow points inward only.
- **`$lib/server/**` is unimportable from client code.** SvelteKit fails the build on it, and `import type` is not a reliable escape hatch. Because the page filters in the browser, `search.ts`, `types.ts` and `colors.ts` live under `src/lib/people/` — client-safe — while only database-touching code sits under `src/lib/server/people/`. This deviates from the spec's file listing; the spec's *boundary rule* is what matters and is preserved, since nothing under `src/lib/people/` imports from the board either.
- **Runes mode is forced** for all non-`node_modules` files (`vite.config.ts`). Use `$props()`, `$state()`, `$derived()`, `$effect()`. Never `export let`.
- **Tests mock the database.** `vi.mock('../db', ...)` — see `src/lib/server/zones/service.test.ts`. No test touches a real SQLite file.
- **`expect: { requireAssertions: true }`** is set in `vite.config.ts`. Every `it()` must contain at least one assertion.
- **Test timezone is pinned** to `America/New_York`. Date assertions must assume it.
- **Flag colour tokens** are exactly `sage`, `sky`, `butter`, `blush`, `lilac`, `clay`. Store token names, never hex.
- **No external services.** This module makes no network calls. Every failure is a zod rejection returned via `fail(400, ...)` or a SQLite error.
- **Commit style:** Conventional Commits v1.0.0. Lowercase imperative description, no trailing period. Scope `dinner`.
- **Run all tests with** `npm test` (`vitest --run`). Run one file with `npx vitest run <path>`.
- **`data/table.sqlite` holds real data** — 30 tasks and 5 zones as of 2026-08-15 — and the Dockerfile migrates production automatically on every boot. No task may write a migration that drops, alters, or deletes anything in an existing table. Task 1 verifies this explicitly. A verified backup sits at `data/backups/table-pre-dinner-2026-08-15.sqlite`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/lib/people/colors.ts` | Flag colour token list and CSS-var resolution. Client-safe. |
| `src/lib/people/types.ts` | `PersonView` / `FlagView` — the shapes components render. Client-safe. |
| `src/lib/people/search.ts` | Filter, rank and order a people array. Pure, no DB. Client-safe. |
| `src/lib/people/search.test.ts` | Tests for the above. |
| `src/lib/server/people/forms.ts` | zod schemas + LinkedIn URL normalisation. Pure. |
| `src/lib/server/people/forms.test.ts` | Tests for the above. |
| `src/lib/server/people/service.ts` | People CRUD, archive, restore. |
| `src/lib/server/people/service.test.ts` | Tests for the above. |
| `src/lib/server/people/flags.ts` | Flag CRUD, attach/detach, transactional delete. |
| `src/lib/server/people/flags.test.ts` | Tests for the above. |
| `src/routes/(app)/dinner/+page.server.ts` | Load people + flags; nine form actions. |
| `src/routes/(app)/dinner/+page.svelte` | Owns search/filter state, renders the view. |
| `src/lib/components/people/PersonCard.svelte` | One tile. |
| `src/lib/components/people/PersonGrid.svelte` | Responsive grid + empty states. |
| `src/lib/components/people/QuickAddPerson.svelte` | Name + optional note, always visible. |
| `src/lib/components/people/FlagFilterBar.svelte` | Filter chips, counts, archived toggle, flag ⋯ menu. |
| `src/lib/components/people/FlagPicker.svelte` | Attach/detach on a person; inline create. |
| `src/lib/components/people/PersonDetailModal.svelte` | Full record editor. |
| `src/lib/toast.svelte.ts` (modify) | Optional action button, for undo on archive. |
| `src/lib/components/Toasts.svelte` (modify) | Render that action button. |
| `src/hooks.ts` | `reroute` mapping the `dinner.` subdomain onto `/dinner`. |
| `src/hooks.test.ts` | Tests for the above. |

**Modified:**

| Path | Change |
|---|---|
| `src/lib/server/db/schema.ts` | Append three table definitions. |
| `drizzle/0006_*.sql` | Generated migration. |
| `src/lib/components/TopBar.svelte:193` | Add a Dinner nav link. |
| `README.md` | Document the section and the subdomain. |

---

## Task 1: Schema and migration

**Files:**
- Modify: `src/lib/server/db/schema.ts` (append at end of file)
- Create: `drizzle/0006_*.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `people`, `flags`, `peopleFlags` Drizzle table objects exported from `$lib/server/db/schema`. Row types are derived by later tasks via `typeof people.$inferSelect`.

- [ ] **Step 1: Append the three tables to the schema**

Add to the end of `src/lib/server/db/schema.ts`:

```ts
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
	/** ISO date. Defaults to today at quick-add, because you add someone right after meeting them. */
	metOn: text('met_on'),
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
```

- [ ] **Step 2: Add the `primaryKey` import**

Change line 1 of `src/lib/server/db/schema.ts` from:

```ts
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
```

to:

```ts
import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0006_<random_name>.sql` containing `CREATE TABLE people`, `CREATE TABLE flags`, and `CREATE TABLE people_flags`.

- [ ] **Step 4: Prove the migration cannot destroy anything**

This database holds real data, and the Dockerfile runs migrations automatically
on every production boot — so this file will execute against production
unattended. Read it before letting it near either database.

Run: `grep -oiE '^\s*(CREATE|DROP|ALTER|DELETE|UPDATE|INSERT)[A-Z ]*' drizzle/0006_*.sql`
Expected: only `CREATE TABLE` and `CREATE UNIQUE INDEX` lines.

Match statement *starts*, not bare words: a substring search flags the column
`updated_at` and the clause `ON DELETE no action`, both of which are harmless and
both of which appear in this migration.

If anything matches, STOP and report it rather than continuing. A generated
migration that rewrites an existing table means the schema edit in Step 1
disturbed something it should not have.

- [ ] **Step 5: Record the baseline row counts**

Run:

```bash
npx tsx -e "
const D=require('better-sqlite3');
const d=new D('./data/table.sqlite',{readonly:true});
for (const t of ['tasks','zones','users','notifications','push_subscriptions'])
  console.log(t, d.prepare('select count(*) c from '+t).get().c);
"
```

Expected: `tasks 30`, `zones 5`, `users 1`, `notifications 7`, `push_subscriptions 4`.
Write down whatever it prints — Step 7 compares against it.

A verified backup already exists at
`data/backups/table-pre-dinner-2026-08-15.sqlite`. Restore with
`cp data/backups/table-pre-dinner-2026-08-15.sqlite data/table.sqlite` after
stopping the dev server, and delete the stale `-wal` and `-shm` files alongside it.

- [ ] **Step 6: Apply the migration**

Run: `npm run db:migrate`
Expected: `Migrations applied.`

- [ ] **Step 7: Verify nothing was lost**

Re-run the count command from Step 5.
Expected: **identical numbers.** Any difference means the migration touched
existing data — stop, restore from the backup, and report it.

- [ ] **Step 8: Verify the tables exist**

Run: `npx tsx -e "const D=require('better-sqlite3');const d=new D('./data/table.sqlite');console.log(d.prepare(\"select name from sqlite_master where type='table' and name in ('people','flags','people_flags')\").all())"`
Expected: three rows — `people`, `flags`, `people_flags`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat(dinner): add people, flags and people_flags tables"
```

---

## Task 2: Flag colour tokens

**Files:**
- Create: `src/lib/people/colors.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type FlagColor`, `FLAG_COLOR_KEYS: FlagColor[]`, `flagColorVars(key: string): { fill: string; border: string }`.

This is a tiny module, but it is the one place the six token names live, and every later component imports it.

- [ ] **Step 1: Write the file**

Create `src/lib/people/colors.ts`:

```ts
/**
 * Flags reuse the app's six palette tokens. The CSS custom properties are
 * shared with zones deliberately — they are theme tokens defined in `app.css`,
 * not zone logic — but the token list lives here so the people module owns its
 * own vocabulary and imports nothing from the board.
 */
export type FlagColor = 'sage' | 'sky' | 'butter' | 'blush' | 'lilac' | 'clay';

export const FLAG_COLOR_KEYS: FlagColor[] = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'];

/**
 * The CSS custom properties a flag colour resolves to, for inline `style=`
 * attributes. Returning `var(...)` strings rather than hex is what lets the same
 * markup render warm pastels in the light theme and their deep counterparts in
 * the dark one.
 *
 * An unrecognised colour (a stale row, a hand-edited database) falls back to
 * sage rather than emitting a var name no stylesheet defines, which would paint
 * the chip transparent.
 */
export function flagColorVars(key: string): { fill: string; border: string } {
	const safe = (FLAG_COLOR_KEYS as string[]).includes(key) ? key : 'sage';
	return { fill: `var(--zone-${safe}-fill)`, border: `var(--zone-${safe}-border)` };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/people/colors.ts
git commit -m "feat(dinner): add the flag colour token module"
```

---

## Task 3: Forms and LinkedIn normalisation

**Files:**
- Create: `src/lib/server/people/forms.ts`
- Test: `src/lib/server/people/forms.test.ts`

**Interfaces:**
- Consumes: `FlagColor`, `FLAG_COLOR_KEYS` from `$lib/people/colors`.
- Produces:
  - `normalizeLinkedinUrl(value: string): string | undefined`
  - `quickAddPersonSchema` → `{ name: string; notes?: string }`
  - `updatePersonSchema` → `{ name: string; linkedinUrl?: string; email?: string; phone?: string; company?: string; role?: string; city?: string; metAt?: string; metOn?: string; notes?: string }`
  - `flagSchema` → `{ name: string; color: FlagColor }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/people/forms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
	normalizeLinkedinUrl,
	quickAddPersonSchema,
	updatePersonSchema,
	flagSchema
} from './forms';

describe('normalizeLinkedinUrl', () => {
	it('adds the scheme to a bare profile path', () => {
		expect(normalizeLinkedinUrl('linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('leaves an already-absolute url alone', () => {
		expect(normalizeLinkedinUrl('https://www.linkedin.com/in/devonreyes')).toBe(
			'https://www.linkedin.com/in/devonreyes'
		);
	});

	it('upgrades http to https', () => {
		expect(normalizeLinkedinUrl('http://linkedin.com/in/devonreyes')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	it('trims surrounding whitespace before deciding', () => {
		expect(normalizeLinkedinUrl('  linkedin.com/in/devonreyes  ')).toBe(
			'https://linkedin.com/in/devonreyes'
		);
	});

	// A pasted value is never rejected — it is the user's own contact detail, and
	// storing it imperfectly beats refusing it.
	it('returns undefined for an empty or whitespace-only value', () => {
		expect(normalizeLinkedinUrl('')).toBeUndefined();
		expect(normalizeLinkedinUrl('   ')).toBeUndefined();
	});
});

describe('quickAddPersonSchema', () => {
	it('accepts a name alone', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: 'Devon Reyes' });
		expect(parsed.success).toBe(true);
	});

	it('accepts a name with the optional note', () => {
		const parsed = quickAddPersonSchema.safeParse({
			name: 'Devon Reyes',
			notes: 'met at Ana&apos;s dinner, builds scheduling infra'
		});
		expect(parsed.data?.notes).toContain('scheduling infra');
	});

	// The browser posts every rendered control, so an untouched note arrives as
	// an empty string rather than an absent key.
	it('treats a blank note as absent', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: 'Devon Reyes', notes: '' });
		expect(parsed.data?.notes).toBeUndefined();
	});

	it('rejects an empty name', () => {
		expect(quickAddPersonSchema.safeParse({ name: '' }).success).toBe(false);
	});

	it('rejects a whitespace-only name', () => {
		expect(quickAddPersonSchema.safeParse({ name: '   ' }).success).toBe(false);
	});

	it('trims the stored name', () => {
		const parsed = quickAddPersonSchema.safeParse({ name: '  Devon Reyes  ' });
		expect(parsed.data?.name).toBe('Devon Reyes');
	});
});

describe('updatePersonSchema', () => {
	it('accepts every field filled in', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes',
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party",
			metOn: '2026-01-14',
			notes: 'Ask about queue design.'
		});
		expect(parsed.success).toBe(true);
	});

	it('normalises the linkedin url as part of parsing', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: 'linkedin.com/in/devonreyes'
		});
		expect(parsed.data?.linkedinUrl).toBe('https://linkedin.com/in/devonreyes');
	});

	it('treats every blank optional field as absent', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			linkedinUrl: '',
			email: '',
			phone: '',
			company: '',
			role: '',
			city: '',
			metAt: '',
			metOn: '',
			notes: ''
		});
		expect(parsed.success).toBe(true);
		// Every one of the nine, not a sample. Asserting two of them lets a
		// regression on any of the other seven ship silently — verified by
		// mutation: dropping the preprocessing from `company` left the suite green.
		expect(parsed.data?.linkedinUrl).toBeUndefined();
		expect(parsed.data?.email).toBeUndefined();
		expect(parsed.data?.phone).toBeUndefined();
		expect(parsed.data?.company).toBeUndefined();
		expect(parsed.data?.role).toBeUndefined();
		expect(parsed.data?.city).toBeUndefined();
		expect(parsed.data?.metAt).toBeUndefined();
		expect(parsed.data?.metOn).toBeUndefined();
		expect(parsed.data?.notes).toBeUndefined();
	});

	// Deliberately loose: rejecting a number copied off a napkin fails worse than
	// storing it imperfectly, and the user is the only reader.
	it('accepts an email that is not a valid address', () => {
		const parsed = updatePersonSchema.safeParse({
			name: 'Devon Reyes',
			email: 'devon at cadence dot dev'
		});
		expect(parsed.success).toBe(true);
	});

	it('rejects an empty name', () => {
		expect(updatePersonSchema.safeParse({ name: '' }).success).toBe(false);
	});
});

describe('flagSchema', () => {
	it('accepts a name and a known colour', () => {
		const parsed = flagSchema.safeParse({ name: 'SF', color: 'sky' });
		expect(parsed.success).toBe(true);
	});

	it('defaults the colour to sage', () => {
		const parsed = flagSchema.safeParse({ name: 'SF' });
		expect(parsed.data?.color).toBe('sage');
	});

	it('rejects a colour outside the palette', () => {
		expect(flagSchema.safeParse({ name: 'SF', color: 'neon' }).success).toBe(false);
	});

	it('rejects an empty flag name', () => {
		expect(flagSchema.safeParse({ name: '  ' }).success).toBe(false);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/people/forms.test.ts`
Expected: FAIL — `Failed to resolve import "./forms"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/people/forms.ts`:

```ts
import { z } from 'zod';
import { FLAG_COLOR_KEYS, type FlagColor } from '$lib/people/colors';

// A browser submits every control the form has rendered, so untouched optional
// fields post empty strings rather than leaving the keys out. Treat blank as
// "not set" — the same reason `tasks/forms.ts` does.
const blankToUndefined = (value: unknown) =>
	typeof value === 'string' && value.trim() === '' ? undefined : value;

const trimmed = z.string().trim();
const optionalText = z.preprocess(blankToUndefined, trimmed.optional());

/**
 * A profile URL as typed, made clickable.
 *
 * People paste `linkedin.com/in/x` far more often than they paste a full URL,
 * and a bare host in an `href` is read as a relative path — so the link would
 * point back at Table. Anything already carrying a scheme is left alone apart
 * from upgrading `http`.
 */
export function normalizeLinkedinUrl(value: string): string | undefined {
	const trimmedValue = value.trim();
	if (!trimmedValue) return undefined;
	// Compare case-insensitively but rebuild from the original, so the scheme is
	// canonicalised while host casing survives. A phone keyboard that
	// auto-capitalises the first character produces `Https://`, and a
	// case-sensitive check would turn that into `https://Https://…` — a dead link.
	const lower = trimmedValue.toLowerCase();
	if (lower.startsWith('https://')) return `https://${trimmedValue.slice('https://'.length)}`;
	if (lower.startsWith('http://')) return `https://${trimmedValue.slice('http://'.length)}`;
	return `https://${trimmedValue}`;
}

export const quickAddPersonSchema = z.object({
	name: trimmed.min(1),
	notes: optionalText
});

export const updatePersonSchema = z.object({
	name: trimmed.min(1),
	linkedinUrl: z.preprocess(
		blankToUndefined,
		trimmed
			.optional()
			.transform((value) => (value === undefined ? undefined : normalizeLinkedinUrl(value)))
	),
	// Email and phone are stored as typed, unvalidated, on purpose.
	email: optionalText,
	phone: optionalText,
	company: optionalText,
	role: optionalText,
	city: optionalText,
	metAt: optionalText,
	metOn: optionalText,
	notes: optionalText
});

export const flagSchema = z.object({
	name: trimmed.min(1),
	// Cast to a tuple of FlagColor, not of string: `as [string, ...string[]]`
	// erases the literal union, so the inferred type widens to `color: string`
	// and consumers silently lose exhaustiveness checking. Runtime rejection
	// works either way, which is what makes the widening easy to miss.
	color: z.enum(FLAG_COLOR_KEYS as [FlagColor, ...FlagColor[]]).default('sage')
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/people/forms.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/people/forms.ts src/lib/server/people/forms.test.ts
git commit -m "feat(dinner): add person and flag form schemas"
```

---

## Task 4: Search, filter and ordering

**Files:**
- Create: `src/lib/people/search.ts`
- Create: `src/lib/people/types.ts`
- Test: `src/lib/people/search.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface FlagView { id: string; name: string; color: string }` (from `types.ts`)
  - `interface PersonView extends SearchablePerson { linkedinUrl: string | null; email: string | null; phone: string | null; createdAt: string; updatedAt: string }` (from `types.ts`)
  - `interface SearchablePerson { id: string; name: string; company: string | null; role: string | null; city: string | null; metAt: string | null; notes: string | null; metOn: string | null; archivedAt: string | null; flagIds: string[] }`
  - `interface SearchOptions { query: string; flagIds: string[]; includeArchived: boolean }`
  - `filterPeople<T extends SearchablePerson>(people: T[], options: SearchOptions): T[]`

This module is the heart of the feature and touches no database, so every rule below is tested directly.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/people/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterPeople, type SearchablePerson } from './search';

function person(overrides: Partial<SearchablePerson> & { id: string; name: string }): SearchablePerson {
	return {
		company: null,
		role: null,
		city: null,
		metAt: null,
		notes: null,
		metOn: null,
		archivedAt: null,
		flagIds: [],
		...overrides
	};
}

const maya = person({
	id: 'p1',
	name: 'Maya Okonkwo',
	company: 'Figma',
	role: 'Staff engineer',
	city: 'San Francisco',
	metAt: 'Recurse pairing night',
	notes: 'Design systems. Offered to look at the bento drag code.',
	metOn: '2026-03-02',
	flagIds: ['sf']
});

const devon = person({
	id: 'p2',
	name: 'Devon Reyes',
	company: 'Cadence',
	role: 'Founder',
	city: 'New York',
	metAt: "Ana's dinner party",
	notes: 'Deep on distributed systems — ask about queue design.',
	metOn: '2026-01-14',
	flagIds: ['nyc', 'founders']
});

const sam = person({
	id: 'p3',
	name: 'Sam Lindqvist',
	company: 'Stripe',
	role: 'Product manager',
	city: 'San Francisco',
	metOn: '2026-02-20',
	flagIds: ['sf']
});

const everyone = [maya, devon, sam];
const noFilter = { query: '', flagIds: [], includeArchived: false };

describe('filterPeople — text matching', () => {
	it('returns everyone when the query is empty', () => {
		expect(filterPeople(everyone, noFilter)).toHaveLength(3);
	});

	it('matches on name, ignoring case', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'devon' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches on company', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'figma' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	it('matches on role', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'founder' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches on city', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'san francisco' });
		expect(found.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
	});

	it('matches on where you met them', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'recurse' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	// The whole point of the notes blob: "who do I know who can help with X".
	it('matches on the notes blob', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'queue design' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches a substring rather than a whole word', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'distrib' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('ignores surrounding whitespace in the query', () => {
		const found = filterPeople(everyone, { ...noFilter, query: '  figma  ' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	it('returns nothing when no field matches', () => {
		expect(filterPeople(everyone, { ...noFilter, query: 'kayaking' })).toEqual([]);
	});

	it('tolerates null fields without throwing', () => {
		const sparse = [person({ id: 'p9', name: 'Priya Tan' })];
		expect(filterPeople(sparse, { ...noFilter, query: 'priya' })).toHaveLength(1);
	});
});

describe('filterPeople — flags', () => {
	it('narrows to people carrying the flag', () => {
		const found = filterPeople(everyone, { ...noFilter, flagIds: ['nyc'] });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	// Two cities means "either city" — that is what planning a trip asks.
	it('ORs multiple flags together', () => {
		const found = filterPeople(everyone, { ...noFilter, flagIds: ['sf', 'nyc'] });
		expect(found.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
	});

	it('ANDs the flag filter with the text query', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'stripe', flagIds: ['sf'] });
		expect(found.map((p) => p.id)).toEqual(['p3']);
	});

	it('returns nothing when the query and the flag disagree', () => {
		expect(filterPeople(everyone, { ...noFilter, query: 'stripe', flagIds: ['nyc'] })).toEqual([]);
	});
});

describe('filterPeople — archived', () => {
	const archived = person({ id: 'p4', name: 'Jonas Weber', archivedAt: '2026-05-01' });

	it('hides archived people by default', () => {
		const found = filterPeople([...everyone, archived], noFilter);
		expect(found.map((p) => p.id)).not.toContain('p4');
	});

	it('includes them when asked', () => {
		const found = filterPeople([...everyone, archived], { ...noFilter, includeArchived: true });
		expect(found.map((p) => p.id)).toContain('p4');
	});

	it('still applies the text query to archived people', () => {
		const found = filterPeople([...everyone, archived], {
			query: 'jonas',
			flagIds: [],
			includeArchived: true
		});
		expect(found.map((p) => p.id)).toEqual(['p4']);
	});
});

describe('filterPeople — ordering', () => {
	// Someone met last week is usually who you are looking for.
	it('sorts by metOn descending when there is no query', () => {
		const found = filterPeople(everyone, noFilter);
		expect(found.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
	});

	it('puts people with no metOn last', () => {
		const undated = person({ id: 'p5', name: 'Aaron Abbott' });
		const found = filterPeople([undated, ...everyone], noFilter);
		expect(found[found.length - 1].id).toBe('p5');
	});

	it('breaks ties on metOn by name', () => {
		const a = person({ id: 'pa', name: 'Zoe Adams', metOn: '2026-04-01' });
		const b = person({ id: 'pb', name: 'Adam Zeal', metOn: '2026-04-01' });
		const found = filterPeople([a, b], noFilter);
		expect(found.map((p) => p.id)).toEqual(['pb', 'pa']);
	});

	// A name hit is a stronger signal than a word buried in someone's notes.
	it('ranks name matches above matches on other fields', () => {
		const named = person({ id: 'pn', name: 'Cadence Hill', metOn: '2020-01-01' });
		const found = filterPeople([devon, named], { ...noFilter, query: 'cadence' });
		expect(found.map((p) => p.id)).toEqual(['pn', 'p2']);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/people/search.test.ts`
Expected: FAIL — `Failed to resolve import "./search"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/people/search.ts`:

```ts
/**
 * Pure filtering and ordering for the people grid.
 *
 * It takes an array and returns an array, touching no database, so every rule
 * here is unit-testable without fixtures — the same split `lms/plan.ts` and
 * `gtasks/plan.ts` already use against their `sync.ts`.
 */

export interface SearchablePerson {
	id: string;
	name: string;
	company: string | null;
	role: string | null;
	city: string | null;
	metAt: string | null;
	notes: string | null;
	metOn: string | null;
	archivedAt: string | null;
	flagIds: string[];
}

export interface SearchOptions {
	query: string;
	flagIds: string[];
	includeArchived: boolean;
}

/** Every field the query is matched against. */
function haystack(person: SearchablePerson): string {
	return [person.name, person.company, person.role, person.city, person.metAt, person.notes]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();
}

function matchesName(person: SearchablePerson, query: string): boolean {
	return person.name.toLowerCase().includes(query);
}

/**
 * Most recently met first, undated last, ties broken by name.
 *
 * `metOn` is an ISO date, so a plain string comparison orders it correctly and
 * avoids parsing a value that may have been hand-edited.
 */
function byRecency(a: SearchablePerson, b: SearchablePerson): number {
	if (a.metOn !== b.metOn) {
		if (!a.metOn) return 1;
		if (!b.metOn) return -1;
		return a.metOn < b.metOn ? 1 : -1;
	}
	return a.name.localeCompare(b.name);
}

export function filterPeople<T extends SearchablePerson>(people: T[], options: SearchOptions): T[] {
	const query = options.query.trim().toLowerCase();

	const matched = people.filter((person) => {
		if (person.archivedAt && !options.includeArchived) return false;
		// Flags OR among themselves; the text query ANDs with the result.
		if (options.flagIds.length > 0 && !options.flagIds.some((id) => person.flagIds.includes(id))) {
			return false;
		}
		if (query && !haystack(person).includes(query)) return false;
		return true;
	});

	if (!query) return matched.sort(byRecency);

	// A name hit outranks a word buried in someone's notes; within each group the
	// same recency order applies.
	return matched.sort((a, b) => {
		const aNamed = matchesName(a, query);
		const bNamed = matchesName(b, query);
		if (aNamed !== bNamed) return aNamed ? -1 : 1;
		return byRecency(a, b);
	});
}
```

- [ ] **Step 4: Write the shared view types**

Create `src/lib/people/types.ts`:

```ts
import type { SearchablePerson } from './search';

/**
 * The shapes components render.
 *
 * They live here rather than being imported from the service because
 * `$lib/server/**` cannot be reached from client code — SvelteKit fails the
 * build, and `import type` is not a dependable escape hatch. The service's
 * `PersonWithFlags` structurally satisfies `PersonView`, so nothing has to be
 * mapped between them.
 */
export interface FlagView {
	id: string;
	name: string;
	color: string;
}

export interface PersonView extends SearchablePerson {
	linkedinUrl: string | null;
	email: string | null;
	phone: string | null;
	createdAt: string;
	updatedAt: string;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/people/search.test.ts`
Expected: PASS — 22 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/people/search.ts src/lib/people/search.test.ts src/lib/people/types.ts
git commit -m "feat(dinner): add pure people search, filtering and ordering"
```

---

## Task 5: People service

**Files:**
- Create: `src/lib/server/people/service.ts`
- Test: `src/lib/server/people/service.test.ts`

**Interfaces:**
- Consumes: `people`, `peopleFlags` from `../db/schema`; `db` from `../db`.
- Produces:
  - `type Person = typeof people.$inferSelect`
  - `type PersonWithFlags = Person & { flagIds: string[] }` — this must structurally satisfy `PersonView` from Task 4, since the components render it without any mapping step
  - `createPerson(input: { name: string; notes?: string; metOn?: string }): Promise<Person>`
  - `listPeople(): Promise<PersonWithFlags[]>`
  - `updatePerson(id: string, patch: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<void>`
  - `archivePerson(id: string): Promise<void>`
  - `restorePerson(id: string): Promise<void>`

The service stays deliberately thin: the interesting rules already live in `search.ts` and `forms.ts`, so these tests cover defaults and state transitions only.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/people/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Person } from './service';

const rows: Person[] = [];
const joins: { personId: string; flagId: string; createdAt: string }[] = [];

// Mirrors the mock in `zones/service.test.ts`: drizzle's `where()` receives an
// SQL object a mock cannot interpret, so these fakes operate on the whole array.
// Tests therefore keep to one or two rows, and the rules worth asserting in
// bulk live in the pure `search.ts` instead.
vi.mock('../db', () => ({
	db: {
		insert: () => ({
			// A COPY, never the object the service returned. Pushing `r` itself
			// makes `rows[0] === createPerson(...)`, so assertions comparing the
			// two compare a property with itself and pass under the very
			// regression they exist to catch. This repo has been bitten by that.
			values: (r: Person) => {
				rows.push({ ...r });
				return Promise.resolve();
			}
		}),
		query: {
			people: { findMany: () => Promise.resolve([...rows]) },
			peopleFlags: { findMany: () => Promise.resolve([...joins]) }
		},
		update: () => ({
			set: (patch: Partial<Person>) => ({
				where: () => {
					Object.assign(rows[0], patch);
					return Promise.resolve();
				}
			})
		})
	}
}));

import * as peopleService from './service';

describe('people service', () => {
	beforeEach(() => {
		rows.length = 0;
		joins.length = 0;
	});

	it('creates a person from a name alone', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		expect(p.name).toBe('Devon Reyes');
		expect(p.id).toBeTruthy();
	});

	it('stores the optional quick-add note', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes', notes: 'builds infra' });
		expect(p.notes).toBe('builds infra');
	});

	// You add someone right after meeting them, so today is the right default.
	it('defaults metOn to today', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		expect(p.metOn).toBe(new Date().toISOString().slice(0, 10));
	});

	it('honours an explicit metOn', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes', metOn: '2026-01-14' });
		expect(p.metOn).toBe('2026-01-14');
	});

	it('creates a person unarchived', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		expect(p.archivedAt).toBeNull();
	});

	it('lists people with their flag ids attached', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		joins.push({ personId: p.id, flagId: 'nyc', createdAt: '2026-01-14' });
		joins.push({ personId: p.id, flagId: 'founders', createdAt: '2026-01-14' });

		const listed = await peopleService.listPeople();
		expect(listed[0].flagIds.sort()).toEqual(['founders', 'nyc']);
	});

	it('gives a person with no flags an empty array rather than undefined', async () => {
		await peopleService.createPerson({ name: 'Devon Reyes' });
		const listed = await peopleService.listPeople();
		expect(listed[0].flagIds).toEqual([]);
	});

	it('updates a field and bumps updatedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		const before = p.updatedAt;
		await new Promise((r) => setTimeout(r, 2));
		await peopleService.updatePerson(p.id, { company: 'Cadence' });
		expect(rows[0].company).toBe('Cadence');
		expect(rows[0].updatedAt).not.toBe(before);
	});

	it('archives a person by stamping archivedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		await peopleService.archivePerson(p.id);
		expect(rows[0].archivedAt).toBeTruthy();
	});

	it('restores a person by clearing archivedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		await peopleService.archivePerson(p.id);
		await peopleService.restorePerson(p.id);
		expect(rows[0].archivedAt).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/people/service.test.ts`
Expected: FAIL — `Failed to resolve import "./service"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/people/service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { people, peopleFlags } from '../db/schema';

export type Person = typeof people.$inferSelect;
export type PersonWithFlags = Person & { flagIds: string[] };

/** Local date, matching the timezone `fly.toml` pins the process to. */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function createPerson(input: {
	name: string;
	notes?: string;
	metOn?: string;
}): Promise<Person> {
	const now = new Date().toISOString();
	const row = {
		id: randomUUID(),
		name: input.name,
		linkedinUrl: null,
		email: null,
		phone: null,
		company: null,
		role: null,
		city: null,
		metAt: null,
		// You add someone right after meeting them, so today is nearly always
		// right and never has to be typed.
		metOn: input.metOn ?? today(),
		notes: input.notes ?? null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	await db.insert(people).values(row);
	return row;
}

/**
 * Every person with their flag ids.
 *
 * Two queries joined in memory rather than one SQL join: at a few hundred rows
 * the difference is unmeasurable, and it keeps `PersonWithFlags` a plain object
 * the pure `filterPeople` can consume without knowing anything about Drizzle.
 */
export async function listPeople(): Promise<PersonWithFlags[]> {
	const [rows, links] = await Promise.all([
		db.query.people.findMany(),
		db.query.peopleFlags.findMany()
	]);

	const byPerson = new Map<string, string[]>();
	for (const link of links) {
		const existing = byPerson.get(link.personId);
		if (existing) existing.push(link.flagId);
		else byPerson.set(link.personId, [link.flagId]);
	}

	return rows.map((row) => ({ ...row, flagIds: byPerson.get(row.id) ?? [] }));
}

export async function updatePerson(
	id: string,
	patch: Partial<Omit<Person, 'id' | 'createdAt'>>
): Promise<void> {
	await db
		.update(people)
		.set({ ...patch, updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}

export async function archivePerson(id: string): Promise<void> {
	await db
		.update(people)
		.set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}

export async function restorePerson(id: string): Promise<void> {
	await db
		.update(people)
		.set({ archivedAt: null, updatedAt: new Date().toISOString() })
		.where(eq(people.id, id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/people/service.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/people/service.ts src/lib/server/people/service.test.ts
git commit -m "feat(dinner): add the people service with archive and restore"
```

---

## Task 6: Flags service

**Files:**
- Create: `src/lib/server/people/flags.ts`
- Test: `src/lib/server/people/flags.test.ts`

**Interfaces:**
- Consumes: `flags`, `peopleFlags` from `../db/schema`; `db` from `../db`; `FlagColor` from `$lib/people/colors`.
- Produces:
  - `type Flag = typeof flags.$inferSelect`
  - `listFlags(): Promise<Flag[]>`
  - `createFlag(name: string, color?: FlagColor): Promise<Flag>` — reuses an existing flag whose name matches ignoring case
  - `updateFlag(id: string, patch: { name?: string; color?: FlagColor }): Promise<void>`
  - `deleteFlag(id: string): Promise<void>` — transactional
  - `attachFlag(personId: string, flagId: string): Promise<void>`
  - `detachFlag(personId: string, flagId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/people/flags.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Flag } from './flags';

const flagRows: Flag[] = [];
const joins: { personId: string; flagId: string; createdAt: string }[] = [];
/** Ordered log of tables the transactional delete hit, for the ordering assertion. */
const deleted: string[] = [];

// `getTableName` is drizzle's public accessor. Reading `table._.name` happens to
// work today but is internal, and this mock has to tell two tables apart.
vi.mock('../db', async () => {
	const { getTableName } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
	const tx = {
		delete: (table: Parameters<typeof getTableName>[0]) => ({
			where: () => ({
				run: () => {
					const name = getTableName(table);
					deleted.push(name);
					if (name === 'people_flags') joins.length = 0;
					else flagRows.length = 0;
				}
			})
		})
	};
	return {
		db: {
			insert: (table: Parameters<typeof getTableName>[0]) => ({
				// Copies, never the objects the service returned — see the note in
				// service.test.ts. Aliasing turns assertions into tautologies.
				values: (r: Record<string, unknown>) => {
					if (getTableName(table) === 'flags') flagRows.push({ ...r } as Flag);
					else joins.push({ ...r } as { personId: string; flagId: string; createdAt: string });
					return Promise.resolve();
				}
			}),
			query: {
				flags: { findMany: () => Promise.resolve([...flagRows]) },
				peopleFlags: { findMany: () => Promise.resolve([...joins]) }
			},
			update: () => ({
				set: (patch: Partial<Flag>) => ({
					where: () => {
						Object.assign(flagRows[0], patch);
						return Promise.resolve();
					}
				})
			}),
			delete: () => ({
				where: () => {
					joins.length = 0;
					return Promise.resolve();
				}
			}),
			// better-sqlite3 transactions are synchronous, so the callback runs
			// inline and receives a tx handle rather than a promise.
			transaction: (cb: (t: typeof tx) => void) => cb(tx)
		}
	};
});

import * as flagsService from './flags';

describe('flags service', () => {
	beforeEach(() => {
		flagRows.length = 0;
		joins.length = 0;
		deleted.length = 0;
	});

	it('creates a flag with the default colour', async () => {
		const f = await flagsService.createFlag('SF');
		expect(f.name).toBe('SF');
		expect(f.color).toBe('sage');
	});

	it('creates a flag with a chosen colour', async () => {
		const f = await flagsService.createFlag('NYC', 'blush');
		expect(f.color).toBe('blush');
	});

	// Typing "sf" when "SF" exists must not produce a twin.
	it('reuses an existing flag whose name differs only in case', async () => {
		const first = await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('sf');
		expect(second.id).toBe(first.id);
		expect(flagRows).toHaveLength(1);
	});

	it('keeps the name exactly as first typed when reusing', async () => {
		await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('sf');
		expect(second.name).toBe('SF');
	});

	it('ignores surrounding whitespace when matching an existing flag', async () => {
		const first = await flagsService.createFlag('SF');
		const second = await flagsService.createFlag('  sf  ');
		expect(second.id).toBe(first.id);
	});

	it('lists flags', async () => {
		await flagsService.createFlag('SF');
		expect(await flagsService.listFlags()).toHaveLength(1);
	});

	it('renames a flag', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.updateFlag(f.id, { name: 'Bay Area' });
		expect(flagRows[0].name).toBe('Bay Area');
	});

	it('recolours a flag', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.updateFlag(f.id, { color: 'lilac' });
		expect(flagRows[0].color).toBe('lilac');
	});

	it('attaches a flag to a person', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		expect(joins).toHaveLength(1);
	});

	it('detaches a flag from a person', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.detachFlag('p1', f.id);
		expect(joins).toHaveLength(0);
	});

	// The foreign_keys pragma is off in db/index.ts, so ON DELETE CASCADE is not
	// enforced — the join rows must be cleared explicitly, and before the flag.
	it('clears join rows before deleting the flag itself', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.deleteFlag(f.id);
		expect(deleted).toEqual(['people_flags', 'flags']);
	});

	it('leaves no orphaned join rows behind after a delete', async () => {
		const f = await flagsService.createFlag('SF');
		await flagsService.attachFlag('p1', f.id);
		await flagsService.deleteFlag(f.id);
		expect(joins).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/people/flags.test.ts`
Expected: FAIL — `Failed to resolve import "./flags"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/people/flags.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { flags, peopleFlags } from '../db/schema';
import type { FlagColor } from '$lib/people/colors';

export type Flag = typeof flags.$inferSelect;

export async function listFlags(): Promise<Flag[]> {
	return db.query.flags.findMany({ orderBy: (f, { asc }) => [asc(f.name)] });
}

/**
 * A flag by name, created only if nothing matches ignoring case.
 *
 * SQLite compares text case-sensitively, so the unique constraint on the column
 * would happily accept "sf" alongside "SF". Matching here is what stops the
 * filter bar filling with near-duplicates. The name is stored exactly as first
 * typed; a later duplicate adopts the original spelling rather than rewriting it.
 */
export async function createFlag(name: string, color: FlagColor = 'sage'): Promise<Flag> {
	const trimmed = name.trim();
	const existing = (await db.query.flags.findMany()).find(
		(f) => f.name.toLowerCase() === trimmed.toLowerCase()
	);
	if (existing) return existing;

	const row = {
		id: randomUUID(),
		name: trimmed,
		color,
		createdAt: new Date().toISOString()
	};
	await db.insert(flags).values(row);
	return row;
}

export async function updateFlag(
	id: string,
	patch: { name?: string; color?: FlagColor }
): Promise<void> {
	await db.update(flags).set(patch).where(eq(flags.id, id));
}

/**
 * A flag and every attachment of it, in one transaction.
 *
 * `db/index.ts` sets only `journal_mode`, leaving the `foreign_keys` pragma off,
 * so `ON DELETE CASCADE` is declared but never enforced — the join rows have to
 * go explicitly, and first, or a crash between the two statements would strand
 * rows pointing at a flag that no longer exists.
 *
 * better-sqlite3 transactions are synchronous, so the callback must not await;
 * `.run()` executes each statement inline.
 */
export async function deleteFlag(id: string): Promise<void> {
	db.transaction((tx) => {
		tx.delete(peopleFlags).where(eq(peopleFlags.flagId, id)).run();
		tx.delete(flags).where(eq(flags.id, id)).run();
	});
}

export async function attachFlag(personId: string, flagId: string): Promise<void> {
	await db.insert(peopleFlags).values({
		personId,
		flagId,
		createdAt: new Date().toISOString()
	});
}

export async function detachFlag(personId: string, flagId: string): Promise<void> {
	await db
		.delete(peopleFlags)
		.where(and(eq(peopleFlags.personId, personId), eq(peopleFlags.flagId, flagId)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/people/flags.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/people/flags.ts src/lib/server/people/flags.test.ts
git commit -m "feat(dinner): add the flags service with case-insensitive reuse"
```

---

## Task 7: Route load and form actions

**Files:**
- Create: `src/routes/(app)/dinner/+page.server.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces: a `load` returning `{ people: PersonWithFlags[]; flags: Flag[] }`, and nine named actions consumed by the components in Tasks 8–10: `createPerson`, `updatePerson`, `archivePerson`, `restorePerson`, `createFlag`, `updateFlag`, `deleteFlag`, `attachFlag`, `detachFlag`.

Filtering deliberately happens in the browser, not here: the whole list is a few hundred rows, so shipping it once and filtering client-side makes search instant and keeps `filterPeople` a single pure function used by one caller.

- [ ] **Step 1: Write the route**

Create `src/routes/(app)/dinner/+page.server.ts`:

```ts
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import * as peopleService from '$lib/server/people/service';
import * as flagsService from '$lib/server/people/flags';
import {
	quickAddPersonSchema,
	updatePersonSchema,
	flagSchema
} from '$lib/server/people/forms';
import type { FlagColor } from '$lib/people/colors';

export const load: PageServerLoad = async () => {
	const [people, flags] = await Promise.all([peopleService.listPeople(), flagsService.listFlags()]);
	return { people, flags };
};

/** Every action posts the row it acts on; a missing id is a bug, not user error. */
function requireId(data: Record<string, unknown>, key = 'id'): string | null {
	const value = data[key];
	return typeof value === 'string' && value ? value : null;
}

export const actions: Actions = {
	createPerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = quickAddPersonSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A name is required' });

		const person = await peopleService.createPerson(parsed.data);
		return { created: person.id };
	},

	updatePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });

		const parsed = updatePersonSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A name is required' });

		await peopleService.updatePerson(id, {
			name: parsed.data.name,
			linkedinUrl: parsed.data.linkedinUrl ?? null,
			email: parsed.data.email ?? null,
			phone: parsed.data.phone ?? null,
			company: parsed.data.company ?? null,
			role: parsed.data.role ?? null,
			city: parsed.data.city ?? null,
			metAt: parsed.data.metAt ?? null,
			metOn: parsed.data.metOn ?? null,
			notes: parsed.data.notes ?? null
		});
		return { saved: true };
	},

	archivePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });
		await peopleService.archivePerson(id);
		return { archived: id };
	},

	restorePerson: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing person' });
		await peopleService.restorePerson(id);
		return { restored: id };
	},

	createFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const parsed = flagSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A flag name is required' });

		const flag = await flagsService.createFlag(parsed.data.name, parsed.data.color as FlagColor);
		// Quick-add from the picker attaches in the same round trip, so a new flag
		// lands on the person who prompted it without a second submit.
		const personId = requireId(data, 'personId');
		if (personId) await flagsService.attachFlag(personId, flag.id);
		return { flagId: flag.id };
	},

	updateFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing flag' });

		const parsed = flagSchema.safeParse(data);
		if (!parsed.success) return fail(400, { error: 'A flag name is required' });

		await flagsService.updateFlag(id, {
			name: parsed.data.name,
			color: parsed.data.color as FlagColor
		});
		return { saved: true };
	},

	deleteFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const id = requireId(data);
		if (!id) return fail(400, { error: 'Missing flag' });
		await flagsService.deleteFlag(id);
		return { deleted: id };
	},

	attachFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const personId = requireId(data, 'personId');
		const flagId = requireId(data, 'flagId');
		if (!personId || !flagId) return fail(400, { error: 'Missing person or flag' });
		await flagsService.attachFlag(personId, flagId);
		return { attached: true };
	},

	detachFlag: async ({ request }) => {
		const data = Object.fromEntries(await request.formData());
		const personId = requireId(data, 'personId');
		const flagId = requireId(data, 'flagId');
		if (!personId || !flagId) return fail(400, { error: 'Missing person or flag' });
		await flagsService.detachFlag(personId, flagId);
		return { detached: true };
	}
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: no errors mentioning `dinner`. (`./$types` resolves only after `svelte-kit sync`, which `check` runs first.)

- [ ] **Step 3: Commit**

```bash
git add "src/routes/(app)/dinner/+page.server.ts"
git commit -m "feat(dinner): add the dinner route load and form actions"
```

---

## Task 8: Person card and grid

**Files:**
- Create: `src/lib/components/people/PersonCard.svelte`
- Create: `src/lib/components/people/PersonGrid.svelte`

**Interfaces:**
- Consumes: `flagColorVars` from `$lib/people/colors`; `PersonView`, `FlagView` from `$lib/people/types`.
- Produces:
  - `PersonCard` props: `{ person: PersonView; flags: FlagView[]; onopen: (id: string) => void }`
  - `PersonGrid` props: `{ people: PersonView[]; flags: FlagView[]; hasAnyPeople: boolean; onopen: (id: string) => void }`

- [ ] **Step 1: Write PersonCard**

Create `src/lib/components/people/PersonCard.svelte`:

```svelte
<script lang="ts">
	import { flagColorVars } from '$lib/people/colors';
	import type { PersonView, FlagView } from '$lib/people/types';

	let {
		person,
		flags,
		onopen
	}: {
		person: PersonView;
		flags: FlagView[];
		onopen: (id: string) => void;
	} = $props();

	// Two letters at most: initials are a stand-in for a photo, and three or more
	// stop reading as a monogram.
	let initials = $derived(
		person.name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('')
	);

	let subtitle = $derived([person.role, person.company].filter(Boolean).join(', '));
	let attached = $derived(flags.filter((f) => person.flagIds.includes(f.id)));
</script>

<button
	type="button"
	class="card"
	class:archived={Boolean(person.archivedAt)}
	onclick={() => onopen(person.id)}
>
	<span class="avatar">{initials}</span>
	<span class="name">{person.name}</span>
	{#if subtitle}<span class="subtitle">{subtitle}</span>{/if}

	{#if attached.length > 0}
		<span class="chips">
			{#each attached as flag (flag.id)}
				{@const vars = flagColorVars(flag.color)}
				<span class="chip" style="background:{vars.fill};border-color:{vars.border}">
					{flag.name}
				</span>
			{/each}
		</span>
	{/if}

	{#if person.notes}<span class="notes">{person.notes}</span>{/if}
	{#if person.archivedAt}<span class="badge">Archived</span>{/if}
</button>

<style>
	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		width: 100%;
		padding: 0.85rem;
		border: 1px solid var(--border, #e7e0d5);
		border-radius: 10px;
		background: var(--surface, #fff);
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.card:hover {
		border-color: var(--border-strong, #d5c9b6);
	}
	.archived {
		opacity: 0.6;
	}
	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--zone-sage-fill);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.name {
		font-weight: 600;
	}
	.subtitle {
		font-size: 0.78rem;
		color: var(--muted, #93897d);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		padding: 0.1rem 0.45rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.68rem;
	}
	.notes {
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--muted, #6b6258);
		/* Three lines: enough to tell people apart, short enough to keep the grid
		   scannable. The full text is one click away in the modal. */
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted, #93897d);
	}
</style>
```

- [ ] **Step 2: Write PersonGrid**

Create `src/lib/components/people/PersonGrid.svelte`:

```svelte
<script lang="ts">
	import PersonCard from './PersonCard.svelte';
	import type { PersonView, FlagView } from '$lib/people/types';

	let {
		people,
		flags,
		hasAnyPeople,
		onopen
	}: {
		people: PersonView[];
		flags: FlagView[];
		/** Distinguishes "no one yet" from "nothing matched", which want different copy. */
		hasAnyPeople: boolean;
		onopen: (id: string) => void;
	} = $props();
</script>

{#if people.length > 0}
	<div class="grid">
		{#each people as person (person.id)}
			<PersonCard {person} {flags} {onopen} />
		{/each}
	</div>
{:else if hasAnyPeople}
	<p class="empty">No one matches. Try clearing the search or the flag filters.</p>
{:else}
	<p class="empty">
		No one here yet. Dinner Table is for people you have actually met — add the last person you
		talked to using the field above.
	</p>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	/* One column on a phone, four on a wide desktop. */
	@media (min-width: 640px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (min-width: 960px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (min-width: 1400px) {
		.grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	.empty {
		max-width: 40ch;
		margin: 2.5rem auto;
		text-align: center;
		color: var(--muted, #93897d);
		line-height: 1.55;
	}
</style>
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run check`
Expected: no errors mentioning `PersonCard` or `PersonGrid`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/people/
git commit -m "feat(dinner): add the person card and responsive grid"
```

---

## Task 9: Quick-add, filter bar, and the page

**Files:**
- Create: `src/lib/components/people/QuickAddPerson.svelte`
- Create: `src/lib/components/people/FlagFilterBar.svelte`
- Create: `src/routes/(app)/dinner/+page.svelte`

**Interfaces:**
- Consumes: the `createPerson`, `updateFlag`, `deleteFlag` actions from Task 7; `filterPeople` from Task 4; `PersonGrid` from Task 8.
- Produces: a working page. The detail modal arrives in Task 10; until then a card click is a no-op.

- [ ] **Step 1: Write QuickAddPerson**

Create `src/lib/components/people/QuickAddPerson.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';

	let nameEl = $state<HTMLInputElement | null>(null);
	let saving = $state(false);
</script>

<!-- The capture path. Everything about it is tuned for speed: a name is the only
     requirement, the note is optional, and focus returns to the name field so a
     run of people can be entered without touching the mouse. -->
<form
	method="POST"
	action="?/createPerson"
	class="quick-add"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update();
			saving = false;
			nameEl?.focus();
		};
	}}
>
	<input
		bind:this={nameEl}
		name="name"
		placeholder="Who did you meet?"
		required
		autocomplete="off"
		class="name"
	/>
	<input name="notes" placeholder="Who are they? (optional)" autocomplete="off" class="note" />
	<button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
</form>

<style>
	.quick-add {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	input {
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 7px;
		background: var(--surface, #fff);
		font: inherit;
		color: inherit;
	}
	.name {
		flex: 0 1 16rem;
	}
	.note {
		flex: 1 1 auto;
		min-width: 0;
	}
	button {
		padding: 0.45rem 0.9rem;
		border: none;
		border-radius: 7px;
		background: var(--accent, #6f7f5f);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media (max-width: 640px) {
		.quick-add {
			flex-wrap: wrap;
		}
		.name {
			flex: 1 1 100%;
		}
	}
</style>
```

- [ ] **Step 2: Write FlagFilterBar**

Create `src/lib/components/people/FlagFilterBar.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { flagColorVars, FLAG_COLOR_KEYS } from '$lib/people/colors';
	import type { FlagView } from '$lib/people/types';

	let {
		flags,
		counts,
		selected,
		includeArchived,
		total,
		onToggle,
		onToggleArchived
	}: {
		flags: FlagView[];
		/** Flag id to number of matching people, for the chip labels. */
		counts: Record<string, number>;
		selected: string[];
		includeArchived: boolean;
		total: number;
		onToggle: (id: string) => void;
		onToggleArchived: () => void;
	} = $props();

	// Which flag's ⋯ menu is open. One at a time, keyed by id.
	let editing = $state<string | null>(null);
</script>

<div class="bar">
	<button type="button" class="chip all" class:on={selected.length === 0} onclick={() => onToggle('')}>
		All · {total}
	</button>

	{#each flags as flag (flag.id)}
		{@const vars = flagColorVars(flag.color)}
		<span class="chip-wrap">
			<button
				type="button"
				class="chip"
				class:on={selected.includes(flag.id)}
				style="background:{vars.fill};border-color:{vars.border}"
				onclick={() => onToggle(flag.id)}
			>
				{flag.name} · {counts[flag.id] ?? 0}
			</button>
			<button
				type="button"
				class="more"
				aria-label="Edit {flag.name}"
				onclick={() => (editing = editing === flag.id ? null : flag.id)}>⋯</button
			>

			{#if editing === flag.id}
				<div class="menu">
					<form
						method="POST"
						action="?/updateFlag"
						use:enhance={() => async ({ update }) => {
							await update();
							editing = null;
						}}
					>
						<input type="hidden" name="id" value={flag.id} />
						<input name="name" value={flag.name} aria-label="Flag name" />
						<select name="color" value={flag.color} aria-label="Flag colour">
							{#each FLAG_COLOR_KEYS as key (key)}
								<option value={key}>{key}</option>
							{/each}
						</select>
						<button type="submit">Save</button>
					</form>
					<form
						method="POST"
						action="?/deleteFlag"
						use:enhance={() => async ({ update }) => {
							await update();
							editing = null;
						}}
					>
						<input type="hidden" name="id" value={flag.id} />
						<!-- Deleting a flag is not deleting people; say so, because the
						     ⋯ menu sits on a chip that appears on their cards. -->
						<button type="submit" class="danger">Delete flag (people are kept)</button>
					</form>
				</div>
			{/if}
		</span>
	{/each}

	<button type="button" class="chip archived-toggle" class:on={includeArchived} onclick={onToggleArchived}>
		{includeArchived ? 'Hide archived' : 'Show archived'}
	</button>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}
	.chip-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.chip {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 999px;
		background: var(--surface, #fff);
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}
	.chip.on {
		outline: 2px solid var(--accent, #6f7f5f);
		outline-offset: 1px;
	}
	.more {
		border: none;
		background: none;
		padding: 0 0.2rem;
		font: inherit;
		color: var(--muted, #93897d);
		cursor: pointer;
	}
	.menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.3rem;
		padding: 0.6rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 8px;
		background: var(--surface, #fff);
		box-shadow: 0 10px 28px rgba(60, 50, 35, 0.18);
	}
	.menu form {
		display: flex;
		gap: 0.3rem;
	}
	.menu input,
	.menu select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 5px;
		font: inherit;
		font-size: 0.8rem;
	}
	.danger {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: #a3462f;
		cursor: pointer;
		white-space: nowrap;
	}
</style>
```

- [ ] **Step 3: Write the page**

Create `src/routes/(app)/dinner/+page.svelte`:

```svelte
<script lang="ts">
	import QuickAddPerson from '$lib/components/people/QuickAddPerson.svelte';
	import FlagFilterBar from '$lib/components/people/FlagFilterBar.svelte';
	import PersonGrid from '$lib/components/people/PersonGrid.svelte';
	import { filterPeople } from '$lib/people/search';

	let { data } = $props();

	let query = $state('');
	let selectedFlagIds = $state<string[]>([]);
	let includeArchived = $state(false);

	let visible = $derived(
		filterPeople(data.people, { query, flagIds: selectedFlagIds, includeArchived })
	);

	// Counts describe the whole book, not the current result set — a chip reading
	// "SF · 0" because of an unrelated search term would look like a bug.
	let counts = $derived.by(() => {
		const tally: Record<string, number> = {};
		for (const person of data.people) {
			if (person.archivedAt && !includeArchived) continue;
			for (const id of person.flagIds) tally[id] = (tally[id] ?? 0) + 1;
		}
		return tally;
	});

	let total = $derived(
		data.people.filter((p) => includeArchived || !p.archivedAt).length
	);

	function toggleFlag(id: string) {
		// The "All" chip posts an empty id and means "clear the filters".
		if (!id) {
			selectedFlagIds = [];
			return;
		}
		selectedFlagIds = selectedFlagIds.includes(id)
			? selectedFlagIds.filter((f) => f !== id)
			: [...selectedFlagIds, id];
	}
</script>

<svelte:head><title>Dinner Table</title></svelte:head>

<section class="dinner">
	<header>
		<h1>Dinner Table</h1>
		<input
			bind:value={query}
			placeholder="Search people, notes, places…"
			aria-label="Search people"
			class="search"
		/>
	</header>

	<QuickAddPerson />

	<FlagFilterBar
		flags={data.flags}
		{counts}
		selected={selectedFlagIds}
		{includeArchived}
		{total}
		onToggle={toggleFlag}
		onToggleArchived={() => (includeArchived = !includeArchived)}
	/>

	<PersonGrid
		people={visible}
		flags={data.flags}
		hasAnyPeople={data.people.length > 0}
		onopen={() => {}}
	/>
</section>

<style>
	.dinner {
		width: 100%;
		max-width: 1500px;
		margin: 0 auto;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
	}
	.search {
		flex: 1 1 16rem;
		min-width: 0;
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 7px;
		background: var(--surface, #fff);
		font: inherit;
		color: inherit;
	}
</style>
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run check`
Expected: no errors mentioning `dinner`.

- [ ] **Step 5: Manually verify the page**

Run: `npm run dev`, sign in, open `http://localhost:5173/dinner`.
Expected: the empty-state copy, a working quick-add that makes a card appear, and an "All · 1" chip.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/people/ "src/routes/(app)/dinner/+page.svelte"
git commit -m "feat(dinner): add quick-add, flag filtering and the dinner page"
```

---

## Task 10: Detail modal and flag picker

**Files:**
- Create: `src/lib/components/people/FlagPicker.svelte`
- Create: `src/lib/components/people/PersonDetailModal.svelte`
- Modify: `src/routes/(app)/dinner/+page.svelte` (wire `onopen`)

**Interfaces:**
- Consumes: the `updatePerson`, `archivePerson`, `restorePerson`, `attachFlag`, `detachFlag`, `createFlag` actions from Task 7.
- Produces: `PersonDetailModal` props `{ person: PersonView; flags: FlagView[]; onclose: () => void }`; an extended `toast(message, tone?, timeoutMs?, action?)` signature.

**Spec deviation resolved here.** The spec calls for archiving to raise an *undo* toast, but `src/lib/toast.svelte.ts` renders text only and `Toasts.svelte` sets `pointer-events: none`, so nothing in a toast can be clicked. Step 1 extends both — backwards-compatibly, since the new parameter is optional — rather than silently downgrading archive to a plain confirmation.

- [ ] **Step 1: Add an optional action to the toast system**

In `src/lib/toast.svelte.ts`, replace the `Toast` interface and the `toast` function with:

```ts
export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
	action?: ToastAction;
}

export function toast(
	message: string,
	tone: Toast['tone'] = 'info',
	timeoutMs = 4000,
	action?: ToastAction
) {
	// One failed drag can call this once per moved card — a zone with fifteen
	// tasks would stack sixteen identical pills. The first one already said it.
	if (toasts.some((t) => t.message === message && t.tone === tone)) return;
	const id = nextId++;
	toasts.push({ id, message, tone, action });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, timeoutMs);
}

/** Removes a toast early — an action that has been taken should not linger. */
export function dismissToast(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}
```

In `src/lib/components/Toasts.svelte`, replace the script block and the `{#each}` body with:

```svelte
<script lang="ts">
	import { toasts, dismissToast } from '$lib/toast.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" class:success={t.tone === 'success'} class:error={t.tone === 'error'}>
			{t.message}
			{#if t.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						t.action?.run();
						dismissToast(t.id);
					}}
				>
					{t.action.label}
				</button>
			{/if}
		</div>
	{/each}
</div>
```

Add to the `<style>` block, and change `.toasts`' `pointer-events: none` to sit on `.toast:not(:has(.action))` instead — a toast without a button must stay click-through so it never blocks the board beneath it:

```css
	.toasts {
		/* was: pointer-events: none */
		pointer-events: none;
	}
	.toast {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}
	.action {
		/* Only the button re-enables pointer events, so the pill itself stays
		   click-through exactly as before. */
		pointer-events: auto;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--accent, #6f7f5f);
		text-decoration: underline;
		cursor: pointer;
	}
```

- [ ] **Step 2: Write FlagPicker**

Create `src/lib/components/people/FlagPicker.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { flagColorVars } from '$lib/people/colors';
	import type { FlagView } from '$lib/people/types';

	let {
		personId,
		flags,
		attachedIds
	}: { personId: string; flags: FlagView[]; attachedIds: string[] } = $props();

	let newName = $state('');
	let matches = $derived(
		flags.filter((f) => f.name.toLowerCase().includes(newName.trim().toLowerCase()))
	);
	let exactMatch = $derived(
		flags.some((f) => f.name.toLowerCase() === newName.trim().toLowerCase())
	);
</script>

<!-- Flags apply immediately rather than on Save: a flag is a relation, not a
     field, this is how CategoryMenu already behaves, and it spares diffing a set
     on submit. -->
<div class="picker">
	<div class="attached">
		{#each flags.filter((f) => attachedIds.includes(f.id)) as flag (flag.id)}
			{@const vars = flagColorVars(flag.color)}
			<form method="POST" action="?/detachFlag" use:enhance>
				<input type="hidden" name="personId" value={personId} />
				<input type="hidden" name="flagId" value={flag.id} />
				<button
					type="submit"
					class="chip"
					style="background:{vars.fill};border-color:{vars.border}"
					title="Remove {flag.name}"
				>
					{flag.name} ✕
				</button>
			</form>
		{/each}
	</div>

	<input bind:value={newName} placeholder="Add a flag…" aria-label="Add a flag" class="input" />

	{#if newName.trim()}
		<div class="suggestions">
			{#each matches.filter((f) => !attachedIds.includes(f.id)) as flag (flag.id)}
				<form
					method="POST"
					action="?/attachFlag"
					use:enhance={() => async ({ update }) => {
						await update();
						newName = '';
					}}
				>
					<input type="hidden" name="personId" value={personId} />
					<input type="hidden" name="flagId" value={flag.id} />
					<button type="submit" class="suggestion">{flag.name}</button>
				</form>
			{/each}

			{#if !exactMatch}
				<!-- Creating from here attaches in the same round trip, so a new flag
				     lands on the person who prompted it without a second submit. -->
				<form
					method="POST"
					action="?/createFlag"
					use:enhance={() => async ({ update }) => {
						await update();
						newName = '';
					}}
				>
					<input type="hidden" name="personId" value={personId} />
					<input type="hidden" name="name" value={newName.trim()} />
					<input type="hidden" name="color" value="sage" />
					<button type="submit" class="suggestion create">Create “{newName.trim()}”</button>
				</form>
			{/if}
		</div>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.attached {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		padding: 0.15rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}
	.input {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.suggestion {
		padding: 0.15rem 0.5rem;
		border: 1px dashed var(--border, #d8cfc0);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: inherit;
		cursor: pointer;
	}
	.create {
		color: var(--accent, #6f7f5f);
	}
</style>
```

- [ ] **Step 3: Write PersonDetailModal**

Create `src/lib/components/people/PersonDetailModal.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import FlagPicker from './FlagPicker.svelte';
	import type { PersonView, FlagView } from '$lib/people/types';

	let {
		person,
		flags,
		onclose
	}: { person: PersonView; flags: FlagView[]; onclose: () => void } = $props();

	// The modal is remounted per person — there is no in-place "next person"
	// navigation — so props are read directly and never re-synced.
	let archiving = $state(false);

	/**
	 * Undo, from the toast raised after archiving.
	 *
	 * It posts to the action endpoint by hand rather than through `use:enhance`,
	 * because by the time the toast is clicked the modal — and its form — has
	 * already closed. The header is what makes SvelteKit answer with an action
	 * result instead of a redirect.
	 */
	async function restore(id: string) {
		const body = new FormData();
		body.set('id', id);
		await fetch('?/restorePerson', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		await invalidateAll();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="modal" role="dialog" aria-modal="true" aria-label={person.name}>
	<header>
		<h2>{person.name}</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>

	<FlagPicker personId={person.id} {flags} attachedIds={person.flagIds} />

	<form method="POST" action="?/updatePerson" use:enhance={() => async ({ update }) => {
		await update();
		toast('Saved', 'success');
	}}>
		<input type="hidden" name="id" value={person.id} />

		<label>Name<input name="name" value={person.name} required /></label>
		<label>Role<input name="role" value={person.role ?? ''} /></label>
		<label>Company<input name="company" value={person.company ?? ''} /></label>
		<label>City<input name="city" value={person.city ?? ''} /></label>
		<label>LinkedIn<input name="linkedinUrl" value={person.linkedinUrl ?? ''} /></label>
		<label>Email<input name="email" value={person.email ?? ''} /></label>
		<label>Phone<input name="phone" value={person.phone ?? ''} /></label>
		<label>Met at<input name="metAt" value={person.metAt ?? ''} /></label>
		<label>Met on<input type="date" name="metOn" value={person.metOn ?? ''} /></label>
		<label class="wide">
			Who they are
			<textarea name="notes" rows="6">{person.notes ?? ''}</textarea>
		</label>

		<div class="actions">
			{#if person.linkedinUrl}
				<!-- The freshness mechanism: LinkedIn exposes no API for this, so the
				     live profile is one click away instead of mirrored and stale. -->
				<a href={person.linkedinUrl} target="_blank" rel="noreferrer noopener">Open LinkedIn</a>
			{/if}
			<button type="submit" class="save">Save</button>
		</div>
	</form>

	<form
		method="POST"
		action={person.archivedAt ? '?/restorePerson' : '?/archivePerson'}
		use:enhance={() => {
			archiving = true;
			const wasArchived = Boolean(person.archivedAt);
			const id = person.id;
			return async ({ update }) => {
				await update();
				archiving = false;
				onclose();
				if (wasArchived) {
					toast('Restored', 'success');
				} else {
					// Longer than the default: an undo nobody has time to read is not
					// an undo. "Show archived" remains the slower path back.
					toast('Archived', 'success', 8000, { label: 'Undo', run: () => void restore(id) });
				}
			};
		}}
	>
		<input type="hidden" name="id" value={person.id} />
		<button type="submit" class="archive" disabled={archiving}>
			{person.archivedAt ? 'Restore' : 'Archive'}
		</button>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(45, 38, 28, 0.35);
	}
	.modal {
		position: fixed;
		z-index: 41;
		inset: 4vh 50% auto auto;
		transform: translateX(50%);
		width: min(680px, 92vw);
		max-height: 92vh;
		overflow-y: auto;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border, #ddd4c6);
		border-radius: 12px;
		background: var(--surface, #fff);
		box-shadow: 0 18px 48px rgba(60, 50, 35, 0.26);
	}
	header {
		display: flex;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.close {
		margin-left: auto;
		border: none;
		background: none;
		font: inherit;
		color: var(--muted, #b0a698);
		cursor: pointer;
	}
	form {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		margin-top: 0.9rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--muted, #93897d);
	}
	.wide {
		grid-column: 1 / -1;
	}
	input,
	textarea {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 6px;
		background: var(--surface, #fff);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
	}
	.actions {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.save {
		margin-left: auto;
		padding: 0.4rem 1rem;
		border: none;
		border-radius: 7px;
		background: var(--accent, #6f7f5f);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.archive {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: #a3462f;
		cursor: pointer;
	}
	@media (max-width: 640px) {
		form {
			grid-template-columns: 1fr;
		}
	}
</style>
```

- [ ] **Step 4: Wire the modal into the page**

In `src/routes/(app)/dinner/+page.svelte`, add to the imports:

```ts
import PersonDetailModal from '$lib/components/people/PersonDetailModal.svelte';
```

Add to the state block, after `let includeArchived = $state(false);`:

```ts
let openPersonId = $state<string | null>(null);
// Re-read from `data` rather than captured on click, so a save re-render shows
// the saved values instead of the ones the modal opened with.
let openPerson = $derived(data.people.find((p) => p.id === openPersonId) ?? null);
```

Replace `onopen={() => {}}` with:

```svelte
		onopen={(id) => (openPersonId = id)}
```

And add immediately before the closing `</section>`:

```svelte
	{#if openPerson}
		{#key openPerson.id}
			<PersonDetailModal
				person={openPerson}
				flags={data.flags}
				onclose={() => (openPersonId = null)}
			/>
		{/key}
	{/if}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run check`
Expected: no errors mentioning `dinner` or `people`.

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, open `/dinner`, add a person, click their card.
Expected: the modal opens; fields save and persist across a reload; a flag typed into the picker appears as a chip without pressing Save; Archive closes the modal and removes the card; the toast offers **Undo**, and clicking it brings the card straight back.

Also check the board still behaves: open `/`, drag a card into a full zone, and confirm the resulting toast is click-through — it must not block the cards beneath it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/people/ "src/routes/(app)/dinner/+page.svelte" src/lib/toast.svelte.ts src/lib/components/Toasts.svelte
git commit -m "feat(dinner): add the person detail modal and flag picker"
```

---

## Task 11: Subdomain routing, navigation, and docs

**Files:**
- Create: `src/hooks.ts`
- Test: `src/hooks.test.ts`
- Modify: `src/lib/components/TopBar.svelte:193`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `reroute` — SvelteKit's universal hook.

- [ ] **Step 1: Write the failing test**

Create `src/hooks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reroute } from './hooks';

/** `reroute` receives the parsed URL; only the hostname and pathname matter here. */
function at(href: string) {
	return reroute({ url: new URL(href), fetch: globalThis.fetch });
}

describe('reroute', () => {
	it('sends the dinner subdomain root to /dinner', () => {
		expect(at('https://dinner.example.com/')).toBe('/dinner');
	});

	it('leaves the main domain alone', () => {
		expect(at('https://table.example.com/')).toBeUndefined();
	});

	// Only the root is remapped, so API routes, the service worker and the login
	// flow keep working when reached through the subdomain.
	it('leaves non-root paths on the subdomain alone', () => {
		expect(at('https://dinner.example.com/login')).toBeUndefined();
		expect(at('https://dinner.example.com/api/dashboard')).toBeUndefined();
	});

	it('leaves a host that merely contains "dinner" alone', () => {
		expect(at('https://mydinnerparty.example.com/')).toBeUndefined();
	});

	it('handles localhost without a subdomain', () => {
		expect(at('http://localhost:5173/')).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks.test.ts`
Expected: FAIL — `Failed to resolve import "./hooks"`.

- [ ] **Step 3: Write the hook**

Create `src/hooks.ts`:

```ts
import type { Reroute } from '@sveltejs/kit';

/**
 * Serves Dinner Table from its own subdomain while it lives inside Table.
 *
 * Only the root path is remapped. Rerouting everything would send `/login`,
 * `/api/*` and the service worker to `/dinner/...`, where nothing answers — and
 * there are no deep links into Dinner Table to preserve, because the open person
 * is component state rather than a URL.
 *
 * Doing this now means that if the module is ever extracted into its own
 * deployment, the change is a DNS record and no bookmark breaks.
 */
export const reroute: Reroute = ({ url }) => {
	if (!url.hostname.startsWith('dinner.')) return;
	if (url.pathname !== '/') return;
	return '/dinner';
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the nav link**

In `src/lib/components/TopBar.svelte`, inside `<nav>`, immediately before the Inbox link (currently line 193):

```svelte
		<a class="nav-link" class:current={page.url.pathname === '/dinner'} href={resolve('/dinner')}>
			Dinner
		</a>
```

- [ ] **Step 6: Document it**

Append to `README.md`, after the "Dashboard API" section:

```markdown
## Dinner Table

Dinner Table is a contact book for people you have actually met in person: who
they are, how to reach them, and what they can help with. It lives at `/dinner`.

Add someone with the field at the top — a name is the only requirement, and the
optional one-line note captures the context you forget by the next morning.
Everything else (LinkedIn, email, phone, company, role, city, where and when you
met) is filled in from the card's detail view whenever you get to it.

**Flags** are reusable labels — "SF", "NYC", "founders" — created from a person's
detail view and applied by picking them, so the same idea cannot drift into three
spellings. Typing `sf` when `SF` exists reuses the existing flag. The filter bar
above the grid narrows by flag; selecting two flags shows people carrying
*either*, which is what planning a trip asks. Deleting a flag keeps the people
who carried it.

Search covers names, companies, roles, cities, where you met, and the notes
themselves, so "who did I meet who knows about queue design" is a query rather
than a memory exercise.

People are **archived** rather than deleted, since a hand-written note about
someone is not recoverable from anywhere. "Show archived" in the filter bar
brings them back to restore.

There is deliberately **no bulk import and no LinkedIn API**. LinkedIn removed
its Connections API in 2015 and nothing self-serve replaced it, so the stored
profile URL simply links out to the live page — always current, nothing to sync.

### Serving it from a subdomain

Point `dinner.<your-domain>` at the same Fly app and the root of that host
resolves to Dinner Table, via the `reroute` hook in `src/hooks.ts`. Only the root
is remapped, so login, the API routes and the service worker keep working on that
host too.
```

- [ ] **Step 7: Run the whole suite and the linter**

Run: `npm test && npm run lint && npm run check`
Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/hooks.ts src/hooks.test.ts src/lib/components/TopBar.svelte README.md
git commit -m "feat(dinner): serve dinner table from its own subdomain"
```

---

## Final manual verification

Run these by hand once every task is complete. From the spec's verification list.

1. `npm run db:migrate`, then `npm run dev`, then open `/dinner`.
2. Quick-add a name alone. The card appears, `metOn` is today, and the field refocuses.
3. Open the card, fill every field, save, reopen. All values persist.
4. Paste a bare `linkedin.com/in/someone`. The saved "Open LinkedIn" link works.
5. Create two flags from one person's picker; chips appear without pressing Save.
6. Filter by one flag, then two. Two flags widen the result set.
7. Search a word that appears only in someone's notes. They match.
8. Rename and recolour a flag from the ⋯ menu. Chips update everywhere.
9. Delete a flag. The people survive; the chip disappears.
10. Archive a person and click **Undo** on the toast. They come back.
11. Archive a person, let the toast expire, then restore via "Show archived".
12. Type `sf` when `SF` exists. No duplicate flag is created.
13. Narrow the window to phone width. The grid drops to one column and the modal to one.
14. On the task board, trigger a toast and confirm it is still click-through.

## Deferred to later specs

Do not build these here:

- **Touchpoints** — last-talked-to, follow-up surfacing, Google Calendar-derived meeting suggestions.
- **Task-to-person links** — a nullable `personId` on `tasks` and a picker in the task modal.
- **Local LLM search** over the notes corpus.
