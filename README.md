# Table

Table is a personal command center: a task board in two views — a filterable, sortable list and a bento grid of drag-between categories — plus email magic-link login, Canvas LMS assignment sync, a read-only Google Calendar agenda, due-date push notifications, an in-app notification inbox, and a read-only dashboard API for external displays (e.g. a Raspberry Pi wall panel). It's built with SvelteKit and Drizzle/SQLite, designed to be self-hosted as a single always-on instance.

## Views and categories

The switcher above the board picks between **List** and **Bento**. List filters and sorts every task, Canvas assignments included. Bento tiles the board into one box per category, and is where categories are managed: **+ New category** adds one, and each box's **⋯** renames it, recolours it, or deletes it. Deleting a category keeps its tasks — they reappear in **Uncategorized**, which is also what you drag a card onto to take its category off.

Categories are stored as rectangles, a leftover from the freeform canvas this board replaced. Nothing draws those rectangles any more; a task belongs to whichever one its coordinates fall inside, and `nextFreeZoneRect` picks a free spot when you add one.

## Local development

```sh
git clone <this-repo-url>
cd table
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Edit `.env` before running the app:

- Set `ALLOWED_EMAILS` to your own email address (comma-separated list of the only accounts allowed to log in).
- Set `DEV_LOG_TOKENS=true` so magic-link sign-in tokens are printed to the server console instead of sent by email — this lets you log in locally without a Resend account.

The dev server runs at `http://localhost:5173`.

## Generating VAPID keys

Push notifications (due-date alerts) require a VAPID key pair. Generate one with:

```sh
npx web-push generate-vapid-keys
```

Paste the output into `.env`:

- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — the server-side key pair used to sign push messages.
- `PUBLIC_VAPID_PUBLIC_KEY` — the same public key, exposed to the browser so it can subscribe to push.
- `VAPID_SUBJECT` — a `mailto:` address the push service can contact if there's a problem with your traffic.

## Setting up Resend

Table sends magic-link login emails through [Resend](https://resend.com):

1. Create a Resend account.
2. Add and verify a sending domain (or use Resend's default test domain for local testing).
3. Create an API key and put it in `RESEND_API_KEY`.
4. Set `EMAIL_FROM` to a verified sender address on that domain, e.g. `Table <table@yourdomain.com>`.

## Canvas LMS sync

Table can pull assignments from Canvas's calendar feed in as tasks.

1. In Canvas, go to **Calendar > Calendar Feed** and copy the `.ics` URL.
2. Set `LMS_ICAL_URL` to that URL.
3. `LMS_SYNC_CRON` controls how often sync runs automatically (default every 6 hours). You can also trigger a sync on demand any time — from the side panel's **Canvas** section, or from the user menu ("Sync assignments").

Each sync imports assignments due from today through 14 days out: a reading list of what's actually coming up, not an archive of the semester.

Assignments live in the side panel's **Canvas** section, grouped by course, and in the list view, where they carry the category **Canvas** and can be filtered like any other category. They deliberately don't appear in the bento grid — a fortnight of deadlines would bury the handful of things you arranged there by hand. `LMS_ZONE_ID` is a leftover from when they did, and is no longer needed.

Before `LMS_ICAL_URL` is set, the Canvas section shows the setup guide instead.

A sync only ever creates new tasks or refreshes the `dueDate` on ones it created before — it never touches a task's title, notes, priority, position, or completion state, and it never deletes anything. Running sync again against the same feed creates nothing new for assignments it's already imported.

## Google Calendar agenda

Table reads your calendars through the Google Calendar API, which is free and needs no
billing account. Set it up once:

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and
   enable the **Google Calendar API**.
2. Under **APIs & Services > Credentials**, create an **OAuth client ID** of type
   **Desktop app**. Copy the client id and secret into `GCAL_CLIENT_ID` and
   `GCAL_CLIENT_SECRET`.
3. Under **APIs & Services > OAuth consent screen**, **publish** the app. A client left in
   Testing mode expires its refresh token after seven days, which shows up later as an
   agenda that empties itself a week after setup.
4. Run `npm run google:auth`, approve the consent screen, and put the printed value in
   `GCAL_REFRESH_TOKEN`. The unverified-app warning is expected — you are authorising your
   own client for your own account.
5. Optionally set `GCAL_CALENDAR_IDS` to a comma-separated list of calendar ids (Calendar
   settings > your calendar > **Integrate calendar** > **Calendar ID**). Unset reads your
   primary calendar. Note that `primary` and your account's own email address name the same
   calendar, so listing both is redundant.

Table asks for `calendar.events.readonly` and `tasks`: read-only on the calendars
you name, read and write on your Google Tasks list, and nothing else — no
calendar writes, no calendar management.

Events fill the side panel's **Today** section: today's events at the top, then the next few
days. It's display-only — nothing in it is editable — just a glance at what's on your
calendars alongside your tasks. Events you've declined are hidden, and an event already in
progress stays visible until it ends. Leave `GCAL_REFRESH_TOKEN` unset and the section
explains how to connect one.

If your account is on a Google Workspace domain you don't administer, the administrator may
need to trust your client id under **Admin console > Security > API controls**.

The panel is docked beside the board and open by default on screens ≥1100px. It shows both sections at once in a single scrolling column — **Today** above, **Canvas** below — so the day and the coursework are visible together rather than one at a time. Each section header collapses its own contents, and the ⟩ button at the top of the panel folds the whole thing into a slim edge strip you click to bring it back. All three choices are remembered. Below 1100px the panel becomes a drawer, opened from the **Panel** button above the board.

## Google Tasks sync

Table mirrors tasks two ways with Google Tasks. Badged tasks become real Google
Tasks — visible on the Google Calendar grid on their planned date, and in the
Google Tasks mobile app — and anything you add in Google Tasks comes back into
Table.

The relationship is deliberately one-sided: **everything in Google is in Table,
but not everything in Table is in Google.** Table stays the place for everything;
Google holds the subset you chose, and those cards carry a badge.

**Every task carries two dates.** "Due by" is the deadline — the last possible
day, and Table's alone; it is never sent to Google, so rescheduling on your
phone can never overwrite it. "Do it on" is the planned date — the shiftable
day you actually mean to sit down and do the work — and it is the only date
Google ever sees. Editing the deadline never marks a task dirty and never
triggers a push; moving the plan is what syncs.

Setup, on top of the Calendar steps above:

1. Enable the **Google Tasks API** in the same Google Cloud project.
2. Run `npm run google:auth` and replace `GCAL_REFRESH_TOKEN` with the new value.
   The existing token carries only the calendar scope, so every Tasks call would
   return 403 until it is replaced.
3. Set `GTASKS_ENABLED=true`. `GTASKS_SYNC_CRON` controls the inbound poll
   (default every five minutes); you can also sync on demand from the user menu.

How it behaves:

- **Opting in.** Click the mark in a card's top corner, straight from the board.
  You can also tick "Send to Google Tasks" in a task's detail modal, or "Also
  add to Google Tasks" in the composer, which remembers its last setting. A task
  needs a planned day before it can be sent — an undated Google Task never
  appears on the calendar grid, only in the Tasks side panel — and asking for
  one without a planned day says so rather than refusing quietly.
- **Reading the marks.** Every card carries one of four: an empty ring for a
  task that lives only in Table, a grey tick for one on its way to Google, a
  green tick for one that is mirrored, and a red tick for a sync problem, whose
  reason is on hover. "What the marks mean" in the user menu is the key.
- **Opting out deletes the Google copy.** Switching a task off removes it from
  Google Tasks and keeps it on the board — the board asks before doing it, the
  detail panel takes the untick plus Save as the answer. If Google cannot be
  reached the removal is recorded and retried on the next sync.
- **Coming back.** Tasks created in Google Tasks are imported as Uncategorized.
  Tasks already completed in Google are never imported, so connecting to a
  long-lived list does not dump its archive into Table's history.
- **Edits and completion** flow both ways. If the same task changed on both
  sides between syncs, the more recent edit wins the whole task.
- **Deletion is mirrored** — delete on either side and it goes from both. Table
  only ever acts on an explicit deletion from Google, never on a task merely
  going missing, so an outage cannot quietly destroy your tasks.
- **A task Google dropped is not deleted here.** If a full sync finds a linked
  task genuinely gone from Google, the badge turns red with "no longer in Google
  Tasks" — that means Google no longer has it, not that a push failed — and
  Table keeps the task rather than delete it on a signal that ambiguous.
- **Failures are visible.** A task Google rejected keeps a warning badge with
  the reason, and retries on every sync — except a task whose Google copy was
  purged: the cron and page-load syncs are incremental and keep 404ing on it,
  so it only recovers via a manual "Sync Google Tasks" from the user menu.
  Table never blocks on Google being up: the change is saved locally either way.

Canvas assignments can be pushed like any other task. The deadline, priority,
and the course name all stay in Table — Google Tasks has no field for any of
them.

## Dashboard API

`GET /api/dashboard` returns active tasks and zones as JSON. It's meant for an external always-on display — Table's companion Raspberry Pi wall panel, for example — not for the SPA itself.

- Set `DASHBOARD_TOKEN` to a long random string; requests must send `Authorization: Bearer <DASHBOARD_TOKEN>`. Leaving it unset disables the route (404) instead of leaving it open.
- The payload ships zone **color token names** (e.g. `"sage"`), never hex values — the consumer owns its own palette and rendering.
- The service sets `TZ=America/New_York` so both the payload's `timezone` field and the cron schedules above reflect your local time rather than UTC. Change it if you're elsewhere.

## Agent API

`/api/agent/*` is a token-authenticated JSON API over tasks and Dinner Table,
for a machine client — an assistant that reads and writes the same records you
edit in the UI. Full contract in [API.md](API.md).

- Set `AGENT_TOKEN` to a long random string; requests send
  `Authorization: Bearer <AGENT_TOKEN>`. Unset disables every agent route (404)
  rather than leaving it open, the same rule the dashboard follows.
- Deliberately **not** `DASHBOARD_TOKEN`, and session cookies are not accepted.
  A separate credential is one you can revoke on its own when the agent
  misbehaves, without touching how you sign in.
- Every write takes an optional `Idempotency-Key`; a repeated key returns the
  original result instead of writing twice, because an agent retries.
- Writes call the same service functions the UI's form actions do, so Google
  Tasks sync, conflict handling and tombstones apply unchanged.

## Dinner Table

Dinner Table is a contact book for people you have actually met in person: who
they are, how to reach them, and what they can help with. It lives at `/dinner`.

**+ Add person** opens a dialog with the name field focused. A name is the only
requirement — type one, press Enter, and you are done — but the rest is there
when you have a moment: LinkedIn, email, phone, where and when you met, when you
last spoke, flags, and a note for who they are and what they can help with.
Company, role and city are the things you look up rather than remember, so they
live in the detail view instead.

**Last spoke** starts out matching the day you met — meeting someone is the first
time you spoke to them — and follows that date until you set it yourself. Move it
whenever you talk again.

**Flags** are reusable labels — "SF", "NYC", "founders", or a conference you both
attended — picked rather than typed, so the same idea cannot drift into three
spellings. Attach them while adding someone or later from their detail view;
typing `sf` when `SF` exists reuses the existing flag. The filter bar
above the grid narrows by flag; selecting two flags shows people carrying
_either_, which is what planning a trip asks. Deleting a flag keeps the people
who carried it.

Search covers names, companies, roles, cities, where you met, and the notes
themselves, so "who did I meet who knows about queue design" is a query rather
than a memory exercise.

People are **archived** rather than deleted, since a hand-written note about
someone is not recoverable from anywhere. "Show archived" in the filter bar
brings them back to restore.

**Reach-outs** are the log of when you actually spoke. Add one from a person's
record with a date and a line about what it was, and the card shows how long it
has been on a five-band scale — in touch, recent, cooling off, going quiet, gone
cold — coloured so a drifting relationship is visible before it has already gone.
The band's name is in the pill's tooltip, so the meaning never rests on colour
alone. Logging an older
conversation you forgot about records it without rewriting "last contact", since
that question only ever means the most recent.

**Company logos** come from `simple-icons`, matched on the company name you
typed. Resolution happens on the server — the package is ~3,450 marks and
several megabytes, and a dynamic lookup cannot be tree-shaken, so only the
handful of paths a page needs travel over the wire. Nothing is fetched from
anywhere, so no third party learns where your contacts work.

Roughly 3,450 brands are covered, which is broad but not universal: the set has
notability thresholds most young companies will not clear. A name with no match
renders no logo rather than a placeholder. Add one by hand in
`src/lib/server/people/logo-overrides.ts`.

**Action items** are real Table tasks, not a second todo list. Raise one from a
person's record with a title and a due date, and it lands on the board like
anything else — the due-date notifications pick it up, and the task's card
shows whose it is.

**People you want to meet** live in the same book under the _To meet_ tab. They
carry no meeting date and no last-spoke date, so a question like "who have I gone
quiet on" never sweeps in someone you have never spoken to.

**Importing** reads a vCard exported from Apple's Contacts.app — select the
people you want, then **File → Export → Export vCard**, and choose the `.vcf` in
the Import dialog. The file is parsed in your browser and nothing is sent
anywhere until you have ticked exactly who to bring in; names already in the book
start unticked. There is deliberately no automatic sync, and **no LinkedIn API**:
LinkedIn removed its Connections API in 2015 and nothing self-serve replaced it,
so the stored profile URL simply links out to the live page — always current,
nothing to sync.

### Serving it from a subdomain

Point `dinner.<your-domain>` at the same server — the tunnel carries a second
ingress rule for that hostname — and the root of that host resolves to Dinner
Table, via the `reroute` hook in `src/hooks.ts`. Only the root is remapped, so
login, the API routes and the service worker keep working on that host too.

## Deployment

Table runs on a dedicated always-on Windows machine, published by Cloudflare
Tunnel and deployed by pushing to `main`. `fly.toml` and the `Dockerfile` are
kept as a record of the previous Fly.io deployment and are not used.

The machine keeps four things outside the git checkout, because the deploy
wipes gitignored files:

| Path                         | Holds                                         |
| ---------------------------- | --------------------------------------------- |
| `C:\table\env\.env`          | Secrets and config; no workflow ever reads it |
| `C:\table\data\table.sqlite` | The database                                  |
| `C:\table\personal\`         | `static/logos/` and `logo-overrides.local.ts` |
| `C:\table\snapshots\`        | Pre-migration `VACUUM INTO` snapshots         |

Two Windows Services run the system — `Table` (the app, via NSSM) and
`cloudflared` (the tunnel) — plus a GitHub Actions self-hosted runner service
that performs deploys. Pushing to `main` runs the test suite on GitHub-hosted
Linux; if it passes, the runner rebuilds, migrates and restarts the service,
then polls `/api/health` and rolls back to the previous build if it does not
answer.

**Migrations are forward-only.** The deploy takes a `VACUUM INTO` snapshot
before migrating; a rollback restores the previous _build_, not the previous
_schema_. Recovering from a bad migration means restoring that snapshot by hand.

**Backups are deliberately out of scope** for the current deployment. The
snapshots above exist for rollback, not for disaster recovery.

## Installing on iPhone

1. Open the deployed URL in **Safari** (not Chrome or another browser — only Safari supports installing a PWA on iOS).
2. Tap the Share icon, then **Add to Home Screen**.
3. Launch Table from the home screen icon you just created, not from a regular Safari tab.
4. From within the installed app, tap **Enable notifications** to subscribe to push.

Push notifications require iOS 16.4 or later, and will not work if Table is opened in a normal Safari tab rather than the home-screen app — iOS only delivers web push to installed PWAs.

## Architecture note: single always-on machine

Table's scheduler (due-date checks and LMS sync) runs in-process, on a cron schedule, inside the same server process that serves HTTP requests. There is no separate worker process or external queue.

Because of this, the app must run as exactly one always-on process. Never run a second instance against the same database — each one would run its own copy of the scheduler, sending duplicate alerts and racing the Google Tasks sync.

## Extending Table

Task-creation and notification-content logic live in plain, route- and scheduler-independent functions:

- `src/lib/server/tasks/service.ts` — creating, updating, and querying tasks.
- `src/lib/server/zones/service.ts` — creating, updating, and querying zones.
- `src/lib/server/notifications/due-alerts.ts`, `src/lib/server/notifications/push.ts`, `src/lib/server/notifications/log.ts` — building and sending due-alert notifications and logging them.

A few more pure-logic modules are the ones most worth reading before extending a given feature:

- `src/lib/placement.ts` — grid/collision math shared by the bento grid and LMS sync, so newly placed tasks don't stack on top of each other.
- `src/lib/server/lms/plan.ts` — decides what a Canvas sync run creates or updates, independent of the database or scheduler.
- `src/lib/server/dashboard/serialize.ts` — shapes tasks/zones into the dashboard API payload.
- `src/lib/server/gcal/agenda.ts` — parses and windows Google Calendar events for the side panel's Today section.

These are called the same way by the UI routes and by the in-process scheduler (`src/lib/server/scheduler/index.ts`), which is also what drives the periodic LMS sync. A future integration can call these same functions directly to create tasks and trigger notifications, without going through HTTP routes or duplicating scheduling logic.
