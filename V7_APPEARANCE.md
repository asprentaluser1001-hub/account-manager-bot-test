# FlingRoulette v7

This release starts from release/v6.2.3 and keeps the Pearl Aqua design by default. The separate Halloween release remains on hold.

## Appearance

Open More → Wallpaper to upload a PNG, JPEG or WebP image up to 3 MB, preview it, then apply it to admin, the customer mini app and checkout. Restore Pearl wallpaper resets only the image. Open More → Accent theme to choose a preset or custom six-digit hex color. Restore Pearl accent resets only the accent. Payment/error/success status meanings remain unchanged.

Appearance is stored in the existing SQLite database, including the uploaded image. No external image hosting or new environment variables are required. A saved change applies immediately on the current page, synchronizes other tabs on the same origin, and refreshes other open devices within 15 seconds or when they return to the foreground. Offline pages retain their last cached appearance. Anonymous visitors can read only the public visual configuration and wallpaper; all changes require existing admin authentication. SVG and mismatched image signatures are rejected.

## Less scrolling

More has expandable rows for Notifications, Wallpaper, Accent theme, Payments, Bot settings and Admin account. Bookings keeps the existing Manual booking / History tabs. Only inside History, Booking controls, Refund tracking, Booking history and Password reset history become expandable sections. One section per group opens at a time. Opened controls stay mounted when collapsed so unsaved edits survive opening another section. Controls load on first opening. Animations honor reduced-motion preferences; collapsed controls are hidden from keyboard focus and assistive technology.

## Deploy and verify

Build client and server with `npm run build` in each directory. Restart the existing server process to register `/api/appearance` and create its single-row settings table. Back up the SQLite database with your existing deployment procedure. Existing accounts, bookings, payments and reset jobs are not migrated or changed by this feature.

Run `node --test tests/appearance.integration.mjs` from server to verify public reads, protected writes, input and size limits, binary wallpaper delivery, persistence in a fresh process, and independent Pearl restoration. A client-only deployment cannot save appearance; deploy both builds together.

After both builds, run `node tests/appearance.browser.cjs` from server for the mobile UI checks. It uses an isolated temporary database and sample data, uploads an existing Pearl image, verifies mini app synchronization and restoration, and checks expandable sections and keyboard/reduced-motion behavior. It never contacts Telegram or a payment service. Use `CHROMIUM_PATH` to select an installed Chromium binary when needed; `APPEARANCE_SCREENSHOT_DIR` sets the output directory for Settings and History preview screenshots.

Version: 7.0.0. Build: 2026.10.31.2.
