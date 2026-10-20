# Automatic reset fix for release/v5.9.2

This patch is based on deployed commit `21a9bb0`, not the older main branch.

## Observed failure and resulting behavior

The production logs show unconfirmed logins followed immediately by "manual
review needed; retries stopped". The prior implementation marked every failure
to find the signed-in account as non-retryable. The updated implementation keeps
unconfirmed navigation eligible for the existing bounded automatic retry policy.
Explicit credential rejection and security challenges still stop for review.

When password submission succeeds but verification fails, the candidate remains
in SQLite. The next attempt checks that candidate in a fresh browser profile
before trying the stored password. A confirmed candidate is promoted without
another password change. An unsuccessful candidate is preserved until a login
with the stored password succeeds; neither password is discarded on failure.

Manual and scheduled reset jobs share one FIFO browser queue per process.
Timeouts begin after queue admission. Scheduler cancellation and recovery can
cancel a queued job without opening another browser or allowing later jobs to
overtake an active one. Run one server process per database.

Password submission waits for form completion instead of a fixed three-second
sleep. Reset-result notifications run independently from state updates. The
release's booking, advance-reservation, extension, and quarantine behavior is
retained.

## Validation and limits

The server TypeScript build and all 39 tests pass, including the existing V5
booking suite. Tests cover automatic scheduler retry without an admin click,
candidate-password recovery, explicit rejection/challenges, FIFO processing,
cancellation and stalled notifications. All browser interactions were mocked
and all test databases temporary. No live customer passwords were changed.
Production logs establish why retries stop; they do not prove whether a given
unconfirmed login was caused by latency, credentials, or a changed website.

## Installation

Review and merge or deploy the fix branch through your usual release process.
Back up the database configured by DB_PATH using a consistent SQLite backup.
Build the server with `npm run build` in its server directory; dependencies and
database schema do not change in this patch. Restart the existing
`account-manager-test.service` only after a successful build. This patch does
not require a client rebuild.

Retain the existing environment, database and recovery candidates. Pending and
interrupted running jobs resume on startup. Previously failed jobs remain
quarantined; select **Retry reset now** once after deployment to requeue each
affected account. A confirmed incorrect password still requires recovering
the current credential, and security challenges require manual attention.

The VPS currently runs the compiled server under
`/root/flingroulette-v4-prod/server/dist/index.js`. This patch has not been
deployed automatically.

