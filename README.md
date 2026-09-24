# Account Manager

A small, **standalone** dashboard to manage VIP accounts and reset their
passwords on the external site (Flingster) via headless Chromium.

- Completely independent of FlingBoss — no shared database, no shared code.
- Stores accounts locally in **SQLite** (a single `data.db` file on the VPS).
- Single admin password to log in.
- "Reset Password" button on each account launches headless Chromium, logs in,
  changes the password to a new random one, and saves it back to SQLite (also
  shown in the dashboard).

```
account-manager/
  server/   Express + SQLite + Playwright API
  client/   React dashboard (built into client/dist, served by the server)
```

## Requirements on the VPS

- Node.js 18+ (20+ recommended)
- ~1 GB free RAM (Chromium needs memory to run)
- Standard build tools for `better-sqlite3` (usually already present; on a
  fresh Ubuntu: `sudo apt-get install -y build-essential python3`)

## Local development

Two terminals:

```bash
# Terminal 1 — backend
cd account-manager/server
cp .env.example .env        # then edit ADMIN_PASSWORD + JWT_SECRET
npm install                 # also downloads Chromium (postinstall)
npm run dev                 # http://localhost:4000

# Terminal 2 — frontend (proxies /api to :4000)
cd account-manager/client
npm install
npm run dev                 # http://localhost:5173
```

## Deploy on a VPS (single server, production)

Copy the `account-manager/` folder to the VPS (e.g. `/var/www/account-manager`),
then:

```bash
# 1. Build the client
cd /var/www/account-manager/client
npm install
npm run build               # produces client/dist

# 2. Set up + build the server
cd /var/www/account-manager/server
npm install                 # installs deps + downloads Chromium
cp .env.example .env
#   edit .env:
#     PORT=4000
#     ADMIN_PASSWORD=<a strong password>
#     JWT_SECRET=<a long random string>
#     DB_PATH=./data.db
npm run build               # compiles TypeScript to dist/

# 3. Run it (kept alive with PM2)
npm install -g pm2          # if not already installed
pm2 start dist/index.js --name account-manager
pm2 save
```

The server serves both the API (`/api/...`) and the built dashboard (`/`) on
the same `PORT`. Open `http://<vps-ip>:4000` and log in with `ADMIN_PASSWORD`.

If Chromium fails to launch on a fresh server, install its system libraries:

```bash
cd /var/www/account-manager/server
npx playwright install-deps chromium
```

## Putting it behind a domain (optional)

Point Nginx at the server port, e.g.:

```nginx
server {
  server_name accounts.example.com;
  location / {
    proxy_pass http://localhost:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Then add HTTPS with `certbot --nginx -d accounts.example.com`.

## Data & backups

All data lives in `server/data.db` (SQLite). To back up, just copy that file.
To reset everything, stop the server and delete `data.db*`.

## Notes

- Passwords are stored in plain text on purpose — the whole point is to view
  and use the external-site credentials. Protect the dashboard with a strong
  `ADMIN_PASSWORD` and HTTPS.
- The password-reset selectors target Flingster's current login / change-password
  UI. If the site changes its markup, update the selectors in
  `server/lib/passwordReset.ts`.
