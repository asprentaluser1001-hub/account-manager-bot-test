import {Router, json, raw} from 'express';
import {randomUUID} from 'crypto';
import {db} from '../db';
import {adminAuth} from '../auth';

const DEFAULT_ACCENT = '#086b78';
db.exec(`CREATE TABLE IF NOT EXISTS appearance_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  accent_color TEXT NOT NULL,
  wallpaper BLOB,
  wallpaper_type TEXT,
  revision TEXT NOT NULL
)`);
db.prepare('INSERT OR IGNORE INTO appearance_settings (id, accent_color, revision) VALUES (1, ?, ?)')
  .run(DEFAULT_ACCENT, randomUUID());

function current() {
  return db.prepare('SELECT accent_color, wallpaper IS NOT NULL AS has_wallpaper, revision FROM appearance_settings WHERE id = 1').get() as {accent_color:string;has_wallpaper:number;revision:string};
}
function config() {
  const row = current();
  return {accentColor:row.accent_color, wallpaperUrl:row.has_wallpaper ? `/api/appearance/wallpaper?v=${row.revision}` : null, revision:row.revision};
}

export const appearanceRouter = Router();
// Only public visual settings are exposed, never admin credentials or account data.
appearanceRouter.get('/', (_req, res) => res.set('Cache-Control', 'no-store').json(config()));
appearanceRouter.get('/wallpaper', (_req, res) => {
  const row = db.prepare('SELECT wallpaper, wallpaper_type, revision FROM appearance_settings WHERE id = 1').get() as {wallpaper:Uint8Array|null;wallpaper_type:string|null;revision:string};
  if (!row.wallpaper) return res.sendStatus(404);
  return res.set({'Content-Type':row.wallpaper_type!, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'ETag':`"${row.revision}"`}).send(Buffer.from(row.wallpaper));
});

appearanceRouter.use(adminAuth);
appearanceRouter.patch('/', json({limit:'2kb'}), (req, res) => {
  const color = req.body?.accentColor;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({error:'Choose a valid six-digit hex color.'});
  db.prepare('UPDATE appearance_settings SET accent_color = ?, revision = ? WHERE id = 1').run(color.toLowerCase(), randomUUID());
  return res.json(config());
});
appearanceRouter.post('/wallpaper', raw({type:['image/png','image/jpeg','image/webp'], limit:'3mb'}), (req, res) => {
  const bytes:unknown = req.body;
  const type = req.get('Content-Type')?.split(';')[0];
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return res.status(400).json({error:'Upload a PNG, JPEG or WebP image under 3 MB.'});
  const valid = type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) return res.status(400).json({error:'The file does not match its image format.'});
  db.prepare('UPDATE appearance_settings SET wallpaper = ?, wallpaper_type = ?, revision = ? WHERE id = 1').run(bytes, type, randomUUID());
  return res.json(config());
});
appearanceRouter.delete('/wallpaper', (_req, res) => {
  db.prepare('UPDATE appearance_settings SET wallpaper = NULL, wallpaper_type = NULL, revision = ? WHERE id = 1').run(randomUUID());
  return res.json(config());
});
appearanceRouter.delete('/', (_req, res) => {
  db.prepare('UPDATE appearance_settings SET accent_color = ?, wallpaper = NULL, wallpaper_type = NULL, revision = ? WHERE id = 1').run(DEFAULT_ACCENT, randomUUID());
  return res.json(config());
});
