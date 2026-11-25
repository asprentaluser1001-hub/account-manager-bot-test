import {randomBytes, randomUUID} from 'crypto';
import {db} from '../db';
import {assignOrder, createWebOrder, getOrder, markDelivered, PRICES} from './testOrders';
import {availability} from './v5Bookings';

type Coupon = {
  id: string;
  code: string;
  hours: number;
  value: number;
  created_at: string;
  redeemed_at: string | null;
  order_id: string | null;
  cancelled_at: string | null;
  bonus_minutes: number;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS checkout_coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    hours INTEGER NOT NULL,
    value INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    redeemed_at TEXT,
    order_id TEXT UNIQUE,
    retry_token TEXT,
    cancelled_at TEXT,
    bonus_minutes INTEGER NOT NULL DEFAULT 0
  );
`);

// v7.1.0 databases already have this table.
if (!(db.prepare('PRAGMA table_info(checkout_coupons)').all() as {name: string}[]).some(column => column.name === 'cancelled_at')) {
  db.exec('ALTER TABLE checkout_coupons ADD COLUMN cancelled_at TEXT');
}

if (!(db.prepare('PRAGMA table_info(checkout_coupons)').all() as {name: string}[]).some(column => column.name === 'bonus_minutes')) {
  db.exec('ALTER TABLE checkout_coupons ADD COLUMN bonus_minutes INTEGER NOT NULL DEFAULT 0');
}

export function listCoupons(): Coupon[] {
  return db.prepare(`SELECT id, code, hours, value, created_at, redeemed_at, order_id, cancelled_at, bonus_minutes
    FROM checkout_coupons ORDER BY created_at DESC LIMIT 200`).all() as Coupon[];
}

export function generateCoupon(hours: number, bonus=false): Coupon {
  if (!bonus && !Object.prototype.hasOwnProperty.call(PRICES, hours)) throw new Error('Choose a valid checkout plan.');
  const coupon: Coupon = {
    id: randomUUID(),
    code: (bonus ? 'FRB-' : 'FR-') + randomBytes(12).toString('hex').toUpperCase(),
    hours: bonus ? 0.5 : hours,
    value: bonus ? 0 : PRICES[hours],
    created_at: new Date().toISOString(),
    redeemed_at: null,
    order_id: null,
    cancelled_at: null,
    bonus_minutes: bonus ? 30 : 0,
  };
  db.prepare('INSERT INTO checkout_coupons (id, code, hours, value, created_at, bonus_minutes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(coupon.id, coupon.code, coupon.hours, coupon.value, coupon.created_at, coupon.bonus_minutes);
  return coupon;
}

export function cancelCoupon(id: string) {
  db.prepare(`UPDATE checkout_coupons SET cancelled_at = ?
    WHERE id = ? AND redeemed_at IS NULL AND order_id IS NULL AND cancelled_at IS NULL`)
    .run(new Date().toISOString(), id);
  const coupon = db.prepare(`SELECT id, code, hours, value, created_at, redeemed_at, order_id, cancelled_at, bonus_minutes
    FROM checkout_coupons WHERE id = ?`).get(id) as Coupon | undefined;
  return coupon;
}

export function createBonusCheckout(code: string, name: string, phone: string, hours: number, customerKey: string, retryToken: string) {
  code = code.trim().toUpperCase();
  if (!/^FRB-[A-F0-9]{24}$/.test(code)) throw new Error('Enter a valid 30-minute bonus coupon.');
  if (!/^[a-f0-9]{64}$/.test(retryToken)) throw new Error('Could not verify this checkout attempt.');
  return db.transaction(() => {
    const coupon = db.prepare('SELECT * FROM checkout_coupons WHERE code = ? AND bonus_minutes = 30').get(code) as (Coupon & {retry_token: string | null}) | undefined;
    if (!coupon || coupon.cancelled_at) throw new Error('This bonus coupon is unavailable.');
    if (coupon.order_id) {
      const previous = coupon.retry_token === retryToken ? getOrder(coupon.order_id) : undefined;
      if (previous?.access_token) return {order: previous, accessToken: previous.access_token, created: false};
      throw new Error('This coupon is already linked to a checkout. Resume payment on that order page.');
    }
    const booking = createWebOrder(name, phone, hours, customerKey, 'web', coupon.id, coupon.bonus_minutes);
    db.prepare('UPDATE checkout_coupons SET order_id = ?, retry_token = ? WHERE id = ?').run(booking.order.id, retryToken, coupon.id);
    return {...booking, created: true};
  })();
}

export function releaseFailedBonusCheckout(orderId: string) {
  db.prepare(`UPDATE checkout_coupons SET order_id = NULL, retry_token = NULL
    WHERE order_id = ? AND bonus_minutes > 0 AND redeemed_at IS NULL
    AND EXISTS (SELECT 1 FROM test_orders WHERE id = ? AND status = 'payment_gateway_error')`).run(orderId, orderId);
}

export function redeemCoupon(code: string, name: string, customerKey: string, retryToken: string) {
  code = code.trim().toUpperCase();
  if (!/^FR-[A-F0-9]{24}$/.test(code)) throw new Error('Enter a valid coupon code.');
  if (!/^[a-f0-9]{64}$/.test(retryToken)) throw new Error('Could not verify this checkout attempt. Please reload and try again.');

  return db.transaction(() => {
    const coupon = db.prepare('SELECT * FROM checkout_coupons WHERE code = ?').get(code) as
      (Coupon & {retry_token: string | null}) | undefined;
    if (!coupon) throw new Error('Coupon code was not found.');
    if (coupon.cancelled_at) throw new Error('This coupon has been cancelled.');
    if (coupon.order_id) {
      const previous = coupon.retry_token === retryToken ? getOrder(coupon.order_id) : undefined;
      if (previous?.access_token) return {order: previous, accessToken: previous.access_token, created: false};
      throw new Error('This coupon has already been redeemed.');
    }

    const booking = createWebOrder(name, '', coupon.hours, customerKey, 'web', coupon.id);
    const account = availability(coupon.hours).find(candidate => !candidate.used && !candidate.resetPending);
    if (!account) throw new Error('Currently unavailable. Please try again later.');
    assignOrder(booking.order.id, account.id);
    markDelivered(booking.order.id);
    db.prepare('UPDATE checkout_coupons SET redeemed_at = ?, order_id = ?, retry_token = ? WHERE id = ?')
      .run(new Date().toISOString(), booking.order.id, retryToken, coupon.id);
    return {...booking, order: getOrder(booking.order.id)!, created: true};
  })();
}
