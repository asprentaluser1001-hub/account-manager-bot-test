# V5.3 — booking and admin fixes

Based on V5, merged in PR #13, on `feature/v4-miniapp-admin`. V5.3 is proposed in PR #14. The live VPS and production database have not been changed.

## Included

- 30-minute bookings cost ₹60 and cannot be extended.
- The Mini App timer bar reflects actual time remaining and updates with its local countdown.
- Manual booking supports 30 minutes at the same ₹60 rate as customer bookings.
- Manual password reset stops and waits for an overlapping scheduled reset before running, instead of colliding with the scheduler. Reserved accounts remain protected and must be ended or released through booking controls.
- Pinch zoom is disabled on admin pages only. The Mini App and checkout keep normal browser zoom behavior.
- The reset scheduler polls once per minute; the Mini App countdown still ticks locally once per second.

## Validation

V5's earlier build and 19-test results are documented in its merged commit. V5.3 adds a test for creating a manual 30-minute booking at ₹60 and updates the existing price and revenue assertions. V5.3 has not yet been built or tested in a local checkout. Review CI results, then build and test in staging before deploying.

No live IMB payment, Telegram delivery, or production Flingster reset is claimed for this update. Keep the V5 database and environment unchanged while staging. Never run a second Telegram bot poller against the production token.

## Staging / deployment

1. Keep production running on the current release until the V5.3 branch is reviewed and tested.
2. Use a separate staging directory and database; keep the existing environment file private.
3. Build server and client with Node 24+, then run `node --test tests/*.mjs` from `server`.
4. Check the booking timer, 30-minute customer and manual bookings, manual reset while a scheduled reset is pending/running, admin pinch zoom, and load/performance.
5. Deploy only after staging passes, with the existing production service and database paths.
