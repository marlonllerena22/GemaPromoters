import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.DB_PATH || path.join(defaultDataDir, 'gemapromoters.sqlite');
const dataDir = path.dirname(dbPath);

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function initDb() {
  migrateEventLocationsForEvents();

  db.exec(`
    CREATE TABLE IF NOT EXISTS establishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      business_type TEXT NOT NULL DEFAULT 'event' CHECK (business_type IN ('event', 'commercial')),
      admin_username TEXT,
      admin_password TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      promoter_sales_enabled INTEGER NOT NULL DEFAULT 1 CHECK (promoter_sales_enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, name)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS promoters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL DEFAULT 1,
      branch_id INTEGER,
      name TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      email TEXT,
      whatsapp TEXT NOT NULL,
      instagram TEXT,
      photo_url TEXT,
      code TEXT NOT NULL UNIQUE,
      username TEXT,
      password TEXT,
      can_sell INTEGER NOT NULL DEFAULT 1 CHECK (can_sell IN (0, 1)),
      manual_points REAL NOT NULL DEFAULT 0 CHECK (manual_points >= 0),
      referred_by_promoter_id INTEGER,
      deleted_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      registered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      commission_type TEXT NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'fixed')),
      commission_value REAL NOT NULL DEFAULT 3 CHECK (commission_value >= 0),
      commission_min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (commission_min_quantity >= 1),
      level_points REAL NOT NULL DEFAULT 1 CHECK (level_points >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(event_id, name)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL DEFAULT 1,
      event_id INTEGER NOT NULL DEFAULT 1,
      order_number TEXT,
      promoter_id INTEGER NOT NULL,
      customer TEXT NOT NULL,
      customer_whatsapp TEXT NOT NULL,
      location TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      total REAL NOT NULL CHECK (total >= 0),
      commission REAL NOT NULL CHECK (commission >= 0),
      sale_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
      commission_paid INTEGER NOT NULL DEFAULT 0 CHECK (commission_paid IN (0, 1)),
      deleted_at TEXT,
      deleted_by TEXT,
      deletion_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (promoter_id) REFERENCES promoters(id)
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      promoter_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
      bank TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      account_number TEXT NOT NULL,
      cedula TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
      requested_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      paid_at TEXT,
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      FOREIGN KEY (promoter_id) REFERENCES promoters(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_settings (
      event_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (event_id, key),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS event_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );
  `);

  addColumnIfMissing('establishments', 'business_type', "TEXT NOT NULL DEFAULT 'event'");
  addColumnIfMissing('establishments', 'admin_username', 'TEXT');
  addColumnIfMissing('establishments', 'admin_password', 'TEXT');
  const defaultEstablishment = ensureDefaultEstablishments();
  addColumnIfMissing('events', 'establishment_id', `INTEGER NOT NULL DEFAULT ${defaultEstablishment.id}`);
  addColumnIfMissing('promoters', 'establishment_id', `INTEGER NOT NULL DEFAULT ${defaultEstablishment.id}`);
  addColumnIfMissing('promoters', 'branch_id', 'INTEGER');
  addColumnIfMissing('sales', 'establishment_id', `INTEGER NOT NULL DEFAULT ${defaultEstablishment.id}`);
  const defaultEvent = ensureDefaultEvent(defaultEstablishment.id);

  addColumnIfMissing('promoters', 'username', 'TEXT');
  addColumnIfMissing('promoters', 'password', 'TEXT');
  addColumnIfMissing('promoters', 'email', 'TEXT');
  addColumnIfMissing('promoters', 'photo_url', 'TEXT');
  addColumnIfMissing('promoters', 'can_sell', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('promoters', 'manual_points', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('promoters', 'referred_by_promoter_id', 'INTEGER');
  addColumnIfMissing('promoters', 'deleted_at', 'TEXT');
  addColumnIfMissing('event_locations', 'event_id', `INTEGER NOT NULL DEFAULT ${defaultEvent.id}`);
  addColumnIfMissing('event_locations', 'commission_type', "TEXT NOT NULL DEFAULT 'percent'");
  addColumnIfMissing('event_locations', 'commission_value', 'REAL NOT NULL DEFAULT 3');
  addColumnIfMissing('event_locations', 'commission_min_quantity', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('event_locations', 'level_points', 'REAL NOT NULL DEFAULT 1');
  addColumnIfMissing('sales', 'event_id', `INTEGER NOT NULL DEFAULT ${defaultEvent.id}`);
  addColumnIfMissing('sales', 'order_number', 'TEXT');
  addColumnIfMissing('sales', 'deleted_at', 'TEXT');
  addColumnIfMissing('sales', 'deleted_by', 'TEXT');
  addColumnIfMissing('sales', 'deletion_reason', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promoters_username ON promoters(username);

    UPDATE establishments
    SET business_type = 'event'
    WHERE business_type IS NULL OR business_type = '';

    UPDATE establishments
    SET admin_username = LOWER(REPLACE(name, ' ', ''))
    WHERE admin_username IS NULL OR admin_username = '';

    UPDATE establishments
    SET admin_password = LOWER(REPLACE(name, ' ', '')) || '123'
    WHERE admin_password IS NULL OR admin_password = '';

    UPDATE events
    SET establishment_id = ${defaultEstablishment.id}
    WHERE establishment_id IS NULL OR establishment_id = 0;

    UPDATE promoters
    SET establishment_id = ${defaultEstablishment.id}
    WHERE establishment_id IS NULL OR establishment_id = 0;

    UPDATE sales
    SET establishment_id = ${defaultEstablishment.id}
    WHERE establishment_id IS NULL OR establishment_id = 0;

    UPDATE promoters
    SET username = UPPER(code)
    WHERE username IS NULL OR username = '';

    UPDATE promoters
    SET password = cedula
    WHERE password IS NULL OR password = '';

    UPDATE promoters
    SET can_sell = 1
    WHERE can_sell IS NULL;

    UPDATE promoters
    SET manual_points = 0
    WHERE manual_points IS NULL OR manual_points < 0;

    UPDATE event_locations
    SET event_id = ${defaultEvent.id}
    WHERE event_id IS NULL;

    UPDATE sales
    SET event_id = ${defaultEvent.id}
    WHERE event_id IS NULL;

    UPDATE event_locations
    SET commission_type = 'percent'
    WHERE commission_type IS NULL OR commission_type = '';

    UPDATE event_locations
    SET commission_value = 3
    WHERE commission_value IS NULL;

    UPDATE event_locations
    SET commission_min_quantity = 1
    WHERE commission_min_quantity IS NULL OR commission_min_quantity < 1;

    UPDATE event_locations
    SET level_points = 1
    WHERE level_points IS NULL OR level_points < 0;

    UPDATE event_locations SET level_points = 3 WHERE UPPER(name) = 'BOX';
    UPDATE event_locations SET level_points = 2 WHERE UPPER(name) = 'VIP';
    UPDATE event_locations SET level_points = 1 WHERE UPPER(name) = 'FAN';

    UPDATE sales
    SET order_number = 'PED-' || printf('%06d', id)
    WHERE order_number IS NULL OR order_number = '';

    INSERT OR IGNORE INTO event_locations
      (event_id, name, price, commission_type, commission_value, commission_min_quantity, level_points, status)
    VALUES
      (${defaultEvent.id}, 'VIP', 35, 'percent', 3, 1, 2, 'active');

    INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('level_bronze_min', '1'),
      ('level_silver_min', '10'),
      ('level_diamond_min', '25'),
      ('referral_points', '3'),
      ('level_bronze_benefits', 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como Bronze promoter'),
      ('level_silver_benefits', 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Silver en el perfil'),
      ('level_diamond_benefits', 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Gold GEMASHOW');
  `);

  db.prepare("UPDATE app_settings SET value = REPLACE(REPLACE(REPLACE(value, 'Diamante', 'Gold'), 'Bronce', 'Bronze'), 'Plata', 'Silver') WHERE key LIKE 'level_%_benefits'").run();
  db.prepare("UPDATE event_settings SET value = REPLACE(REPLACE(REPLACE(value, 'Diamante', 'Gold'), 'Bronce', 'Bronze'), 'Plata', 'Silver') WHERE key LIKE 'level_%_benefits'").run();

  seedDefaultEventSettings(defaultEvent.id);
  ensureMarjorieEstablishment();
}

export function toMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateEventLocationsForEvents() {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_locations'").get();
  if (!table) {
    return;
  }

  const columns = db.prepare('PRAGMA table_info(event_locations)').all();
  const hasEventId = columns.some((item) => item.name === 'event_id');
  const indexes = db.prepare('PRAGMA index_list(event_locations)').all();
  const hasInlineUniqueName = indexes.some((item) => item.origin === 'u');

  if (hasEventId && !hasInlineUniqueName) {
    return;
  }

  const eventColumn = hasEventId ? 'COALESCE(event_id, 1)' : '1';

  db.exec(`
    ALTER TABLE event_locations RENAME TO event_locations_old;

    CREATE TABLE event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      commission_type TEXT NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent', 'fixed')),
      commission_value REAL NOT NULL DEFAULT 3 CHECK (commission_value >= 0),
      commission_min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (commission_min_quantity >= 1),
      level_points REAL NOT NULL DEFAULT 1 CHECK (level_points >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(event_id, name)
    );

    INSERT INTO event_locations
      (id, event_id, name, price, commission_type, commission_value, commission_min_quantity, level_points, status, created_at)
    SELECT
      id,
      ${eventColumn},
      name,
      price,
      COALESCE(commission_type, 'percent'),
      COALESCE(commission_value, 3),
      COALESCE(commission_min_quantity, 1),
      COALESCE(level_points, 1),
      COALESCE(status, 'active'),
      COALESCE(created_at, datetime('now', 'localtime'))
    FROM event_locations_old;

    DROP TABLE event_locations_old;
  `);
}

function ensureDefaultEstablishments() {
  let establishment = db.prepare('SELECT * FROM establishments WHERE name = ?').get('GEMASHOW');

  if (!establishment) {
    const result = db
      .prepare('INSERT INTO establishments (name, display_name, business_type, admin_username, admin_password, status, promoter_sales_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('GEMASHOW', 'GEMASHOW', 'event', 'admin', 'admin123', 'active', 1);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare("UPDATE establishments SET business_type = 'event', promoter_sales_enabled = 1, admin_username = COALESCE(NULLIF(admin_username, ''), 'admin'), admin_password = COALESCE(NULLIF(admin_password, ''), 'admin123') WHERE id = ?").run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  return establishment;
}

function ensureMarjorieEstablishment() {
  let establishment = db.prepare('SELECT * FROM establishments WHERE name = ?').get('Marjorie Promotoras');
  if (!establishment) {
    const result = db
      .prepare('INSERT INTO establishments (name, display_name, business_type, admin_username, admin_password, status, promoter_sales_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('Marjorie Promotoras', 'Marjorie Botas', 'commercial', 'marjorie', 'marjorie123', 'active', 0);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare("UPDATE establishments SET business_type = 'commercial', promoter_sales_enabled = 0 WHERE id = ?").run(establishment.id);
    db.prepare("UPDATE establishments SET admin_username = 'marjorie' WHERE id = ? AND (admin_username IS NULL OR admin_username = '' OR admin_username = 'marjoriepromotoras')").run(establishment.id);
    db.prepare("UPDATE establishments SET admin_password = 'marjorie123' WHERE id = ? AND (admin_password IS NULL OR admin_password = '' OR admin_password = 'marjoriepromotoras123')").run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  db.prepare('INSERT OR IGNORE INTO branches (establishment_id, name, address, status) VALUES (?, ?, ?, ?)')
    .run(establishment.id, 'Sucursal principal', '', 'active');

  let event = db.prepare('SELECT * FROM events WHERE establishment_id = ? ORDER BY is_active DESC, id ASC').get(establishment.id);
  if (!event) {
    const result = db
      .prepare('INSERT INTO events (establishment_id, name, description, status, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(establishment.id, 'MARJORIE BOTAS', 'Programa de promotoras Marjorie Botas', 'active');
    event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  }
  seedDefaultEventSettings(event.id);
  return establishment;
}

function ensureDefaultEvent(establishmentId) {
  const defaultName = 'KRIS R EL TRAP DE KOLOMBIA';
  let event = db.prepare('SELECT * FROM events WHERE name = ?').get(defaultName);
  const activeEvent = db.prepare('SELECT * FROM events WHERE establishment_id = ? AND is_active = 1').get(establishmentId);

  if (!event) {
    const result = db
      .prepare('INSERT INTO events (establishment_id, name, description, status, is_active) VALUES (?, ?, ?, ?, ?)')
      .run(establishmentId, defaultName, 'Evento principal GEMASHOW', 'active', activeEvent ? 0 : 1);
    event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  } else if (!event.establishment_id) {
    db.prepare('UPDATE events SET establishment_id = ? WHERE id = ?').run(establishmentId, event.id);
    event = db.prepare('SELECT * FROM events WHERE id = ?').get(event.id);
  }

  if (!activeEvent) {
    db.prepare('UPDATE events SET is_active = 1, status = ? WHERE id = ?').run('active', event.id);
    db.prepare('UPDATE events SET is_active = 0 WHERE establishment_id = ? AND id <> ?').run(establishmentId, event.id);
  }

  return event;
}

function seedDefaultEventSettings(eventId) {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM event_settings WHERE event_id = ?').get(eventId).total;
  if (existing) {
    return;
  }

  const save = db.prepare('INSERT OR IGNORE INTO event_settings (event_id, key, value) VALUES (?, ?, ?)');
  const globalSettings = db.prepare('SELECT key, value FROM app_settings').all();
  const defaults = new Map([
    ['level_bronze_min', '1'],
    ['level_silver_min', '10'],
    ['level_diamond_min', '25'],
    ['referral_points', '3'],
    ['level_bronze_benefits', 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como Bronze promoter'],
    ['level_silver_benefits', 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Silver en el perfil'],
    ['level_diamond_benefits', 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Gold GEMASHOW']
  ]);

  for (const row of globalSettings) {
    defaults.set(row.key, row.value);
  }

  for (const [key, value] of defaults) {
    save.run(eventId, key, value);
  }
}

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function normalizeLookup(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}
