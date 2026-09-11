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
      contact_whatsapp TEXT,
      contact_location TEXT,
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
      content_studio_user_id INTEGER,
      name TEXT NOT NULL,
      image_data TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      google_sub TEXT,
      avatar_url TEXT,
      credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
      plan_name TEXT NOT NULL DEFAULT 'Profesional',
      monthly_limit INTEGER NOT NULL DEFAULT 80 CHECK (monthly_limit >= 1),
      subscription_status TEXT NOT NULL DEFAULT 'inactive' CHECK (subscription_status IN ('paid', 'trial', 'inactive')),
      paid_at TEXT,
      paid_until TEXT,
      brand_tone TEXT NOT NULL DEFAULT 'premium',
      contact_whatsapp TEXT,
      contact_location TEXT,
      can_delete_generations INTEGER NOT NULL DEFAULT 1 CHECK (can_delete_generations IN (0, 1)),
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

    CREATE TABLE IF NOT EXISTS content_studio_plan_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_number TEXT UNIQUE,
      customer_name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      monthly_limit INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'transfer',
      transfer_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
      content_studio_user_id INTEGER,
      reviewed_by TEXT,
      reviewed_at TEXT,
      payment_provider TEXT NOT NULL DEFAULT 'transfer',
      provider_transaction_id TEXT,
      provider_payload_json TEXT,
      seller_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_seller_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      activity_type TEXT NOT NULL CHECK (activity_type IN ('visit', 'demo', 'followup')),
      business_name TEXT NOT NULL,
      contact_name TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (seller_id) REFERENCES content_studio_sellers(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_seller_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      plan_order_id INTEGER NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (seller_id) REFERENCES content_studio_sellers(id),
      FOREIGN KEY (plan_order_id) REFERENCES content_studio_plan_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_plan_orders_scope
      ON content_studio_plan_orders(establishment_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_sellers_scope
      ON content_studio_sellers(establishment_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_seller_activities_scope
      ON content_studio_seller_activities(establishment_id, seller_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_studio_seller_sales_scope
      ON content_studio_seller_sales(establishment_id, seller_id, created_at);

    CREATE TABLE IF NOT EXISTS content_studio_research_cache (
      query_key TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      context TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS content_studio_magic_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      content_studio_user_id INTEGER,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_magic_email
      ON content_studio_magic_links(establishment_id, email, created_at);

    CREATE TABLE IF NOT EXISTS content_studio_auth_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_content_studio_auth_handoffs_expiry
      ON content_studio_auth_handoffs(expires_at);

    CREATE TABLE IF NOT EXISTS content_studio_meta_oauth_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_hash TEXT NOT NULL UNIQUE,
      establishment_id INTEGER NOT NULL,
      content_studio_user_id INTEGER,
      owner_key TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE TABLE IF NOT EXISTS content_studio_social_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      content_studio_user_id INTEGER,
      owner_key TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'meta',
      meta_user_id TEXT,
      page_id TEXT NOT NULL,
      page_name TEXT NOT NULL,
      instagram_account_id TEXT,
      instagram_username TEXT,
      token_ciphertext TEXT NOT NULL,
      token_expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT,
      UNIQUE(owner_key, provider, page_id),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_social_connections_owner
      ON content_studio_social_connections(owner_key, status, created_at);

    CREATE TABLE IF NOT EXISTS content_studio_social_publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      content_studio_user_id INTEGER,
      connection_id INTEGER NOT NULL,
      generation_id INTEGER NOT NULL,
      network TEXT NOT NULL CHECK (network IN ('facebook', 'instagram')),
      copy_text TEXT,
      status TEXT NOT NULL CHECK (status IN ('published', 'failed')),
      external_post_id TEXT,
      permalink TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (connection_id) REFERENCES content_studio_social_connections(id),
      FOREIGN KEY (generation_id) REFERENCES content_studio_generations(id),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (content_studio_user_id) REFERENCES content_studio_users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_content_studio_social_publications_generation
      ON content_studio_social_publications(generation_id, created_at);

    CREATE TABLE IF NOT EXISTS content_studio_social_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      confirmation_code TEXT NOT NULL UNIQUE,
      meta_user_id TEXT NOT NULL,
      connections_revoked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS content_studio_payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      plan_order_id INTEGER,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(provider, provider_event_id),
      FOREIGN KEY (plan_order_id) REFERENCES content_studio_plan_orders(id)
    );
  `);
  const generationColumns = db.prepare('PRAGMA table_info(content_studio_generations)').all();
  if (!generationColumns.some((column) => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE content_studio_generations ADD COLUMN deleted_at TEXT');
  }
  if (!generationColumns.some((column) => column.name === 'content_studio_user_id')) {
    db.exec('ALTER TABLE content_studio_generations ADD COLUMN content_studio_user_id INTEGER');
  }
  const socialConnectionColumns = db.prepare('PRAGMA table_info(content_studio_social_connections)').all();
  if (!socialConnectionColumns.some((column) => column.name === 'meta_user_id')) {
    db.exec('ALTER TABLE content_studio_social_connections ADD COLUMN meta_user_id TEXT');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_content_studio_social_connections_meta_user
    ON content_studio_social_connections(meta_user_id, status)`);
  const settingsColumns = db.prepare('PRAGMA table_info(content_studio_settings)').all();
  if (!settingsColumns.some((column) => column.name === 'logos_seeded')) {
    db.exec('ALTER TABLE content_studio_settings ADD COLUMN logos_seeded INTEGER NOT NULL DEFAULT 0');
  }
  if (!settingsColumns.some((column) => column.name === 'user_logos_isolated')) {
    db.exec('ALTER TABLE content_studio_settings ADD COLUMN user_logos_isolated INTEGER NOT NULL DEFAULT 0');
  }
  if (!settingsColumns.some((column) => column.name === 'contact_whatsapp')) {
    db.exec('ALTER TABLE content_studio_settings ADD COLUMN contact_whatsapp TEXT');
  }
  if (!settingsColumns.some((column) => column.name === 'contact_location')) {
    db.exec('ALTER TABLE content_studio_settings ADD COLUMN contact_location TEXT');
  }
  const userColumns = db.prepare('PRAGMA table_info(content_studio_users)').all();
  const creditLimitWasMissing = !userColumns.some((column) => column.name === 'credit_limit');
  if (!userColumns.some((column) => column.name === 'email')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN email TEXT');
  }
  if (!userColumns.some((column) => column.name === 'google_sub')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN google_sub TEXT');
  }
  if (!userColumns.some((column) => column.name === 'avatar_url')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN avatar_url TEXT');
  }
  if (creditLimitWasMissing) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0)');
    db.exec('UPDATE content_studio_users SET credit_limit = monthly_limit');
  }
  if (!userColumns.some((column) => column.name === 'contact_whatsapp')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN contact_whatsapp TEXT');
  }
  if (!userColumns.some((column) => column.name === 'contact_location')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN contact_location TEXT');
  }
  if (!userColumns.some((column) => column.name === 'can_delete_generations')) {
    db.exec('ALTER TABLE content_studio_users ADD COLUMN can_delete_generations INTEGER NOT NULL DEFAULT 1 CHECK (can_delete_generations IN (0, 1))');
    db.prepare(`UPDATE content_studio_users SET can_delete_generations = 0
      WHERE LOWER(username) IN ('martha.bosque', 'norma.llamuca')
         OR LOWER(TRIM(name)) IN ('martha bosque', 'norma llamuca')`).run();
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_content_studio_users_email ON content_studio_users(LOWER(email)) WHERE email IS NOT NULL AND email != ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_content_studio_users_google_sub ON content_studio_users(google_sub) WHERE google_sub IS NOT NULL AND google_sub != ''");

  const orderColumns = db.prepare('PRAGMA table_info(content_studio_plan_orders)').all();
  if (!orderColumns.some((column) => column.name === 'payment_provider')) {
    db.exec("ALTER TABLE content_studio_plan_orders ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'transfer'");
  }
  if (!orderColumns.some((column) => column.name === 'provider_transaction_id')) {
    db.exec('ALTER TABLE content_studio_plan_orders ADD COLUMN provider_transaction_id TEXT');
  }
  if (!orderColumns.some((column) => column.name === 'provider_payload_json')) {
    db.exec('ALTER TABLE content_studio_plan_orders ADD COLUMN provider_payload_json TEXT');
  }
  if (!orderColumns.some((column) => column.name === 'seller_id')) {
    db.exec('ALTER TABLE content_studio_plan_orders ADD COLUMN seller_id INTEGER');
  }
  const logoColumns = db.prepare('PRAGMA table_info(content_studio_logos)').all();
  if (!logoColumns.some((column) => column.name === 'content_studio_user_id')) {
    db.exec('ALTER TABLE content_studio_logos ADD COLUMN content_studio_user_id INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_content_studio_logos_user_scope ON content_studio_logos(establishment_id, content_studio_user_id, created_at)');
  const migrateLegacyLogos = db.transaction(() => {
    const scopes = db.prepare('SELECT establishment_id FROM content_studio_settings WHERE user_logos_isolated = 0').all();
    const usersForScope = db.prepare('SELECT id FROM content_studio_users WHERE establishment_id = ?');
    const legacyLogosForScope = db.prepare('SELECT name, image_data, created_by, created_at FROM content_studio_logos WHERE establishment_id = ? AND content_studio_user_id IS NULL');
    const cloneLogo = db.prepare(`INSERT INTO content_studio_logos
      (establishment_id, content_studio_user_id, name, image_data, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const scope of scopes) {
      const users = usersForScope.all(scope.establishment_id);
      const legacyLogos = legacyLogosForScope.all(scope.establishment_id);
      for (const user of users) {
        for (const logo of legacyLogos) {
          cloneLogo.run(scope.establishment_id, user.id, logo.name, logo.image_data, logo.created_by, logo.created_at);
        }
      }
      db.prepare('UPDATE content_studio_settings SET user_logos_isolated = 1 WHERE establishment_id = ?').run(scope.establishment_id);
    }
  });
  migrateLegacyLogos();
}

export function ensureContentStudioEstablishment(db) {
  const configuredAdminUser = String(process.env.CONTENT_STUDIO_ADMIN_USER || '').trim();
  const configuredAdminPassword = String(process.env.CONTENT_STUDIO_ADMIN_PASSWORD || '');
  let establishment = db.prepare("SELECT * FROM establishments WHERE module_type = 'content_studio' ORDER BY id ASC").get();
  if (!establishment) {
    const result = db.prepare(
      `INSERT INTO establishments
       (name, display_name, business_type, module_type, code_prefix, theme, logo_url, admin_username, admin_password, status, promoter_sales_enabled)
       VALUES (?, ?, 'commercial', 'content_studio', ?, ?, '', ?, ?, 'active', 0)`
    ).run(
      'ESTUDIOS CREATIVOS',
      'Estudios Creativos',
      'STUDIO',
      'contentstudio',
      configuredAdminUser || 'contenido',
      configuredAdminPassword || 'contenido123'
    );
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE establishments
       SET name = 'ESTUDIOS CREATIVOS', display_name = 'Estudios Creativos',
           business_type = 'commercial', module_type = 'content_studio', promoter_sales_enabled = 0,
           theme = 'contentstudio',
           admin_username = CASE WHEN ? <> '' THEN ? ELSE admin_username END,
           admin_password = CASE WHEN ? <> '' THEN ? ELSE admin_password END
       WHERE id = ?`
    ).run(configuredAdminUser, configuredAdminUser, configuredAdminPassword, configuredAdminPassword, establishment.id);
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
       (establishment_id, name, business_name, username, password_hash, credit_limit, plan_name, monthly_limit, subscription_status, paid_at, paid_until, brand_tone, status)
       VALUES (?, 'Cliente Demo', 'Negocio Demo', ?, ?, 80, 'Profesional', 80, 'paid', date('now', 'localtime'), date('now', 'localtime', '+1 year'), 'premium', 'active')`
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

export function findContentStudioSellerForLogin(db, username, password) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const seller = db.prepare(
    `SELECT sellers.*, establishments.name AS establishment_name, establishments.display_name AS establishment_display_name
     FROM content_studio_sellers sellers
     JOIN establishments ON establishments.id = sellers.establishment_id
     WHERE LOWER(sellers.username) = ? AND sellers.status = 'active'
       AND establishments.status = 'active' AND establishments.module_type = 'content_studio'`
  ).get(cleanUsername);
  return seller && verifyContentStudioPassword(password, seller.password_hash) ? seller : null;
}
