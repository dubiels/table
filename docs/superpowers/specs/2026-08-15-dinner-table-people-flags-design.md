# Dinner Table — People and Flags

**Date:** 2026-08-15
**Status:** Approved, ready for planning
**Scope:** First of several specs. Covers people records, reusable flags, browse, and search.

## Context

Table is a command center for one person's own life. Dinner Table extends it to
the people that person knows: who they are, how to reach them, what they can help
with, and where they are when you travel.

It begins as a contact book with opinions. Later specs add a log of when you last
spoke, links between tasks and people, and a locally hosted LLM that answers
questions like "who do I know who can help with queue design?" over the notes.

## Product principle

**Only people you have actually met in person.**

This single rule shapes the whole design. It rules out bulk import, and with it
the duplicate-matching, dedup, and refresh machinery a general contact manager
needs. It keeps the corpus small and high signal, which serves the later LLM
phase far better than three thousand LinkedIn connections would. It also means
every record is worth writing by hand, so the notes field carries real weight.

## Goals

- Capture someone within seconds of meeting them.
- Answer "who do I know in SF?" and "who works on X?" without scrolling.
- Hold a paragraph about each person that is worth reading a year later.

## Non-goals

Deferred to their own specs:

- Touchpoints: last-talked-to dates, follow-up nudges, calendar-derived meetings.
- Task-to-person links.
- Local LLM search over the notes.

Ruled out entirely:

- Importing contacts in bulk, from any source.
- Calling any LinkedIn API. The `linkedinUrl` field is stored and linked out to,
  nothing more. See "Decisions worth recording" below.
- Multi-tenancy. Table remains a single-user application.

## Architecture

Dinner Table is a **bounded module inside Table**, sharing its repository,
database, deployment, and session. It is not a separate service.

Two arguments settled this. First, the desired integrations — a task that points
at a person, a calendar event matched to the people who attended — are joins.
Splitting the apps would put a network boundary between tables that want a
foreign key. Second, splitting buys nothing toward the possible future of selling
Dinner Table as its own product: that future's real cost is multi-tenancy, which
Table entirely lacks today (`tasks` and `zones` carry no `userId`), and that work
is identical whether one app exists or two. Products can also be sold separately
from a single codebase behind an entitlement flag.

The module stays extractable through a rule the directory layout enforces:

> Code under `src/lib/server/people/` and `src/routes/(app)/dinner/` never
> imports from `tasks/`, `zones/`, `lms/`, `gcal/`, or `gtasks/`. The dependency
> arrow points only inward, from Table toward people.

Integration therefore happens through named seams — a nullable `personId` on
`tasks`, a calendar-attendee matcher — each an explicit, listable thing rather
than people logic scattered through the board. If the split ever happens, those
seams are the cut line.

### Routing

Dinner Table lives at `/dinner`, and `dinner.<domain>` maps onto it through
SvelteKit's `reroute` hook. Serving the subdomain now means that extracting the
module later is a DNS change that breaks no bookmarks.

## Data model

Three new tables in Table's existing SQLite database, owned solely by this
module.

```
people
  id           text pk
  name         text not null
  linkedinUrl  text
  email        text
  phone        text
  company      text
  role         text
  city         text
  metAt        text          -- free text: "Ana's dinner party"
  metOn        text          -- ISO date, defaults to today at quick-add
  notes        text          -- who they are, what they can help with
  archivedAt   text          -- null means active
  createdAt    text not null
  updatedAt    text not null

flags
  id           text pk
  name         text not null unique
  color        text not null default 'sage'
  createdAt    text not null

peopleFlags
  personId     text not null -> people.id
  flagId       text not null -> flags.id
  createdAt    text not null
  primary key (personId, flagId)
```

**`company` and `role` are separate columns.** They display as one line
("Founder, Cadence") but answer different questions, and you may want to filter
by either.

**`metAt` and `metOn` earn their place from the IRL-only rule.** Where you met
someone is the first thing you forget and the most useful thing to search. The
date defaults to today, because you add someone right after meeting them.

**`archivedAt` replaces deletion.** A hand-written paragraph about someone you
met once cannot be recovered from anywhere, precisely because no import exists.
Archiving costs one column and one where-clause. Flags, by contrast, are deleted
outright: a label is not irreplaceable, and the people outlive it.

**Flag colours are token names** — `sage`, `sky`, `butter`, `blush`, `lilac`,
`clay` — the same six `zones` uses, matching how the dashboard serializer already
ships tokens rather than hex.

**`peopleFlags` uses a composite primary key**, which makes the same flag twice
on one person unrepresentable. The `uniqueIndex` workaround elsewhere in the
schema exists only because SQLite cannot `ALTER TABLE ADD COLUMN ... UNIQUE`;
that constraint does not apply to a new table.

Migration follows the usual path: `npm run db:generate` produces `0006_*.sql`,
and `npm run db:migrate` applies it.

## Module layout

```
src/lib/server/people/
  service.ts        create, update, archive, restore, get, list
  service.test.ts
  flags.ts          flag CRUD, attach, detach, transactional delete
  flags.test.ts
  search.ts         pure: filter and rank a people array
  search.test.ts
  forms.ts          zod schemas for quick-add and the detail form
  forms.test.ts

src/routes/(app)/dinner/
  +page.server.ts   load: people, flags. actions: createPerson, updatePerson,
                    archivePerson, restorePerson, createFlag, updateFlag,
                    deleteFlag, attachFlag, detachFlag
  +page.svelte      owns search and filter state, renders the view

src/lib/components/people/
  PersonGrid.svelte
  PersonCard.svelte
  PersonDetailModal.svelte
  QuickAddPerson.svelte
  FlagFilterBar.svelte
  FlagPicker.svelte
```

`search.ts` stays pure: it takes an array and a query and returns a filtered
array, touching no database. The ranking rules are then unit-testable without
fixtures, the same way `lms/plan.ts` and `gtasks/plan.ts` already split from
their `sync.ts`.

`TopBar` gains a Dinner Table link.

## Search and filtering

Search matches `name`, `company`, `role`, `city`, `metAt`, and `notes`, ignoring
case, on substring rather than whole word. A `LIKE` scan is instant at a few
hundred rows; SQLite FTS5 remains the upgrade path if the LLM phase wants it.

Flag chips **OR** among themselves and **AND** with the text query. Selecting SF
and NYC means "either city", which is what planning a trip actually asks.

Archived people are excluded from both search and filtering unless "Show
archived" is on.

**Ordering.** With no query, people sort by `metOn` descending, nulls last, then
by name. With a query, people whose `name` matched sort above those matched only
on another field; within each group the same `metOn`-then-name order applies.
Someone you met last week ranks above someone you met two years ago, which is
usually who you are looking for.

## Interface

The grid is the only view in v1. Table already separates a `ViewSwitcher` from
pure `ListView` and `BentoView` components, with loading and filtering in
`+page.server.ts`; mirroring that shape means a second view later is a new
component and a switcher entry, not a rewrite.

**Card grid.** Columns scale with width: one below 640px, two below 960px, three
below 1400px, four above. Each card shows initials, name, role and company, flag
chips, and three clamped lines of notes. Clicking opens the detail modal.

**Quick-add** sits above the grid, always visible: a name field and an optional
one-line "who is this". Enter submits and refocuses for the next person. Nothing
else is required.

**Detail modal** mirrors `TaskDetailModal`: an explicit Save button, `use:enhance`,
Escape to close, remounted fresh per person so no state bleeds between records.
Flags are the exception, applying immediately rather than on Save — a flag is a
relation rather than a field, this is how `CategoryMenu` already behaves, and it
spares diffing a set on submit.

**Flags** are created inline from the picker when nothing matches, and renamed,
recoloured, or deleted from a ⋯ menu on the chip in the filter bar, following the
bento precedent. Deleting a flag removes its `peopleFlags` rows and the flag
itself in one transaction — explicitly, because `db/index.ts` sets only
`journal_mode`, leaving the `foreign_keys` pragma off and `ON DELETE CASCADE`
unenforced.

Flag names are unique ignoring case: typing "sf" when "SF" exists attaches the
existing flag instead of creating a twin. The service enforces this by comparing
lowercased names before insert, and stores the name exactly as typed. The `unique`
constraint on the column is an exact-match backstop, since SQLite compares text
case-sensitively by default.

**Archiving** happens from the detail modal and raises an undo toast through the
existing `Toasts` component. A "Show archived" toggle in the filter bar brings
archived people back into the grid to restore.

**Empty states.** With no people, the copy states the premise — this is for people
you have actually met — and points at quick-add. With no search results, it offers
to clear the filters. With no flags, the bar shows only "All".

## Validation

Name is required and non-empty.

A LinkedIn value is normalised: `linkedin.com/in/devonreyes` becomes
`https://linkedin.com/in/devonreyes`, so the link works.

Email and phone are stored as typed, unchecked. Rejecting a number copied off a
napkin fails worse than storing it imperfectly, and you are the only reader.

## Error handling

This module reaches no external service — no OAuth, no ICS feed, no push. Every
failure is either a zod rejection returned as `fail(400, ...)` or a SQLite error.
None of the timeout-and-degrade machinery that `gcal` and `gtasks` require applies
here.

## Testing

Colocated vitest files, following the existing convention:

- `search.test.ts` — filter and rank rules, including flag OR and text AND.
- `forms.test.ts` — validation and LinkedIn normalisation.
- `service.test.ts` — CRUD, archive, restore, and archived people staying out of
  the default list.
- `flags.test.ts` — case-insensitive reuse, and the transactional delete removing
  join rows while leaving people intact.

### Manual verification

Run these by hand after implementation:

1. `npm run db:migrate`, then `npm run dev`, then open `/dinner`.
2. Quick-add a name alone. Confirm the card appears, `metOn` is today, and the
   field refocuses.
3. Open the card, fill every field, save, reopen. Confirm all values persist.
4. Paste a bare `linkedin.com/in/someone`. Confirm the saved link opens.
5. Create two flags, attach both to one person, and confirm chips appear without
   a save.
6. Filter by one flag, then two. Confirm two flags widen the result set.
7. Search a word that appears only in a person's notes. Confirm they match.
8. Rename and recolour a flag. Confirm the chips update everywhere.
9. Delete a flag. Confirm the people survive and the chip disappears.
10. Archive a person, undo from the toast, archive again, then restore via
    "Show archived".
11. Type "sf" when "SF" exists. Confirm no duplicate flag is created.

## Decisions worth recording

**Build rather than buy.** Products like Clay auto-ingest your email, calendar,
and LinkedIn, and enrich contacts from licensed data. Dinner Table cannot and
should not compete there. It wins on the opposite axis: a small, deliberately
curated set of people you have actually met, kept in your own SQLite file, beside
your task board, feeding an LLM you host. Deliberate smallness is not a feature
any of those products offers.

**No LinkedIn integration.** LinkedIn removed the Connections API in 2015.
What remains self-serve returns only your own profile (`openid`, `profile`,
`email`) or your connection *count*. Everything richer — Marketing Developer
Platform, Talent Solutions, Sales Navigator, Compliance — requires a signed
business relationship, and none of it yields a personal address book. Scraping
violates the user agreement and is actively blocked. LinkedIn's Member Data
Portability API, built for the EU Digital Markets Act, is the one legitimate
route to your own connections, but it requires app approval and has been gated by
region; it is worth checking eligibility, not worth designing around. Enrichment
vendors resell scraped data at a per-record cost, hold your graph, and have been
litigated against. The practical answer is the stored `linkedinUrl`: one click to
the live profile, always accurate, no infrastructure.

**Quick-add is load-bearing.** Hand-maintained contact books die of neglect. If
adding a person takes a minute, the book is abandoned within weeks and the LLM
phase inherits an empty corpus. Every design decision that trades completeness
for speed at capture is deliberate.

## What comes next

1. **Touchpoints** — a log of when you last spoke, follow-up surfacing, and a
   matcher that turns Google Calendar events into suggested touchpoints using the
   OAuth token Table already holds. Calendar-derived suggestions are the
   anti-rot mechanism; without them the book depends entirely on discipline.
2. **Task-to-person links** — a nullable `personId` on `tasks`, a picker in the
   task modal, and linked tasks on the person record.
3. **Local LLM search** — semantic retrieval over the notes corpus.
