# Deploying Table

Table runs as a Docker Compose stack on one always-on Linux machine, published
by Cloudflare Tunnel, and deployed by running one script on that machine. This
is the guide for setting that up from scratch and for living with it afterwards.

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
            |  https://table.example.com   https://dinner.example.com
            v
     Cloudflare edge          <- TLS, no open inbound port
            |
            |  outbound-only tunnel
            v
   cloudflared  (container)
            |
            |  http://table:3000  (compose network)
            v
     Table  (container)  ----  127.0.0.1:3100 on the host, for health checks
            |
            v
   ~/table/data/table.sqlite  (bind mount)
```

Deploys are pulled, not pushed. `git push` runs lint, check, tests and a build
on GitHub-hosted Linux. Getting the result onto the server is
`~/table/deploy.sh` there: pull, snapshot the database, rebuild the image,
restart, health-check.

Nothing listens on a public port. The tunnel dials out, so the machine needs no
firewall rule, no port forward and no static IP. The app binds only to
localhost, and only so the deploy script can poll it.

### Layout on disk

Everything lives under one directory. The checkout is inside it, and the things
a deploy must never touch are beside the checkout rather than in it.

| Path                        | Holds                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `~/table/compose.yaml`      | The stack. A copy of `deploy/compose.yaml`; `deploy.sh` refreshes it                |
| `~/table/deploy.sh`         | The deploy. A copy of `deploy/deploy.sh`                                            |
| `~/table/env/.env`          | Secrets and config. Read by the container at start, never by a workflow             |
| `~/table/env/tunnel.env`    | `TUNNEL_TOKEN=...` for cloudflared                                                  |
| `~/table/data/table.sqlite` | The database, mounted into the container at `/data`                                 |
| `~/table/snapshots/`        | Pre-deploy `VACUUM INTO` copies, last ten kept                                      |
| `~/table/app/`              | The git checkout, plus the gitignored `static/logos/` and `logo-overrides.local.ts` |

The personal files sit inside the checkout because the image is built from it
and both are pulled in at build time. They are gitignored, so `git pull` leaves
them alone.

---

## Part 1 — One-time setup

### 1.1 Check what is already installed

```sh
docker --version; docker compose version; git --version
id -nG | grep -qw docker && echo "docker group ok"
```

Docker Engine with the Compose plugin and git are all the machine needs. Node
is not required: the image carries its own, pinned to the major in `.nvmrc`.

If `docker group ok` did not print, you need it or every step needs sudo:

```sh
sudo usermod -aG docker "$USER"
# then log out and back in
```

Check the port. The app is published on `127.0.0.1:3100`; if something already
owns that, pick another in `compose.yaml` and `deploy.sh`.

```sh
ss -ltn | grep ':3100 ' || echo "3100 free"
```

### 1.2 Create the layout and clone

```sh
mkdir -p ~/table/{data,env,snapshots}
git clone https://github.com/dubiels/table.git ~/table/app
cp ~/table/app/deploy/compose.yaml ~/table/app/deploy/deploy.sh ~/table/
chmod +x ~/table/deploy.sh
```

### 1.3 Move the data across

> **Do this step LAST, immediately before the first deploy in Part 2 — not
> now.** The moment you copy the database you must stop using the Mac copy, and
> every task added in between lands on a database nothing will ever read again.
> Read this section, then skip to §1.4 and come back.

**On the Mac**, take a consistent copy. Do not copy `table.sqlite` on its own —
the app runs in WAL mode, so an arbitrary amount of committed data lives in the
`-wal` sidecar and a plain file copy loses all of it:

```sh
cd ~/table
npx tsx scripts/snapshot-db.ts data/table.sqlite ~/table-transfer.sqlite
sqlite3 ~/table-transfer.sqlite "PRAGMA integrity_check;"
sqlite3 ~/table-transfer.sqlite \
  "SELECT 'tasks',count(*) FROM tasks UNION ALL \
   SELECT 'people',count(*) FROM people UNION ALL \
   SELECT 'touchpoints',count(*) FROM touchpoints UNION ALL \
   SELECT 'zones',count(*) FROM zones UNION ALL \
   SELECT 'flags',count(*) FROM flags UNION ALL \
   SELECT 'users',count(*) FROM users;"
```

Write the numbers down, then copy three things:

```sh
scp ~/table-transfer.sqlite            SERVER:~/table/data/table.sqlite
scp static/logos/*                     SERVER:~/table/app/static/logos/
scp src/lib/server/people/logo-overrides.local.ts SERVER:~/table/app/src/lib/server/people/
```

(`mkdir -p ~/table/app/static/logos` on the server first; the directory is
gitignored so the clone does not create it.)

> **After this point, stop writing to the Mac copy.** Two live databases with no
> sync between them is a split brain. Keep `data/table.sqlite` on the Mac as a
> cold backup and let it go stale on purpose. Local development keeps its own
> database, which is fine — just never treat it as the real one again.

### 1.4 Write the environment file

Create `~/table/env/.env`. Start from your local `.env`, then change the
following. **The first three are not optional.**

```ini
# The path INSIDE the container. compose.yaml mounts ~/table/data there. Get
# this wrong and nothing complains: the app CREATES a missing database, so the
# service comes up "healthy" on an empty board. deploy.sh checks the row count
# for this reason.
DATABASE_PATH=/data/table.sqlite

# Magic-link emails are built from this. A wrong value emails you a link to
# localhost, which is an auth outage you only notice once you are logged out.
PUBLIC_APP_URL=https://table.example.com

# Session cookies are only marked Secure when this is set.
NODE_ENV=production

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

> **Do not set `ORIGIN`.** `adapter-node` uses it as the base for _every_
> request URL regardless of the `Host` that arrived, and `src/hooks.ts` decides
> whether to serve Dinner Table by testing `url.hostname.startsWith('dinner.')`.
> Pin the origin and `dinner.example.com` renders the task board, and every form
> on it returns 403. Left unset, the origin is derived from the `Host` header,
> which the tunnel passes through, with the protocol defaulting to `https`.

Carry across unchanged: `ALLOWED_EMAILS`, `RESEND_API_KEY`, `EMAIL_FROM`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, **`PUBLIC_VAPID_PUBLIC_KEY`**,
`VAPID_SUBJECT`, `LMS_ICAL_URL`, the `GCAL_*` keys, and `GTASKS_ENABLED`.

`PUBLIC_VAPID_PUBLIC_KEY` is easy to miss because it does not start with
`VAPID_`. It is read in the browser, and without it push notifications fail
silently with nothing in any log.

Lock the file down:

```sh
chmod 600 ~/table/env/.env
```

### 1.4b Prove email actually sends, before you need it

Magic links are the only way into Table. If Resend rejects the send you are
locked out, and the failure is quiet: the login page still says "check your
email". Test from the Mac with the same key and From address the server uses:

```sh
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"Table <you@yourdomain.com>","to":"you@yourdomain.com",
       "subject":"Table send test","html":"<p>works</p>"}'
```

A `403` mentioning an unverified domain means Resend needs the domain added
under **Domains** with its DKIM and SPF records published. Fix that first.

If you do get locked out later, the way back in is the log: set
`DEV_LOG_TOKENS=true`, `docker compose up -d`, request a link, read it out of
`docker compose logs table`. **Set it back to `false` and restart** the moment
you are in.

### 1.5 Create the tunnel

Your domain must already be on Cloudflare. This is a remotely managed tunnel:
its hostnames are configured in the dashboard, and the server only needs the
token.

1. Cloudflare dashboard → **Zero Trust** → **Networks → Tunnels → Create a
   tunnel** → **Cloudflared** → name it `table` → save.
2. The install page shows commands ending in `--token eyJ...`. Do not run them.
   Copy just the token and write it on the server:

   ```sh
   echo 'TUNNEL_TOKEN=eyJ...' > ~/table/env/tunnel.env
   chmod 600 ~/table/env/tunnel.env
   ```

3. On the tunnel's **Published application routes** tab (older UI: **Public
   Hostname**), add two routes. Both use type **HTTP** and URL `table:3000` —
   that name resolves on the compose network to the app container.

   | Subdomain | Domain        |
   | --------- | ------------- |
   | `table`   | `example.com` |
   | `dinner`  | `example.com` |

   Cloudflare creates the DNS records. Both hostnames are one label below the
   zone, which is what the free universal certificate covers; a second level
   (`table.you.example.com`) would not be.

   If the form asks about IP ranges or device profiles, you are on the
   **Private Network** tab. That is the wrong one.

Start only the connector to confirm the tunnel registers:

```sh
cd ~/table && docker compose up -d --no-deps cloudflared
docker compose logs cloudflared | grep -c "Registered tunnel connection"   # 4
```

---

## Part 2 — First deploy

**First, do §1.3 now** if you skipped it. This is the moment the Mac copy stops
being the live one.

```sh
~/table/deploy.sh
```

The script pulls, skips the snapshot (no database yet is fine; a copied one gets
snapshotted), builds the image, starts both containers, and polls
`/api/health` for 90 seconds. On start the container applies migrations and
the idempotent city seed before listening. The last line prints the task+person
row count — it should match what you wrote down in §1.3, not zero.

Then confirm it from the Mac:

```sh
curl -s https://table.example.com/api/health          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://table.example.com/api/agent/meta
```

That second call should return **404** if you left `AGENT_TOKEN` blank — the
agent API is off, not open. See [API.md](API.md) for switching it on.

Finally, open the site, sign in with a magic link, and **add a task**. That last
step is the one that proves the origin handling is right; everything else can
look healthy while form actions are 403ing. Then open the `dinner.` hostname
and confirm it renders Dinner Table, not the board.

---

## Part 3 — The day-to-day loop

```sh
git push origin main        # on the Mac: CI runs lint, check, tests, build
ssh SERVER ~/table/deploy.sh
```

Wait for CI to go green before deploying; the script does not check it. A
broken build fails at the `docker compose build` step with the old container
still running, so a bad push costs a rebuild, not an outage. A build that
succeeds but then dies on start is caught by the health check, which prints the
container log; the old image is gone by then, so fix forward or restore the
snapshot.

---

## Part 4 — Operations

### Restore the database from a snapshot

```sh
cd ~/table
docker compose stop table
cp snapshots/table-<stamp>.sqlite data/table.sqlite
# Delete the sidecars, or SQLite replays a stale WAL over the file you restored
# and quietly undoes the restore.
rm -f data/table.sqlite-wal data/table.sqlite-shm
docker compose start table
```

### Read the logs

```sh
cd ~/table && docker compose logs -f --tail=100 table
docker compose logs -f --tail=50 cloudflared
```

### Change a secret

Edit `~/table/env/.env`, then `docker compose up -d` in `~/table`. Compose
notices the env file changed and recreates the container; the process reads
its environment once at startup.

### Add someone who can log in

Append their address to `ALLOWED_EMAILS` in `~/table/env/.env`, then
`docker compose up -d`. Everyone shares one board; the list only controls who
may sign in.

### Rotate the tunnel token

Tunnel → **Edit** → **Refresh token** in Cloudflare, write the new value to
`~/table/env/tunnel.env`, then `docker compose up -d cloudflared`.

### Backups

The snapshots in `~/table/snapshots/` exist for deploy rollback. They are on
the same disk as the database, so they are not a backup — a dead drive takes
both. `VACUUM INTO` is safe against the live database, so a cron entry like
this needs no downtime:

```sh
# crontab -e
15 4 * * * cd ~/table && docker compose run --rm --no-deps -v "$HOME/table/backups:/backups" table npx tsx /app/scripts/snapshot-db.ts /data/table.sqlite "/backups/table-$(date +\%Y\%m\%d).sqlite" >/dev/null 2>&1
```

Then sync `~/table/backups/` somewhere off the machine.

---

## Troubleshooting

| Symptom                                           | Cause                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pages load, but adding anything returns **403**   | `ORIGIN` is set. Remove it. See §1.4                                                                         |
| Magic-link email never arrives                    | `DEV_LOG_TOKENS=true` (the link is in `docker compose logs table`), or `RESEND_API_KEY` / `EMAIL_FROM` wrong |
| Login link points at `localhost`                  | `PUBLIC_APP_URL` still holds the dev value                                                                   |
| `/api/agent/*` returns **404** with a valid token | `AGENT_TOKEN` not set, or the container was not recreated after setting it                                   |
| `/api/agent/*` returns **401**                    | Token mismatch, or the header is not `Authorization: Bearer <token>`                                         |
| `deploy.sh` says the database is **EMPTY**        | `DATABASE_PATH` is not `/data/table.sqlite`, or the file is not at `~/table/data/table.sqlite`               |
| Container starts then exits                       | `docker compose logs table`. Usually a malformed `.env` line or a failed migration                           |
| `npm ci` fails inside the build                   | Lockfile out of sync with the image's npm. Regenerate it inside `node:24-slim` and commit                    |
| Company logos vanished after a deploy             | `static/logos/` or `logo-overrides.local.ts` missing from `~/table/app`; they must exist _before_ the build  |
| Site unreachable, `curl 127.0.0.1:3100` healthy   | cloudflared container down, or the route in Cloudflare points somewhere other than `http://table:3000`       |
| `Could not resolve host` right after setup        | Your own DNS cache remembers the pre-record lookup. `dig @1.1.1.1` shows the truth; wait a few minutes       |
