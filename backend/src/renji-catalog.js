const products = [
  { id: 'baggy-negro', name: 'Pantalón baggy', color: 'Negro', image: '/renji/pantalon-negro.jpg', launchId: 'lanzamiento-2-pantalones', launchName: 'Lanzamiento 2 · Pantalones baggy', itemType: 'pants', description: 'Pantalón baggy de corte amplio.', sortOrder: 20, stock: { S: 1, M: 4, L: 4, XL: 2 } },
  { id: 'baggy-gris', name: 'Pantalón baggy', color: 'Gris', image: '/renji/pantalon-gris.jpg', launchId: 'lanzamiento-2-pantalones', launchName: 'Lanzamiento 2 · Pantalones baggy', itemType: 'pants', description: 'Pantalón baggy de corte amplio.', sortOrder: 21, stock: { S: 1, M: 2, L: 2, XL: 1 } },
  { id: 'hoodie-toros-negros', name: 'Hoodie Toros Negros', color: 'Negro', image: '/renji/hoodie-toros-negros.png', launchId: 'lanzamiento-3-hoodie-toros-negros', launchName: 'Lanzamiento 3 · Hoodie Toros Negros', itemType: 'hoodie', description: 'Hoodie negro de edición especial con detalles bordados.', price: 38.99, compareAtPrice: 45.99, featured: 1, sortOrder: 1, stock: { S: 2, M: 6, L: 6, XL: 4 } }
];

export function initRenjiCatalog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS renji_catalog_products (
      establishment_id INTEGER NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
      color TEXT NOT NULL, image_url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (establishment_id, id)
    );
    CREATE TABLE IF NOT EXISTS renji_catalog_stock (
      establishment_id INTEGER NOT NULL, product_id TEXT NOT NULL,
      size TEXT NOT NULL CHECK (size IN ('S','M','L','XL')),
      quantity INTEGER NOT NULL CHECK (quantity >= 0 AND quantity = CAST(quantity AS INTEGER)),
      PRIMARY KEY (establishment_id, product_id, size)
    );
    CREATE TABLE IF NOT EXISTS renji_catalog_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, establishment_id INTEGER NOT NULL,
      product_id TEXT NOT NULL, size TEXT NOT NULL, quantity INTEGER NOT NULL,
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const add = (table, column, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  add('renji_orders', 'product_id', 'TEXT');
  add('renji_registrations', 'product_id', 'TEXT');
  add('renji_registrations', 'product_name', 'TEXT');
  add('renji_registrations', 'color', "TEXT NOT NULL DEFAULT 'Negro'");
  add('renji_registrations', 'stock_reserved', 'INTEGER NOT NULL DEFAULT 0');
  add('renji_registrations', 'request_key', 'TEXT');
  add('renji_registrations', 'request_hash', 'TEXT');
  add('renji_registrations', 'email_sent', 'INTEGER NOT NULL DEFAULT 0');
  add('renji_registrations', 'catalog_items_json', 'TEXT');
  add('renji_registrations', 'payment_status', "TEXT NOT NULL DEFAULT 'paid'");
  add('renji_registrations', 'sales_origin', "TEXT NOT NULL DEFAULT 'web'");
  add('renji_registrations', 'total_amount', 'REAL NOT NULL DEFAULT 0');
  add('renji_registrations', 'payphone_provider_reference', 'TEXT');
  add('renji_registrations', 'paid_at', 'TEXT');
  add('renji_catalog_products', 'launch_id', "TEXT NOT NULL DEFAULT 'lanzamiento-2-pantalones'");
  add('renji_catalog_products', 'launch_name', "TEXT NOT NULL DEFAULT 'Lanzamiento 2 · Pantalones baggy'");
  add('renji_catalog_products', 'item_type', "TEXT NOT NULL DEFAULT 'pants'");
  add('renji_catalog_products', 'description', "TEXT NOT NULL DEFAULT ''");
  add('renji_catalog_products', 'price', 'REAL NOT NULL DEFAULT 0');
  add('renji_catalog_products', 'compare_at_price', 'REAL NOT NULL DEFAULT 0');
  add('renji_catalog_products', 'featured', 'INTEGER NOT NULL DEFAULT 0');
  add('renji_catalog_products', 'sort_order', 'INTEGER NOT NULL DEFAULT 100');
  db.prepare(`UPDATE renji_catalog_products
    SET launch_id = 'lanzamiento-2-pantalones', launch_name = 'Lanzamiento 2 · Pantalones baggy'
    WHERE launch_id IS NULL OR launch_id = '' OR launch_name IS NULL OR launch_name = ''`).run();
  db.prepare(`UPDATE renji_catalog_products SET item_type = 'pants',
    description = CASE WHEN description = '' THEN 'Pantalón baggy de corte amplio.' ELSE description END,
    sort_order = CASE WHEN sort_order = 100 THEN CASE id WHEN 'baggy-negro' THEN 20 ELSE 21 END ELSE sort_order END
    WHERE id IN ('baggy-negro', 'baggy-gris')`).run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_renji_registration_request ON renji_registrations(establishment_id, request_key)');
}

export function seedRenjiCatalog(db, establishmentId) {
  // Seed only when the product is first created. A restart must never replenish sold units.
  db.transaction(() => {
    for (const product of products) {
      const created = db.prepare(`INSERT OR IGNORE INTO renji_catalog_products
        (establishment_id, id, name, color, image_url, launch_id, launch_name, item_type, description, price, compare_at_price, featured, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(establishmentId, product.id, product.name, product.color, product.image, product.launchId, product.launchName,
          product.itemType || 'pants', product.description || '', product.price || 0, product.compareAtPrice || 0,
          product.featured || 0, product.sortOrder || 100);
      if (!created.changes) continue;
      for (const [size, quantity] of Object.entries(product.stock)) {
        db.prepare('INSERT INTO renji_catalog_stock VALUES (?, ?, ?, ?)').run(establishmentId, product.id, size, quantity);
        db.prepare('INSERT INTO renji_catalog_movements (establishment_id, product_id, size, quantity, notes) VALUES (?, ?, ?, ?, ?)')
          .run(establishmentId, product.id, size, quantity, `Inventario inicial ${product.launchName}`);
      }
    }
  })();
}

export function renjiCatalog(db, establishmentId) {
  return db.prepare('SELECT * FROM renji_catalog_products WHERE establishment_id = ? ORDER BY featured DESC, sort_order ASC, id DESC').all(establishmentId)
    .map((product) => ({ ...product, sizes: db.prepare(`SELECT size, quantity FROM renji_catalog_stock
      WHERE establishment_id = ? AND product_id = ? ORDER BY CASE size WHEN 'S' THEN 1 WHEN 'M' THEN 2 WHEN 'L' THEN 3 ELSE 4 END`)
      .all(establishmentId, product.id) }));
}

export function catalogError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

export function validateCatalogPayload(db, establishmentId, payload) {
  const product = db.prepare('SELECT * FROM renji_catalog_products WHERE establishment_id = ? AND id = ? AND active = 1')
    .get(establishmentId, payload.productId || '');
  if (!product) throw catalogError('Esta prenda está agotada o ya no está disponible. Elige otra prenda del catálogo.');
  if (payload.selectionType && payload.selectionType !== product.item_type) throw catalogError('La prenda seleccionada no coincide con el tipo de producto.', 400);
  payload.selectionType = product.item_type;
  payload.productName = product.name;
  payload.color = product.color;
  return product;
}

export function moveCatalogStock(db, establishmentId, productId, size, quantity, notes) {
  if (!Number.isSafeInteger(quantity) || quantity === 0) throw catalogError('La cantidad debe ser un número entero positivo.', 400);
  const result = db.prepare(`UPDATE renji_catalog_stock SET quantity = quantity + ?
    WHERE establishment_id = ? AND product_id = ? AND size = ? AND quantity + ? >= 0`)
    .run(quantity, establishmentId, productId, size, quantity);
  if (!result.changes) throw catalogError(`No hay suficientes unidades en talla ${size} del color seleccionado. Elige otra talla o reduce la cantidad.`);
  db.prepare('INSERT INTO renji_catalog_movements (establishment_id, product_id, size, quantity, notes) VALUES (?, ?, ?, ?, ?)')
    .run(establishmentId, productId, size, quantity, notes);
}

export function releaseRegistrationStock(db, registration, reason) {
  if (!registration.stock_reserved) return;
  let items = [];
  try {
    items = JSON.parse(registration.catalog_items_json || '[]');
  } catch {
    items = [];
  }
  if (!Array.isArray(items) || !items.length) {
    items = registration.product_id ? [{
      product_id: registration.product_id,
      size: registration.pants_size || registration.size,
      quantity: Number(registration.quantity)
    }] : [];
  }
  for (const item of items) {
    moveCatalogStock(db, registration.establishment_id, item.product_id, item.size,
      Number(item.quantity || 1), `${reason} registro ${registration.id}`);
  }
}
