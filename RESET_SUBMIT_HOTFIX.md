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
