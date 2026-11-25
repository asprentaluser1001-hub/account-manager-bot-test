#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

release=${1:?Pass the verified release commit}
base=68cca4171202b9d32df10e412418c342b95eba51
service=account-manager-test.service
root=/root/flingroulette-v4-prod
health=http://127.0.0.1:4000
cd "$root"

[[ $(git rev-parse HEAD) == "$base" ]]
[[ $(git rev-parse "$release^{commit}") == "$release" ]]
git merge-base --is-ancestor "$base" "$release"
git diff --quiet
git diff --cached --quiet
systemctl is-active --quiet "$service"
[[ $(systemctl show "$service" -p WorkingDirectory --value) == "$root/server" ]]
pid=$(systemctl show "$service" -p MainPID --value)
node=$(readlink -f "/proc/$pid/exe")
"$node" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
export PATH="$(dirname "$node"):$PATH"
test -d server/node_modules
test -d server/dist
test -d client/dist
curl -fsS --max-time 4 "$health/api/health" >/dev/null

stage=$(mktemp -d /tmp/flingroulette-coupons.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --max-time 4 "$health/api/checkout/config" > "$stage/previous-checkout.json"
"$node" -e 'if (require(process.argv[1]).mockPayment !== false) process.exit(1)' "$stage/previous-checkout.json"
git archive "$release" | tar -x -C "$stage"
(cd "$stage/client" && npm ci --ignore-scripts && npm run build)
(cd "$stage/server" && npm ci --ignore-scripts && npm run build && node --test tests/*.integration.mjs)
test -s "$stage/server/dist/index.js"
test -s "$stage/client/dist/index.html"

backup=$(mktemp -d /root/flingroulette-coupons-backup.XXXXXX)
[[ $(systemctl show "$service" -p MainPID --value) == "$pid" ]]
db_path=$("$node" "$root/server/scripts/reset-db-backup.cjs" resolve "$pid")
"$node" "$stage/server/scripts/reset-db-backup.cjs" snapshot "$db_path" "$backup/database.sqlite"
"$node" -e 'const db = new (require("node:sqlite").DatabaseSync)(process.argv[1], {readOnly: true}); if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") process.exit(1)' "$backup/database.sqlite"
printf '%s\n' "$base" > "$backup/previous-commit"
printf '%s\n' "$db_path" > "$backup/database-path"
cp "$backup/database.sqlite" "$stage/migration.sqlite"
(
 cd "$stage/server"
 DB_PATH="$stage/migration.sqlite" V3_PREVIEW=false "$node" -e '
  require("./dist/routes/checkout.js");
  const {db} = require("./dist/db.js");
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") process.exit(1);
  db.prepare("SELECT coupon_id FROM test_orders LIMIT 1").get();
  db.prepare("SELECT cancelled_at FROM checkout_coupons LIMIT 1").get();
  db.close();
 '
)

ready(){
 for attempt in {1..15}; do
  if systemctl is-active --quiet "$service" && curl -fsS --max-time 2 "$health/api/health" >/dev/null; then return 0; fi
  sleep 1
 done
 return 1
}

rollback(){
 trap - ERR
 set +e
 systemctl stop "$service"
 git switch --detach "$base"
 for component in server client; do
  if [[ -d "$backup/$component-dist" ]]; then
   if [[ -d "$component/dist" ]]; then mv "$component/dist" "$backup/failed-$component-dist"; fi
   mv "$backup/$component-dist" "$component/dist"
  fi
 done
 if systemctl start "$service" && ready; then
  printf 'Release check failed. Previous app is healthy again. Backup: %s\n' "$backup" >&2
 else
  printf 'Release check and rollback health check failed. Backup: %s\n' "$backup" >&2
 fi
 exit 1
}

trap rollback ERR
systemctl stop "$service"
git switch --detach "$release"
for component in server client; do
 mv "$component/dist" "$backup/$component-dist"
 cp -a "$stage/$component/dist" "$component/dist"
 chown -R --reference="$backup/$component-dist" "$component/dist"
 chmod --reference="$backup/$component-dist" "$component/dist"
done
systemctl start "$service"
ready
curl -fsS --max-time 4 "$health/api/checkout/config" > "$stage/checkout.json"
"$node" -e 'const c = require(process.argv[1]), previous = require(process.argv[2]); for (const key of ["mockPayment", "gatewayEnabled", "paymentProvider"]) if (c[key] !== previous[key]) process.exit(1)' "$stage/checkout.json" "$stage/previous-checkout.json"
status=$(curl -sS --max-time 4 -o "$stage/redeem.json" -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' "$health/api/checkout/redeem")
[[ $status == 400 ]]
"$node" -e 'if (require(process.argv[1]).error !== "Enter your name and coupon code.") process.exit(1)' "$stage/redeem.json"
trap - ERR

printf 'FlingRoulette %s deployed and healthy. Checkout coupon route verified. Backup: %s\n' "$release" "$backup"
