import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { createToken } from '../src/auth.js';
import { initMarjoriePromotersDb } from '../src/marjorie-promoters-db.js';
import { marjorieCommissionRate, marjorieCycleFor, registerMarjoriePromotersRoutes } from '../src/marjorie-promoters-routes.js';

process.env.JWT_SECRET = 'marjorie-test-secret';
process.env.PUBLIC_APP_URL = 'https://example.test';
process.env.MARJORIE_STORE_URL = 'https://shop.example.test';
process.env.MARJORIE_INVENTORY_API_KEY = 'inventory-test-key';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE establishments (id INTEGER PRIMARY KEY, name TEXT, theme TEXT);
    CREATE TABLE production_clients (
      id INTEGER PRIMARY KEY, name TEXT, city TEXT, address TEXT, phone TEXT,
      local_store_key TEXT, deleted_at TEXT
    );
    INSERT INTO establishments VALUES (1, 'Marjorie Promotoras', 'marjorie');
    INSERT INTO production_clients VALUES
      (10, 'Local Marjorie Botas Norte', 'Norte', 'Direccion norte', '', 'marjorie-norte', NULL),
      (11, 'Local Marjorie Botas Sur', 'Sur', 'Direccion sur', '', 'marjorie-sur', NULL),
      (12, 'Local Marjorie Botas Valle', 'Valle', 'Direccion valle', '', 'marjorie-valle', NULL),
      (13, 'Sebastians', 'Bosque', 'Direccion bosque', '', 'sebastians', NULL);
  `);
  initMarjoriePromotersDb(db);
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerMarjoriePromotersRoutes(app, db);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const adminToken = createToken({ role: 'supreme', username: 'test-admin' });
  async function request(path, options = {}) {
    const response = await fetch(`${url}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }
  return { db, server, request, adminToken };
}

test('commission scale and individual 30-day cycle boundaries are exact', () => {
  assert.equal(marjorieCommissionRate(0), 0);
  assert.equal(marjorieCommissionRate(4), 2.5);
  assert.equal(marjorieCommissionRate(5), 4);
  assert.equal(marjorieCommissionRate(9), 4);
  assert.equal(marjorieCommissionRate(10), 5);
  assert.deepEqual(marjorieCycleFor('2026-09-08', '2026-09-22'), { index: 0, start: '2026-09-08', first_cut: '2026-09-23', end: '2026-10-08', days_remaining: 16 });
  assert.equal(marjorieCycleFor('2026-09-08', '2026-10-08').start, '2026-10-08');
});

test('registration, approval, QR, sales, bonuses, payments and reversals remain auditable', async (t) => {
  const { db, server, request, adminToken } = fixture();
  t.after(() => { server.close(); db.close(); });
  const registration = {
    name: 'Maria Jose Andrade', cedula: '1801234567', whatsapp: '0991234567', email: 'maria@example.com',
    instagram: 'maria.andrade', city: 'Ambato', photo_url: 'data:image/png;base64,AA==', password: 'clave-segura', accepted_terms: true
  };
  const created = await request('/marjorie/register', { method: 'POST', body: JSON.stringify(registration) });
  assert.equal(created.status, 201);
  assert.equal(created.data.code, 'MB0001');
  assert.equal((await request('/marjorie/register', { method: 'POST', body: JSON.stringify(registration) })).status, 409);
  assert.notEqual(db.prepare('SELECT password_hash FROM marjorie_promoters').get().password_hash, registration.password);
  assert.equal(db.prepare('SELECT code FROM marjorie_promoters').get().code, 'MB0001');

  const pendingLogin = await request('/marjorie/auth/login', { method: 'POST', body: JSON.stringify({ username: registration.email, password: registration.password }) });
  assert.equal(pendingLogin.status, 200);
  assert.equal(pendingLogin.data.user.status, 'pending');
  const approval = await request('/marjorie/admin/promoters/1/approve', { method: 'POST', token: adminToken });
  assert.equal(approval.status, 200);
  assert.equal(approval.data.code, 'MB0001');
  assert.equal(approval.data.email_sent, false);
  assert.equal(approval.data.password_hash, undefined);
  const adminList = await request('/marjorie/admin/promoters', { token: adminToken });
  assert.equal(adminList.data[0].password_hash, undefined);
  db.prepare("UPDATE marjorie_promoters SET activated_at = '2026-08-07' WHERE id = 1").run();

  const login = await request('/marjorie/auth/login', { method: 'POST', body: JSON.stringify({ username: 'MB-0001', password: registration.password }) });
  const me = await request('/marjorie/me', { token: login.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.password_hash, undefined);
  assert.equal(me.data.branches.length, 4);
  assert.match(me.data.qr_url, /MB0001\/qr$/);
  assert.equal(me.data.referral_url, 'https://shop.example.test/?codigo=MB0001');

  const firstSale = await request('/marjorie/admin/sales', { method: 'POST', token: adminToken, body: JSON.stringify({ promoter_id: 1, branch_client_id: 10, customer_name: 'Cliente uno', pairs: 4, sale_date: '2026-08-08', is_paid: true, is_delivered: true }) });
  assert.equal(firstSale.status, 201);
  let detail = (await request('/marjorie/admin/promoters/1', { token: adminToken })).data;
  assert.equal(detail.commission_total, 10);
  assert.equal(detail.pending_total, 10);
  const firstPayment = await request('/marjorie/admin/promoters/1/pay', { method: 'POST', token: adminToken, body: '{}' });
  assert.equal(firstPayment.data.payment.total_amount, 10);

  const secondSale = await request('/marjorie/admin/sales', { method: 'POST', token: adminToken, body: JSON.stringify({ promoter_id: 1, branch_client_id: 11, customer_name: 'Cliente dos', pairs: 6, sale_date: '2026-08-24', is_paid: true, is_delivered: true }) });
  assert.equal(secondSale.status, 201);
  await request('/marjorie/admin/bonuses', { method: 'PUT', token: adminToken, body: JSON.stringify({ promoter_id: 1, cycle_start: '2026-08-07', cut_number: 2, active_page: true, published_content: true, stories_reels: true, correct_information: true, appropriate_content: true, status: 'approved' }) });
  detail = (await request('/marjorie/admin/promoters/1', { token: adminToken })).data;
  assert.equal(detail.commission_total, 50);
  assert.equal(detail.pending_total, 65);
  const secondPayment = await request('/marjorie/admin/promoters/1/pay', { method: 'POST', token: adminToken, body: '{}' });
  assert.equal(secondPayment.data.payment.total_amount, 65);
  assert.equal((await request('/marjorie/admin/promoters/1/pay', { method: 'POST', token: adminToken, body: '{}' })).status, 409);

  await request(`/marjorie/admin/sales/${secondSale.data.id}`, { method: 'PATCH', token: adminToken, body: JSON.stringify({ returned_pairs: 2, is_paid: true, is_delivered: true }) });
  detail = (await request('/marjorie/admin/promoters/1', { token: adminToken })).data;
  assert.equal(detail.commission_total, 32);
  assert.equal(detail.ledger_balance, -18);
  assert.ok(detail.audit.some((row) => row.entity_type === 'sale' && row.action === 'update'));
});

test('database startup backfills missing codes, activation dates and removes legacy hyphens', () => {
  const db = new Database(':memory:');
  initMarjoriePromotersDb(db);
  const insert = db.prepare(`INSERT INTO marjorie_promoters
    (name,cedula,whatsapp,email,instagram,city,photo_url,password_hash,code,status,terms_version,terms_accepted_at,registered_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('Una', '1', '1', 'una@test.com', 'una', 'Quito', '/a.png', 'hash', 'MB-0001', 'active', 'v', '2026-01-01', '2026-01-01 12:00:00');
  insert.run('Dos', '2', '2', 'dos@test.com', 'dos', 'Quito', '/b.png', 'hash', null, 'pending', 'v', '2026-01-01', '2026-01-01 12:00:00');
  initMarjoriePromotersDb(db);
  assert.deepEqual(db.prepare('SELECT code FROM marjorie_promoters ORDER BY id').all(), [{ code: 'MB0001' }, { code: 'MB0002' }]);
  assert.equal(db.prepare('SELECT activated_at FROM marjorie_promoters WHERE id = 1').get().activated_at, '2026-01-01');
  assert.equal(db.prepare('SELECT activated_at FROM marjorie_promoters WHERE id = 2').get().activated_at, null);
  db.close();
});

test('admin activation sets the cycle date even when status changes through the editor', async (t) => {
  const { db, server, request, adminToken } = fixture();
  t.after(() => { server.close(); db.close(); });
  db.prepare(`INSERT INTO marjorie_promoters
    (name,cedula,whatsapp,email,instagram,city,password_hash,code,status,terms_version,terms_accepted_at)
    VALUES ('Morelia','1800000001','099','morelia@test.com','morelia','Ambato','hash','MB0002','pending','v','2026-09-15')`).run();

  const updated = await request('/marjorie/admin/promoters/1', {
    method: 'PATCH', token: adminToken, body: JSON.stringify({ status: 'active' })
  });
  assert.equal(updated.status, 200);
  assert.match(updated.data.activated_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('inventory integration validates codes and updates each external sale idempotently', async (t) => {
  const { db, server, request, adminToken } = fixture();
  t.after(() => { server.close(); db.close(); });
  db.prepare(`INSERT INTO marjorie_promoters
    (name,cedula,whatsapp,email,instagram,city,photo_url,password_hash,code,status,terms_version,terms_accepted_at,activated_at)
    VALUES ('Ana','1800000000','099','ana@test.com','ana','Ambato','/a.png','hash','MB0010','active','v','2026-01-01','2026-08-20')`).run();
  const auth = { Authorization: 'Bearer inventory-test-key' };
  assert.equal((await request('/marjorie/admin/settings')).status, 401);
  assert.deepEqual((await request('/marjorie/admin/settings', { token: adminToken })).data, { discount_percent: 0, support_whatsapp: '' });
  assert.equal((await request('/marjorie/admin/settings', { method: 'PUT', token: adminToken, body: JSON.stringify({ discount_percent: 101 }) })).status, 400);
  const settings = await request('/marjorie/admin/settings', { method: 'PUT', token: adminToken, body: JSON.stringify({ discount_percent: 12.5, support_whatsapp: '+593 98 765 4321' }) });
  assert.deepEqual(settings.data, { discount_percent: 12.5, support_whatsapp: '593987654321' });
  const validate = await request('/integrations/marjorie/promoters/MB-0010', { headers: auth });
  assert.deepEqual({ valid: validate.data.valid, code: validate.data.code, discount_percent: validate.data.discount_percent }, { valid: true, code: 'MB0010', discount_percent: 12.5 });
  const sale = { source: 'facturacion', sale_id: 'FAC-44', promoter_code: 'MB0010', branch_name: 'Local Marjorie Botas Norte', customer_name: 'Comprador', pairs: 10, discount_percent: 12.5, sale_date: '2026-09-01', is_paid: true, is_delivered: true };
  assert.equal((await request('/integrations/marjorie/sales', { method: 'POST', headers: auth, body: JSON.stringify(sale) })).status, 201);
  const update = await request('/integrations/marjorie/sales', { method: 'POST', headers: auth, body: JSON.stringify({ ...sale, returned_pairs: 3 }) });
  assert.equal(update.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marjorie_promoter_sales').get().count, 1);
  assert.equal(update.data.discount_percent, 12.5);
  assert.equal(update.data.cycle_points, 7);
  assert.equal(update.data.commission, 28);
  assert.equal((await request('/integrations/marjorie/promoters/MB-0010')).status, 401);
});

test('AlfaBusiness contract exposes referral lookup and accepts idempotent sale webhooks', async (t) => {
  const { db, server, request, adminToken } = fixture();
  t.after(() => { server.close(); db.close(); });
  db.prepare(`INSERT INTO marjorie_promoters
    (name,cedula,whatsapp,email,instagram,city,photo_url,password_hash,code,status,terms_version,terms_accepted_at,activated_at)
    VALUES ('Ana','1800000000','099','ana@test.com','ana','Ambato','/a.png','hash','MB0001','active','v','2026-01-01','2026-08-20')`).run();
  const auth = { Authorization: 'Bearer inventory-test-key' };
  await request('/marjorie/admin/settings', { method: 'PUT', token: adminToken, body: JSON.stringify({ discount_percent: 10 }) });

  const lookup = await request('/v1/referral-codes/mb-0001', { headers: auth });
  assert.equal(lookup.status, 200);
  assert.deepEqual(lookup.data, {
    code: 'MB0001', active: true, discount_percent: 10,
    promoter: { id: 'prc_1', name: 'Ana', level: 'inicial' }
  });
  assert.equal((await request('/v1/referral-codes/MB-0001')).status, 401);
  assert.equal((await request('/v1/referral-codes/NO-EXISTE', { headers: auth })).status, 404);

  const webhookHeaders = { ...auth, 'Idempotency-Key': 'mb-sale-1842' };
  const webhook = {
    event: 'sale.registered', occurred_at: '2026-09-01T16:57:00-05:00', promo_code: 'MB-0001',
    sale: { id: 1842, sold_at: '2026-09-01T16:57:00-05:00', branch_id: 3, branch_name: 'Valle de los Chillos', pairs: 2, subtotal: 78.17, discount: 8.9, total: 80.1, currency: 'USD', comprobante_type: 'factura_electronica', promo_discount_percent: 10 }
  };
  const accepted = await request('/v1/webhooks/marjorie-sales', { method: 'POST', headers: webhookHeaders, body: JSON.stringify(webhook) });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.data.accepted, true);
  assert.equal(accepted.data.duplicate, false);
  const repeated = await request('/v1/webhooks/marjorie-sales', { method: 'POST', headers: webhookHeaders, body: JSON.stringify(webhook) });
  assert.equal(repeated.status, 202);
  assert.equal(repeated.data.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marjorie_promoter_sales').get().count, 1);
  const stored = db.prepare('SELECT branch_name, pairs, external_source, external_sale_id FROM marjorie_promoter_sales').get();
  assert.deepEqual(stored, { branch_name: 'Local Marjorie Botas Valle', pairs: 2, external_source: 'marjorie-alfabusiness', external_sale_id: 'mb-sale-1842' });
});
