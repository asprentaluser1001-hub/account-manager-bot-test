#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run this installer as root on the existing VPS.' >&2; exit 1; fi
repo=$(git rev-parse --show-toplevel)
service=account-manager-test.service
cd "$repo"
git diff --quiet
git diff --cached --quiet
systemctl is-active --quiet "$service"

# Both builds finish before the running app or its files are touched.
build_dir=$(mktemp -d /tmp/flingroulette-reliability.XXXXXX)
trap 'rm -rf -- "$build_dir"' EXIT
if [[ ! -d client/node_modules ]]; then (cd client && npm ci --ignore-scripts); fi
(cd server && node node_modules/typescript/bin/tsc --outDir "$build_dir/server-dist")
(cd client && node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build --outDir "$build_dir/client-dist" --emptyOutDir)
test -s "$build_dir/server-dist/index.js"
test -s "$build_dir/client-dist/index.html"
test -d server/dist
test -d client/dist

mkdir -p "$repo/.reset-hotfix-backups"
backup=$(mktemp -d "$repo/.reset-hotfix-backups/reliability.XXXXXX")
pid=$(systemctl show "$service" --value -p MainPID)
db_path=$(node server/scripts/reset-db-backup.cjs resolve "$pid")
printf '%s\n' "$db_path" > "$backup/database-path"
git rev-parse HEAD > "$backup/applied-commit"
# SQLite backup includes committed WAL pages. Never restore this snapshot during
# automatic rollback: the website password may have changed since it was made.
node server/scripts/reset-db-backup.cjs snapshot "$db_path" "$backup/database.sqlite"

rollback(){
 trap - ERR
 systemctl stop "$service" || true
 # Preserve the latest passwords/candidates. Older code must not release IDs
 # whose new background jobs were interrupted by this deployment.
 node server/scripts/reset-db-backup.cjs quarantine "$db_path" || true
 if [[ -d "$backup/server-dist" ]]; then
  if [[ -d server/dist ]]; then mv server/dist "$backup/failed-server-dist"; fi
  cp -a "$backup/server-dist" server/dist
 fi
 if [[ -d "$backup/client-dist" ]]; then
  if [[ -d client/dist ]]; then mv client/dist "$backup/failed-client-dist"; fi
  cp -a "$backup/client-dist" client/dist
 fi
 systemctl start "$service" || true
 echo "Deployment failed; previous app restored. Latest database retained. Backup: $backup" >&2
 exit 1
}
trap rollback ERR
systemctl stop "$service"
mv server/dist "$backup/server-dist"
mv client/dist "$backup/client-dist"
cp -a "$build_dir/server-dist" server/dist
cp -a "$build_dir/client-dist" client/dist
chown -R --reference="$backup/server-dist" server/dist
chown -R --reference="$backup/client-dist" client/dist
systemctl start "$service"
ready=false
for attempt in {1..15}; do
 if systemctl is-active --quiet "$service" && curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/dev/null; then ready=true; break; fi
 sleep 1
done
[[ $ready == true ]]
trap - ERR
echo "Reset reliability update installed. App builds and SQLite backup: $backup"
echo 'Refresh the dashboard in Safari. Reset and Release now run as background jobs.'
echo 'Verify one manual reset, then one expiry reset; inspect journalctl -u account-manager-test.service -n 60 --no-pager.'
