import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import nodemailer from 'nodemailer';
import { initTicketingDb } from '../src/ticketing-db.js';
import { registerTicketingRoutes } from '../src/ticketing-routes.js';
import { createToken } from '../src/auth.js';
import { buildTicketSalesReport } from '../src/ticketing-finance.js';

async function fixture(t) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE establishments (id INTEGER PRIMARY KEY, name TEXT, display_name TEXT,
    business_type TEXT, module_type TEXT, code_prefix TEXT, theme TEXT, logo_url TEXT,
    admin_username TEXT, admin_password TEXT, status TEXT, promoter_sales_enabled INTEGER);`);
  const business = initTicketingDb(db);
  const event = db.prepare("SELECT * FROM ticketing_events WHERE slug = 'las-leyendas-de-mago-de-oz-imbabura'").get();
  db.prepare("UPDATE ticketing_events SET status = 'published', sales_enabled = 1, payment_enabled = 1 WHERE id = ?").run(event.id);
  const type = db.prepare('SELECT * FROM ticketing_ticket_types WHERE event_id = ? ORDER BY price LIMIT 1').get(event.id);
  db.prepare('UPDATE ticketing_ticket_types SET stock = 20, sold = 0, price = 15 WHERE id = ?').run(type.id);
  const customer = db.prepare(`INSERT INTO ticketing_customers (establishment_id, name, email) VALUES (?, 'Prueba Local', 'prueba@example.invalid')`).run(business.id).lastInsertRowid;
  const app = express(); app.use(express.json()); registerTicketingRoutes(app, db);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const admin = createToken({ role: 'admin', establishmentId: business.id, username: 'test-admin' });
  const buyer = createToken({ role: 'ticket_customer', establishmentId: business.id, customerId: customer });
  async function request(path, token = admin, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ticketing${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  }
  const create = () => request('/orders', buyer, 'POST', { ticket_type_id: type.id, quantity: 2, payment_method: 'transfer', service_fee: 0, total: 1 });
  return { db, business, event, type, customer, admin, buyer, request, create };
}

test('transfer reservation uses authoritative 5% fee, event QR, expiry and no tickets until approval', async (t) => {
  const f = await fixture(t);
  const created = await f.create(); assert.equal(created.status, 201);
  assert.equal(created.body.subtotal, 30); assert.equal(created.body.service_fee, 1.5); assert.equal(created.body.total, 31.5);
  assert.equal(created.body.payment_method, 'transfer'); assert.equal(created.body.provider_fee_rate, 0);
  assert.equal(created.body.tickets.length, 0); assert.equal(created.body.payment_status, 'pending');
  assert.equal(created.body.transfer.deuna_qr_url, '/protickets/deuna-mago.png');
  assert.ok(created.body.transfer.whatsapp_url.startsWith('https://wa.me/593979243134?text='));
  const minutes = f.db.prepare("SELECT (julianday(expires_at)-julianday('now','localtime'))*1440 AS minutes FROM ticketing_orders WHERE id = ?").get(created.body.id).minutes;
  assert.ok(minutes > 29 && minutes <= 30.01);
  assert.equal((await f.create()).status, 409);
  assert.equal((await f.request(`/transfers/${created.body.id}/confirm`, f.buyer, 'POST', { reference: 'ABC' })).status, 403);
  assert.equal((await f.request(`/admin/orders/${created.body.id}/confirm`, f.admin, 'POST', {})).status, 400);
  f.db.prepare("UPDATE ticketing_events SET transfer_qr_url = '/protickets/changed.png' WHERE id = ?").run(f.event.id);
  initTicketingDb(f.db);
  assert.equal(f.db.prepare('SELECT transfer_qr_url FROM ticketing_events WHERE id = ?').get(f.event.id).transfer_qr_url, '/protickets/changed.png');
});

test('transfer reviewer is restricted; approval emits tickets and email once with a unique reference', async (t) => {
  const f = await fixture(t);
  const messages = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (message) => { messages.push(message); } }));
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) { const previous = process.env[key]; process.env[key] = 'isolated-test'; t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }); }
  const user = await f.request('/admin/validators', f.admin, 'POST', { name: 'Revisor', username: 'revisor.test', password: 'test-password-123', access_scope: 'transfers' });
  assert.equal(user.status, 201);
  const login = await f.request('/validator/login', '', 'POST', { username: 'revisor.test', password: 'test-password-123' });
  assert.equal(login.body.user.role, 'ticket_transfer_reviewer');
  const token = login.body.token;
  for (const path of ['/admin/overview', '/admin/validators', '/admin/sales-report', '/validation/history']) assert.equal((await f.request(path, token)).status, 403);
  assert.equal((await f.request('/admin/tickets/validate', token, 'POST', { code: 'PT-TEST' })).status, 403);
  const order = (await f.create()).body;
  assert.equal((await f.request(`/transfers/${order.id}/confirm`, token, 'POST', {})).status, 409);
  const confirmed = await f.request(`/transfers/${order.id}/confirm`, token, 'POST', { reference: 'BANK-001' });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.order.tickets.length, 2); assert.equal(confirmed.body.order.payment_status, 'paid');
  assert.equal(messages.length, 1); assert.equal(messages[0].to, 'prueba@example.invalid'); assert.equal(messages[0].attachments.length, 2);
  assert.equal((await f.request(`/transfers/${order.id}/confirm`, token, 'POST', { reference: 'BANK-001' })).status, 200);
  assert.equal(messages.length, 1); assert.equal(f.db.prepare('SELECT sold FROM ticketing_ticket_types WHERE id = ?').get(f.type.id).sold, 2);
  const another = (await f.create()).body;
  assert.equal((await f.request(`/transfers/${another.id}/confirm`, token, 'POST', { reference: 'BANK-001' })).status, 409);
  const report = (await f.request('/admin/sales-report')).body;
  assert.equal(report.totals.quantity, 2); assert.equal(report.totals.gross, 31.5); assert.equal(report.totals.payphone_fee, 0);
  assert.equal(report.totals.protickets_net, 1.5); assert.equal(report.totals.event_net, 30);
  const today = f.db.prepare("SELECT date('now','localtime') AS day").get().day;
  assert.equal((await f.request(`/admin/sales-report?from=${today}&to=${today}&event_id=${f.event.id}`)).body.totals.quantity, 2);
  assert.equal((await f.request('/admin/sales-report?to=2000-01-01')).body.totals.quantity, 0);
  assert.equal((await f.request('/admin/sales-report?from=2026-12-01&to=2026-01-01')).status, 400);
  f.db.prepare("UPDATE ticketing_orders SET paid_at = '2026-09-22 02:30:00' WHERE id = ?").run(order.id);
  assert.equal((await f.request('/admin/sales-report?from=2026-09-21&to=2026-09-21')).body.totals.quantity, 2,
    '02:30 UTC still belongs to the previous day in Ecuador');
  assert.equal((await f.request('/admin/sales-report?from=2026-09-22&to=2026-09-22')).body.totals.quantity, 0);
  await f.request(`/admin/validators/${user.body.id}`, f.admin, 'PUT', { ...user.body, status: 'inactive' });
  assert.equal((await f.request('/transfers', token)).status, 401);
});

test('expired transfers release stock but late approval cannot consume another active reservation', async (t) => {
  const f = await fixture(t);
  const order = (await f.create()).body;
  f.db.prepare("UPDATE ticketing_orders SET expires_at = datetime('now','localtime','-1 minute') WHERE id = ?").run(order.id);
  assert.equal((await f.request('/me/orders', f.buyer)).body.length, 0);
  f.db.prepare('UPDATE ticketing_ticket_types SET stock = 2 WHERE id = ?').run(f.type.id);
  assert.equal((await f.create()).status, 201);
  const late = await f.request(`/transfers/${order.id}/confirm`, f.admin, 'POST', { reference: 'LATE-001' });
  assert.equal(late.status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ticketing_tickets').get().count, 0);
  const foreign = createToken({ role: 'admin', establishmentId: 9999 });
  assert.equal((await f.request('/transfers', foreign)).status, 403);
});

test('an administrator can cancel mistakenly approved tickets, restore stock, email the buyer and show the custom scanner warning', async (t) => {
  const f = await fixture(t);
  const messages = [];
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (message) => { messages.push(message); } }));
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    const previous = process.env[key];
    process.env[key] = 'isolated-test';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const order = (await f.create()).body;
  const confirmed = await f.request(`/transfers/${order.id}/confirm`, f.admin, 'POST', { reference: 'HENRY-TEST' });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.order.tickets.length, 2);
  const ticketCode = confirmed.body.order.tickets[0].code;
  const cancelled = await f.request(`/admin/orders/${order.id}/cancel-tickets`, f.admin, 'POST', {
    reason: 'Falta de pago',
    scan_message: 'BOLETO CANCELADO, FALTA DE PAGO, CASO HENRY'
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.order.payment_status, 'rejected');
  assert.equal(cancelled.body.order.cancellation_reason, 'Falta de pago');
  assert.equal(cancelled.body.order.cancellation_scan_message, 'BOLETO CANCELADO, FALTA DE PAGO, CASO HENRY');
  assert.equal(cancelled.body.email.sent, true);
  assert.equal(messages.length, 2);
  assert.match(messages[1].subject, /Boletos suspendidos/);
  assert.match(messages[1].html, /no se registró el pago/);
  assert.equal(f.db.prepare('SELECT sold FROM ticketing_ticket_types WHERE id = ?').get(f.type.id).sold, 0);
  assert.deepEqual(
    f.db.prepare('SELECT DISTINCT status FROM ticketing_tickets WHERE order_id = ?').all(order.id),
    [{ status: 'void' }]
  );
  const scanned = await f.request('/admin/tickets/validate', f.admin, 'POST', { code: ticketCode });
  assert.equal(scanned.status, 409);
  assert.equal(scanned.body.valid, false);
  assert.equal(scanned.body.message, 'BOLETO CANCELADO, FALTA DE PAGO, CASO HENRY');
  assert.equal((await f.request(`/admin/orders/${order.id}/cancel-tickets`, f.admin, 'POST', {
    reason: 'Falta de pago', scan_message: 'BOLETO CANCELADO'
  })).status, 400);
  assert.equal(messages.length, 2);
});

test('offline scanner downloads an event, synchronizes idempotently and resolves used or cancelled conflicts', async (t) => {
  const f = await fixture(t);
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async () => {} }));
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    const previous = process.env[key]; process.env[key] = 'isolated-test';
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const validator = await f.request('/admin/validators', f.admin, 'POST', {
    name: 'Puerta principal', username: 'puerta.principal', password: 'test-password-123', access_scope: 'qr'
  });
  const login = await f.request('/validator/login', '', 'POST', {
    username: 'puerta.principal', password: 'test-password-123'
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'ticket_validator');
  const token = login.body.token;
  const firstOrder = (await f.create()).body;
  const firstConfirmed = await f.request(`/transfers/${firstOrder.id}/confirm`, f.admin, 'POST', { reference: 'OFFLINE-001' });
  const firstCode = firstConfirmed.body.order.tickets[0].code;
  const offlinePackage = await f.request(`/validation/offline-package?event_id=${f.event.id}`, token);
  assert.equal(offlinePackage.status, 200);
  assert.equal(offlinePackage.body.event.id, f.event.id);
  assert.equal(offlinePackage.body.stats.valid, 2);
  assert.ok(offlinePackage.body.tickets.some((ticket) => ticket.code === firstCode));

  const scannerTest = await f.request('/admin/tickets/validate', token, 'POST', { code: 'PROTICKETS-PRUEBA-01' });
  assert.equal(scannerTest.status, 200);
  assert.equal(scannerTest.body.valid, true);
  assert.equal(scannerTest.body.test, true);
  assert.equal(scannerTest.body.message, 'LECTURA DE PRUEBA CORRECTA');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ticketing_validation_logs').get().count, 0);

  const firstSync = await f.request('/validation/offline-sync', token, 'POST', {
    device_id: 'device-main-gate',
    scans: [{ client_event_id: 'scan-001', event_id: f.event.id, code: firstCode,
      scanned_at: '2026-10-08T23:00:00.000Z', client_result: 'valid' }]
  });
  assert.equal(firstSync.status, 200);
  assert.equal(firstSync.body.results[0].server_result, 'valid');
  assert.equal(f.db.prepare('SELECT status FROM ticketing_tickets WHERE code = ?').get(firstCode).status, 'used');

  const repeatedSync = await f.request('/validation/offline-sync', token, 'POST', {
    device_id: 'device-main-gate',
    scans: [{ client_event_id: 'scan-001', event_id: f.event.id, code: firstCode,
      scanned_at: '2026-10-08T23:00:00.000Z', client_result: 'valid' }]
  });
  assert.equal(repeatedSync.body.results[0].duplicate_submission, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ticketing_offline_scans').get().count, 1);

  const duplicateScan = await f.request('/validation/offline-sync', token, 'POST', {
    device_id: 'device-main-gate',
    scans: [{ client_event_id: 'scan-002', event_id: f.event.id, code: firstCode,
      scanned_at: '2026-10-08T23:01:00.000Z', client_result: 'already_used' }]
  });
  assert.equal(duplicateScan.body.results[0].server_result, 'already_used');

  const secondOrder = (await f.create()).body;
  const secondConfirmed = await f.request(`/transfers/${secondOrder.id}/confirm`, f.admin, 'POST', { reference: 'OFFLINE-002' });
  const cancelledCode = secondConfirmed.body.order.tickets[0].code;
  await f.request(`/admin/orders/${secondOrder.id}/cancel-tickets`, f.admin, 'POST', {
    reason: 'Falta de pago', scan_message: 'BOLETO CANCELADO, FALTA DE PAGO, CASO HENRY'
  });
  const cancelledSync = await f.request('/validation/offline-sync', token, 'POST', {
    device_id: 'device-main-gate',
    scans: [{ client_event_id: 'scan-003', event_id: f.event.id, code: cancelledCode,
      scanned_at: '2026-10-08T23:02:00.000Z', client_result: 'valid' }]
  });
  assert.equal(cancelledSync.body.results[0].server_result, 'void');
  assert.equal(cancelledSync.body.results[0].message, 'BOLETO CANCELADO, FALTA DE PAGO, CASO HENRY');
  const refreshed = await f.request(`/validation/offline-package?event_id=${f.event.id}`, token);
  assert.equal(refreshed.body.tickets.find((ticket) => ticket.code === cancelledCode).status, 'void');
  assert.equal((await f.request('/validation/offline-package', f.admin)).status, 200);
  assert.equal(validator.body.access_scope, 'qr');
});

test('report rounds once per payment, distinguishes methods and reconciles every cent', () => {
  const orders = [
    { id: 1, event_id: 1, event_title: 'Evento', payment_method: 'payphone', subtotal: 100, service_fee: 10, total: 110, provider_fee_rate: 5.75 },
    { id: 2, event_id: 1, event_title: 'Evento', payment_method: 'transfer', subtotal: 40, service_fee: 2, total: 42 }
  ];
  const items = [
    { order_id: 1, ticket_type_id: 1, ticket_name: 'General', quantity: 1, unit_price: 15 },
    { order_id: 1, ticket_type_id: 2, ticket_name: 'Promo Golden', quantity: 1, unit_price: 85 },
    { order_id: 2, ticket_type_id: 2, ticket_name: 'Promo Golden', quantity: 1, unit_price: 40 }
  ];
  const report = buildTicketSalesReport(orders, items, 5.75);
  assert.equal(report.totals.gross, 152); assert.equal(report.totals.payphone_fee, 6.33);
  assert.equal(report.totals.protickets_net, 5.67); assert.equal(report.totals.event_net, 140);
  assert.equal(report.rows.reduce((sum, r) => sum + Math.round(r.payphone_fee * 100), 0), 633);
  assert.equal(report.totals.quantity, 3); assert.equal(report.simple_totals.quantity, 3);
  assert.equal(report.simple_totals.admissions, 5); assert.equal(report.reconciliation.balanced, true);
  assert.equal(report.simple_totals.payphone_total, 110); assert.equal(report.simple_totals.transfer_total, 42);
  const golden = report.simple_rows.find((row) => row.locality === 'Promo Golden');
  assert.equal(golden.quantity, 2); assert.equal(golden.admissions, 4); assert.equal(golden.gross, 135.5);
  assert.equal(golden.purchase_quantity, 2); assert.equal(golden.is_promo_golden, true);
  assert.equal(golden.payphone_total, 93.5); assert.equal(golden.transfer_total, 42);
});

test('card checkout retains 10% surcharge and snapshots PayPhone commission', async (t) => {
  const f = await fixture(t);
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://pay.payphonetodoesposible.com/')) {
      const payment = JSON.parse(options.body);
      assert.equal(payment.amount, 3300); assert.equal(payment.service, 300); assert.equal(payment.amountWithoutTax, 3000);
      return new Response(JSON.stringify({ paymentId: 'TEST-ID', payWithCard: 'https://pay.example.invalid/test' }), { status: 200 });
    }
    return originalFetch(url, options);
  });
  for (const key of ['PAYPHONE_TOKEN', 'PAYPHONE_STORE_ID']) { const previous = process.env[key]; process.env[key] = 'isolated-test'; t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }); }
  const result = await f.request('/orders', f.buyer, 'POST', { ticket_type_id: f.type.id, quantity: 2, payment_method: 'payphone', total: 1 });
  assert.equal(result.status, 201); assert.equal(result.body.total, 33); assert.equal(result.body.service_fee, 3);
  assert.equal(result.body.provider_fee_rate, 5.75); assert.equal(result.body.payment_method, 'payphone');
  assert.equal((await f.request(`/transfers/${result.body.id}/confirm`, f.admin, 'POST', { reference: 'BANK-FAKE' })).status, 404);
});
