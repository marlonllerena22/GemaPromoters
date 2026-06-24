export function initProducalzaDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendor' CHECK (role IN ('admin', 'vendor')),
      can_view_all_orders INTEGER NOT NULL DEFAULT 0 CHECK (can_view_all_orders IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS production_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      external_number INTEGER,
      name TEXT NOT NULL,
      business_name TEXT,
      tax_id TEXT,
      city TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      brand TEXT,
      payment_method TEXT,
      bank_reference TEXT,
      classification TEXT,
      imported_seller_code TEXT,
      guide_template_key TEXT,
      guide_logo_url TEXT,
      general_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, external_number)
    );

    CREATE TABLE IF NOT EXISTS production_client_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      visited_by_user_id INTEGER,
      visitor_name TEXT,
      visit_type TEXT NOT NULL DEFAULT 'visit',
      result TEXT,
      next_visit_date TEXT,
      order_id INTEGER,
      visit_date TEXT,
      visit_date_text TEXT,
      pairs INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (client_id) REFERENCES production_clients(id),
      FOREIGN KEY (visited_by_user_id) REFERENCES production_users(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id)
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_number TEXT,
      client_id INTEGER NOT NULL,
      seller_user_id INTEGER,
      order_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      brand TEXT,
      payment_method TEXT,
      bank_reference TEXT,
      guide_template_key TEXT,
      general_notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'received', 'reviewed', 'in_production', 'finished', 'delivered', 'cancelled')),
      created_by TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (client_id) REFERENCES production_clients(id),
      FOREIGN KEY (seller_user_id) REFERENCES production_users(id),
      UNIQUE(establishment_id, order_number)
    );

    CREATE TABLE IF NOT EXISTS production_order_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      card_number INTEGER,
      model_code TEXT NOT NULL,
      color TEXT,
      material TEXT,
      notes TEXT,
      plant_area TEXT,
      total_pairs INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'reviewed', 'in_production', 'cut', 'stitched', 'assembled', 'finished', 'delivered', 'cancelled')),
      process_cut INTEGER NOT NULL DEFAULT 0 CHECK (process_cut IN (0, 1)),
      process_prepared INTEGER NOT NULL DEFAULT 0 CHECK (process_prepared IN (0, 1)),
      process_stitched INTEGER NOT NULL DEFAULT 0 CHECK (process_stitched IN (0, 1)),
      process_assembled INTEGER NOT NULL DEFAULT 0 CHECK (process_assembled IN (0, 1)),
      process_planted INTEGER NOT NULL DEFAULT 0 CHECK (process_planted IN (0, 1)),
      process_finished INTEGER NOT NULL DEFAULT 0 CHECK (process_finished IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id),
      UNIQUE(establishment_id, card_number)
    );

    CREATE TABLE IF NOT EXISTS production_model_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      model_id INTEGER NOT NULL,
      size INTEGER NOT NULL CHECK (size BETWEEN 20 AND 50),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (model_id) REFERENCES production_order_models(id),
      UNIQUE(model_id, size)
    );

    CREATE TABLE IF NOT EXISTS production_settings (
      establishment_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (establishment_id, key),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS production_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      user_label TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_production_clients_business
      ON production_clients(establishment_id, name);
    CREATE INDEX IF NOT EXISTS idx_production_orders_business
      ON production_orders(establishment_id, order_date, status);
    CREATE INDEX IF NOT EXISTS idx_production_models_order
      ON production_order_models(order_id, status);
  `);

  addColumnIfMissing(db, 'production_client_visits', 'visited_by_user_id', 'INTEGER');
  addColumnIfMissing(db, 'production_client_visits', 'visitor_name', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'visit_type', "TEXT NOT NULL DEFAULT 'visit'");
  addColumnIfMissing(db, 'production_client_visits', 'result', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'next_visit_date', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'order_id', 'INTEGER');
  addColumnIfMissing(db, 'production_client_visits', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'production_clients', 'guide_template_key', 'TEXT');
  addColumnIfMissing(db, 'production_clients', 'guide_logo_url', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'guide_template_key', 'TEXT');
  db.prepare(
    `UPDATE production_client_visits
     SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at),
         visit_type = COALESCE(NULLIF(visit_type, ''), 'visit')
     WHERE updated_at IS NULL OR updated_at = '' OR visit_type IS NULL OR visit_type = ''`
  ).run();

  let establishment = db.prepare("SELECT * FROM establishments WHERE name = 'PRODUCALZA'").get();
  if (!establishment) {
    const result = db
      .prepare(
        `INSERT INTO establishments
         (name, display_name, business_type, module_type, code_prefix, theme, logo_url, admin_username, admin_password, status, promoter_sales_enabled)
         VALUES (?, ?, 'commercial', 'production', ?, ?, ?, ?, ?, 'active', 0)`
      )
      .run('PRODUCALZA', 'PRODUCALZA', 'PROD', 'producalza', '', 'producalza', 'producalza123');
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE establishments
       SET business_type = 'commercial',
           module_type = 'production',
           promoter_sales_enabled = 0,
           code_prefix = COALESCE(NULLIF(code_prefix, ''), 'PROD'),
           theme = COALESCE(NULLIF(theme, ''), 'producalza'),
           admin_username = COALESCE(NULLIF(admin_username, ''), 'producalza'),
           admin_password = COALESCE(NULLIF(admin_password, ''), 'producalza123')
       WHERE id = ?`
    ).run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  db.prepare(
    `INSERT OR IGNORE INTO production_settings (establishment_id, key, value)
     VALUES (?, 'next_card_number', '62')`
  ).run(establishment.id);

}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
