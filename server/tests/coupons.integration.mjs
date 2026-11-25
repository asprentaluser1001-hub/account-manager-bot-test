import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';

const require = createRequire(import.meta.url);

test('admin codes book exactly one free slot without the payment gateway', async () => {
  process.env.DB_PATH = ':memory:';
  process.env.V3_PREVIEW = 'false';
  process.env.JWT_SECRET = 'integration-test-secret-at-least-thirty-two-characters';
  delete process.env.IMB_API_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  const {db} = require('../dist/db.js');
  const {checkoutRouter, paymentSettingsRouter} = require('../dist/routes/checkout.js');
  const {summary} = require('../dist/lib/testOrders.js');
  const app = require('express')();
  app.use('/checkout', checkoutRouter);
  app.use('/admin', paymentSettingsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;
  const adminToken = require('jsonwebtoken').sign({admin: true}, process.env.JWT_SECRET);
  const admin = {Authorization: `Bearer ${adminToken}`};
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
  const newToken = () => randomBytes(32).toString('hex');

  try {
    assert.equal((await post('/admin/coupons', {hours: 1})).status, 401);
    assert.equal((await post('/admin/coupons', {hours: 4}, admin)).status, 400);
    const oneHour = await (await post('/admin/coupons', {hours: 1}, admin)).json();
    const twoHours = await (await post('/admin/coupons', {hours: 2}, admin)).json();
    assert.equal(oneHour.value, 100);
    assert.equal(twoHours.value, 150);
    assert.notEqual(oneHour.code, twoHours.code);

    const request = {name: 'Sample customer', code: twoHours.code.toLowerCase(), retryToken: newToken()};
    assert.equal((await post('/checkout/redeem', {...request, code: 'FR-' + 'A'.repeat(24)})).status, 400);
    assert.equal((await post('/checkout/redeem', request)).status, 400);
    const empty = await (await fetch(base + '/admin/coupons', {headers: admin})).json();
    assert.equal(empty.coupons.find(coupon => coupon.id === twoHours.id).order_id, null);

    db.prepare('INSERT INTO accounts (id, name, email, password, created_at) VALUES (?,?,?,?,?)')
      .run('sample', 'Sample', 'sample@example.invalid', 'sample-password', new Date().toISOString());
    const now = Date.now();
    db.prepare("INSERT INTO booking_slots (order_id,account_id,starts_at,ends_at,status,kind) VALUES (?,?,?,?,'reserved','advance')")
      .run('future-slot', 'sample', new Date(now + 90 * 60_000).toISOString(), new Date(now + 3 * 3600_000).toISOString());
    assert.equal((await post('/checkout/redeem', request)).status, 400, 'cannot overlap an existing reservation');
    db.prepare("DELETE FROM booking_slots WHERE order_id='future-slot'").run();

    const competing = {...request, retryToken: newToken()};
    const responses = await Promise.all([post('/checkout/redeem', request), post('/checkout/redeem', competing)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
    const winner = responses[0].status === 201 ? request : competing;
    const booked = await responses.find(response => response.status === 201).json();
    assert.equal(booked.amount, 0);
    assert.equal(booked.hours, 2);
    assert.equal(booked.status, 'delivered');
    assert.equal('payment_url' in booked, false);
    assert.equal((await post('/checkout/redeem', {...request, retryToken: newToken()})).status, 400);
    const retry = await post('/checkout/redeem', winner);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), booked);

    const orderUrl = base + '/checkout/orders/' + booked.orderId;
    assert.equal((await fetch(orderUrl + '?token=wrong')).status, 404);
    const order = await (await fetch(orderUrl + '?token=' + booked.accessToken)).json();
    assert.equal(order.credentials.email, 'sample@example.invalid');
    assert.equal(Date.parse(order.expires_at) - Date.parse(order.approved_at), 2 * 3600_000);
    assert.equal(db.prepare('SELECT run_at FROM auto_reset_schedule WHERE account_id=?').get('sample').run_at, order.expires_at);
    assert.equal(summary().bookings, 1);
    assert.equal(summary().sales, 0);
    assert.equal(summary().revenue, 0);

    const history = await (await fetch(base + '/admin/coupons', {headers: admin})).json();
    assert.equal(history.coupons.find(coupon => coupon.id === twoHours.id).order_id, booked.orderId);
    assert.equal(history.coupons.find(coupon => coupon.id === oneHour.id).order_id, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
