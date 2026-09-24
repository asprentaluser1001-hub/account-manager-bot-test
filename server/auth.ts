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
const TOKEN_TTL = '7d';

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { password } = req.body || {};

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured: ADMIN_PASSWORD missing' });
  }
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_TTL });
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
    jwt.verify(token, JWT_SECRET);
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
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters' });
  }
  if (currentPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }

  // Find and update .env file.
  const envCandidates = [
    path.join(__dirname, '..', '.env'),       // prod: server/dist -> server/.env
    path.join(__dirname, '.env'),             // dev: server/.env
  ];
  const envPath = envCandidates.find((p) => fs.existsSync(p));

  if (!envPath) {
    return res.status(500).json({ error: '.env file not found — update ADMIN_PASSWORD manually' });
  }

  try {
    let content = fs.readFileSync(envPath, 'utf8');
    if (content.includes('ADMIN_PASSWORD=')) {
      content = content.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${newPassword}`);
    } else {
      content += `\nADMIN_PASSWORD=${newPassword}\n`;
    }
    fs.writeFileSync(envPath, content, 'utf8');

    // Update in-process so the new password works immediately (no restart needed).
    process.env.ADMIN_PASSWORD = newPassword;
    ADMIN_PASSWORD = newPassword;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `Failed to update .env: ${msg}` });
  }

  return res.json({ ok: true, message: 'Admin password updated. You will be logged out.' });
});
