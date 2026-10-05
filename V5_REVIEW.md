# V5 draft — booking and payment update

Base: production commit `43ee6ae7c9474f8b8a3ffd3af2d3e9c63ca6920a` on `feature/v4-miniapp-admin`, repository `asprentaluser1001-hub/account-manager-bot-test`.
The live service is `account-manager-test.service`, project `/root/flingroulette-v4-prod`. No deployment or production database changes have been performed.

## Included

- Two main Telegram buttons: Open Mini App and Show Proofs.
- 30 minutes for ₹70. Backend and Mini App reject extensions for this plan.
- Used IDs, next slot estimates, and advance checkout for the selected duration.
- Durable, transactional slot holds: advance checkout holds expire after five minutes (or at slot start, whichever comes first).
- Verified payments turn holds into reservations. Conflicting bookings, extensions, transfers, and complimentary time are rejected.
- Active customer credentials are returned only to the verified Telegram owner while the booking is current.
- Paid extension of one hour for the existing ₹50 fee. Checkout leaves the original timer/reset unchanged; only verified payment before expiry changes both atomically.
- Telegram extension reminder in the final five minutes, including Mini App bookings. Thirty-minute plans and conflicting extensions are excluded.
- Payment-page instructions to return and wait 5–10 seconds. Checkout polls every eight seconds and verifies through the existing IMB status API as well as the webhook.
- Late confirmed payments are recorded as `payment_late`, counted in collections, and shown for support/refund tracking. They do not extend expired access.
- Reserved accounts activate at their slot start only after the previous password reset succeeds. Credentials are never handed over during a failed/in-progress reset.
- Reset scheduler checks every second and atomically claims the original due reset before starting it. This initiates work near expiry; external browser/password changes are asynchronous and cannot be guaranteed to complete at the exact second.

## Decisions and limits to review

The extension price remains the existing ₹50; duration changes from 50 minutes to 60 minutes. Future slots include a two-minute password-reset allowance. Availability is an estimate: if a reset takes longer, the account remains blocked. A reservation that cannot activate before its end is marked `reservation_failed` and requires support/refund handling. This draft does not issue automatic refunds.

No real IMB payment, Telegram delivery, or production Flingster reset has been executed. These integrations must be exercised on staging with approved test accounts before production rollout. Existing production `.env`, SQLite data, bot settings, and media remain outside the Git changes. The existing botanical background remains in the base Git tree.

## Validation

Server TypeScript and client TypeScript/Vite builds; all 19 automated checks pass. New coverage includes 30-minute extension rejection, unchanged checkout timers, duplicate confirmations, future overlap prevention, late payments, revenue totals, owner isolation, and reset-gated reservation activation. Existing migration, booking lifecycle, authentication, reset navigation, and account-recovery checks remain passing.

## Staging / deployment sequence

1. Keep production on V4. Back up the live SQLite database using SQLite's backup API and keep the existing environment file private.
2. Check out this draft into a separate staging directory with a separate SQLite database. Never run a second bot poller using the production token.
3. Build client and server using Node 24+, then run the test suite with `node --test tests/*.mjs` in `server` after its build.
4. Exercise the real gateway's supported testing flow: regular booking, paid advance booking, extension before deadline, duplicate callbacks, payment after deadline, and reset failure. Check actual Telegram reminders and credentials.
5. After staging review, deploy the reviewed commit to the existing production service with its existing environment/database paths. No merge, service restart or deployment is performed by this draft.
