# Same-attempt password verification for v5.9.2

The VPS logs show successful changes whose password form remains filled. The
old code waits 25 seconds, returns failure, then waits another 30 seconds for a
scheduled retry to verify the candidate. This patch waits up to five seconds for
the form and, on a Playwright timeout only, verifies the candidate immediately
in a fresh profile. It keeps the submission browser alive until verification
finishes so a pending request is not cancelled. This fallback briefly uses two
browser profiles at once; the existing global reset queue still runs one job
at a time.

Only a successful fresh login and account view updates the stored password.
Failures and cancellations retain the candidate for later recovery. HTTP 403
and recognizable challenge pages stop promptly for manual review; this patch
does not resolve the website's access challenge.

## Deploy on the diagnosed VPS

The checkout must have no tracked local changes. From Termius run:

```bash
cd /root/flingroulette-v4-prod && git fetch origin fix/v5.9.2-same-attempt-verification && git merge --ff-only FETCH_HEAD && bash deploy/apply-reset-hotfix.sh
```

The script compiles into a temporary directory before stopping
`account-manager-test.service`, saves the old compiled server in
`.reset-hotfix-backups/`, installs the build, and restarts the service. It
restores the previous compiled server if installation or the startup check
fails. It does not change the database schema or install dependencies.

Afterward, trigger one reset and inspect:

```bash
journalctl -u account-manager-test.service -n 40 --no-pager -o short-iso
```

An unchanged form should log `Submission UI unconfirmed; verifying candidate in
the same attempt` followed by success, without `try 2/3`. A challenge should
report `Site access blocked or verification challenge detected` and retain any
unverified candidate. Do not repeatedly reschedule a challenge-blocked account.

To roll back manually, stop the service, move the current `server/dist` aside,
copy the saved `dist` directory back to `server/dist`, and start the service.
The source checkout remains on the hotfix commit; rebuilding it reapplies the
hotfix.

## Check remaining VPS access failures

If the logs show HTTP 403 or `cf-mitigated: challenge`, compare the installed
Chromium's native defaults with one deterministic sample of the application's
current browser settings:

```bash
cd /root/flingroulette-v4-prod && git fetch origin fix/v5.9.2-same-attempt-verification && git merge --ff-only FETCH_HEAD && cd server && node scripts/check-site-access.cjs
```

This opens only the public landing page, once per configuration and sequentially.
It reads no database or account credentials and makes no login/password-change
submissions. It does not restart or rebuild the server. It stops inspecting a
page when a challenge is detected; it does not solve or bypass that challenge.
The application preset is a fixed sample, not a reconstruction of the random
settings from an earlier reset.

If native defaults alone reach the login controls, investigate browser
configuration before changing production behavior. Landing-page access is not
proof that a login or reset will work. If both configurations remain challenged,
access from the VPS is still unverified; use Flingster's official contact page
at https://flingster.com/contact/ to ask about supported automated access.
No official password-management API was established during this investigation.

## Consistent browser preset

The VPS diagnostic on 2026-10-24 returned a Cloudflare challenge for native
defaults, while `application-preset-sample` returned HTTP 200 with visible login
controls. Reset, verification, and persisted-candidate recovery now use that
same fixed preset (Windows Chrome 125 presentation, 1280x720, en-US,
Asia/Kolkata) across jobs instead of randomizing settings on every attempt.
This is an existing application preset, not a new challenge-handling mechanism.

The two checks were sequential and each ran once: timing or intermittent site
behavior could also explain the difference. The observation establishes public
landing-page access only. One authenticated reset on the VPS is still needed
to validate the result; HTTP 403/challenges continue to stop for manual review.
Fresh verification still has no shared authenticated cookies or storage.

Install this update with the same backed-up deployment command in the deployment
section, then try one expired account. If the current password was changed
manually, save that verified current password through account recovery before
queuing the test. The change does not modify stored credentials or the schema.
