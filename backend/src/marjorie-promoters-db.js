export function initMarjoriePromotersDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marjorie_promoters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      whatsapp TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      instagram TEXT NOT NULL,
      city TEXT NOT NULL,
      photo_url TEXT,
      password_hash TEXT NOT NULL,
      code TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'review', 'suspended', 'revoked', 'rejected')),
      terms_version TEXT NOT NULL,
      terms_accepted_at TEXT NOT NULL,
      activated_at TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      admin_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS marjorie_promoter_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promoter_id INTEGER NOT NULL,
      branch_client_id INTEGER,
      branch_name TEXT,
      customer_name TEXT NOT NULL,
      customer_whatsapp TEXT,
      pairs INTEGER NOT NULL CHECK (pairs > 0),
      returned_pairs INTEGER NOT NULL DEFAULT 0 CHECK (returned_pairs >= 0),
      sale_date TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1)),
      is_delivered INTEGER NOT NULL DEFAULT 0 CHECK (is_delivered IN (0, 1)),
      is_voided INTEGER NOT NULL DEFAULT 0 CHECK (is_voided IN (0, 1)),
      notes TEXT,
      created_by TEXT,
      external_source TEXT,
      external_sale_id TEXT,
      external_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (promoter_id) REFERENCES marjorie_promoters(id)
    );

    CREATE TABLE IF NOT EXISTS marjorie_promoter_bonuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promoter_id INTEGER NOT NULL,
      cycle_start TEXT NOT NULL,
      cut_number INTEGER NOT NULL CHECK (cut_number IN (1, 2)),
      active_page INTEGER NOT NULL DEFAULT 0,
      published_content INTEGER NOT NULL DEFAULT 0,
      stories_reels INTEGER NOT NULL DEFAULT 0,
      correct_information INTEGER NOT NULL DEFAULT 0,
      appropriate_content INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      amount REAL NOT NULL DEFAULT 25 CHECK (amount >= 0),
      evidence_url TEXT,
      observation TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (promoter_id) REFERENCES marjorie_promoters(id),
      UNIQUE(promoter_id, cycle_start, cut_number)
    );

    CREATE TABLE IF NOT EXISTS marjorie_promoter_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promoter_id INTEGER NOT NULL,
      cycle_start TEXT NOT NULL,
      cut_number INTEGER NOT NULL CHECK (cut_number IN (1, 2)),
      commission_amount REAL NOT NULL DEFAULT 0,
      bonus_amount REAL NOT NULL DEFAULT 0,
      adjustment_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL CHECK (total_amount >= 0),
      notes TEXT,
      paid_by TEXT NOT NULL,
      paid_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (promoter_id) REFERENCES marjorie_promoters(id),
      UNIQUE(promoter_id, cycle_start, cut_number)
    );

    CREATE TABLE IF NOT EXISTS marjorie_content_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promoter_id INTEGER NOT NULL,
      branch_client_id INTEGER NOT NULL,
      branch_name TEXT NOT NULL,
      request_type TEXT NOT NULL,
      desired_date TEXT NOT NULL,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_observation TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (promoter_id) REFERENCES marjorie_promoters(id)
    );

    CREATE TABLE IF NOT EXISTS marjorie_content_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image'
        CHECK (content_type IN ('image', 'video', 'reel', 'promotion', 'text', 'link')),
      asset_url TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS marjorie_promoter_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promoter_id INTEGER,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_marjorie_promoters_status ON marjorie_promoters(status, registered_at);
    CREATE INDEX IF NOT EXISTS idx_marjorie_sales_promoter_date ON marjorie_promoter_sales(promoter_id, sale_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_marjorie_sales_external
      ON marjorie_promoter_sales(external_source, external_sale_id)
      WHERE external_sale_id IS NOT NULL AND external_sale_id != '';
    CREATE INDEX IF NOT EXISTS idx_marjorie_bonuses_promoter_cycle ON marjorie_promoter_bonuses(promoter_id, cycle_start);
    CREATE INDEX IF NOT EXISTS idx_marjorie_payments_promoter_date ON marjorie_promoter_payments(promoter_id, paid_at);
    CREATE INDEX IF NOT EXISTS idx_marjorie_requests_status ON marjorie_content_requests(status, desired_date);
  `);
}
