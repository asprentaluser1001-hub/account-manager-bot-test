#!/usr/bin/env bash
set -euo pipefail
rm -f /etc/systemd/system/account-manager-test.service.d/90-flingroulette-admin-browser.conf
systemctl daemon-reload
systemctl restart account-manager-test.service
echo 'Temporary admin browser disabled.'
