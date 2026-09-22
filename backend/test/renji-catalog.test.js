import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import nodemailer from 'nodemailer';

// Route imports also import db.js. Never let this test open the application's database.
process.env.DB_PATH = ':memory:';
const { db, initDb } = await import('../src/db.js');
const { registerRenjiRoutes } = await import('../src/renji-routes.js');
const { seedRenjiCatalog } = await import('../src/renji-catalog.js');
const { createToken } = await import('../src/auth.js');

test('RENJI photo catalog reserves exact variants, survives retries, and preserves order lifecycle', async (t) => {
  initDb();
  const business = db.prepare("SELECT * FROM establishments WHERE name = 'RENJI'").get();
  const legacyBefore = db.prepare('SELECT * FROM renji_stock WHERE establishment_id = ?').all(business.id);
  const messages = [];
  let failEmail = false;
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (message) => {
    if (failEmail) throw new Error('Simulated SMTP failure');
    messages.push(message);
  } }));
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    const previous = process.env[key];
    process.env[key] = 'isolated-test';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const app = express();
  app.use(express.json());
  registerRenjiRoutes(app, db, (req) => req.user.establishmentId);
  const server = await new Promise((resolve) => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const token = createToken({ role: 'admin', establishmentId: business.id });
  const base = `http://127.0.0.1:${server.address().port}/api/renji`;
  async function request(path, method = 'GET', body, authorization = token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const payload = (overrides = {}) => ({
    request_key: randomUUID(), customer_name: 'Cliente prueba', customer_cedula: '0000000000',
    customer_email: 'cliente@example.invalid', customer_city: 'Ambato', customer_address: 'Dirección de prueba',
    customer_phone: '0990000000', selection_type: 'pants', product_id: 'baggy-negro', pants_size: 'S', size: 'S', quantity: 1, ...overrides
  });
  const stock = (product, size) => db.prepare('SELECT quantity FROM renji_catalog_stock WHERE establishment_id = ? AND product_id = ? AND size = ?')
    .get(business.id, product, size).quantity;
  const registration = (id) => db.prepare('SELECT * FROM renji_registrations WHERE id = ?').get(id);
  const black = payload();

  await t.test('initial stock is exact and old collection is unavailable', async () => {
    const catalog = await request('/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.previous_collection.available, false);
    for (const [product, expected] of [['baggy-negro', [1, 4, 4, 2]], ['baggy-gris', [1, 2, 2, 1]]]) {
      const entry = catalog.body.products.find((item) => item.id === product);
      assert.deepEqual(entry.sizes.map((item) => item.quantity), expected);
      assert.match(entry.image_url, /^\/renji\/pantalon-/);
    }
    assert.equal((await request('/public-registrations', 'POST', payload({ product_id: '', selection_type: 'set' }))).status, 409);
    assert.equal((await request('/orders', 'POST', payload({ product_id: '', selection_type: 'set' }))).status, 409);
    for (const quantity of [0, -1, 1.5, 'abc', 1001]) {
      assert.equal((await request('/public-registrations', 'POST', payload({ quantity }))).status, 400);
    }
    assert.equal(stock('baggy-negro', 'S'), 1);
  });

  let blackId;
  await t.test('two customers cannot reserve the last unit; retries never double debit or email', async () => {
    const results = await Promise.all([
      request('/public-registrations', 'POST', black),
      request('/public-registrations', 'POST', payload())
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(results[0].status, 201);
    blackId = results[0].body.registration_id;
    assert.equal(stock('baggy-negro', 'S'), 0);
    assert.equal(stock('baggy-gris', 'S'), 1);
    const repeated = await request('/public-registrations', 'POST', black);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.registration_id, blackId);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Negro/);
    assert.match(messages[0].text, /Talla S/);
    assert.equal((await request('/public-registrations', 'POST', { ...black, quantity: 2 })).status, 409);
    initDb();
    seedRenjiCatalog(db, business.id);
    assert.equal(stock('baggy-negro', 'S'), 0, 'reinitialization must not replenish stock');
  });

  await t.test('edits transfer the reservation atomically; confirming does not debit twice', async () => {
    const edited = { ...registration(blackId), product_id: 'baggy-gris', size: 'M', pants_size: 'M' };
    assert.equal((await request(`/registrations/${blackId}`, 'PUT', edited)).status, 200);
    assert.equal(stock('baggy-negro', 'S'), 1);
    assert.equal(stock('baggy-gris', 'M'), 1);
    assert.equal((await request(`/registrations/${blackId}`, 'PUT', { ...edited, quantity: 3 })).status, 409);
    assert.equal(stock('baggy-gris', 'M'), 1);
    assert.equal(registration(blackId).quantity, 1);
    assert.equal((await request(`/registrations/${blackId}/resend-email`, 'POST')).status, 200);
    assert.match(messages.at(-1).text, /Gris/);
    assert.match(messages.at(-1).text, /Talla M/);
    assert.equal((await request(`/registrations/${blackId}/confirm`, 'POST')).status, 200);
    assert.equal(stock('baggy-gris', 'M'), 1);
    assert.equal((await request(`/registrations/${blackId}/confirm`, 'POST')).status, 404);
    const orderId = registration(blackId).order_id;
    let order = db.prepare('SELECT * FROM renji_orders WHERE id = ?').get(orderId);
    assert.equal(order.color, 'Gris');
    assert.equal(order.product_id, 'baggy-gris');
    assert.equal(order.production_status, 'ready');
    assert.equal((await request(`/orders/${orderId}`, 'PUT', { ...order, product_id: 'baggy-negro', size: 'L', pants_size: 'L', quantity: 2 })).status, 200);
    assert.equal(stock('baggy-gris', 'M'), 2);
    assert.equal(stock('baggy-negro', 'L'), 2);
    order = db.prepare('SELECT * FROM renji_orders WHERE id = ?').get(orderId);
    assert.equal((await request(`/orders/${orderId}`, 'PUT', { ...order, quantity: 99 })).status, 409);
    assert.equal(stock('baggy-negro', 'L'), 2);
    assert.equal((await request(`/orders/${orderId}`, 'DELETE')).status, 200);
    assert.equal(stock('baggy-negro', 'L'), 4);
    assert.equal((await request(`/orders/${orderId}`, 'DELETE')).status, 404);
    assert.equal(stock('baggy-negro', 'L'), 4);
  });

  await t.test('separations reserve too; cancellation restores once; SMTP failure never loses the order', async () => {
    failEmail = true;
    const body = payload({ product_id: 'baggy-gris', pants_size: 'XL', size: 'XL', deposit_amount: 5 });
    const response = await request('/public-separations', 'POST', body);
    assert.equal(response.status, 201);
    assert.equal(response.body.email.sent, false);
    assert.equal(stock('baggy-gris', 'XL'), 0);
    const id = response.body.registration_id;
    assert.equal(registration(id).deposit_amount, 5);
    assert.equal(registration(id).email_sent, 0);
    failEmail = false;
    assert.equal((await request(`/registrations/${id}/resend-email`, 'POST')).status, 200);
    assert.equal(registration(id).email_sent, 1);
    assert.equal((await request(`/registrations/${id}`, 'DELETE')).status, 200);
    assert.equal(stock('baggy-gris', 'XL'), 1);
    assert.equal((await request(`/registrations/${id}`, 'DELETE')).status, 404);
    assert.equal(stock('baggy-gris', 'XL'), 1);
    assert.equal((await request('/public-separations', 'POST', payload())).status, 400);
  });

  await t.test('admin stock and sales use the same variant inventory, leaving legacy stock untouched', async () => {
    assert.equal((await request('/stock', 'POST', { items: [{ product_id: 'baggy-gris', item_type: 'pants', size: 'L', quantity: 2 }] })).status, 201);
    assert.equal(stock('baggy-gris', 'L'), 4);
    const sale = await request('/orders', 'POST', payload({ product_id: 'baggy-gris', pants_size: 'L', size: 'L', quantity: 2 }));
    assert.equal(sale.status, 201);
    assert.equal(stock('baggy-gris', 'L'), 2);
    assert.equal(sale.body.orders[0].color, 'Gris');
    assert.equal(sale.body.catalog.length, 2);
    assert.deepEqual(db.prepare('SELECT * FROM renji_stock WHERE establishment_id = ?').all(business.id), legacyBefore);
    assert.equal((await request('/stock', 'POST', { items: [] }, '')).status, 401);
  });

  await t.test('one customer can reserve and confirm two independently sized garments', async () => {
    const messageCount = messages.length;
    const body = payload({
      product_id: 'baggy-negro', pants_size: 'XL', size: 'XL', quantity: 2,
      items: [
        { product_id: 'baggy-negro', size: 'XL', quantity: 1 },
        { product_id: 'baggy-gris', size: 'S', quantity: 1 }
      ]
    });
    const response = await request('/public-registrations', 'POST', body);
    assert.equal(response.status, 201);
    assert.equal(response.body.items.length, 2);
    assert.equal(stock('baggy-negro', 'XL'), 1);
    assert.equal(stock('baggy-gris', 'S'), 0);
    assert.equal(messages.length, messageCount + 1);
    assert.match(messages.at(-1).text, /Negro.*Talla XL/s);
    assert.match(messages.at(-1).text, /Gris.*Talla S/s);

    const saved = registration(response.body.registration_id);
    assert.equal(JSON.parse(saved.catalog_items_json).length, 2);
    assert.equal((await request(`/registrations/${saved.id}/confirm`, 'POST')).status, 200);
    const confirmed = registration(saved.id);
    const order = db.prepare('SELECT * FROM renji_orders WHERE id = ?').get(confirmed.order_id);
    assert.equal(JSON.parse(order.stock_items_json).length, 2);
    assert.equal((await request(`/orders/${order.id}`, 'DELETE')).status, 200);
    assert.equal(stock('baggy-negro', 'XL'), 2);
    assert.equal(stock('baggy-gris', 'S'), 1);
  });
});
