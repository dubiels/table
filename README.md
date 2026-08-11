# Table

Table is a personal command center: a task board in two views — a filterable, sortable list and a bento grid of drag-between categories — plus email magic-link login, Canvas LMS assignment sync, a read-only Google Calendar agenda, morning digest emails, due-date push notifications, an in-app notification inbox, and a read-only dashboard API for external displays (e.g. a Raspberry Pi wall panel). It's built with SvelteKit and Drizzle/SQLite, designed to be self-hosted as a single always-on instance on Fly.io.

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

Push notifications (due-date alerts and the morning digest) require a VAPID key pair. Generate one with:

```sh
npx web-push generate-vapid-keys
```

Paste the output into `.env`:

- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — the server-side key pair used to sign push messages.
- `PUBLIC_VAPID_PUBLIC_KEY` — the same public key, exposed to the browser so it can subscribe to push.
- `VAPID_SUBJECT` — a `mailto:` address the push service can contact if there's a problem with your traffic.

## Setting up Resend

Table sends magic-link login emails and the morning digest through [Resend](https://resend.com):

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
4. Run `npm run gcal:auth`, approve the consent screen, and put the printed value in
   `GCAL_REFRESH_TOKEN`. The unverified-app warning is expected — you are authorising your
   own client for your own account.
5. Optionally set `GCAL_CALENDAR_IDS` to a comma-separated list of calendar ids (Calendar
   settings > your calendar > **Integrate calendar** > **Calendar ID**). Unset reads your
   primary calendar. Note that `primary` and your account's own email address name the same
   calendar, so listing both is redundant.

Table asks only for `calendar.events.readonly`, the narrowest scope that works: it can read
events on the calendars you name and nothing else — no writes, no calendar management.

Events fill the side panel's **Today** section: today's events at the top, then the next few
days. It's display-only — nothing in it is editable — just a glance at what's on your
calendars alongside your tasks. Events you've declined are hidden, and an event already in
progress stays visible until it ends. Leave `GCAL_REFRESH_TOKEN` unset and the section
explains how to connect one.

If your account is on a Google Workspace domain you don't administer, the administrator may
need to trust your client id under **Admin console > Security > API controls**.

The panel is docked beside the board and open by default on screens ≥1100px. It shows both sections at once in a single scrolling column — **Today** above, **Canvas** below — so the day and the coursework are visible together rather than one at a time. Each section header collapses its own contents, and the ⟩ button at the top of the panel folds the whole thing into a slim edge strip you click to bring it back. All three choices are remembered. Below 1100px the panel becomes a drawer, opened from the **Panel** button above the board.

## Tasks → Google Calendar

Table can also publish its own tasks as an `.ics` feed so you can subscribe to them from Google Calendar or any calendar app:

1. Set `TASKS_FEED_TOKEN` to a long random string.
2. In Google Calendar, go to **Other calendars > From URL** and paste `https://your-app/calendar.ics?token=<TASKS_FEED_TOKEN>`.

Active tasks with a due date show up as all-day events. As with the dashboard token below, leaving `TASKS_FEED_TOKEN` unset disables the route entirely (404) — no config means no exposure.

Note that the token travels in the URL, so it lands in server access logs and browser history like any other query string. Rotate `TASKS_FEED_TOKEN` if you share those logs or hand the URL to someone you didn't mean to give your task list to.

## Dashboard API

`GET /api/dashboard` returns active tasks and zones as JSON. It's meant for an external always-on display — Table's companion Raspberry Pi wall panel, for example — not for the SPA itself.

- Set `DASHBOARD_TOKEN` to a long random string; requests must send `Authorization: Bearer <DASHBOARD_TOKEN>`. Leaving it unset disables the route (404) instead of leaving it open.
- The payload ships zone **color token names** (e.g. `"sage"`), never hex values — the consumer owns its own palette and rendering.
- `fly.toml` sets `TZ = "America/New_York"` so both the payload's `timezone` field and the cron schedules above reflect your local time instead of Fly's default UTC. Change it if you're elsewhere.

## Deploying to Fly.io

1. Install [`flyctl`](https://fly.io/docs/flyctl/install/) and log in with `flyctl auth login`.
2. From the repo root, run `flyctl launch --no-deploy`. When it offers to overwrite `fly.toml`, keep the one already in this repo (it configures the persistent volume, single-instance settings, and internal port needed by the app).
3. Create the persistent volume for the SQLite database:
   ```sh
   flyctl volumes create table_data --size 1
   ```
4. Set the app's secrets (these are read from the environment at runtime, not from `.env`):
   ```sh
   flyctl secrets set \
     ALLOWED_EMAILS=you@example.com \
     RESEND_API_KEY=re_your_key \
     EMAIL_FROM="Table <table@yourdomain.com>" \
     PUBLIC_APP_URL=https://your-app.fly.dev \
     VAPID_PUBLIC_KEY=your_public_key \
     VAPID_PRIVATE_KEY=your_private_key \
     PUBLIC_VAPID_PUBLIC_KEY=your_public_key \
     VAPID_SUBJECT=mailto:you@example.com
   ```
   These cover core functionality. If you're using the optional integrations above, also set `LMS_ICAL_URL`, `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, `GCAL_REFRESH_TOKEN`, `GCAL_CALENDAR_IDS`, `TASKS_FEED_TOKEN`, and/or `DASHBOARD_TOKEN` as needed.
5. Deploy:
   ```sh
   flyctl deploy
   ```

On boot, the container runs the Drizzle migrations against the database on the mounted volume, then starts the SvelteKit server.

## Installing on iPhone

1. Open the deployed URL in **Safari** (not Chrome or another browser — only Safari supports installing a PWA on iOS).
2. Tap the Share icon, then **Add to Home Screen**.
3. Launch Table from the home screen icon you just created, not from a regular Safari tab.
4. From within the installed app, tap **Enable notifications** to subscribe to push.

Push notifications require iOS 16.4 or later, and will not work if Table is opened in a normal Safari tab rather than the home-screen app — iOS only delivers web push to installed PWAs.

## Architecture note: single always-on machine

Table's scheduler (morning digest, due-date checks, and LMS sync) runs in-process, on a cron schedule, inside the same server process that serves HTTP requests. There is no separate worker process or external queue.

Because of this, the app must run as exactly one always-on machine. `fly.toml` sets `min_machines_running = 1` and `auto_stop_machines = false` for this reason — do not enable Fly's autoscaling to multiple machines, since each machine would run its own copy of the scheduler and could send duplicate notifications.

## Extending Table

Task-creation and notification-content logic live in plain, route- and scheduler-independent functions:

- `src/lib/server/tasks/service.ts` — creating, updating, and querying tasks.
- `src/lib/server/zones/service.ts` — creating, updating, and querying zones.
- `src/lib/server/notifications/digest.ts`, `src/lib/server/notifications/due-alerts.ts`, `src/lib/server/notifications/push.ts`, `src/lib/server/notifications/log.ts` — building and sending digest/due-alert notifications and logging them.

A few more pure-logic modules are the ones most worth reading before extending a given feature:

- `src/lib/placement.ts` — grid/collision math shared by the bento grid and LMS sync, so newly placed tasks don't stack on top of each other.
- `src/lib/server/lms/plan.ts` — decides what a Canvas sync run creates or updates, independent of the database or scheduler.
- `src/lib/server/dashboard/serialize.ts` — shapes tasks/zones into the dashboard API payload.
- `src/lib/server/gcal/agenda.ts` — parses and windows Google Calendar events for the side panel's Today section.
- `src/lib/server/ics/export.ts` — renders tasks as an RFC 5545 `.ics` feed.

These are called the same way by the UI routes and by the in-process scheduler (`src/lib/server/scheduler/index.ts`), which is also what drives the periodic LMS sync. A future integration can call these same functions directly to create tasks and trigger notifications, without going through HTTP routes or duplicating scheduling logic.
