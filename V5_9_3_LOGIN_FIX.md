# v5.9.3 proposed login reliability patch

Not deployed. Based on v5.9.2. This addresses intermittent **initial login** failures (IDs 2/3 recovered after manual retry; ID 4's credentials may be outdated).

- When the initial login form remains visible **without** an explicit invalid-password message, reload and retry that login exactly once. Only permitted before submitting any password change.
- Stop without retry on explicit credential rejection, CAPTCHA/security challenge, an unknown account-menu layout, a failed reload, or cancellation.
- Preserve the v5.9.2 fresh-browser verification and password-candidate quarantine. Do not repeat submitted password changes.
- Failed resets in Accounts show warning/error styling and no longer display the obsolete scheduled time as **Next**.
- Includes mock tests for intermittent login, invalid credentials, challenges and a changed layout.

## Limits and release checks

The site's actual login error UI needs verification with an authorized test account. A login form staying visible is not evidence of bad credentials. A suspected external password change must be resolved through the site's legitimate recovery mechanism. Do not bypass site verification.

CI passing is not proof of live behavior. Before production: run staging tests, check booking impacts and active resets, take a consistent SQLite backup, preserve compiled v5.9.2 rollback files and conduct an off-peak test.

No live server, account, booking or database has been modified by this branch.
