#!/usr/bin/env bash
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
service=account-manager-test.service
cd "$repo"
git diff --quiet
git diff --cached --quiet
systemctl is-active --quiet "$service"

# Compile before stopping the service. Existing dependencies and Chromium are
# reused; the patch has no database, environment, or frontend changes.
build_dir=$(mktemp -d /tmp/flingroulette-reset-build.XXXXXX)
trap 'rm -rf -- "$build_dir"' EXIT
(cd server && node node_modules/typescript/bin/tsc --outDir "$build_dir")
test -s "$build_dir/index.js"
mkdir -p "$repo/.reset-hotfix-backups"
backup=$(mktemp -d "$repo/.reset-hotfix-backups/build.XXXXXX")
git rev-parse HEAD > "$backup/applied-commit"

rollback() {
  trap - ERR
  if [[ -d "$backup/dist" ]]; then
    systemctl stop "$service" || true
    if [[ -d "$repo/server/dist" ]]; then
      mv "$repo/server/dist" "$backup/failed-dist"
    fi
    cp -a "$backup/dist" "$repo/server/dist"
  fi
  systemctl start "$service" || true
  echo "Deployment failed; restored the previous compiled server from $backup" >&2
  exit 1
}
trap rollback ERR
systemctl stop "$service"
mv "$repo/server/dist" "$backup/dist"
cp -a "$build_dir" "$repo/server/dist"
chown -R --reference="$backup/dist" "$repo/server/dist"
chmod --reference="$backup/dist" "$repo/server/dist"
systemctl start "$service"
sleep 2
systemctl is-active --quiet "$service"
trap - ERR
echo "Reset hotfix installed. Previous compiled server: $backup/dist"
echo "Next: try one reset and inspect journalctl -u $service -n 40 --no-pager"
