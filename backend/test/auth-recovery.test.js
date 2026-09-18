import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { createToken } from '../src/auth.js';
import { hashRecoveryPassword, registerAuthRecoveryRoutes, verifyRecoveryPassword } from '../src/auth-recovery-routes.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE establishments (
      id INTEGER PRIMARY KEY, display_name TEXT, admin_username TEXT, admin_email TEXT, admin_password TEXT,
      status TEXT, admin_must_change_password INTEGER DEFAULT 0, admin_temp_password_expires_at TEXT,
      admin_password_recovery_requested_at TEXT
    );
    CREATE TABLE promoters (
      id INTEGER PRIMARY KEY, name TEXT, username TEXT, email TEXT, code TEXT, password TEXT, status TEXT,
      deleted_at TEXT, must_change_password INTEGER DEFAULT 0, temp_password_expires_at TEXT,
      password_recovery_requested_at TEXT
    );
    CREATE TABLE marjorie_promoters (
      id INTEGER PRIMARY KEY, name TEXT, email TEXT, code TEXT, password_hash TEXT, status TEXT,
      must_change_password INTEGER DEFAULT 0, temp_password_expires_at TEXT,
      password_recovery_requested_at TEXT, updated_at TEXT
    );
    INSERT INTO establishments VALUES (1, 'Marjorie Botas', 'marjorie', 'ventas@marjorie.test', 'actual', 'active', 0, NULL, NULL);
    INSERT INTO promoters VALUES (2, 'Promotor Uno', 'promotor.uno', 'promotor@test.com', 'PR-0002', 'actual', 'active', NULL, 0, NULL, NULL);
    INSERT INTO marjorie_promoters VALUES (3, 'Promotora MB', 'mb@test.com', 'MB-0003', '${hashRecoveryPassword('actual')}', 'active', 0, NULL, NULL, NULL);
  `);
  const deliveries = [];
  const app = express();
  app.use(express.json());
  registerAuthRecoveryRoutes(app, db, {
    sendTemporaryPassword: async (account, password) => deliveries.push({ account, password })
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'POST',
      headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      body: JSON.stringify(options.body || {})
    });
    return { status: response.status, data: await response.json() };
  }
  return { db, server, deliveries, request };
}

test('recovery sends a temporary password and requires an administrator to replace it', async (t) => {
  const { db, server, deliveries, request } = fixture();
  t.after(() => { server.close(); db.close(); });

  const recovery = await request('/forgot-password', { body: { identifier: 'ventas@marjorie.test' } });
  assert.equal(recovery.status, 200);
  assert.equal(deliveries.length, 1);
  const temporaryPassword = deliveries[0].password;
  const stored = db.prepare('SELECT * FROM establishments WHERE id = 1').get();
  assert.equal(stored.admin_password, temporaryPassword);
  assert.equal(stored.admin_must_change_password, 1);
  assert.ok(stored.admin_temp_password_expires_at);

  const token = createToken({ role: 'admin', establishmentId: 1, passwordAccountType: 'establishment', mustChangePassword: true });
  const changed = await request('/change-temporary-password', { token, body: { new_password: 'NuevaClave25!' } });
  assert.equal(changed.status, 200);
  assert.equal(db.prepare('SELECT admin_password FROM establishments WHERE id = 1').get().admin_password, 'NuevaClave25!');
  assert.equal(db.prepare('SELECT admin_must_change_password FROM establishments WHERE id = 1').get().admin_must_change_password, 0);
});

test('recovery accepts promoter email and preserves the Marjorie password hash format', async (t) => {
  const { db, server, deliveries, request } = fixture();
  t.after(() => { server.close(); db.close(); });

  assert.equal((await request('/forgot-password', { body: { identifier: 'promotor@test.com' } })).status, 200);
  assert.equal(db.prepare('SELECT must_change_password FROM promoters WHERE id = 2').get().must_change_password, 1);

  assert.equal((await request('/forgot-password', { body: { identifier: 'MB-0003' } })).status, 200);
  const temporaryPassword = deliveries.at(-1).password;
  const marjorie = db.prepare('SELECT password_hash, must_change_password FROM marjorie_promoters WHERE id = 3').get();
  assert.equal(marjorie.must_change_password, 1);
  assert.equal(verifyRecoveryPassword(temporaryPassword, marjorie.password_hash), true);
});
