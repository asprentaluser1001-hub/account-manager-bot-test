# V3 production release review (27 September 2026)

This is a review plan, not deployment authorization. Do not merge or restart production until the owner explicitly approves. The V3 developer preview remains separate.

## Scope and compatibility

- The review branch merges `v3/developer-preview` with `main` at `29079c5fc41a466354b0e22283fafbdd5e524efa` and retains the existing ₹50/50-minute manual extension. Repeated extensions update the original booking expiry, account expiry, and reset schedule together.
- Production manual booking still allows private credential delivery without a Telegram ID; when an ID is provided, it must belong to a customer who started the configured bot. A failed send is shown to the admin and keeps the account reserved.
- Preview-only mock claim endpoints reject requests when `V3_PREVIEW` is false. The existing live checkout and IMB status path remains enabled by configuration. There is no automatic refund; refund labels only track status.
- V3 History removal hides eligible finished rows from the UI and reported earnings but retains the database records. Gross totals include cancellations and are not net settlement figures.

## Required pre-deployment checks (not yet completed)

1. Obtain read-only production facts, one Termius command and response at a time: repository directory/status/commit, service name and state, Node version, database path (path only), and configured *names* of environment settings. Do not paste secret values or database contents. Inspect the preview VPS separately and do not treat it as production.
2. Resolve any divergence from the verified main commit. Confirm production `V3_PREVIEW=false`, `SANDBOX_MODE=false`, non-mock `PAYMENT_MODE`, valid existing `IMB_API_TOKEN`, and the existing production bot and checkout configuration. Never copy preview `.env.v3`, sample accounts, test bot, or `v3-preview.db` to production.
3. Take a consistent SQLite backup of the *actual* V2 production database using SQLite's backup API while the service is running, or stop writes and use an equivalent consistent backup. Verify backup integrity (`PRAGMA integrity_check`) and retain it outside the release tree with restrictive permissions and an independently verified restore path. Do not paste database rows or secrets in chat.
4. Apply the release code to a **copy** of that database in an isolated environment, with external bot/payment calls disabled; start the server against the copy and verify `PRAGMA integrity_check`, expected tables/columns, preserved row counts and representative bookings, manual extension, account reset, reports, and rollback against the backup. Startup currently creates/changes schema; it is not an independently reversible migration.
5. Build client and server on the deployment Node runtime (requires Node 24+ for `node:sqlite`), run integration tests, then smoke-check admin login, old sessions, V2 manual booking (with/without Telegram), IMB checkout status/verification **without a live charge**, reset behavior, reports and preview isolation. Live gateway and real Telegram delivery need separately authorized end-to-end verification; local tests do not prove them.

## Proposed production sequence after explicit approval

Record the actual running commit and verified backup path, deploy the approved PR commit to the existing production checkout without replacing its environment or database, build, restart only the verified production service, then inspect health, checkout configuration, logs, one known booking, reset queue and totals. Provide and check one command at a time. Keep the previous commit and verified database backup for rollback. If health, checkout, or data checks fail, stop the service, restore the previous commit and **its matching database backup**, restart, and verify again. Rollback may discard writes made since the backup: suspend new bookings/coordinate the maintenance window before restoring. Never use the preview database as a rollback source.

## Local evidence and open risks

Client/server builds and isolated preview/production-mode integration tests must pass on the final review commit. Synthetic V2-schema tests are not a migration of the actual production database. Production VPS state, production backup integrity, real payment settlement, and bot delivery remain unverified until the checks above are complete. The PR is review-only while these items are outstanding.
