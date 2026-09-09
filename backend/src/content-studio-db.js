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
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_refs_scope
      ON content_studio_references(establishment_id, category, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_generations_scope
      ON content_studio_generations(establishment_id, created_at);
  `);
  const generationColumns = db.prepare('PRAGMA table_info(content_studio_generations)').all();
  if (!generationColumns.some((column) => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE content_studio_generations ADD COLUMN deleted_at TEXT');
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
  return establishment;
}
