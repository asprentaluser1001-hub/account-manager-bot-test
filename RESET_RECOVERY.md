# FlingRoulette: safe reset recovery (v5.9)

This is a **proposed code change**, not a deployed fix. Test it on an isolated copy of the database with sample credentials before approving production rollout.

## If "My Account not visible after login" appears

An HTTP 200 page load does not prove login succeeded. A previously submitted password change may have succeeded while the verification browser failed. Do not repeatedly click "Retry reset now", and do not assume the stored password is current.

1. On the website, manually verify the **current** password for the affected account. Never paste passwords, screenshots showing them, session cookies or API tokens into chat or issue trackers.
2. From **Accounts → Lost password / stuck reset**, choose **Stop reset & quarantine ID** if reset attempts remain queued. This ends linked bookings and holds the account out of inventory.
3. If the recovery field contains the verified current password, choose **Save recovered password (no reset)**. This stores the verified password, clears the unverified candidate, stops retries and retains the quarantine; linked active bookings are ended. It does **not** queue a reset, release the ID or book anyone.
4. Diagnose the website's signed-in navigation with an authorized test account. If the site requests CAPTCHA or identity verification, complete that manually rather than attempting to bypass it.
5. Only after the automated flow has been repaired and tested should an admin decide whether to queue a new reset, release an ID or move a booking. Confirm the external password and account availability before reuse.

Unconfirmed initial login, missing account navigation and uncertain password-change verification now stop the six-attempt retry cycle. The account stays unavailable until recovery. Ordinary transient failures may still be retried.

## Validation before release

Run on Node.js 24+ with dependencies installed. From the server directory:

```sh
npm ci --ignore-scripts
npm run build
node --test tests/resetNavigation.unit.mjs tests/recovery.integration.mjs
```

Build the client from `client/` using `npm ci --ignore-scripts && npm run build`.
The integration tests use synthetic accounts and mocks. They are not evidence that live Flingster login works; that requires a separately authorized, non-production test.

Do not merge, restart the live VPS, alter the production database or publish real credentials until the owner explicitly approves after backup and deployment review.
