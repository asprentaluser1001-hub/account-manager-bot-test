# FlingRoulette V4 preview rollout

Install `feature/v4-miniapp-admin` into a dedicated `/opt/flingroulette-v4` checkout, using the dedicated `flingroulette-v4-preview.service` and port 4500. Route a separate HTTPS preview hostname to this service. Leave existing production and V3 preview directories and services alone.

Copy `server/.env.v4.example` to `server/.env.v4`; set a unique preview password and JWT secret. Keep `V3_PREVIEW=true`, `SANDBOX_MODE=true`, `PAYMENT_MODE=mock`, `IMB_API_TOKEN=` and `DB_PATH=/opt/flingroulette-v4/server/data/v4-preview.db`. Create only sample accounts and use a *separate test bot token* for `TELEGRAM_BOT_TOKEN` and its test admin ID for `TELEGRAM_ADMIN_ID`. Set `PUBLIC_CHECKOUT_URL` and `TELEGRAM_MINI_APP_URL` to the same preview HTTPS hostname (the Mini App path must be `/miniapp`). If bot credentials are blank, the web preview works but the Telegram Mini App cannot authenticate or submit extension alerts.

Build client and server; give the preview user ownership of its data directory, install and start the separate systemd service. Check `/api/health` and open the preview hostname, then launch the Mini App via the *test bot* menu. Check: before booking a sample account, Quick Book is visible; after confirming a mock order and assigning a sample account, only the active card and extension request are shown. Verify that the preview admin receives the extension request and confirms mock payment before granting +50 min. Test with a second Telegram account to verify booking isolation.

Production promotion requires a separate rollout using production credentials, database backup, HTTPS URL and live payment verification. Never copy this preview environment or sample database to production.
