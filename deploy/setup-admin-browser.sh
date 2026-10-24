#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run this setup as root on the diagnosed VPS.' >&2; exit 1; fi
repo=$(git rev-parse --show-toplevel)
cd "$repo"
git diff --quiet
git diff --cached --quiet
systemctl is-active --quiet account-manager-test.service

if ! command -v Xvfb >/dev/null || ! command -v xkbcomp >/dev/null || ! command -v dbus-daemon >/dev/null \
  || [[ ! -s /usr/share/glib-2.0/schemas/gschemas.compiled ]] \
  || [[ ! -f /usr/share/glib-2.0/schemas/org.gnome.desktop.interface.gschema.xml ]]; then
  apt-get update
  apt-get install -y --no-install-recommends xvfb x11-xkb-utils dbus gsettings-desktop-schemas
fi

unit_dir=/etc/systemd/system/account-manager-test.service.d
dropin="$unit_dir/90-flingroulette-admin-browser.conf"
mkdir -p "$unit_dir"
saved=$(mktemp -d /tmp/fr-viewer-setup.XXXXXX)
trap 'rm -rf -- "$saved"' EXIT
if [[ -f "$dropin" ]]; then cp -a "$dropin" "$saved/dropin"; fi
restore() {
  trap - ERR
  if [[ -f "$saved/dropin" ]]; then cp -a "$saved/dropin" "$dropin"; else rm -f "$dropin"; fi
  systemctl daemon-reload
  systemctl restart account-manager-test.service || true
  echo 'Viewer setup failed; restored its previous service configuration.' >&2
  exit 1
}
trap restore ERR
cat > "$dropin" <<'CONFIG'
[Service]
Environment=ENABLE_ADMIN_BROWSER_DIAGNOSTICS=true
Environment=ADMIN_BROWSER_ORIGIN=https://flingroulette.duckdns.org
CONFIG
systemctl daemon-reload
bash deploy/apply-reset-hotfix.sh
trap - ERR
echo 'Sign in to your dashboard in Safari, then open:'
echo 'https://flingroulette.duckdns.org/admin-browser'
echo 'Each browser session lasts at most two minutes. Close it when finished.'
