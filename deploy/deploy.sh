#!/usr/bin/env bash
# Deploy the latest main: snapshot the database, rebuild the image, restart,
# health-check. Migrations and the city seed run inside the container on start
# (see app/Dockerfile CMD). Run from anywhere: ~/table/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
stamp=$(date +%Y%m%d-%H%M%S)

echo "=== Pull"
git -C app pull --ff-only
# The compose file is versioned in the repo; the live copy next to this script
# is what `docker compose` reads, so keep it current. (This script is not
# re-copied while it runs - pull the new one by hand if deploy.sh changes.)
cp app/deploy/compose.yaml compose.yaml

echo "=== Snapshot database"
if [ -f data/table.sqlite ]; then
  # VACUUM INTO via the running image, so no Node is needed on the host.
  docker compose run --rm --no-deps -v "$PWD/snapshots:/snapshots" table \
    npx tsx /app/scripts/snapshot-db.ts /data/table.sqlite "/snapshots/table-$stamp.sqlite" \
    || { echo "Snapshot failed; refusing to deploy."; exit 1; }
  ls snapshots | sort -r | tail -n +11 | xargs -r -I{} rm -f "snapshots/{}"
else
  echo "No database yet - first deploy."
fi

echo "=== Build"
docker compose build table

echo "=== Restart"
docker compose up -d

echo "=== Health"
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1; then
    rows=$(docker compose exec -T table node -e "const D=require(\"better-sqlite3\");const d=new D(\"/data/table.sqlite\",{readonly:true});console.log(d.prepare(\"select (select count(*) from tasks)+(select count(*) from people) n\").get().n)")
    echo "Healthy. Database holds $rows task+person rows."
    [ "$rows" = "0" ] && echo "WARNING: database is EMPTY. Check DATABASE_PATH / the volume mount."
    exit 0
  fi
  sleep 2
done
echo "DEPLOY FAILED: no 200 from /api/health in 90s. Logs:"
docker compose logs --tail=50 table
exit 1
