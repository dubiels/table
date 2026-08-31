# Deploying Table

Table runs on one always-on Windows machine, published by Cloudflare Tunnel,
and deployed by pushing to `main`. This is the guide for setting that up from
scratch and for living with it afterwards.

- [What you are building](#what-you-are-building)
- [Part 1 — One-time setup](#part-1--one-time-setup)
- [Part 2 — First deploy](#part-2--first-deploy)
- [Part 3 — The day-to-day loop](#part-3--the-day-to-day-loop)
- [Part 4 — Operations](#part-4--operations)
- [Troubleshooting](#troubleshooting)

## What you are building

```
your phone / the Pi / your agent
            |
            |  https://table.example.com
            v
     Cloudflare edge          <- TLS, no open inbound port
            |
            |  outbound-only tunnel
            v
     cloudflared  (Windows service)
            |
            |  http://localhost:3000
            v
        Table  (Windows service, via NSSM)
            |
            v
   C:\table\data\table.sqlite
```

Deploys arrive the other way: `git push` → GitHub-hosted Linux runs lint, check,
tests and a build → if that passes, a self-hosted runner on the Windows box
rebuilds, snapshots, migrates, swaps and health-checks, rolling back if the new
build does not answer.

Nothing listens on an inbound port. The tunnel dials out, so the machine needs
no firewall rule, no port forward and no static IP.

### Layout on disk

Four things live outside the git checkout, because a deploy replaces the
checkout and would wipe anything gitignored inside it.

| Path                         | Holds                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `C:\table\env\.env`          | Secrets and config. Read by the service, never by a workflow                     |
| `C:\table\data\table.sqlite` | The database                                                                     |
| `C:\table\personal\`         | `logos\` and `logo-overrides.local.ts` — gitignored, copied in before each build |
| `C:\table\snapshots\`        | Pre-migration `VACUUM INTO` copies                                               |
| `C:\table\app\`              | The running release. Written by the deploy, never edited by hand                 |
| `C:\table\releases\`         | The previous few builds, for rollback                                            |
| `C:\table\logs\`             | Service stdout and stderr                                                        |

---

## Part 1 — One-time setup

### 1.1 Check what is already installed

```powershell
node --version    # must be 24.x — matches .nvmrc and package.json engines
git --version
```

If Node is missing or the wrong major, install Node 24 LTS. The build and the
native `better-sqlite3` binding are both compiled against it, so a mismatch
fails at `npm ci` rather than silently.

Then install the two service wrappers:

```powershell
winget install NSSM.NSSM
winget install Cloudflare.cloudflared
```

### 1.2 Create the directories

```powershell
mkdir C:\table\env, C:\table\data, C:\table\personal\logos, `
      C:\table\snapshots, C:\table\app, C:\table\releases, C:\table\logs
```

### 1.3 Move the data across

**On the Mac**, take a consistent copy. Do not copy `table.sqlite` on its own —
the app runs in WAL mode, so an arbitrary amount of committed data lives in the
`-wal` sidecar and a plain file copy loses all of it:

```sh
cd ~/table
npx tsx scripts/snapshot-db.ts data/table.sqlite ~/table-transfer.sqlite
```

Verify what you are about to move, and write the numbers down:

```sh
sqlite3 ~/table-transfer.sqlite "PRAGMA integrity_check;"
sqlite3 ~/table-transfer.sqlite \
  "SELECT 'tasks',count(*) FROM tasks UNION ALL \
   SELECT 'people',count(*) FROM people UNION ALL \
   SELECT 'touchpoints',count(*) FROM touchpoints UNION ALL \
   SELECT 'zones',count(*) FROM zones UNION ALL \
   SELECT 'flags',count(*) FROM flags UNION ALL \
   SELECT 'users',count(*) FROM users;"
```

Copy three things to the Windows box:

| From (Mac)                                      | To (Windows)                 |
| ----------------------------------------------- | ---------------------------- |
| `~/table-transfer.sqlite`                       | `C:\table\data\table.sqlite` |
| `static/logos/*`                                | `C:\table\personal\logos\`   |
| `src/lib/server/people/logo-overrides.local.ts` | `C:\table\personal\`         |

**On the Windows box**, confirm the counts match what you wrote down. If you do
not have the `sqlite3` CLI there, the first deploy will tell you soon enough —
but checking now is cheaper than discovering it later.

> **After this point, stop writing to the Mac copy.** Two live databases with no
> sync between them is a split brain, and merging them by hand later means
> reconciling tasks and contacts one row at a time. Once the server is up, use
> the deployed app. Keep `data/table.sqlite` on the Mac as a cold backup and let
> it go stale on purpose.

Local development keeps its own separate database, which is fine and expected —
just never treat it as the real one again.

### 1.4 Write the environment file

Create `C:\table\env\.env`. Start from your local `.env`, then change the
following. **The first three are not optional.**

```ini
# Where the database actually is on this machine.
DATABASE_PATH=C:\table\data\table.sqlite

# SvelteKit's adapter-node refuses cross-site form posts. Behind a tunnel it
# cannot work out its own public origin, so without this EVERY form action —
# adding a task, adding a person, logging in — fails with 403 while the pages
# themselves render perfectly. This is the single most confusing way to get
# this deployment wrong.
ORIGIN=https://table.example.com

# Magic-link emails are built from this. Wrong value emails you a link to
# localhost, which is an auth outage you only notice when you are logged out.
PUBLIC_APP_URL=https://table.example.com

PORT=3000
TZ=America/New_York

# Must be false or unset here. When true, the login link is printed to the log
# and no email is sent — correct locally, a silent and total auth outage here.
DEV_LOG_TOKENS=false

# Long random strings. Generate with: openssl rand -hex 32
# Leave either unset to keep that API disabled (404) rather than open.
DASHBOARD_TOKEN=
AGENT_TOKEN=
```

Carry across unchanged: `ALLOWED_EMAILS`, `RESEND_API_KEY`, `EMAIL_FROM`, the
three `VAPID_*` keys, `VAPID_SUBJECT`, `LMS_ICAL_URL`, the `GCAL_*` keys, and
`GTASKS_ENABLED`.

Lock the file down — it holds every secret the app has:

```powershell
icacls C:\table\env\.env /inheritance:r /grant:r "$env:USERNAME:(R,W)" /grant:r "SYSTEM:(F)"
```

### 1.5 Install the Table service

The service runs Node directly against the built app, loading the environment
file itself — this is why nothing else needs to know where the secrets live.

```powershell
$node = (Get-Command node).Source

nssm install Table $node
nssm set Table AppParameters "--env-file=C:\table\env\.env C:\table\app\build\index.js"
nssm set Table AppDirectory  "C:\table\app"
nssm set Table AppStdout     "C:\table\logs\table.log"
nssm set Table AppStderr     "C:\table\logs\table.err.log"
nssm set Table AppRotateFiles 1
nssm set Table AppRotateBytes 10485760
nssm set Table Start SERVICE_AUTO_START
nssm set Table AppExit Default Restart
```

Do not start it yet — there is no build in `C:\table\app` until the first
deploy.

### 1.6 Publish it with Cloudflare Tunnel

Your domain must already be on Cloudflare (its nameservers pointing there).

```powershell
cloudflared tunnel login          # opens a browser, pick the zone
cloudflared tunnel create table   # note the UUID it prints
```

Write `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: <the-uuid>
credentials-file: C:\Users\<you>\.cloudflared\<the-uuid>.json

ingress:
  - hostname: table.example.com
    service: http://localhost:3000
  # Dinner Table is served from its own subdomain by the `reroute` hook in
  # src/hooks.ts. Same app, same port — only the root path is remapped.
  - hostname: dinner.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Point DNS at the tunnel and install it as a service:

```powershell
cloudflared tunnel route dns table table.example.com
cloudflared tunnel route dns table dinner.example.com
cloudflared service install
Start-Service cloudflared
```

### 1.7 Install the GitHub Actions runner

On GitHub: **Settings → Actions → Runners → New self-hosted runner → Windows
x64**, then follow the download and `config.cmd` steps it gives you.

When it asks for labels, add these three. The workflow's `runs-on` matches on
them, so a typo here means deploys queue forever with no error:

```
self-hosted, windows, table
```

Install it as a service so it survives reboots:

```powershell
.\svc.cmd install
.\svc.cmd start
```

**The runner needs permission to stop and start the `Table` service.** By
default it runs as `NT AUTHORITY\NETWORK SERVICE`, which cannot, and the deploy
will fail at the swap step. The simplest fix is to run the runner service as an
account with local administrator rights:

```powershell
.\svc.cmd uninstall
.\svc.cmd install <domain-or-machine>\<admin-user>
.\svc.cmd start
```

> A self-hosted runner executes whatever is pushed to `main`. Anyone who can
> push to this repository can run code on the machine holding your contacts and
> your secrets. Keep the repository private, and never enable workflows for pull
> requests from forks.

---

## Part 2 — First deploy

Your local `main` is ahead of the remote. Push it:

```sh
cd ~/table
git status                    # confirm nothing unexpected is staged
git push origin main
```

Watch it: **Actions** tab on GitHub, or `gh run watch`.

The `test` job runs on GitHub's Linux runners. Only if it passes does `deploy`
start on your machine, where it will:

1. copy your personal logo files into the checkout — _before_ the build, because
   `static/logos/` is baked into the client bundle and `logo-overrides.local.ts`
   is pulled in by a build-time `import.meta.glob`;
2. `npm ci` and `npm run build`;
3. snapshot the database to `C:\table\snapshots\`;
4. run migrations, then the (idempotent) city seed;
5. stop the service, swap in the new build, start it again;
6. poll `/api/health` for 90s, rolling back the build if it never answers.

Then confirm it from the Mac:

```sh
curl -s https://table.example.com/api/health          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://table.example.com/api/agent/meta
```

That second call should return **404** if you left `AGENT_TOKEN` blank — the
agent API is off, not open. See [API.md](API.md) for switching it on.

Finally, open the site, sign in with a magic link, and **add a task**. That last
step is the one that proves `ORIGIN` is right; everything else can look healthy
while form actions are 403ing.

---

## Part 3 — The day-to-day loop

```sh
git add -A
git commit -m "feat(board): ..."
git push
```

That is the whole deployment process. Roughly two minutes later the change is
live, or the run is red and nothing changed.

Some things worth knowing:

- **Only `main` deploys.** Push a branch and you get the checks without the
  deploy — useful when you want CI's opinion before committing to it.
- **Deploys queue, they do not overlap.** Two pushes in quick succession run one
  after the other rather than fighting over the service.
- **A red `test` job means the machine is never touched.** The Linux checks are
  the gate; lint, typecheck, the full test suite and a production build all have
  to pass first.
- **Local development is unaffected.** `npm run dev` against your own
  `data/table.sqlite` as always.

### Schema changes

```sh
# after editing src/lib/server/db/schema.ts
npm run db:generate       # writes drizzle/NNNN_*.sql
npm run db:migrate        # applies it locally
git add drizzle src/lib/server/db/schema.ts
git commit -m "feat(db): ..."
git push                  # the deploy applies it on the server
```

**Migrations are forward-only.** The deploy snapshots before migrating, but a
rollback restores the previous _build_, not the previous _schema_. If a
migration is what broke, restore the snapshot by hand — see below.

---

## Part 4 — Operations

### Roll back to an earlier build

Automatic on a failed health check. To do it deliberately:

```powershell
Get-ChildItem C:\table\releases        # pick a timestamp
Stop-Service Table
robocopy C:\table\releases\<stamp>\build C:\table\app\build /E /PURGE
Start-Service Table
```

### Restore the database from a snapshot

```powershell
Stop-Service Table
Copy-Item C:\table\snapshots\table-<stamp>.sqlite C:\table\data\table.sqlite -Force
# Delete the sidecars, or SQLite replays a stale WAL over the file you restored
# and quietly undoes the restore.
Remove-Item C:\table\data\table.sqlite-wal, C:\table\data\table.sqlite-shm -ErrorAction SilentlyContinue
Start-Service Table
```

### Read the logs

```powershell
Get-Content C:\table\logs\table.err.log -Tail 50 -Wait
Get-Content C:\table\logs\table.log -Tail 50 -Wait
```

### Change a secret

Edit `C:\table\env\.env`, then `Restart-Service Table`. The process reads its
environment once at startup, so nothing takes effect until it does.

### Deploy by hand

When Actions is down or you want to watch it happen:

```powershell
cd C:\actions-runner\_work\table\table   # or any checkout
git pull
Copy-Item C:\table\personal\logo-overrides.local.ts src\lib\server\people\ -Force
Copy-Item C:\table\personal\logos\* static\logos\ -Force
npm ci
npm run build
.\scripts\deploy.ps1
```

### Backups

The snapshots in `C:\table\snapshots\` exist for deploy rollback. They are on
the same disk as the database, so they are not a backup — a dead drive takes
both.

Your handwritten notes about people cannot be reconstructed from anywhere. A
scheduled task copying a snapshot somewhere off the machine costs nothing:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd'
npx tsx C:\table\app\scripts\snapshot-db.ts `
  C:\table\data\table.sqlite "$env:USERPROFILE\OneDrive\table-backups\table-$stamp.sqlite"
```

Register it with Task Scheduler to run daily. `VACUUM INTO` is safe against the
live database, so the service does not need to stop.

---

## Troubleshooting

| Symptom                                           | Cause                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Pages load, but adding anything returns **403**   | `ORIGIN` is unset or does not exactly match the public URL. The most common failure                        |
| Magic-link email never arrives                    | `DEV_LOG_TOKENS=true` (check `table.log` — the link is in there), or `RESEND_API_KEY` / `EMAIL_FROM` wrong |
| Login link points at `localhost`                  | `PUBLIC_APP_URL` still holds the dev value                                                                 |
| `/api/agent/*` returns **404** with a valid token | `AGENT_TOKEN` not set, or the service was not restarted after setting it                                   |
| `/api/agent/*` returns **401**                    | Token mismatch, or the header is not `Authorization: Bearer <token>`                                       |
| Deploy hangs in "Waiting for a runner"            | Runner offline, or its labels do not match `[self-hosted, windows, table]`                                 |
| Deploy fails stopping the service                 | Runner service account lacks rights over `Table` — see [1.7](#17-install-the-github-actions-runner)        |
| Service starts then exits immediately             | Read `table.err.log`. Usually a bad `DATABASE_PATH` or a malformed `.env` line                             |
| Company logos vanished after a deploy             | `C:\table\personal\` is missing or empty; those files must exist _before_ the build                        |
| Site unreachable, app healthy locally             | `cloudflared` service stopped, or DNS not routed to the tunnel                                             |
| `npm ci` fails on `better-sqlite3`                | Node major does not match `.nvmrc` (24)                                                                    |
