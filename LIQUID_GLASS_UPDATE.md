# v6.2.0 — light glass controls and navigation shade

Styling update based on v6.1.3. Uses the same supplied Pearl Aqua wallpaper.

- Bottom navigation has a soft, blurred shade without the outlined capsule.
  Its persistent sliding selection is now a feathered aqua glow behind the icon.
- Add account, Reset password, primary actions and secondary controls have
  transparent pearl-glass surfaces, light reflective edges and dark teal labels.
- Shared major card opacity is reduced from 28% to 18%, and inputs from 72% to
  53%, letting more background color show through while keeping dark text.
- Payment/error/status colors and disabled actions retain their semantics.
- Solid fallbacks remain for unsupported backdrop blur and reduced-transparency
  preferences; existing reduced-motion and navigation behavior are preserved.

This is a CSS glass effect inspired by the requested appearance, not Apple's
native optical refraction implementation. No new animation loop or dependency.
Frontend build and diff checks pass; final contrast and appearance need checking
on actual Android/iPhone screens because automated preview is unavailable here.

Deploy by backing up the current client/dist and recording the current commit,
fetching release/v6.2.0, switching to that release, rebuilding the frontend and
reopening the dashboard/mini app. No server restart or database changes are needed
for the styling. API keys, bookings, timers and gateway selection stay unchanged.
