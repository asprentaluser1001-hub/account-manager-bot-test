# Account Manager + Telegram booking sandbox

**This repository is a test project.** It uses sample accounts and simulated payment claims; it does not collect money or reset external accounts. Follow [TESTING.md](TESTING.md) for the correct setup.

## Quick start on a computer or test VPS

You need Node.js 24 or later. On an iPhone, you can use an SSH app to control a VPS; GitHub itself cannot run the bot.

```bash
git clone https://github.com/asprentaluser1001-hub/account-manager-bot-test.git
cd account-manager-bot-test/client
npm ci --ignore-scripts
npm run build
cd ../server
npm ci --ignore-scripts
cp .env.example .env
```

Edit `server/.env`: give `ADMIN_PASSWORD` a unique value of at least 12 characters, `JWT_SECRET` a random value of at least 32 characters, and keep `SANDBOX_MODE=true`. For Telegram testing, put your new BotFather token in `TELEGRAM_BOT_TOKEN`. Never paste the token in chat or upload `.env` to GitHub.

```bash
npm run build
npm start
```

Open `http://localhost:4000` on the computer running the server and log in with `ADMIN_PASSWORD`. Keep port 4000 private. To test the bot, send `/id` to your bot from your admin Telegram account; add the numeric ID to `TELEGRAM_ADMIN_ID` in `.env` and restart. From a separate customer Telegram account, send `/start`, choose a duration and tap **Simulate payment claim**. Approve the sample order from the buttons sent to your admin account. Check orders and history on the dashboard.


## Customer menu update

The existing password-protected dashboard at `/` supports adding, editing and deleting sample IDs and viewing booking history. Sandbox IDs must use a name beginning with `Sample` and an email ending in `@example.invalid`.

The bot now checks availability before showing plans and creating an order; approval checks it again atomically. An unpaid order does not reserve inventory. Times start at admin approval. Rates are 1 hour ₹100, 2 hours ₹150, 3 hours ₹200, 7 days ₹750, and 30 days ₹1800. A month means exactly 30 days.

From the configured admin Telegram account:
- Send `/supportuser your_username` to set the direct support button (your public username, not the bot username).
- Send a photo or video with caption `/proof` to save it. Use `/clearproofs` to remove the set. Upload only media intended for customers.
- New visitors get the rate list and saved media. Returning customers can use **Rates & proofs** to view them again. Settings and visitor records survive restarts.

The project also includes an independent customer checkout at `/checkout`. Set `PUBLIC_CHECKOUT_URL` to the public HTTPS checkout URL; when it is set, the bot sends a payment-page link after a customer chooses a plan. The bot does not send the QR image. On the website, the admin can set the brand name, payee name, UPI ID, support contact and upload a QR image. Customers can download that QR, open their UPI app with the exact amount, upload a payment screenshot and optionally enter the transaction reference. The order then appears in **Sales & bookings** for manual approval. Credentials are revealed only on the customer's private order page after an account is assigned.

Payment screenshots are claims, not bank verification. This repository remains a sandbox until the seller is approved by a payment provider and a verified payment webhook replaces manual proof review. Telegram requires Stars for digital goods sold inside bots: https://core.telegram.org/bots/payments-stars . Keep the website purchase flow separate from Telegram.

To update an existing test VPS, stop its running test process, run `git pull --ff-only` in the repository, rebuild the client and server with `npm run build` in each directory, then run `npm start` from `server`. Existing `.env` and database files are retained. Dashboard access from a phone still needs a private tunnel or secured deployment; localhost in phone Safari refers to the phone, not the VPS.

## Admin panel: screenshots and support

The dashboard now includes a **Bot settings** section. Upload any number of PNG/JPEG/WebP screenshots (maximum 3 MB each) and MP4 videos (maximum 15 MB each), remove individual proofs, and set the support username there. Uploads are sent to the configured admin Telegram chat for review and their Telegram file IDs are stored in SQLite. The admin must have started the bot. Telegram must be reachable for uploads. The panel lists saved screenshots by number; view the actual images in the admin chat.

The booking overview includes total orders, distinct customers, approved test sales and test revenue. Amounts represent approved simulated orders, not verified earnings. Customer availability checks update the existing menu and expose only available/unavailable; detailed stock remains admin-only.

## Bot navigation

Telegram displays its own **Start** button before a customer first talks to a bot; bots cannot message users simply when they reopen a conversation. After starting, customers can use the Telegram command menu (`/home`), or the **Home** button on booking screens. Saved proof media is sent in groups of up to ten items per Telegram album. The upgrade migrates existing saved screenshots automatically; keep the `server/test.db` database when updating the VPS.


## Account recovery, migration and complimentary time

- **Accounts → Lost password / stuck reset / remove ID**: stop retries and quarantine an ID, save a recovered current Flingster password and queue a reset, or permanently remove an unusable ID after typing its name. Recovery ends linked bookings and keeps their history. Removal does not change the external password.
- Password changes are confirmed by logging in with the new password in a fresh Chromium profile. If confirmation fails, the last proposed password remains available in the admin recovery panel; the prior stored password is preserved. Check which password works before retrying.
- **Bookings → Migrate ID**: select an available replacement. The booking keeps its remaining time and associated extension records. The old ID stays reserved while its password reset is queued. If Telegram delivery fails or the customer has no linked Telegram ID, share the replacement credentials privately from Accounts.
- **Bookings → +10 / +15 / +30 min free**: complimentary time updates the booking, account and password reset timer together. It does not add sales or revenue. Time cannot be added after expiry or once resetting starts.
- **More → Bot settings → Customer mini app URL**: save the customer-facing HTTPS URL. The welcome message invites users to check the mini app and includes an **Open mini app** button. `PUBLIC_MINI_APP_URL` can also configure it; `PUBLIC_CHECKOUT_URL` is the fallback. This is shown on `/start` or Home; it is not an unsolicited broadcast.

After deploying the updated client and server, restart the existing service. The server adds the recovery-password column to the existing SQLite database automatically. Back up the live database before upgrading. These changes do not recover a forgotten external-site password automatically.

Validation: build `server` and `client` with `npm run build`, then run `node --test tests/*.mjs` from `server`. The recovery suite uses only temporary databases, sample credentials and a mocked external browser; it never changes live customer passwords.
