# FlingRoulette V3 Developer Preview

Status: isolated preview scaffold on branch v3/developer-preview.

## Current architecture

- client/: React 18 + TypeScript + Vite dashboard and checkout UI.
- server/: Node.js 24 + TypeScript + Express API.
- server/db.ts: local SQLite database selected only by DB_PATH.
- server/lib/testOrders.ts: sample booking/order state machine and synthetic payment claims.
- server/lib/autoResetScheduler.ts: scheduled sample reset workflow.
- server/lib/telegramBot.ts: optional Telegram test bot polling.
- server/routes/checkout.ts: checkout, payment-proof, and order endpoints.
- client/src/App.tsx: existing V2 dashboard UI copied unchanged in this branch, with only the required preview banner added through CSS.
- client/src/Checkout.tsx: existing checkout UI copied unchanged; live gateway access is disabled in V3.

## Isolation contract

| Area | V2 production | V3 developer preview |
|---|---|---|
| Git ref | main | v3/developer-preview |
| URL | Existing production URL | Separate preview hostname only |
| Database | Existing production DB | /opt/flingroulette-v3/server/data/v3-preview.db |
| Environment | Existing V2 env | server/.env.v3 |
| Process | Existing V2 service | flingroulette-v3-preview.service |
| Payment | Existing V2 configuration | PAYMENT_MODE=mock; live IMB blocked |
| Telegram | Existing V2 bot | Empty or separate test bot token |
| Accounts | Existing V2 accounts | Auto-created Sample IDs only |

V3 startup fails if V3_PREVIEW=true is combined with non-sandbox mode, a non-mock payment mode, or an IMB token. No production database path, production secrets, production Telegram token, or production payment token should be copied into the V3 environment.

## First-preview acceptance checks

1. GET /api/health returns {"ok":true}.
2. The login page and dashboard retain the current V2 layout.
3. The banner reads: FlingRoulette Developer Preview V3 — Test Data Only.
4. The preview database is created at the V3-only path.
5. The Accounts page contains only Sample ID records.
6. Adding non-sample accounts is rejected.
7. Mock checkout creates a test order and never calls IMB.
8. No V2 service is stopped, restarted, reconfigured, or pointed at the preview database.
9. The systemd unit runs as a separate service and user.
10. The preview URL is not the production URL.

## V3 feature list for approval

These are planning items only. They are not implemented in this first preview.

### Dashboard and booking controls

- New admin dashboard design.
- Booking extend-time control.
- End booking early control.
- Transfer customer to another account.
- Cancel booking and refund-status state.
- Improved manual booking with a live timer.

### Reset and account lifecycle

- Reset attempt history controls.
- Retry-now control.
- Reset progress/status display.
- Clear account-available-again indicator.

### Finance and payments

- Daily, weekly, and monthly revenue reports.
- Successful versus failed payment reports.
- Refund tracking.
- CSV export.
- QR-only payment flow with an explicit test/live boundary.

### Telegram

- Booking history.
- Payment-status notifications.
- Expiry reminders.
- Automatic credential delivery.

### VPS and operations

- VPS system update controls.
- GitHub update/deploy button with protected preview/production separation.
- Logs, backups, health checks, and rollback.
- Admin audit logs and improved security.

## Deployment note

The repository branch and isolated configuration are prepared, but a preview URL can only be issued after deployment to a separate VPS location/host. The current workspace has no authorized SSH/VPS deployment channel, so production has intentionally not been touched and no URL is claimed here.

Required preview deployment inputs are the preview VPS hostname/IP and an SSH path/account with permission to create:

- /opt/flingroulette-v3
- the flingroulette-v3 system user
- the separate systemd unit
- the separate HTTPS/Cloudflare preview hostname

After deployment, stop for owner approval before implementing any redesign or feature from the list above.
