# Temporary phone-accessible VPS browser

The dashboard at https://flingroulette.duckdns.org serves the browser viewer at
`/admin-browser`. This is a manual diagnostic, not proof that automated password
changes work and not a mechanism to share challenge clearance with reset jobs.

## Setup

```bash
cd /root/flingroulette-v4-prod && git fetch origin diagnostics/phone-vps-browser && git merge --ff-only FETCH_HEAD && bash deploy/setup-admin-browser.sh
```

Setup installs Xvfb, keyboard utilities, D-Bus and desktop settings schemas if
absent and enables two environment variables through a dedicated systemd
drop-in. It compiles before restarting the existing service
using the backed-up installer. No new public listener, VNC port, SSH forwarding,
database schema, npm dependency, or frontend build is needed. The display server
uses a local Unix socket and does not listen on TCP. Each viewer also starts a
private desktop session bus with a Unix socket inside its temporary profile.
Chromium receives that bus address, never an inherited desktop session address.

Sign in to the normal dashboard in Safari, then open
https://flingroulette.duckdns.org/admin-browser in that same browser. Tap **Open
VPS browser**. Tap the image to click, and use the text box to type into the
selected remote field. Text is hidden in the local input and cleared after
sending. The viewer does not retrieve credentials from the account database.

The live browser is visible for up to two minutes, including startup time, and
holds the existing global browser queue while active. Scheduled resets wait;
they are not cancelled. Stop it when finished. If a reset is already running,
the viewer waits its turn. A queued request expires after five minutes.
Headed Chromium has up to 60 seconds to start, within that existing two-minute
limit. The reset worker's browser timeout and verification policy are unchanged.

## Access and lifecycle

The feature is disabled by default. All browser API operations require the
existing admin Bearer token, and all mutations require the configured HTTPS
Origin. Frame/action/status/stop requests also require an unguessable session
header bound to the initiating admin token. Screenshots, HTML, and API responses
are marked no-store. Session identifiers and credentials are never put in URLs.
The HTML is a public shell with a restrictive CSP; it contains no credentials or
screenshots. An unsigned visitor cannot start, view, or operate the browser.

The browser uses its own temporary profile. Its cookies are not copied to reset
workers or retained after closure. The child processes receive only selected
basic environment variables, excluding app credentials. The GUI runs under the
existing service account, with the same Chromium sandbox flags as reset jobs.
Top-level navigation is restricted to HTTPS on Flingster domains, new tabs are
closed, and no address bar, developer tools, arbitrary keyboard shortcuts,
shell execution, or file API is exposed by the viewer. Website subresources and
challenge frames still load normally. Downloads are disabled.

If you manually change a website password, verify it and save it through account
recovery afterward. Saving recovery credentials ends linked bookings and leaves
the ID quarantined. The viewer does not automatically update passwords, mark a
reset successful, release accounts, or approve orders.

## Diagnose browser startup

If the viewer cannot open, check the local headed-browser fixture while no reset
is running:

```bash
cd /root/flingroulette-v4-prod/server && node tests/admin-browser-display.browser.cjs
```

It uses the installed viewer code with a local test page, without opening the
website, reading the account database, changing passwords, or restarting the
service. The observer allows up to 100 seconds so the launcher's own 60-second
timeout and cleanup can complete. A failed launch prints the Playwright launch
error to this terminal only, before any website or human input is loaded.
The previous fixture stopped observing after 15 seconds, which could report
`opening != ready` and cancel the browser before the launcher reported its
actual result. Such output does not prove Chromium crashed or that its D-Bus
warnings caused the viewer failure.

## Disable after inspection

```bash
cd /root/flingroulette-v4-prod && bash deploy/disable-admin-browser.sh
```

This removes only the diagnostic drop-in and restarts the existing service. On service shutdown, the viewer closes its browser and removes the temporary profile before exiting. It
leaves Xvfb installed but does not keep a display process running. Active browser
profiles are temporary and contain no shared reset-worker state. The private
desktop bus is also stopped and its socket removed when the viewer closes.
