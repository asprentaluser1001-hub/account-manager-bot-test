# Reset and automatic reset reliability

This update fixes application failures in the reset workflow. It does not
establish that Flingster permits unattended access from the VPS. A real 403 or
verification challenge still stops the attempt and keeps the account unavailable.
Manual login on a phone uses a different browser and network.

## Findings from the version comparison

The VPS logs before the recent fixes already contain intermittent 403 responses.
They also show password changes that succeeded but waited for a form to clear,
timed out after 25 seconds, and were confirmed on a later attempt. The installed
same-attempt verification fix completed one real reset in about 27 seconds.

Three application problems remained:

- Same-attempt verification could keep the submitting Chromium process alive
  while launching a second process, undermining the single-browser resource
  limit on the 1 GiB VPS.
- The 120-second execution timeout was treated like an explicit cancellation,
  preventing an automatic retry that could verify the preserved candidate.
- Reset and Release were long HTTP requests. Any manual failure, including a
  temporary error or duplicate request, immediately quarantined the ID. The
  dashboard offered Reset on reserved accounts even though the endpoint rejected
  them and required Release.

## Runtime paths and invariants

server/lib/passwordReset.ts implements the workflow used by manual and automatic
requests. One Chromium engine opens isolated BrowserContexts for login and
verification. Verification inherits presentation settings without inheriting
cookies or authenticated storage. An uncertain submission remains alive while
verification runs in another context of the same engine. Browser shutdown
finishes before the shared FIFO slot is released.

The candidate is saved before submission. Only an authenticated account view
with the new password updates the stored credential and last_reset_at. A later
attempt checks an existing candidate before attempting another password change.
Errors redact current and proposed credentials; logs identify the final stage
and elapsed time.

server/lib/resetJobs.ts owns the global browser FIFO and per-account lock.
Queue wait does not consume the 120-second execution allowance. Its own timeout
is retryable; explicit cancellation is not. Challenges and explicit credential
rejections retain their existing stop rules.

server/lib/autoResetScheduler.ts starts booking-expiry resets. Its existing
policy remains three tries, 30-second gaps, then ten minutes and three more
tries for temporary failures. It skips accounts owned by active manual jobs.
Interrupted running expiry schedules resume on startup as before.

server/lib/manualResetJobs.ts persists manual Reset and Release jobs in the new
manual_reset_jobs table, separately from booking expiry timestamps. Repeated
clicks return the same active job. Both actions use the same worker and FIFO as
automatic expiry. Temporary failures use the same bounded retry policy, with
retry times saved to SQLite. Restart preserves a retry delay and resumes an
interrupted attempt without losing its candidate.

An accepted manual job holds the ID immediately, with no automatic unsell time.
Booking availability and extension checks exclude it. Intermediate failures
do not impose a final customer hold. A final blocked or failed result quarantines
the ID and uses the existing customer-approval policy. Successful verification
releases it. Release stops the replaced expiry reset and ends the current booking
through the existing markReset contract. A normal reset preserves a future
schedule and satisfies an already-due one.

Recovery cancels queued/running manual jobs and waits for the worker to stop
before saving credentials or retiring an ID. Graceful shutdown stops both
schedulers and the active browser; pending jobs remain recoverable after restart.
The runtime database uses Node 24's built-in node:sqlite.

## Admin API and dashboard

POST /api/accounts/:id/reset-password and POST /api/accounts/:id/release
now return HTTP 202 with a job object. They no longer wait for a browser operation.
GET /api/accounts/:id/reset-jobs/:jobId returns progress and the terminal result.
These endpoints retain admin authentication and send Cache-Control: no-store.
The account list includes active manual jobs so page refresh restores progress.

The dashboard polls short status requests, shows queued/running/retry progress,
and displays success only after verification. Closing the page does not cancel
the server job. Reserved accounts show **Release & reset**. Customer blocks still
require explicit approval after recovery; reset success does not approve a
customer automatically.

## Install on the existing VPS

~~~bash
cd /root/flingroulette-v4-prod && git fetch origin fix/reset-worker-reliability && git merge --ff-only FETCH_HEAD && bash deploy/apply-reset-reliability.sh
~~~

The installer compiles server and client into temporary directories before
changing the running app. It resolves the service's database path without
printing its environment, makes a consistent SQLite backup including WAL data,
and saves both previous builds under .reset-hotfix-backups/reliability.*.
It restarts account-manager-test.service and checks local health. No environment,
public listener, website credentials or SSH settings are changed.

If installation fails, it restores the previous builds. It keeps the latest live
database: rolling back password data could disagree with a change already applied
on the website. Any unfinished new manual jobs are paused and their IDs held
through the old schedule table so older code cannot release them accidentally.
The schema addition is compatible with the older server.

Refresh Safari after installation. Verify one manual reset and one expiry reset;
inspect job status, stored password and history. Logs:

~~~bash
journalctl -u account-manager-test.service --since "10 minutes ago" -n 100 --no-pager -o short-iso
~~~

## Validation

Integration suites use temporary databases and test credentials, including
old-schema migration, job ownership, bounded retries, cancellation, interruption,
booking release, expiry and customer holds. Deployment checks exercise WAL
backup and rollback without reverting credentials.

server/tests/reset-worker.browser.cjs runs actual headless Chromium against
intercepted local pages. It proves storage isolation, same-attempt verification
with the submitting form still open, candidate preservation on a verification
block, recovery without another password change, and browser cleanup.
server/tests/reset-dashboard.browser.cjs exercises the built dashboard at phone
width with local API fixtures, including Reset, Release and page refresh.
These fixtures do not access Flingster or any live account.

Local validation completed: server and client builds; 78 integration/unit checks;
real Chromium reset worker and mobile dashboard fixtures; JavaScript, shell and
whitespace checks. Live VPS reset and expiry verification remain outstanding.
