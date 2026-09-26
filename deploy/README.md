# V3 preview deployment

Use this directory only for the isolated developer preview.

1. Clone the repository into /opt/flingroulette-v3.
2. Check out v3/developer-preview.
3. Build client and server.
4. Copy server/.env.v3.example to /opt/flingroulette-v3/server/.env.v3.
5. Set a preview-only admin password and JWT secret.
6. Keep V3_PREVIEW=true, SANDBOX_MODE=true, PAYMENT_MODE=mock, and IMB_API_TOKEN empty.
7. Create /opt/flingroulette-v3/server/data owned by the preview service user.
8. Install deploy/systemd/flingroulette-v3-preview.service as a separate unit.
9. Put the preview hostname in PUBLIC_CHECKOUT_URL.
10. Configure a separate HTTPS/Cloudflare route to port 4400.
11. Verify /api/health, banner, sample-only validation, mock checkout, and service isolation.

Do not point this service at the V2 directory, V2 .env, V2 database, V2 bot, or production URL.
