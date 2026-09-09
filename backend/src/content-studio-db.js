import crypto from 'node:crypto';
import fs from 'node:fs';

const DEFAULT_LOGOS = [
  ['Marjorie Botas', new URL('../assets/content-studio/marjorie-botas.jpg', import.meta.url)],
  ["Sebastian's", new URL('../assets/content-studio/sebastians.jpg', import.meta.url)]
];

export function hashContentStudioPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyContentStudioPassword(password, stored) {
  const [, salt, expected] = String(stored || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export function initContentStudioDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_studio_settings (
      establishment_id INTEGER PRIMARY KEY,
      plan_name TEXT NOT NULL DEFAULT 'Profesional',
      monthly_limit INTEGER NOT NULL DEFAULT 80 CHECK (monthly_limit >= 1),
      brand_name TEXT,
      brand_tone TEXT NOT NULL DEFAULT 'premium',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      image_data TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_logos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      image_data TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan_name TEXT NOT NULL DEFAULT 'Profesional',
      monthly_limit INTEGER NOT NULL DEFAULT 80 CHECK (monthly_limit >= 1),
      subscription_status TEXT NOT NULL DEFAULT 'inactive' CHECK (subscription_status IN ('paid', 'trial', 'inactive')),
      paid_at TEXT,
      paid_until TEXT,
      brand_tone TEXT NOT NULL DEFAULT 'premium',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      preset TEXT NOT NULL,
      product_name TEXT,
      brand_name TEXT,
      material TEXT,
      color TEXT,
      headline TEXT,
      mood TEXT,
      aspect_ratio TEXT,
      reference_ids_json TEXT NOT NULL DEFAULT '[]',
      output_image_data TEXT,
      revised_prompt TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
      error_message TEXT,
      created_by TEXT,
      content_studio_user_id INTEGER,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_refs_scope
      ON content_studio_references(establishment_id, category, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_logos_scope
      ON content_studio_logos(establishment_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_generations_scope
      ON content_studio_generations(establishment_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_users_scope
      ON content_studio_users(establishment_id, subscription_status, status);
  `);
  const generationColumns = db.prepare('PRAGMA table_info(content_studio_generations)').all();
  if (!generationColumns.some((column) => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE content_studio_generations ADD COLUMN deleted_at TEXT');
  }
  if (!generationColumns.some((column) => column.name === 'content_studio_user_id')) {
    db.exec('ALTER TABLE content_studio_generations ADD COLUMN content_studio_user_id INTEGER');
  }
  const settingsColumns = db.prepare('PRAGMA table_info(content_studio_settings)').all();
  if (!settingsColumns.some((column) => column.name === 'logos_seeded')) {
    db.exec('ALTER TABLE content_studio_settings ADD COLUMN logos_seeded INTEGER NOT NULL DEFAULT 0');
  }
}

export function ensureContentStudioEstablishment(db) {
  let establishment = db.prepare("SELECT * FROM establishments WHERE module_type = 'content_studio' ORDER BY id ASC").get();
  if (!establishment) {
    const result = db.prepare(
      `INSERT INTO establishments
       (name, display_name, business_type, module_type, code_prefix, theme, logo_url, admin_username, admin_password, status, promoter_sales_enabled)
       VALUES (?, ?, 'commercial', 'content_studio', ?, ?, '', ?, ?, 'active', 0)`
    ).run(
      'ESTUDIO CREATIVO',
      'Estudio Creativo',
      'STUDIO',
      'contentstudio',
      process.env.CONTENT_STUDIO_ADMIN_USER || 'contenido',
      process.env.CONTENT_STUDIO_ADMIN_PASSWORD || 'contenido123'
    );
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE establishments
       SET business_type = 'commercial', module_type = 'content_studio', promoter_sales_enabled = 0,
           theme = 'contentstudio'
       WHERE id = ?`
    ).run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  db.prepare(
    `INSERT OR IGNORE INTO content_studio_settings
     (establishment_id, plan_name, monthly_limit, brand_name, brand_tone)
     VALUES (?, 'Profesional', 80, ?, 'premium')`
  ).run(establishment.id, establishment.display_name || establishment.name);

  const settings = db.prepare('SELECT logos_seeded FROM content_studio_settings WHERE establishment_id = ?').get(establishment.id);
  if (!settings?.logos_seeded) {
    const insertLogo = db.prepare('INSERT INTO content_studio_logos (establishment_id, name, image_data, created_by) VALUES (?, ?, ?, ?)');
    const seedLogos = db.transaction(() => {
      for (const [name, file] of DEFAULT_LOGOS) {
        const imageData = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
        insertLogo.run(establishment.id, name, imageData, 'system');
      }
      db.prepare('UPDATE content_studio_settings SET logos_seeded = 1 WHERE establishment_id = ?').run(establishment.id);
    });
    seedLogos();
  }

  const demoUsername = process.env.CONTENT_STUDIO_DEMO_USER || 'cliente.demo';
  const existingDemo = db.prepare('SELECT id FROM content_studio_users WHERE username = ?').get(demoUsername);
  if (!existingDemo) {
    db.prepare(
      `INSERT INTO content_studio_users
       (establishment_id, name, business_name, username, password_hash, plan_name, monthly_limit, subscription_status, paid_at, paid_until, brand_tone, status)
       VALUES (?, 'Cliente Demo', 'Negocio Demo', ?, ?, 'Profesional', 80, 'paid', date('now', 'localtime'), date('now', 'localtime', '+1 year'), 'premium', 'active')`
    ).run(establishment.id, demoUsername, hashContentStudioPassword(process.env.CONTENT_STUDIO_DEMO_PASSWORD || 'contenido2026'));
  }
  return establishment;
}

export function findContentStudioUserForLogin(db, username, password) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const user = db.prepare(
    `SELECT users.*, establishments.name AS establishment_name, establishments.display_name AS establishment_display_name
     FROM content_studio_users users
     JOIN establishments ON establishments.id = users.establishment_id
     WHERE LOWER(users.username) = ? AND users.status = 'active' AND establishments.status = 'active' AND establishments.module_type = 'content_studio'`
  ).get(cleanUsername);
  return user && verifyContentStudioPassword(password, user.password_hash) ? user : null;
}
