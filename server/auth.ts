import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

/**
 * Simple single-password admin auth.
 * - POST /api/login  { password } -> { token }
 * - adminAuth middleware guards protected routes via Bearer token.
 */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL = process.env.V3_PREVIEW === 'true' ? '12h' : '7d';
const failedLogins = new Map<string,{count:number;until:number}>();

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { password } = req.body || {};
  const key=req.ip||'unknown',now=Date.now(),attempt=failedLogins.get(key);
  if(process.env.V3_PREVIEW==='true'&&attempt&&attempt.count>=8&&attempt.until>now)return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured: ADMIN_PASSWORD missing' });
  }
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (password !== ADMIN_PASSWORD) {
    if(process.env.V3_PREVIEW==='true')failedLogins.set(key,{count:attempt&&attempt.until>now?attempt.count+1:1,until:now+15*60_000});
    return res.status(401).json({ error: 'Wrong password' });
  }
  failedLogins.delete(key);

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET + ADMIN_PASSWORD, { expiresIn: TOKEN_TTL });
  return res.json({ token });
});

/**
 * Middleware: require a valid admin Bearer token.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    jwt.verify(token, JWT_SECRET + ADMIN_PASSWORD);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * POST /api/change-admin-password
 * Body: { currentPassword, newPassword }
 * Verifies current password, updates .env and process.env in-place.
 * Protected by adminAuth.
 */
authRouter.post('/change-admin-password', adminAuth, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return res.status(400).json({ error: 'currentPassword is required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12 || /[\r\n]/.test(newPassword)) {
    return res.status(400).json({ error: 'newPassword must be at least 12 characters and contain no line breaks' });
  }
  if (currentPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }

  // Find and update .env file.
  const envFile = process.env.V3_PREVIEW === 'true' ? '.env.v3' : '.env';
  const envCandidates = [
    path.join(__dirname, '..', envFile),
    path.join(__dirname, envFile),
  ];
  const envPath = envCandidates.find((p) => fs.existsSync(p));

  if (!envPath) {
    return res.status(500).json({ error: `${envFile} file not found — update ADMIN_PASSWORD manually` });
  }

  try {
    let content = fs.readFileSync(envPath, 'utf8');
    if (content.includes('ADMIN_PASSWORD=')) {
      content = content.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${newPassword}`);
    } else {
      content += `\nADMIN_PASSWORD=${newPassword}\n`;
    }
    const temporaryPath = `${envPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, envPath);

    // Update in-process so the new password works immediately (no restart needed).
    process.env.ADMIN_PASSWORD = newPassword;
    ADMIN_PASSWORD = newPassword;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to update .env: ${msg}` });
  }

  return res.json({ ok: true, message: 'Admin password updated. You will be logged out.' });
});
