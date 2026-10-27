# v6.1.2 — sliding navigation selection

Replaces the previous page-lift transition with one persistent selection pill
per navigation rail. Manual booking/History, the admin bottom menu and the
Telegram mini-app bottom menu all move the pill horizontally to the selected
button. The indicator follows measured button positions and sizes, so it works
with both equal-width mobile items and labels that change width.

The pill uses a darker teal glass fill, defined border and shadow for separation
from the wallpaper. Active text is darker/bolder; individual active backgrounds
are removed so there is only one moving highlight. Content does not remount or
slide while forms are being edited. Option-expansion and button feedback remain.

ResizeObserver, viewport resize and font readiness keep the pill aligned. The
first selection is placed immediately, rapid selection changes retarget the same
CSS transform, and reduced-motion users get an immediate selection change.
Reduced-transparency preferences use a solid indicator.

Client/server builds and diff checks pass. Physical Android/iOS rendering has
not been verified in this execution environment. On deployment, check Home to
Reports and back, Manual booking to History and back, screen rotation, keyboard
focus and reduced-motion mode. Payments, credentials, timers and data are unchanged.
