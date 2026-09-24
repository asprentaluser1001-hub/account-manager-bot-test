# Account Manager + Telegram test bot

This is an isolated copy of the supplied account manager. **Use sample accounts only.** It will not visit Flingster, collect money, or send a real QR. The original source is untouched.

## What the test demonstrates

- In the bot, the customer chooses 1, 2 or 3 hours, then taps **Simulate payment claim**. The bot reports a **claim**, never a confirmed payment.
- The admin receives a claim, chooses one available sample account and approves it. This reserves the account, schedules a reset from the moment of approval, and attempts to send the test credentials to the customer.
- Failed Telegram delivery leaves the account reserved and marks the order for attention.
- The admin page shows test orders, revenue totals, available accounts, expiry and reset status. The admin can also create sample orders directly when no bot token is available.
- A scheduled reset changes only the sample password. On success the account becomes available again. If reset fails, it stays unavailable.

## Run locally

Requires Node.js 24 or newer. In `server`, install packages with `npm ci --ignore-scripts`, copy `.env.example` to `.env` and replace `ADMIN_PASSWORD` with a unique password of at least 12 characters and `JWT_SECRET` with a random secret of at least 32 characters. Keep `SANDBOX_MODE=true` and set `DB_PATH=./test.db`.

Build the dashboard from `client` using `npm ci --ignore-scripts` and `npm run build`. Build the backend in `server` with `npm run build`, then run `npm start`. Open the server's local address (port 4000 by default). Do not expose this test server publicly. No real credentials should be entered.

To test Telegram, create a new bot and set its token only in the server's `.env` as `TELEGRAM_BOT_TOKEN`. Start the server and send `/id` to the bot from your admin account. Set that number as `TELEGRAM_ADMIN_ID`, restart, and open the bot from a separate customer test account. Admin `/stock` reports available sample IDs. Protect the token and the admin ID.

The sample prices are ₹100, ₹190, and ₹270 for 1, 2, and 3 hours respectively. These are **test figures**, not an approved live price list. The dashboard's revenue is synthetic.

## Live integration boundaries

Telegram requires Stars for digital services sold through a bot. A QR image in the bot would not be a compliant production checkout. There is deliberately no real QR, payment provider, webhook, or payment verification in this copy.

The source owner must obtain permission to sell access to the external service. The sample reset neither logs into nor changes any external account. The existing browser automation is present in the duplicated source for review, but sandbox mode always takes the synthetic reset path.

Before any live system: secure merchant approval and service rights; verify payment from provider records, idempotently; protect credentials at rest and in transit; test what external password rotation does to active sessions; and design refund and recovery paths for failed deliveries and resets.
