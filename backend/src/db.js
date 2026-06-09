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
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS promoters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      whatsapp TEXT NOT NULL,
      instagram TEXT,
      photo_url TEXT,
      code TEXT NOT NULL UNIQUE,
      username TEXT,
      password TEXT,
      can_sell INTEGER NOT NULL DEFAULT 1 CHECK (can_sell IN (0, 1)),
      manual_points REAL NOT NULL DEFAULT 0 CHECK (manual_points >= 0),
      referred_by_promoter_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      registered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
      event_id INTEGER NOT NULL DEFAULT 1,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
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

  const defaultEvent = ensureDefaultEvent();

  addColumnIfMissing('promoters', 'username', 'TEXT');
  addColumnIfMissing('promoters', 'password', 'TEXT');
  addColumnIfMissing('promoters', 'photo_url', 'TEXT');
  addColumnIfMissing('promoters', 'can_sell', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('promoters', 'manual_points', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('promoters', 'referred_by_promoter_id', 'INTEGER');
  addColumnIfMissing('event_locations', 'event_id', `INTEGER NOT NULL DEFAULT ${defaultEvent.id}`);
  addColumnIfMissing('event_locations', 'commission_type', "TEXT NOT NULL DEFAULT 'percent'");
  addColumnIfMissing('event_locations', 'commission_value', 'REAL NOT NULL DEFAULT 3');
  addColumnIfMissing('event_locations', 'commission_min_quantity', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('event_locations', 'level_points', 'REAL NOT NULL DEFAULT 1');
  addColumnIfMissing('sales', 'event_id', `INTEGER NOT NULL DEFAULT ${defaultEvent.id}`);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promoters_username ON promoters(username);

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

    INSERT OR IGNORE INTO event_locations
      (event_id, name, price, commission_type, commission_value, commission_min_quantity, level_points, status)
    VALUES
      (${defaultEvent.id}, 'VIP', 35, 'percent', 3, 1, 2, 'active');

    INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('level_bronze_min', '1'),
      ('level_silver_min', '10'),
      ('level_diamond_min', '25'),
      ('referral_points', '3'),
      ('level_bronze_benefits', 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como promotor Bronce'),
      ('level_silver_benefits', 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Plata en el perfil'),
      ('level_diamond_benefits', 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Diamante GEMASHOW');
  `);

  seedDefaultEventSettings(defaultEvent.id);
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

function ensureDefaultEvent() {
  const defaultName = 'KRIS R EL TRAP DE KOLOMBIA';
  let event = db.prepare('SELECT * FROM events WHERE name = ?').get(defaultName);
  const activeEvent = db.prepare('SELECT * FROM events WHERE is_active = 1').get();

  if (!event) {
    const result = db
      .prepare('INSERT INTO events (name, description, status, is_active) VALUES (?, ?, ?, ?)')
      .run(defaultName, 'Evento principal GEMASHOW', 'active', activeEvent ? 0 : 1);
    event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  }

  if (!activeEvent) {
    db.prepare('UPDATE events SET is_active = 1, status = ? WHERE id = ?').run('active', event.id);
    db.prepare('UPDATE events SET is_active = 0 WHERE id <> ?').run(event.id);
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
    ['level_bronze_benefits', 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como promotor Bronce'],
    ['level_silver_benefits', 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Plata en el perfil'],
    ['level_diamond_benefits', 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Diamante GEMASHOW']
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
