function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initTicketingDb(db) {
  let establishment = db.prepare("SELECT * FROM establishments WHERE name = 'PROTICKETS'").get();
  if (!establishment) {
    const result = db.prepare(
      `INSERT INTO establishments
       (name, display_name, business_type, module_type, code_prefix, theme, logo_url,
        admin_username, admin_password, status, promoter_sales_enabled)
       VALUES (?, ?, 'event', 'ticketing', 'PT', 'protickets', ?, ?, ?, 'active', 0)`
    ).run(
      'PROTICKETS',
      'ProTickets',
      '/protickets/protickets-logo.png',
      'protickets',
      'protickets123'
    );
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE establishments
       SET display_name = COALESCE(NULLIF(display_name, ''), 'ProTickets'),
           business_type = 'event',
           module_type = 'ticketing',
           code_prefix = 'PT',
           theme = 'protickets',
           logo_url = COALESCE(NULLIF(logo_url, ''), '/protickets/protickets-logo.png'),
           admin_username = COALESCE(NULLIF(admin_username, ''), 'protickets'),
           admin_password = COALESCE(NULLIF(admin_password, ''), 'protickets123'),
           promoter_sales_enabled = 0
       WHERE id = ?`
    ).run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticketing_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      cedula TEXT,
      phone TEXT,
      password_hash TEXT,
      google_sub TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, email)
    );

    CREATE TABLE IF NOT EXISTS ticketing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      venue TEXT,
      city TEXT,
      address TEXT,
      event_date TEXT,
      doors_time TEXT,
      hero_image_url TEXT,
      card_image_url TEXT,
      organizer TEXT,
      terms TEXT,
      bendo_payment_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'sold_out', 'archived')),
      featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, slug)
    );

    CREATE TABLE IF NOT EXISTS ticketing_ticket_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
      service_fee REAL NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
      max_per_order INTEGER NOT NULL DEFAULT 6 CHECK (max_per_order >= 1),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold_out')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES ticketing_events(id),
      UNIQUE(event_id, name)
    );

    CREATE TABLE IF NOT EXISTS ticketing_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      title TEXT,
      subtitle TEXT,
      cta_label TEXT,
      cta_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS ticketing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      order_number TEXT NOT NULL UNIQUE,
      subtotal REAL NOT NULL DEFAULT 0,
      service_fee REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'rejected', 'expired', 'refunded')),
      payment_url TEXT,
      external_reference TEXT,
      expires_at TEXT,
      paid_at TEXT,
      email_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (event_id) REFERENCES ticketing_events(id),
      FOREIGN KEY (customer_id) REFERENCES ticketing_customers(id)
    );

    CREATE TABLE IF NOT EXISTS ticketing_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      ticket_type_id INTEGER NOT NULL,
      ticket_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL DEFAULT 0,
      unit_fee REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (order_id) REFERENCES ticketing_orders(id),
      FOREIGN KEY (ticket_type_id) REFERENCES ticketing_ticket_types(id)
    );

    CREATE TABLE IF NOT EXISTS ticketing_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'used', 'void')),
      used_at TEXT,
      checked_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (event_id) REFERENCES ticketing_events(id),
      FOREIGN KEY (order_id) REFERENCES ticketing_orders(id),
      FOREIGN KEY (order_item_id) REFERENCES ticketing_order_items(id),
      FOREIGN KEY (customer_id) REFERENCES ticketing_customers(id)
    );

    CREATE TABLE IF NOT EXISTS ticketing_payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER,
      provider TEXT NOT NULL DEFAULT 'bendo',
      provider_reference TEXT,
      event_status TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES ticketing_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ticketing_events_public
      ON ticketing_events(establishment_id, status, featured, event_date);
    CREATE INDEX IF NOT EXISTS idx_ticketing_orders_customer
      ON ticketing_orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticketing_orders_status
      ON ticketing_orders(establishment_id, payment_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticketing_tickets_code
      ON ticketing_tickets(code, status);
  `);

  addColumnIfMissing(db, 'ticketing_orders', 'payment_url', 'TEXT');
  addColumnIfMissing(db, 'ticketing_orders', 'external_reference', 'TEXT');
  addColumnIfMissing(db, 'ticketing_orders', 'expires_at', 'TEXT');
  addColumnIfMissing(db, 'ticketing_orders', 'email_sent_at', 'TEXT');

  let event = db.prepare(
    `SELECT * FROM ticketing_events
     WHERE establishment_id = ? AND slug = 'kris-r-el-trap-de-kolombia'`
  ).get(establishment.id);
  if (!event) {
    const result = db.prepare(
      `INSERT INTO ticketing_events
       (establishment_id, slug, title, subtitle, description, venue, city, address,
        hero_image_url, card_image_url, organizer, terms, status, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1)`
    ).run(
      establishment.id,
      'kris-r-el-trap-de-kolombia',
      'KRIS R EL TRAP DE KOLOMBIA',
      'Una noche para vivir el trap en grande',
      'El primer evento de ProTickets. La fecha, el lugar, las imágenes y toda la información pueden editarse desde el administrador.',
      'Lugar por confirmar',
      'Ambato',
      'Ambato, Ecuador',
      '/protickets/kris-r-hero.png',
      '/protickets/kris-r-hero.png',
      'GEMASHOW',
      'La entrada es personal. Presenta tu código QR y documento de identidad al ingresar.'
    );
    event = db.prepare('SELECT * FROM ticketing_events WHERE id = ?').get(result.lastInsertRowid);
  }

  const insertType = db.prepare(
    `INSERT OR IGNORE INTO ticketing_ticket_types
     (event_id, name, description, price, service_fee, stock, max_per_order, status, sort_order)
     VALUES (?, ?, ?, ?, 0, 0, 6, 'active', ?)`
  );
  insertType.run(event.id, 'FAN', 'Acceso localidad Fan', 20, 1);
  insertType.run(event.id, 'VIP', 'Acceso localidad VIP', 30, 2);
  insertType.run(event.id, 'BOX', 'Acceso localidad Box', 40, 3);

  db.prepare(
    `INSERT INTO ticketing_banners
     (establishment_id, image_url, title, subtitle, cta_label, cta_url, status, sort_order)
     SELECT ?, ?, ?, ?, ?, ?, 'active', 1
     WHERE NOT EXISTS (SELECT 1 FROM ticketing_banners WHERE establishment_id = ?)`
  ).run(
    establishment.id,
    '/protickets/kris-r-hero.png',
    'KRIS R EL TRAP DE KOLOMBIA',
    'Muy pronto en Ambato',
    'Ver evento',
    '/tickets/evento/kris-r-el-trap-de-kolombia',
    establishment.id
  );

  return establishment;
}
