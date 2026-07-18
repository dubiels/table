# Table

Table is a personal whiteboard app for tracking tasks and topics on a kanban-style board, with email magic-link login, morning digest emails, due-date push notifications, and an in-app notification inbox. It's built with SvelteKit and Drizzle/SQLite, designed to be self-hosted as a single always-on instance on Fly.io.

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

Table's notification scheduler (morning digest and due-date checks) runs in-process, on a cron schedule, inside the same server process that serves HTTP requests. There is no separate worker process or external queue.

Because of this, the app must run as exactly one always-on machine. `fly.toml` sets `min_machines_running = 1` and `auto_stop_machines = false` for this reason — do not enable Fly's autoscaling to multiple machines, since each machine would run its own copy of the scheduler and could send duplicate notifications.

## Extending Table

Task-creation and notification-content logic live in plain, route- and scheduler-independent functions:

- `src/lib/server/tasks/service.ts` — creating, updating, and querying tasks.
- `src/lib/server/topics/service.ts` — creating, updating, and querying topics.
- `src/lib/server/notifications/digest.ts`, `src/lib/server/notifications/due-alerts.ts`, `src/lib/server/notifications/push.ts`, `src/lib/server/notifications/log.ts` — building and sending digest/due-alert notifications and logging them.

These are called the same way by the UI routes and by the in-process scheduler (`src/lib/server/scheduler/index.ts`). A future integration (for example, importing assignments from Canvas) can call these same functions directly to create tasks and trigger notifications, without going through HTTP routes or duplicating scheduling logic.
