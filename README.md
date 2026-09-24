# Account Manager + Telegram booking sandbox

**This repository is a test project.** It uses sample accounts and simulated payment claims; it does not collect money or reset external accounts. Follow [TESTING.md](TESTING.md) for the correct setup. The older deployment instructions below describe the original account manager and do not apply to the test bot.

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

