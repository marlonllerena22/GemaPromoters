function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
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
      hero_display_mode TEXT NOT NULL DEFAULT 'cover',
      organizer TEXT,
      terms TEXT,
      bendo_payment_url TEXT,
      sales_enabled INTEGER NOT NULL DEFAULT 1,
      payment_enabled INTEGER NOT NULL DEFAULT 1,
      is_past INTEGER NOT NULL DEFAULT 0,
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
      event_id INTEGER,
      image_url TEXT NOT NULL,
      mobile_image_url TEXT,
      title TEXT,
      subtitle TEXT,
      cta_label TEXT,
      cta_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      show_overlay INTEGER NOT NULL DEFAULT 1,
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
      provider TEXT NOT NULL DEFAULT 'payphone',
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
  addColumnIfMissing(db, 'ticketing_events', 'hero_display_mode', "TEXT NOT NULL DEFAULT 'cover'");
  addColumnIfMissing(db, 'ticketing_events', 'sales_enabled', 'INTEGER NOT NULL DEFAULT 1');
  const addedPaymentEnabled = addColumnIfMissing(db, 'ticketing_events', 'payment_enabled', 'INTEGER NOT NULL DEFAULT 1');
  const addedPastState = addColumnIfMissing(db, 'ticketing_events', 'is_past', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'ticketing_banners', 'event_id', 'INTEGER');
  addColumnIfMissing(db, 'ticketing_banners', 'mobile_image_url', 'TEXT');
  addColumnIfMissing(db, 'ticketing_banners', 'show_overlay', 'INTEGER NOT NULL DEFAULT 1');

  let event = db.prepare(
    `SELECT * FROM ticketing_events
     WHERE establishment_id = ? AND slug = 'kris-r-el-trap-de-kolombia'`
  ).get(establishment.id);
  if (!event) {
    const result = db.prepare(
      `INSERT INTO ticketing_events
       (establishment_id, slug, title, subtitle, description, venue, city, address,
        event_date, hero_image_url, card_image_url, organizer, terms, status, featured,
        sales_enabled, payment_enabled, is_past)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 0, 0, 0, 1)`
    ).run(
      establishment.id,
      'kris-r-el-trap-de-kolombia',
      'KRIS R EL TRAP DE KOLOMBIA',
      'Una noche para vivir el trap en grande',
      'El primer evento de ProTickets. La fecha, el lugar, las imágenes y toda la información pueden editarse desde el administrador.',
      'Lugar por confirmar',
      'Ambato',
      'Ambato, Ecuador',
      '2026-08-01T19:00',
      '/protickets/kris-r-evento-pasado.png',
      '/protickets/kris-r-evento-pasado.png',
      'GEMASHOW',
      'La entrada es personal. Presenta tu código QR y documento de identidad al ingresar.'
    );
    event = db.prepare('SELECT * FROM ticketing_events WHERE id = ?').get(result.lastInsertRowid);
  }

  if (addedPastState) {
    db.prepare(
      `UPDATE ticketing_events
       SET is_past = 1, featured = 0, sales_enabled = 0, payment_enabled = 0,
           updated_at = datetime('now', 'localtime')
       WHERE establishment_id = ? AND slug = 'kris-r-el-trap-de-kolombia'`
    ).run(establishment.id);
  }
  db.prepare(
    `UPDATE ticketing_events
     SET event_date = COALESCE(event_date, '2026-08-01T19:00'),
         venue = CASE WHEN venue IS NULL OR venue = '' OR venue = 'Lugar por confirmar' THEN 'Casa de Campo' ELSE venue END,
         address = CASE WHEN address IS NULL OR address = '' OR address = 'Ambato, Ecuador' THEN 'Casa de Campo, Ambato, Ecuador' ELSE address END,
         hero_image_url = CASE WHEN hero_image_url IS NULL OR hero_image_url = '' OR hero_image_url = '/protickets/kris-r-hero.png' THEN '/protickets/kris-r-evento-pasado.png' ELSE hero_image_url END,
         card_image_url = CASE WHEN card_image_url IS NULL OR card_image_url = '' OR card_image_url = '/protickets/kris-r-hero.png' THEN '/protickets/kris-r-evento-pasado.png' ELSE card_image_url END,
         updated_at = datetime('now', 'localtime')
     WHERE establishment_id = ? AND slug = 'kris-r-el-trap-de-kolombia'`
  ).run(establishment.id);

  const insertType = db.prepare(
    `INSERT OR IGNORE INTO ticketing_ticket_types
     (event_id, name, description, price, service_fee, stock, max_per_order, status, sort_order)
     VALUES (?, ?, ?, ?, 0, 0, 6, 'active', ?)`
  );
  insertType.run(event.id, 'FAN', 'Acceso localidad Fan', 20, 1);
  insertType.run(event.id, 'VIP', 'Acceso localidad VIP', 30, 2);
  insertType.run(event.id, 'BOX', 'Acceso localidad Box', 40, 3);

  let magoEvent = db.prepare(
    `SELECT * FROM ticketing_events
     WHERE establishment_id = ? AND slug = 'las-leyendas-de-mago-de-oz-imbabura'`
  ).get(establishment.id);
  if (!magoEvent) {
    const result = db.prepare(
      `INSERT INTO ticketing_events
       (establishment_id, slug, title, subtitle, description, venue, city, address,
        event_date, doors_time, hero_image_url, card_image_url, hero_display_mode,
        organizer, terms, status, featured, sales_enabled, payment_enabled, is_past)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contain', ?, ?, 'published', 1, 1, 0, 0)`
    ).run(
      establishment.id,
      'las-leyendas-de-mago-de-oz-imbabura',
      'LAS LEYENDAS DE MAGO DE OZ - KABRONES!!!',
      'Por primera vez en Imbabura, Ecuador',
      'Una noche histórica llega por primera vez a Imbabura. Las leyendas de Mago de Oz, Kabrones!!!, presentan un espectáculo de dos horas en el Coliseo Atuntaqui con José Andrëa, Frank, Salva y Carlitos. Vive en directo los himnos que marcaron generaciones en una experiencia cargada de rock, energía y nostalgia.',
      'Coliseo Atuntaqui',
      'Atuntaqui, Imbabura',
      'Coliseo Atuntaqui, Imbabura, Ecuador',
      '2026-10-08T20:00',
      '20:00',
      '/protickets/mago-de-oz-imbabura/portada-evento.png',
      '/protickets/mago-de-oz-imbabura/portada-principal.png',
      'ProTickets',
      'Preventa sujeta a disponibilidad. PROMO GOLDEN es válida para el ingreso de 2 personas juntas. La entrada digital será personal y deberá presentarse junto con un documento de identidad. Las compras permanecerán deshabilitadas hasta el anuncio oficial de apertura de ventas.'
    );
    magoEvent = db.prepare('SELECT * FROM ticketing_events WHERE id = ?').get(result.lastInsertRowid);
  }

  if (addedPaymentEnabled) {
    db.prepare(
      `UPDATE ticketing_events
       SET sales_enabled = 1, payment_enabled = 0, is_past = 0,
           updated_at = datetime('now', 'localtime')
       WHERE establishment_id = ? AND slug = 'las-leyendas-de-mago-de-oz-imbabura'`
    ).run(establishment.id);
  }

  const insertMagoType = db.prepare(
    `INSERT OR IGNORE INTO ticketing_ticket_types
     (event_id, name, description, price, service_fee, stock, max_per_order, status, sort_order)
     VALUES (?, ?, ?, ?, 0, 0, 6, 'active', ?)`
  );
  insertMagoType.run(magoEvent.id, 'GENERAL', 'Preventa General', 15, 1);
  insertMagoType.run(magoEvent.id, 'PREFERENCIA', 'Preventa Preferencia', 25, 2);
  insertMagoType.run(magoEvent.id, 'GOLDEN', 'Preventa Golden', 40, 3);
  insertMagoType.run(magoEvent.id, 'PROMO GOLDEN', 'Preventa válida para 2 personas', 70, 4);

  db.prepare(
    `INSERT INTO ticketing_banners
     (establishment_id, event_id, image_url, mobile_image_url, title, subtitle,
      cta_label, cta_url, status, show_overlay, sort_order)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0
     WHERE NOT EXISTS (
       SELECT 1 FROM ticketing_banners WHERE establishment_id = ? AND event_id = ?
     )`
  ).run(
    establishment.id,
    magoEvent.id,
    '/protickets/mago-de-oz-imbabura/banner-pc.png',
    '/protickets/mago-de-oz-imbabura/banner-celular.png',
    'LAS LEYENDAS DE MAGO DE OZ - KABRONES!!!',
    '8 de octubre · Coliseo Atuntaqui',
    'Ver evento',
    '/tickets/evento/las-leyendas-de-mago-de-oz-imbabura',
    establishment.id,
    magoEvent.id
  );

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
