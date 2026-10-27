# FlingRoulette 6.0.0

Based on the deployed Cashfree/IMB update (17bf6d2). No booking records are deleted,
and no API-key or gateway setting changes are required.

- Reports and overview show this India-time calendar month's confirmed gross
  booking revenue. The period rolls over on the first day at 00:00 Asia/Kolkata.
- Detailed report totals, confirmed count, daily/weekly/monthly groups and CSV
  use that same monthly period. Failed counts use creation time in that month.
- The rolling seven-day chart still includes prior-month days when applicable.
- Earlier booking history stays intact. Refund tracking stays visible and is not
  subtracted from gross revenue. The reporting status definitions are unchanged.
- Production reports no longer say Test data only, test bookings or no real payments.
  The explicit developer-preview warning is retained when mock mode is enabled.
- Admin cards and navigation use lighter glass with blur, readable dark text,
  and opaque fallbacks for reduced-transparency preferences or unsupported browsers.
- The existing botanical background, mini app, password resets, Cashfree/IMB
  selection and per-order gateway handling are preserved.

Validation: server/client builds, monthly reporting boundary and reconciliation
checks, payment/mini-app/rollback suite, and paid-extension/slot/deadline suite.
These tests use temporary data and mocked payments; they never charge customers.

Deployment: back up current builds and settings privately. Fetch release/v6.0.0,
switch to it, build server and client, run the checks below, restart the existing
account-manager-test.service, and verify /api/health and the v6 admin header.
Keep the existing private .env and live database path unchanged.

```
node --test --test-isolation=none server/tests/monthly-finance.unit.mjs
node --test --test-isolation=none server/tests/payments.integration.mjs
node --test --test-isolation=none server/tests/v5.integration.mjs
```

For code rollback, rebuild the prior commit or restore the immediate pre-v6 dist
backups and restart the same service. Do not restore an older database over new
bookings. This release requires no database schema changes.
