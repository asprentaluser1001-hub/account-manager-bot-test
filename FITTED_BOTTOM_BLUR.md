# v6.2.2 — stronger bottom blur and fitted Active badge

The decorative bottom layer is measured from the navigation's current top edge
plus a 34 px fade allowance. This shortens the blur to the requested area above
the icons instead of fading higher booking cards. A 38 px backdrop blur and
stronger pearl tint obscure the scrolling content behind the navigation. The
layer remains full-width, square-edged, pointer-events:none, with a soft masked
top boundary. It recalculates on navigation/viewport/font changes and retains
unsupported-mask and reduced-transparency fallbacks.

The green Active badge was stretching to its parent flex row's height. The
booking row now aligns to the start; the badge has an explicit content-sized
inline-flex layout, no flex growth/shrink, a pale aqua fill and compact border.
Long assigned-email text can wrap without pushing the badge out of the card.

Frontend build and diff checks pass. The exact fade position still needs a phone
check because rendered-device preview is unavailable in the execution environment.
No payment, database, credential, account-reset or booking logic changes.

Frontend-only deployment: back up client/dist and the current commit, fetch
release/v6.2.2, switch to it, build the client, then close/reopen the admin and
Telegram mini app. No server restart is needed for the UI changes.
