# Cashfree with IMB rollback

This payment update starts from deployed commit a887972. It preserves the
Telegram mini app, advance reservations, extensions, and password-reset worker.
IMB remains the default gateway. Do not deploy the older main branch over this release.

## Configure

Keep IMB_API_TOKEN, ADMIN_PASSWORD, JWT_SECRET, DB_PATH, Telegram settings and
existing service settings unchanged. Add these only to the private server/.env:

```
CASHFREE_ENV=production
CASHFREE_APP_ID=<Payment Gateway production App ID>
CASHFREE_SECRET_KEY=<Payment Gateway production secret>
PUBLIC_CHECKOUT_URL=https://flingroulette.duckdns.org/checkout
```

Never commit .env or its backups. The browser receives only payment sessions;
it never receives API credentials. Domain approval and live merchant activation
are required in Cashfree. Keep the Cashfree environment/keys unchanged while
Cashfree orders are pending, even when switching new orders back to IMB.

## Deploy

Back up the live SQLite database using SQLite's backup API and copy .env and
both existing dist directories to a private directory outside the repository.
Record the deployed commit and service settings. Keep bookings running while
preparing the build; restart only after both builds and payment checks pass.

Use Node.js 24+. From the repository, build with:

```
npm --prefix server run build
npm --prefix client run build
cd server
node --test --test-isolation=none tests/payments.integration.mjs
node --test --test-isolation=none tests/v5.integration.mjs
```

The payment suite uses a temporary database, fake keys, in-process Express
requests, and mocked provider APIs. It does not charge customers or reset real
accounts. Existing dependencies suffice; no Cashfree backend package is needed.
Cashfree's browser SDK is loaded from https://sdk.cashfree.com/js/v3/cashfree.js
only when opening a Cashfree payment.

Restart account-manager-test.service after deployment, then verify /api/health
and the admin page. In admin > More > Website payment settings, confirm both
gateways show Configured. New orders should still show IMB.

## Webhooks and activation

Keep the existing IMB endpoint enabled:
https://flingroulette.duckdns.org/api/checkout/imb/webhook

Add a Payment Gateway webhook in the Cashfree production dashboard:
https://flingroulette.duckdns.org/api/checkout/cashfree/webhook

Choose the 2025-01-01 webhook schema and Success Payment, Failed Payment, and
User Dropped Payment. The handler acknowledges non-success events without
fulfillment. It verifies signed success notifications using the raw request
body, then checks order ID, amount, currency, PAID order status and a successful
payment via Cashfree's server API. Signed test notifications for unknown orders
are acknowledged without creating an order or assigning credentials.

Select Use Cashfree in admin. Customers using the mini app choose their plan
normally, enter a valid Indian mobile number on checkout, and open Cashfree.
After payment, they can return to checkout and tap Check payment status if the
webhook is delayed. The browser return is never accepted as payment proof.

Check one real low-value booking: exact price, one assigned ID, correct duration,
Telegram-linked booking history, expiration timer and password-reset schedule.
A paid order without stock remains pending for admin attention. Advance bookings
and extensions retain their existing hold/deadline rules.

## Roll back payments

Select Use IMB / Roll back in admin. This switches only NEW orders. Existing
Cashfree orders retain their sessions and verification through Cashfree. Existing
IMB orders also keep IMB when Cashfree is active. Do not remove either key or
webhook. Gateway selection is stored in SQLite and survives service restarts.
There is no automatic retry through another gateway that could cause two charges.

Prefer this switch to rolling back code/database. Database migration only adds
columns, with legacy orders defaulting to IMB. Do not restore an old database over
new paid bookings; reconcile any in-flight payments before a full code rollback.
