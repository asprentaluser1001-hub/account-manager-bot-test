# v6.1.0 — Pearl Aqua

Uses the user's supplied aqua/pearl artwork unchanged as a local JPEG wallpaper.
The 119 KB asset ships with the frontend; it requires no external image service.

The new CSS layer covers admin/login, Telegram mini app and customer checkout:
translucent pearl cards, aqua selection states, teal primary actions and dark
readable text. Fixed decorative backgrounds do not intercept taps. Solid-panel
fallbacks cover unsupported blur and reduced-transparency preferences. Error,
unavailable, pending and successful payment states retain distinct colors.

The underlying v6 monthly reporting and v6.0.1 IMB external-browser handoff are
included. Payment verification, booking timers, account delivery, credentials,
webhook endpoints and gateway selection behavior are unchanged by this theme.

Frontend build passes. Automated browser preview could not run in the restricted
execution environment; verify on Android/iPhone after deployment, including
scrolling/navigation and payment-status contrast. No new runtime packages are needed.

Back up current dist folders and settings before upgrading. Fetch release/v6.1.0,
build the client, restart the existing service if updating the backend package
version too, then reopen/refresh the admin and mini app. Keep .env and the live
database untouched. Restoring the immediately prior dist builds rolls back the
visual update; never restore an old database over new customer bookings.
