# FlingRoulette V3 developer preview

This branch (`v3/developer-preview`) is a test-only implementation. It is not a production release and has no real payment or refund capability. The V2 `main` branch and its database/service remain separate.

## Preview isolation

| Area | V2 production | V3 preview |
|---|---|---|
| Git | `main` | `v3/developer-preview` |
| Database | Existing V2 database | `/opt/flingroulette-v3/server/data/v3-preview.db` |
| Environment | Existing V2 environment | `/opt/flingroulette-v3/server/.env.v3` |
| Service | Existing V2 service | `flingroulette-v3-preview.service` |
| Payments | Production configuration | `PAYMENT_MODE=mock`; live IMB prohibited |
| Telegram | Production bot | No token or a *separate* test bot |
| Accounts | Production accounts | Sample names and `@example.invalid` addresses only |

Startup fails if V3 preview runs without `SANDBOX_MODE=true`, `PAYMENT_MODE=mock`, a V3-specific database path, or with `IMB_API_TOKEN`. Do not copy V2 database, secrets, payment token, Telegram token or hostname into V3.

## Implemented test features

- Liquid-glass dashboard with compact navigation and live booking timers.
- Admin History: create/claim/approve sample bookings; extend an existing booking by 50 minutes for a manually confirmed ₹50 *test* amount; end early, cancel, or transfer it to a free sample account. The previous account remains reserved until its password reset succeeds. Extend is not a separate customer booking.
- Reset schedule and retry-now for failed resets; reset history and availability indicators. Reserved accounts cannot have their reset timer disabled, be deleted, or have their password edited directly.
- Daily/weekly/monthly gross test-revenue summaries, success/failure counts, refund-status tracking and CSV. Gross figures include cancellations; refunds are tracked separately, not deducted or issued.
- Mock checkout creates a sample web order with **no QR, UPI or gateway payment**. Admin marks a test claim and assigns an account in History. Public order page shows credentials only during the active booking.
- Optional separate test Telegram bot: order history, sample status, expiry reminder and sample credential delivery. Requires a test bot token and admin ID to actually deliver messages.
- Preview-only health/disk check, consistent SQLite backup, backup list and booking/refund audit. Git update/restart and rollback stay manual VPS operations, with no privileged web endpoints.
- Twelve-hour admin sessions, password-change session invalidation, 15-minute sign-in throttling and isolated `.env.v3` password updates.

## Deliberately not live

Automatic paid checkout, real QR transactions, automatic refunds, a production Telegram bot, OS package updates, privileged GitHub deploy, and one-click rollback require separate authorization/integration. This preview must not pretend to receive or refund money. A backup is created in the V3 data directory; it does not replace an off-VPS backup.

## Validate before using the preview

On a Node.js 24+ development machine, install dependencies in `server` and `client`, run `npm run build` in each, then run `node --test tests/v3.integration.mjs` in `server`. The integration test starts a temporary isolated preview database, exercises the booking lifecycle and backup, then removes the temporary test data.

For the VPS preview, inspect `deploy/README.md`, back up the V3 database first, update only `v3/developer-preview`, rebuild, restart only `flingroulette-v3-preview.service`, then verify `/api/health`, `/api/v3/ops/health` (authenticated), mock checkout and account isolation. Avoid exposing port 4400 without HTTPS/authenticated admin access. A `trycloudflare.com` quick-tunnel address is temporary and cannot be treated as a permanent URL.
