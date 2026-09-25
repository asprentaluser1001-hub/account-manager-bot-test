import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import { authRouter } from './auth';
import { accountsRouter, historyRouter } from './routes/accounts';
import { startAutoResetScheduler } from './lib/autoResetScheduler';
import './db'; // initialize the database on startup
import { testOrdersRouter } from './routes/testOrders';
import { startTestBot } from './lib/telegramBot';
import { db } from './db';
import {botSettingsRouter} from './routes/botSettings';
import {checkoutRouter,paymentSettingsRouter} from './routes/checkout';
import {pushRouter} from './routes/push';

const sandboxMode = process.env.SANDBOX_MODE === 'true';
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12 || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Configure strong ADMIN_PASSWORD and JWT_SECRET before starting.');
// Demo accounts are created only in the explicit sample-only mode.
if (sandboxMode && (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as {n:number}).n === 0) {
 for(let n=1;n<=3;n++) db.prepare('INSERT INTO accounts (id,name,email,password,sold,sold_until,last_reset_at,created_at) VALUES (?,?,?,?,0,NULL,NULL,?)').run(`sample-${n}`,`Sample ID ${n}`,`sample${n}@example.invalid`,`TEST-ONLY-${n}-${Date.now()}`,new Date().toISOString());
}
const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use('/api/bot-settings', botSettingsRouter);
app.use('/api/checkout', checkoutRouter);
app.use('/api/payment-settings', paymentSettingsRouter);
app.use('/api/push', pushRouter);
app.use(express.json({limit:'256kb'}));

// API routes
app.use('/api', authRouter);              // POST /api/login
app.use('/api/accounts', accountsRouter); // account CRUD + reset + auto-reset
app.use('/api/history', historyRouter);   // reset history
app.use('/api/test-orders', testOrdersRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve the built React client (client/dist) if present.
// Works both in dev (ts-node: __dirname = server) and prod
// (compiled: __dirname = server/dist), so check both candidate paths.
const clientDistCandidates = [
  path.join(__dirname, '..', '..', 'client', 'dist'), // prod: server/dist -> client/dist
  path.join(__dirname, '..', 'client', 'dist'),       // dev:  server      -> client/dist
];
const clientDist = clientDistCandidates.find((p) => fs.existsSync(p));
if (clientDist) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Account Manager running on port ${PORT}`);
  startAutoResetScheduler();
  startTestBot();
});
