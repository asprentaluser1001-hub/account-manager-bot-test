# v6.2.1 — full-width bottom blur, no dock

A separate viewport-wide decorative layer replaces the rounded navigation
container on mobile admin and in the Telegram mini app. Blur/tint is strongest
at the bottom and masked to transparency toward the top. It reaches both screen
edges and the safe area. Icons float above it with the existing sliding glow.

The navigation's background, border, corner radius, box shadow and own backdrop
blur are removed. The blur layer is outside navigation, so its edges do not form
a dock. It has pointer-events:none and sits below navigation and above scrolling
content. Existing bottom padding lets content scroll clear of the controls.
Desktop admin top navigation is unchanged. Unsupported mask/blur uses a simple
fading tint; reduced-transparency mode uses a solid full-width backdrop.

Frontend build and diff checks pass. Physical device appearance still needs
verification. This is a frontend-only update: keep .env and the live database,
back up client/dist, switch to release/v6.2.1, build the client, then close/reopen
the dashboard and mini app. A backend restart is not required for these changes.
