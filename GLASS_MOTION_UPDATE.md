# v6.1.1 — more transparent glass and subtle motion

- Shared card opacity changes from 44% to 28%; navigation glass from 40% to 29%.
  Input surfaces, dark text, status colors and reduced-transparency fallbacks remain.
- Admin tabs and Telegram mini-app tabs enter with a 230 ms fade/9 px rise.
  Animation is applied to the mounted content with the Web Animations API, so
  it does not remount form controls, reset local state, or repeat network requests.
- Rapid tab switches cancel the previous animation. Navigation stays in place.
- Buttons and plan options use short press feedback; pointer hover applies only
  to devices with hover support. Disabled controls have no press animation.
- Account add/scheduling/sold controls and FAQ answers enter in 190 ms.
- Reduced-motion users get instant transitions and no added button movement.
  There is no continuously animated wallpaper or blur animation.

Frontend and backend build checks pass. Rendered-device verification is still
required; the session's automated browser preview is unavailable. No payment,
API-key, webhook, booking timer or database changes are included in this update.
