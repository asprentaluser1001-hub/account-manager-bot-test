import {randomBytes, randomUUID} from 'crypto';
import {db} from '../db';
import {assignOrder, availableAccounts, createWebOrder, getOrder, markDelivered, PRICES} from './testOrders';

type Coupon = {
  id: string;
  code: string;
  hours: number;
  value: number;
  created_at: string;
  redeemed_at: string | null;
  order_id: string | null;
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
    retry_token TEXT
  );
`);

export function listCoupons(): Coupon[] {
  return db.prepare(`SELECT id, code, hours, value, created_at, redeemed_at, order_id
    FROM checkout_coupons ORDER BY created_at DESC LIMIT 200`).all() as Coupon[];
}

export function generateCoupon(hours: number): Coupon {
  if (!Object.prototype.hasOwnProperty.call(PRICES, hours)) throw new Error('Choose a valid checkout plan.');
  const coupon: Coupon = {
    id: randomUUID(),
    code: 'FR-' + randomBytes(12).toString('hex').toUpperCase(),
    hours,
    value: PRICES[hours],
    created_at: new Date().toISOString(),
    redeemed_at: null,
    order_id: null,
  };
  db.prepare('INSERT INTO checkout_coupons (id, code, hours, value, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(coupon.id, coupon.code, coupon.hours, coupon.value, coupon.created_at);
  return coupon;
}

export function redeemCoupon(code: string, name: string, customerKey: string, retryToken: string) {
  code = code.trim().toUpperCase();
  if (!/^FR-[A-F0-9]{24}$/.test(code)) throw new Error('Enter a valid coupon code.');
  if (!/^[a-f0-9]{64}$/.test(retryToken)) throw new Error('Could not verify this checkout attempt. Please reload and try again.');

  return db.transaction(() => {
    const coupon = db.prepare('SELECT * FROM checkout_coupons WHERE code = ?').get(code) as
      (Coupon & {retry_token: string | null}) | undefined;
    if (!coupon) throw new Error('Coupon code was not found.');
    if (coupon.order_id) {
      const previous = coupon.retry_token === retryToken ? getOrder(coupon.order_id) : undefined;
      if (previous?.access_token) return {order: previous, accessToken: previous.access_token, created: false};
      throw new Error('This coupon has already been redeemed.');
    }

    const booking = createWebOrder(name, '', coupon.hours, customerKey, coupon.id);
    assignOrder(booking.order.id, availableAccounts()[0].id);
    markDelivered(booking.order.id);
    db.prepare('UPDATE checkout_coupons SET redeemed_at = ?, order_id = ?, retry_token = ? WHERE id = ?')
      .run(new Date().toISOString(), booking.order.id, retryToken, coupon.id);
    return {...booking, order: getOrder(booking.order.id)!, created: true};
  })();
}
