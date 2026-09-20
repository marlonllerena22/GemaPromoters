import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import nodemailer from 'nodemailer';
import { initTicketingDb } from '../src/ticketing-db.js';
import { registerTicketingRoutes } from '../src/ticketing-routes.js';
import { createToken } from '../src/auth.js';

test('promotions deduplicate failed buyers, recheck paid purchases, and deliver separate branded email', async (t) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE establishments (id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, business_type TEXT, module_type TEXT, code_prefix TEXT, theme TEXT, logo_url TEXT, admin_username TEXT, admin_password TEXT, status TEXT, promoter_sales_enabled INTEGER)');
  const business = initTicketingDb(db);
  const event = db.prepare('SELECT id FROM ticketing_events LIMIT 1').get();
  const otherEvent = db.prepare('SELECT id FROM ticketing_events WHERE id <> ? LIMIT 1').get(event.id);
  const makeCustomer = db.prepare('INSERT INTO ticketing_customers (establishment_id, name, email, phone) VALUES (?, ?, ?, ?)');
  const a = makeCustomer.run(business.id, 'Ana Uno', 'ana@test.invalid', '0991234567').lastInsertRowid;
  const b = makeCustomer.run(business.id, 'Bea Dos', 'bea@test.invalid', '0992223344').lastInsertRowid;
  const c = makeCustomer.run(business.id, 'Caro Tres', 'caro@test.invalid', '0993334455').lastInsertRowid;
  const d = makeCustomer.run(business.id, 'Dora Cuatro', 'dora@test.invalid', '0994445566').lastInsertRowid;
  const insertOrder = db.prepare('INSERT INTO ticketing_orders (establishment_id, event_id, customer_id, order_number, payment_status, expires_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertOrder.run(business.id, event.id, a, 'PT-PROMO-A1', 'rejected', null);
  insertOrder.run(business.id, event.id, a, 'PT-PROMO-A2', 'rejected', null);
  insertOrder.run(business.id, event.id, b, 'PT-PROMO-B1', 'rejected', null);
  insertOrder.run(business.id, otherEvent.id, b, 'PT-PROMO-B2', 'paid', null);
  insertOrder.run(business.id, event.id, c, 'PT-PROMO-C1', 'expired', null);
  insertOrder.run(business.id, event.id, d, 'PT-PROMO-D1', 'rejected', null);
  insertOrder.run(business.id, event.id, d, 'PT-PROMO-D2', 'pending', '2099-01-01 00:00:00');
  db.prepare("UPDATE ticketing_orders SET created_at = datetime('now', 'localtime', '+1 minute') WHERE customer_id = ?").run(a);

  let releaseFirst;
  const pauseFirst = new Promise((resolve) => { releaseFirst = resolve; });
  const sent = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (message) => {
    sent.push(message);
    if (sent.length === 1) await pauseFirst;
  } }));
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    const before = process.env[key];
    process.env[key] = 'isolated-test';
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerTicketingRoutes(app, db);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const token = createToken({ role: 'admin', establishmentId: business.id, username: 'promo-admin' });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/ticketing';
  async function request(path, method = 'GET', body, authorization = token) {
    const response = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authorization },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  }
  const preview = await request('/admin/promotions/recipients');
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.recipients.map((person) => person.email).sort(),
    ['ana@test.invalid', 'caro@test.invalid']);
  assert.equal((await request('/admin/promotions/recipients?event_id=' + event.id)).body.recipients.length, 2);
  assert.equal((await request('/admin/promotions/recipients/' + b + '/whatsapp')).status, 409);
  assert.equal((await request('/admin/promotions/recipients/' + a + '/whatsapp')).body.phone, '593991234567');
  const buyerToken = createToken({ role: 'ticket_customer', establishmentId: business.id, customerId: a });
  assert.equal((await request('/admin/promotions/recipients', 'GET', null, buyerToken)).status, 403);

  const campaignBody = {
    request_key: 'test-promotion-123456', subject: 'Promoción especial',
    message: 'Disfruta <la oferta> este mes', event_id: event.id,
    file: { name: 'oferta.png', data_url: 'data:image/png;base64,' + Buffer.from('fake-image').toString('base64') }
  };
  assert.equal((await request('/admin/promotions/email', 'POST', {
    ...campaignBody, file: { name: 'archivo.exe', data_url: 'data:application/octet-stream;base64,QQ==' }
  })).status, 400);
  const campaign = await request('/admin/promotions/email', 'POST', campaignBody);
  assert.equal(campaign.status, 202);
  assert.equal(campaign.body.total, 2);
  assert.equal((await request('/admin/promotions/email', 'POST', campaignBody)).body.id, campaign.body.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@test.invalid');
  assert.match(sent[0].html, /Disfruta &lt;la oferta&gt;/);
  assert.match(sent[0].html, /cid:promotion@protickets/);
  assert.equal(sent[0].attachments[0].filename, 'oferta.png');
  assert.match(sent[0].text, /Dejar de recibir promociones/);

  insertOrder.run(business.id, event.id, c, 'PT-PROMO-C2', 'paid', null);
  releaseFirst();
  let final;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    final = await request('/admin/promotions/email/' + campaign.body.id);
    if (final.body.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(final.body.status, 'completed');
  assert.equal(final.body.sent, 1);
  assert.equal(final.body.skipped, 1);
  assert.equal(sent.length, 1);
  assert.equal(db.prepare('SELECT file_data FROM ticketing_promotion_campaigns WHERE id = ?').get(campaign.body.id).file_data, null);
  assert.deepEqual((await request('/admin/promotions/recipients')).body.recipients.map((person) => person.email),
    ['ana@test.invalid']);

  const unsubscribe = sent[0].text.match(/https?:\/\/\S+\/api\/ticketing\/promotions\/unsubscribe\/[a-f0-9]{48}/)?.[0];
  assert.ok(unsubscribe);
  const optOut = await fetch(base + new URL(unsubscribe).pathname.replace('/api/ticketing', ''));
  assert.equal(optOut.status, 200);
  assert.equal((await request('/admin/promotions/recipients')).body.recipients.length, 1);
  const confirmedOptOut = await fetch(base + new URL(unsubscribe).pathname.replace('/api/ticketing', ''), { method: 'POST' });
  assert.equal(confirmedOptOut.status, 200);
  assert.equal((await request('/admin/promotions/recipients')).body.recipients.length, 0);
});
