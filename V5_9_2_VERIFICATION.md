# v5.9.2 — faster, safer verification (candidate)

**Not deployed.** Based on the v5.9.1 branch. No VPS or production database changes.

## Root cause addressed

The v5.9.1 reset may submit a password change successfully, then time out opening a **fresh** verification login form. This leaves the old saved password and a pending candidate, quarantining the ID. The actual website may have accepted the new password.

## Changes

- Eliminate the random 1–3-second prelaunch pause and two fixed 3-second post-login pauses. Subsequent My Account detection waits for a real control instead of sleeping.
- Wait for the email form using a bounded poll after **one** click on the login control. Avoid repeated menu/modal toggling.
- If the *verification* login form times out, reload that verification page exactly once and try opening the form again. **Never resubmit the password change as part of verification retry**.
- Stop immediately on an apparent CAPTCHA or security verification screen. No bypass attempts.
- Keep the existing 3-second pause immediately after change-password submission until the website's acknowledgment behavior can be validated with an authorized test account.
- Preserve the candidate and keep the account quarantined on any uncertain post-submit failure. Only save the new password after the fresh login succeeds.

## Release checklist

1. GitHub Actions build and isolated regression tests must pass (Node.js 24).
2. Validate on an authorized test account using the real website; do not assume mocked tests prove live password changes work.
3. Confirm account inventory, booking timing, rollback plan, and snapshot of production SQLite database before deployment.
4. For a failed reset, verify the candidate manually and use **Save recovered password (no reset)** if appropriate. This action can end linked bookings, so review them first.
5. Do not replay or bypass security challenges or continue uncertain password-change submissions.

The existing retry scheduler policy for pre-submit failures remains unchanged. Optimizations do not promise a fixed reset duration.
