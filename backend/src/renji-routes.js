import { requireAdmin } from './auth.js';
import { toMoney } from './db.js';
import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { renjiCatalog, validateCatalogPayload, moveCatalogStock, releaseRegistrationStock, catalogError } from './renji-catalog.js';

const sizes = ['S', 'M', 'L', 'XL'];
const itemTypes = ['hoodie', 'pants'];
const SUKUNA_LAUNCH = { id: 'lanzamiento-1-sukuna', name: 'Lanzamiento 1 · Conjunto Sukuna' };

function cleanText(value) {
  return String(value || '').trim();
}

function emailTransportConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renjiItemDetailText(payload) {
  const catalogItems = catalogItemsFromPayload(payload);
  if (catalogItems.length) {
    return catalogItems.map((item, index) =>
      `${index + 1}. ${item.product_name || 'Pantalón baggy'} · ${item.color || ''} · Talla ${item.size}`
    ).join('\n');
  }
  const hoodieSize = payload.hoodieSize || payload.hoodie_size || payload.size || 'M';
  const pantsSize = payload.pantsSize || payload.pants_size || payload.size || 'M';
  if (payload.productId || payload.product_id) return `${payload.productName || payload.product_name || 'Pantalón baggy'} · ${payload.color} · Talla ${pantsSize}`;
  if (payload.selectionType === 'set' || payload.selection_type === 'set') {
    return `Hoodie ${hoodieSize} + Pantalon ${pantsSize}`;
  }
  if (payload.selectionType === 'hoodie' || payload.selection_type === 'hoodie') {
    return `Hoodie ${hoodieSize}`;
  }
  return `Pantalon ${pantsSize}`;
}

async function sendRenjiOrderConfirmationEmail(payload) {
  if (!emailTransportConfigured() || !payload.email) {
    return { sent: false, reason: 'SMTP no configurado o cliente sin correo' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const detail = renjiItemDetailText(payload);
  const catalogItems = catalogItemsFromPayload(payload);
  const quantity = catalogItems.length
    ? catalogItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0)
    : Number(payload.quantity || 1);
  const detailHtml = detail.split('\n').map((line) => `<div style="margin:6px 0">${escapeHtml(line)}</div>`).join('');

  await transporter.sendMail({
    from,
    to: payload.email,
    subject: 'Confirmación de tu pedido RENJI',
    text: `Hola ${payload.customerName},

Recibimos tus datos para RENJI.

Prendas:
${detail}
Total de prendas: ${quantity}
Referencia: ${payload.registrationId ? `Registro #${payload.registrationId}` : 'RENJI'}

Datos de envio:
Nombre: ${payload.customerName}
Cedula: ${payload.cedula}
Ciudad: ${payload.city}
Direccion: ${payload.address}
Celular: ${payload.phone}
Instagram: ${payload.instagram ? '@' + payload.instagram : 'No registrado'}
Correo: ${payload.email}

Por favor revisa que todo este correcto. Si necesitas corregir algun dato, contactanos por el mismo medio donde realizaste tu compra.`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#09090b;color:#f8fafc;padding:24px;border-radius:14px">
        <h2 style="margin-top:0;color:#ffffff">Confirmacion de datos RENJI</h2>
        <p>Hola <strong>${escapeHtml(payload.customerName)}</strong>, recibimos tus datos correctamente.</p>
        <div style="background:#151518;border:1px solid #2f2f35;padding:16px;border-radius:12px;margin:16px 0">
          <p><strong>Prendas:</strong></p>
          ${detailHtml}
          <p><strong>Total de prendas:</strong> ${quantity}</p>
          ${payload.registrationId ? `<p><strong>Referencia:</strong> Registro #${payload.registrationId}</p>` : ''}
        </div>
        <div style="background:#111827;border:1px solid #273449;padding:16px;border-radius:12px">
          <p><strong>Nombre:</strong> ${escapeHtml(payload.customerName)}</p>
          <p><strong>Cedula:</strong> ${escapeHtml(payload.cedula)}</p>
          <p><strong>Ciudad:</strong> ${escapeHtml(payload.city)}</p>
          <p><strong>Direccion:</strong> ${escapeHtml(payload.address)}</p>
          <p><strong>Celular:</strong> ${escapeHtml(payload.phone)}</p>
          <p><strong>Instagram:</strong> ${payload.instagram ? '@' + escapeHtml(payload.instagram) : 'No registrado'}</p>
          <p><strong>Correo:</strong> ${escapeHtml(payload.email)}</p>
        </div>
        <p style="color:#cbd5e1;font-size:13px">Revisa que tus datos esten correctos. Si necesitas corregir algo, contactanos por el mismo medio donde realizaste tu compra.</p>
      </div>
    `
  });

  return { sent: true };
}

function normalizeItemType(value) {
  return itemTypes.includes(value) ? value : '';
}

function normalizeSize(value) {
  const size = cleanText(value).toUpperCase();
  return sizes.includes(size) ? size : '';
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function catalogItemsFromPayload(payload) {
  const items = payload.catalogItems || payload.catalog_items || parseJsonArray(payload.catalog_items_json);
  return Array.isArray(items) ? items : [];
}

function readPublicCatalogItems(db, establishmentId, body, legacyPayload) {
  const suppliedItems = Array.isArray(body.items) ? body.items : [];
  if (suppliedItems.length > 2) throw catalogError('Puedes registrar un máximo de dos prendas por cliente.', 400);
  const rawItems = suppliedItems.length ? suppliedItems : [{
    product_id: legacyPayload.productId,
    size: legacyPayload.pantsSize,
    quantity: legacyPayload.quantity
  }];
  if (!rawItems.length) throw catalogError('Selecciona al menos una prenda.', 400);

  return rawItems.map((item) => {
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || (suppliedItems.length && quantity !== 1)) {
      throw catalogError('Cada selección representa una prenda. Agrega una segunda selección para pedir dos.', 400);
    }
    const size = normalizeSize(item.size || item.pants_size);
    if (!size) throw catalogError('Selecciona la talla de cada prenda.', 400);
    const normalized = {
      productId: cleanText(item.product_id),
      selectionType: 'pants',
      pantsSize: size,
      size
    };
    validateCatalogPayload(db, establishmentId, normalized);
    return {
      item_type: 'pants',
      product_id: normalized.productId,
      product_name: normalized.productName,
      color: normalized.color,
      size,
      quantity
    };
  });
}

function orderItemsForSelection(selectionType, quantity, sizesByType = {}) {
  const catalogItems = catalogItemsFromPayload(sizesByType);
  if (catalogItems.length) return catalogItems.map((item) => ({ ...item, item_type: 'pants' }));
  const qty = Math.max(1, Number(quantity || 1));
  const hoodieSize = sizesByType.hoodie_size || sizesByType.hoodieSize || sizesByType.size;
  const pantsSize = sizesByType.pants_size || sizesByType.pantsSize || sizesByType.size;
  if (sizesByType.productId || sizesByType.product_id) return [{ item_type: 'pants', product_id: sizesByType.productId || sizesByType.product_id, size: pantsSize, quantity: qty }];
  if (selectionType === 'set') {
    return [
      { item_type: 'hoodie', size: hoodieSize, quantity: qty },
      { item_type: 'pants', size: pantsSize, quantity: qty }
    ];
  }
  return [{ item_type: selectionType, size: selectionType === 'pants' ? pantsSize : hoodieSize, quantity: qty }];
}

function formatOrder(row) {
  const garments = row.selection_type === 'set' ? Number(row.quantity || 0) * 2 : Number(row.quantity || 0);
  const hoodieSize = row.hoodie_size || row.size;
  const pantsSize = row.pants_size || row.size;
  const stockItems = parseJsonArray(row.stock_items_json);
  const productionItems = parseJsonArray(row.production_items_json);
  return {
    ...row,
    customer_email: row.customer_email || '',
    hoodie_size: hoodieSize,
    pants_size: pantsSize,
    stock_items: stockItems,
    production_items: productionItems,
    production_status: row.production_status || 'ready',
    quantity: Number(row.quantity || 0),
    garments,
    deposit_amount: toMoney(row.deposit_amount),
    pending_amount: toMoney(row.pending_amount)
  };
}

function formatRegistration(row) {
  const hoodieSize = row.hoodie_size || row.size;
  const pantsSize = row.pants_size || row.size;
  return {
    ...row,
    catalog_items: parseJsonArray(row.catalog_items_json),
    hoodie_size: hoodieSize,
    pants_size: pantsSize,
    quantity: Number(row.quantity || 0),
    deposit_amount: toMoney(row.deposit_amount)
  };
}

function launchForRecord(row, catalogById) {
  const productIds = new Set([
    row.product_id,
    ...parseJsonArray(row.catalog_items_json).map((item) => item.product_id),
    ...parseJsonArray(row.stock_items_json).map((item) => item.product_id),
    ...parseJsonArray(row.production_items_json).map((item) => item.product_id)
  ].filter(Boolean));
  const launches = [...productIds]
    .map((productId) => catalogById.get(productId))
    .filter(Boolean)
    .filter((launch, index, all) => all.findIndex((candidate) => candidate.id === launch.id) === index);
  if (!launches.length) return { launch_id: SUKUNA_LAUNCH.id, launch_name: SUKUNA_LAUNCH.name };
  if (launches.length === 1) return { launch_id: launches[0].id, launch_name: launches[0].name };
  return { launch_id: launches.map((launch) => launch.id).sort().join('+'), launch_name: launches.map((launch) => launch.name).join(' + ') };
}

function normalizedOrderSizes(row) {
  return {
    size: row.size || '',
    hoodie_size: row.hoodie_size || row.size || '',
    pants_size: row.pants_size || row.size || ''
  };
}

function orderSizeChanged(order, payload) {
  const current = normalizedOrderSizes(order);
  return current.size !== payload.size
    || current.hoodie_size !== payload.hoodieSize
    || current.pants_size !== payload.pantsSize;
}

function movementItemKey(row) {
  return `${row.item_type || ''}|${row.size || ''}`;
}

function detectHistoricallyEditedSizeOrderIds(db, establishmentId) {
  const rows = db.prepare(
    `SELECT order_id, item_type, size, notes
     FROM renji_stock_movements
     WHERE establishment_id = ?
       AND order_id IS NOT NULL
       AND movement_type = 'sale'
     ORDER BY id ASC`
  ).all(establishmentId);
  const byOrder = new Map();
  for (const row of rows) {
    const orderRows = byOrder.get(row.order_id) || { initial: new Set(), edited: new Set() };
    if (String(row.notes || '').toUpperCase().includes('EDICION')) {
      orderRows.edited.add(movementItemKey(row));
    } else {
      orderRows.initial.add(movementItemKey(row));
    }
    byOrder.set(row.order_id, orderRows);
  }
  const editedIds = new Set();
  for (const [orderId, itemSets] of byOrder.entries()) {
    if (!itemSets.edited.size || !itemSets.initial.size) continue;
    const hasDifferentSize = [...itemSets.edited].some((item) => !itemSets.initial.has(item));
    if (hasDifferentSize) editedIds.add(Number(orderId));
  }
  return editedIds;
}

function getRenjiEstablishment(db) {
  return db.prepare("SELECT * FROM establishments WHERE name = 'RENJI' AND status = 'active'").get()
    || db.prepare("SELECT * FROM establishments WHERE module_type = 'clothing' AND status = 'active' ORDER BY id ASC").get();
}

function readOrderPayload(body, { paidByDefault = false, registrationType = null, requireDeposit = false, requireEmail = false } = {}) {
  const customerName = cleanText(body.customer_name);
  const city = cleanText(body.customer_city);
  const address = cleanText(body.customer_address);
  const phone = cleanText(body.customer_phone);
  const cedula = cleanText(body.customer_cedula);
  const email = cleanText(body.customer_email).toLowerCase();
  const instagram = cleanText(body.customer_instagram).replace(/^@+/, '');
  const purchaseChannel = body.purchase_channel === 'instagram' ? 'instagram' : 'other';
  const selectionType = ['set', 'hoodie', 'pants'].includes(body.selection_type) ? body.selection_type : '';
  const baseSize = normalizeSize(body.size);
  const hoodieSize = normalizeSize(body.hoodie_size) || baseSize;
  const pantsSize = normalizeSize(body.pants_size) || baseSize;
  const size = selectionType === 'pants' ? pantsSize : hoodieSize;
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw catalogError('La cantidad debe ser un número entero entre 1 y 1000.', 400);
  }
  const depositAmount = toMoney(body.deposit_amount);
  const pendingAmount = paidByDefault ? 0 : toMoney(body.pending_amount);
  const paymentStatus = paidByDefault ? 'paid' : (body.payment_status === 'paid' ? 'paid' : 'pending');
  const normalizedRegistrationType = registrationType || (body.registration_type === 'separation' ? 'separation' : 'paid');
  const notes = cleanText(body.notes);

  if (!customerName || !city || !address || !phone || !selectionType || !size) {
    const error = new Error('Cliente, ciudad, direccion, celular, prenda y talla son obligatorios');
    error.status = 400;
    throw error;
  }

  if (selectionType === 'set' && (!hoodieSize || !pantsSize)) {
    const error = new Error('Selecciona talla de hoodie y talla de pantalon para el conjunto');
    error.status = 400;
    throw error;
  }

  if (purchaseChannel === 'instagram' && !instagram) {
    const error = new Error('El usuario de Instagram es obligatorio si la compra fue por Instagram');
    error.status = 400;
    throw error;
  }

  if (requireDeposit && depositAmount <= 0) {
    const error = new Error('El valor transferido para separar es obligatorio');
    error.status = 400;
    throw error;
  }

  if (requireEmail && !email) {
    const error = new Error('El correo electronico es obligatorio para confirmar tu pedido');
    error.status = 400;
    throw error;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw catalogError('Ingresa un correo electrónico válido.', 400);

  return {
    productId: cleanText(body.product_id) || null,
    productName: cleanText(body.product_name),
    color: cleanText(body.color) || 'Negro',
    customerName,
    cedula,
    email,
    city,
    address,
    phone,
    instagram,
    purchaseChannel,
    selectionType,
    size,
    hoodieSize,
    pantsSize,
    quantity,
    depositAmount,
    pendingAmount: paymentStatus === 'paid' ? 0 : pendingAmount,
    paymentStatus,
    registrationType: normalizedRegistrationType,
    notes
  };
}

function getRenjiOverview(db, establishmentId) {
  const historicallyEditedSizeIds = detectHistoricallyEditedSizeOrderIds(db, establishmentId);
  const catalog = renjiCatalog(db, establishmentId);
  const catalogById = new Map(catalog.map((product) => [product.id, {
    id: product.launch_id || 'lanzamiento-2-pantalones',
    name: product.launch_name || 'Lanzamiento 2 · Pantalones baggy'
  }]));
  const stock = db
    .prepare(
      `SELECT *
       FROM renji_stock
       WHERE establishment_id = ?
       ORDER BY item_type ASC,
                CASE size WHEN 'S' THEN 1 WHEN 'M' THEN 2 WHEN 'L' THEN 3 WHEN 'XL' THEN 4 ELSE 5 END`
    )
    .all(establishmentId);

  const orders = db
    .prepare(
      `SELECT *
       FROM renji_orders
       WHERE establishment_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(establishmentId)
    .map((row) => ({
      ...formatOrder(row),
      ...launchForRecord(row, catalogById),
      size_edited: Number(row.size_edited || 0) || historicallyEditedSizeIds.has(Number(row.id)) ? 1 : 0
    }));
  const registrations = db
    .prepare(
      `SELECT *
       FROM renji_registrations
       WHERE establishment_id = ? AND status = 'pending'
       ORDER BY created_at DESC, id DESC`
    )
    .all(establishmentId)
    .map((row) => ({ ...formatRegistration(row), ...launchForRecord(row, catalogById) }));

  const launchMap = new Map([[SUKUNA_LAUNCH.id, SUKUNA_LAUNCH.name]]);
  for (const product of catalog) launchMap.set(product.launch_id, product.launch_name);
  for (const record of [...orders, ...registrations]) launchMap.set(record.launch_id, record.launch_name);
  const launches = [...launchMap].map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const soldGarments = orders.reduce((sum, order) => sum + order.garments, 0);
  const pendingPayments = orders
    .filter((order) => order.payment_status === 'pending')
    .reduce((sum, order) => sum + Number(order.pending_amount || 0), 0);
  const productionOrders = orders.filter((order) => (order.production_status || 'ready') !== 'ready');
  const productionItems = productionOrders.reduce((sum, order) => (
    sum + (order.production_items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0)
  ), 0);

  return {
    stock,
    catalog,
    launches,
    orders,
    registrations,
    summary: {
      sold_orders: orders.length,
      sold_garments: soldGarments,
      pending_shipping: orders.filter((order) => order.shipping_status !== 'sent').length,
      paid_orders: orders.filter((order) => order.payment_status === 'paid').length,
      pending_amount: toMoney(pendingPayments),
      pending_registrations: registrations.length,
      production_orders: productionOrders.length,
      production_items: productionItems
    }
  };
}

function assertRenjiBusiness(db, establishmentId) {
  const establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishmentId);
  if (!establishment || establishment.module_type !== 'clothing') {
    const error = new Error('Este negocio no corresponde a Renji');
    error.status = 403;
    throw error;
  }
  return establishment;
}

function applyStockMovement(db, { establishmentId, orderId = null, itemType, size, quantity, movementType, notes = '', movementDate = null }) {
  const current = db
    .prepare('SELECT * FROM renji_stock WHERE establishment_id = ? AND item_type = ? AND size = ? AND color = ?')
    .get(establishmentId, itemType, size, 'Negro');

  if (!current) {
    db.prepare(
      `INSERT INTO renji_stock (establishment_id, item_type, size, color, quantity)
       VALUES (?, ?, ?, 'Negro', 0)`
    ).run(establishmentId, itemType, size);
  }

  const nextQuantity = Number(current?.quantity || 0) + Number(quantity || 0);
  if (nextQuantity < 0) {
    const label = itemType === 'hoodie' ? 'hoodie' : 'pantalon';
    const error = new Error(`Stock insuficiente para ${label} talla ${size}`);
    error.status = 400;
    throw error;
  }

  db.prepare(
    `UPDATE renji_stock
     SET quantity = ?, updated_at = datetime('now', 'localtime')
     WHERE establishment_id = ? AND item_type = ? AND size = ? AND color = ?`
  ).run(nextQuantity, establishmentId, itemType, size, 'Negro');

  db.prepare(
    `INSERT INTO renji_stock_movements
     (establishment_id, order_id, movement_date, item_type, size, color, quantity, movement_type, notes)
     VALUES (?, ?, ?, ?, ?, 'Negro', ?, ?, ?)`
  ).run(establishmentId, orderId, movementDate || new Date().toISOString().slice(0, 10), itemType, size, Number(quantity || 0), movementType, notes);
}

function currentStockQuantity(db, establishmentId, itemType, size) {
  const current = db
    .prepare('SELECT quantity FROM renji_stock WHERE establishment_id = ? AND item_type = ? AND size = ? AND color = ?')
    .get(establishmentId, itemType, size, 'Negro');
  return Number(current?.quantity || 0);
}

function reserveRenjiStockForOrder(db, { establishmentId, orderId, orderNumber, items, notesPrefix = '' }) {
  const stockItems = [];
  const productionItems = [];

  for (const item of items) {
    const requested = Math.max(0, Number(item.quantity || 0));
    if (item.product_id) {
      moveCatalogStock(db, establishmentId, item.product_id, item.size, -requested, `${notesPrefix}${orderNumber}`);
      stockItems.push({ ...item, quantity: requested });
      continue;
    }
    const available = currentStockQuantity(db, establishmentId, item.item_type, item.size);
    const reserved = Math.min(available, requested);
    const pending = requested - reserved;

    if (reserved > 0) {
      applyStockMovement(db, {
        establishmentId,
        orderId,
        itemType: item.item_type,
        size: item.size,
        quantity: -reserved,
        movementType: 'sale',
        notes: `${notesPrefix}${orderNumber}`.trim()
      });
      stockItems.push({ item_type: item.item_type, size: item.size, quantity: reserved });
    }

    if (pending > 0) {
      productionItems.push({ item_type: item.item_type, size: item.size, quantity: pending });
    }
  }

  const requestedTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const productionTotal = productionItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const productionStatus = productionTotal <= 0
    ? 'ready'
    : productionTotal >= requestedTotal
      ? 'in_production'
      : 'partial_production';

  return { stockItems, productionItems, productionStatus };
}

function insertRenjiOrder(db, establishmentId, payload, { alreadyReserved = false } = {}) {
  if (payload.productId) validateCatalogPayload(db, establishmentId, payload);
  const result = db.prepare(
    `INSERT INTO renji_orders
     (establishment_id, customer_name, customer_cedula, customer_email, customer_city, customer_address, customer_phone, customer_instagram, purchase_channel, selection_type, size, hoodie_size, pants_size, quantity, deposit_amount, pending_amount, payment_status, shipping_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_sent', ?)`
  ).run(
    establishmentId,
    payload.customerName,
    payload.cedula,
    payload.email,
    payload.city,
    payload.address,
    payload.phone,
    payload.instagram,
    payload.purchaseChannel,
    payload.selectionType,
    payload.size,
    payload.hoodieSize,
    payload.pantsSize,
    payload.quantity,
    payload.depositAmount,
    payload.pendingAmount,
    payload.paymentStatus,
    payload.notes
  );

  const orderId = result.lastInsertRowid;
  const orderNumber = `RENJI-${String(orderId).padStart(5, '0')}`;
  db.prepare('UPDATE renji_orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);
  if (payload.productId) db.prepare('UPDATE renji_orders SET product_id = ?, product_name = ?, color = ? WHERE id = ?')
    .run(payload.productId, payload.productName, payload.color, orderId);

  const items = orderItemsForSelection(payload.selectionType, payload.quantity, payload);
  const reservation = alreadyReserved
    ? { stockItems: items, productionItems: [], productionStatus: 'ready' }
    : reserveRenjiStockForOrder(db, { establishmentId, orderId, orderNumber, items });
  db.prepare(
    `UPDATE renji_orders
     SET stock_items_json = ?, production_items_json = ?, production_status = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(reservation.stockItems),
    JSON.stringify(reservation.productionItems),
    reservation.productionStatus,
    orderId
  );

  return orderId;
}

function restoreOrderStock(db, order, reason = 'Reversa') {
  const restoredItems = [];
  const stockItems = parseJsonArray(order.stock_items_json);
  const itemsToRestore = order.stock_items_json != null ? stockItems : orderItemsForSelection(order.selection_type, order.quantity, order);
  for (const item of itemsToRestore) {
    if (item.product_id) {
      moveCatalogStock(db, order.establishment_id, item.product_id, item.size, Number(item.quantity), `${reason} ${order.order_number || order.id}`);
      restoredItems.push(item);
      continue;
    }
    applyStockMovement(db, {
      establishmentId: order.establishment_id,
      orderId: order.id,
      itemType: item.item_type,
      size: item.size,
      quantity: item.quantity,
      movementType: 'return',
      notes: `${reason} ${order.order_number || order.id}`
    });
    restoredItems.push({ item_type: item.item_type, size: item.size, quantity: item.quantity });
  }
  return restoredItems;
}

export function registerRenjiRoutes(app, db, getRequestEstablishmentId) {
  app.get('/api/renji/catalog', (req, res) => {
    const establishment = getRenjiEstablishment(db);
    if (!establishment) return res.status(404).json({ message: 'RENJI no está disponible' });
    res.set('Cache-Control', 'no-store').json({ products: renjiCatalog(db, establishment.id), previous_collection: { name: 'Conjunto Sukuna', available: false } });
  });

  const registerPublicOrder = (isSeparation) => async (req, res) => {
    try {
      const establishment = getRenjiEstablishment(db);
      if (!establishment) return res.status(404).json({ message: 'RENJI no está disponible' });
      const firstItem = Array.isArray(req.body.items) ? req.body.items[0] : null;
      const payload = readOrderPayload({
        ...req.body,
        product_id: firstItem?.product_id || req.body.product_id,
        selection_type: 'pants',
        size: firstItem?.size || req.body.size,
        pants_size: firstItem?.size || req.body.pants_size,
        quantity: firstItem ? 1 : req.body.quantity
      }, {
        paidByDefault: !isSeparation, registrationType: isSeparation ? 'separation' : 'paid',
        requireDeposit: isSeparation, requireEmail: true
      });
      const catalogItems = readPublicCatalogItems(db, establishment.id, req.body, payload);
      const firstCatalogItem = catalogItems[0];
      Object.assign(payload, {
        catalogItems,
        productId: firstCatalogItem.product_id,
        productName: firstCatalogItem.product_name,
        color: firstCatalogItem.color,
        size: firstCatalogItem.size,
        pantsSize: firstCatalogItem.size,
        quantity: catalogItems.reduce((sum, item) => sum + item.quantity, 0)
      });
      const requestKey = cleanText(req.body.request_key);
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) throw catalogError('Actualiza la página e intenta enviar tu pedido nuevamente.', 400);
      const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const result = db.transaction(() => {
        const previous = db.prepare('SELECT * FROM renji_registrations WHERE establishment_id = ? AND request_key = ?').get(establishment.id, requestKey);
        if (previous) {
          if (previous.status === 'deleted') throw catalogError('Este registro fue cancelado. Actualiza la página para crear otro pedido.');
          if (previous.request_hash !== requestHash) throw catalogError('Este envío ya fue registrado. Actualiza la página para crear otro pedido.');
          return { id: previous.id, duplicate: true, emailSent: Boolean(previous.email_sent) };
        }
        for (const item of catalogItems) {
          moveCatalogStock(db, establishment.id, item.product_id, item.size, -item.quantity, `Reserva web ${requestKey}`);
        }
        const inserted = db.prepare(`INSERT INTO renji_registrations
          (establishment_id, customer_name, customer_cedula, customer_email, customer_city, customer_address, customer_phone,
           customer_instagram, purchase_channel, selection_type, size, hoodie_size, pants_size, quantity, registration_type,
           deposit_amount, notes, product_id, product_name, color, stock_reserved, request_key, request_hash, catalog_items_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
          .run(establishment.id, payload.customerName, payload.cedula, payload.email, payload.city, payload.address,
            payload.phone, payload.instagram, payload.purchaseChannel, payload.selectionType, payload.size, payload.hoodieSize,
            payload.pantsSize, payload.quantity, payload.registrationType, payload.depositAmount, payload.notes,
            payload.productId, payload.productName, payload.color, requestKey, requestHash, JSON.stringify(catalogItems));
        return { id: Number(inserted.lastInsertRowid), duplicate: false };
      })();
      let emailResult = { sent: result.emailSent || false };
      if (!result.duplicate) {
        emailResult = await sendRenjiOrderConfirmationEmail({ ...payload, registrationId: result.id }).catch(() => ({ sent: false }));
        db.prepare('UPDATE renji_registrations SET email_sent = ? WHERE id = ?').run(emailResult.sent ? 1 : 0, result.id);
      }
      res.status(result.duplicate ? 200 : 201).json({ ok: true, registration_id: result.id, email: { sent: emailResult.sent },
        product_name: payload.productName, color: payload.color, size: payload.pantsSize, quantity: payload.quantity,
        items: catalogItems });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar tu pedido' });
    }
  };
  app.post('/api/renji/public-registrations', registerPublicOrder(false));
  app.post('/api/renji/public-separations', registerPublicOrder(true));

  app.get('/api/renji/overview', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo cargar Renji' });
    }
  });

  app.post('/api/renji/stock', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const movementDate = cleanText(req.body.movement_date) || new Date().toISOString().slice(0, 10);
      const notes = cleanText(req.body.notes);
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      const validItems = items.map((item) => ({
        product_id: cleanText(item.product_id) || null,
        item_type: normalizeItemType(item.item_type),
        size: normalizeSize(item.size),
        quantity: Number(item.quantity || 0)
      })).filter((item) => item.item_type && item.size && Number.isSafeInteger(item.quantity) && item.quantity > 0);

      if (!validItems.length) {
        return res.status(400).json({ message: 'Agrega al menos una prenda con talla y cantidad' });
      }

      const transaction = db.transaction(() => {
        for (const item of validItems) {
          if (item.product_id) {
            validateCatalogPayload(db, establishmentId, { productId: item.product_id, selectionType: item.item_type });
            moveCatalogStock(db, establishmentId, item.product_id, item.size, item.quantity, `Ingreso ${movementDate} ${notes}`);
            continue;
          }
          applyStockMovement(db, {
            establishmentId,
            itemType: item.item_type,
            size: item.size,
            quantity: item.quantity,
            movementType: 'entry',
            movementDate,
            notes
          });
        }
      });
      transaction();
      res.status(201).json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar stock' });
    }
  });

  app.post('/api/renji/orders', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const payload = readOrderPayload(req.body);
      if (!payload.productId) throw catalogError('El conjunto anterior está agotado. Selecciona un pantalón del catálogo.');

      const transaction = db.transaction(() => {
        insertRenjiOrder(db, establishmentId, payload);
      });

      transaction();
      res.status(201).json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar la venta' });
    }
  });

  app.put('/api/renji/orders/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const order = db.prepare('SELECT * FROM renji_orders WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      if (parseJsonArray(order.stock_items_json).length + parseJsonArray(order.production_items_json).length > 1) {
        throw catalogError('Este pedido contiene dos prendas y debe mantenerse unido.', 400);
      }
      const payload = readOrderPayload({ ...req.body, product_id: req.body.product_id ?? order.product_id });
      if (order.product_id && !payload.productId) throw catalogError('Selecciona un pantalón del catálogo.');
      if (payload.productId) validateCatalogPayload(db, establishmentId, payload);
      const sizeChanged = orderSizeChanged(order, payload);
      const transaction = db.transaction(() => {
        restoreOrderStock(db, order);
        const updateOrder = db.prepare(
          `UPDATE renji_orders
           SET customer_name = ?, customer_cedula = ?, customer_city = ?, customer_address = ?, customer_phone = ?,
               customer_email = ?, customer_instagram = ?, purchase_channel = ?, selection_type = ?, size = ?, hoodie_size = ?, pants_size = ?, quantity = ?,
               deposit_amount = ?, pending_amount = ?, payment_status = ?, notes = ?,
               stock_items_json = ?, production_items_json = ?, production_status = ?,
               size_edited = CASE WHEN ? = 1 THEN 1 ELSE size_edited END,
               size_edited_at = CASE WHEN ? = 1 THEN datetime('now', 'localtime') ELSE size_edited_at END,
               updated_at = datetime('now', 'localtime')
           WHERE id = ? AND establishment_id = ?`
        );
        const items = orderItemsForSelection(payload.selectionType, payload.quantity, payload);
        const reservation = reserveRenjiStockForOrder(db, {
          establishmentId,
          orderId: order.id,
          orderNumber: order.order_number || String(order.id),
          items,
          notesPrefix: 'Edicion '
        });
        updateOrder.run(
          payload.customerName,
          payload.cedula,
          payload.city,
          payload.address,
          payload.phone,
          payload.email,
          payload.instagram,
          payload.purchaseChannel,
          payload.selectionType,
          payload.size,
          payload.hoodieSize,
          payload.pantsSize,
          payload.quantity,
          payload.depositAmount,
          payload.pendingAmount,
          payload.paymentStatus,
          payload.notes,
          JSON.stringify(reservation.stockItems),
          JSON.stringify(reservation.productionItems),
          reservation.productionStatus,
          sizeChanged ? 1 : 0,
          sizeChanged ? 1 : 0,
          order.id,
          establishmentId
        );
        if (payload.productId) db.prepare('UPDATE renji_orders SET product_id = ?, product_name = ?, color = ? WHERE id = ?')
          .run(payload.productId, payload.productName, payload.color, order.id);
      });
      transaction();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo editar el pedido' });
    }
  });

  app.delete('/api/renji/orders/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const order = db.prepare('SELECT * FROM renji_orders WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      let restoredStock = [];
      const transaction = db.transaction(() => {
        restoredStock = restoreOrderStock(db, order, 'Reversa por eliminacion');
        db.prepare('DELETE FROM renji_orders WHERE id = ? AND establishment_id = ?').run(order.id, establishmentId);
      });
      transaction();
      res.json({ ...getRenjiOverview(db, establishmentId), restored_stock: restoredStock });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo eliminar el pedido' });
    }
  });

  app.put('/api/renji/registrations/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const registration = db.prepare("SELECT * FROM renji_registrations WHERE id = ? AND establishment_id = ? AND status = 'pending'").get(req.params.id, establishmentId);
      if (!registration) return res.status(404).json({ message: 'Registro no encontrado o ya confirmado' });
      if (parseJsonArray(registration.catalog_items_json).length > 1) {
        throw catalogError('Este registro contiene dos prendas. Puedes confirmarlo o cancelarlo como un solo pedido.', 400);
      }
      const registrationType = req.body.registration_type === 'separation' ? 'separation' : 'paid';
      const payload = readOrderPayload({ ...req.body, product_id: req.body.product_id ?? registration.product_id }, {
        paidByDefault: registrationType === 'paid',
        registrationType,
        requireDeposit: registrationType === 'separation'
      });
      if (registration.product_id && !payload.productId) throw catalogError('Selecciona un pantalón del catálogo.');
      if (payload.productId) validateCatalogPayload(db, establishmentId, payload);
      db.transaction(() => {
        releaseRegistrationStock(db, registration, 'Edición');
        if (payload.productId) moveCatalogStock(db, establishmentId, payload.productId, payload.pantsSize, -payload.quantity, `Edición registro ${registration.id}`);
        const result = db.prepare(
          `UPDATE renji_registrations
           SET customer_name = ?, customer_cedula = ?, customer_city = ?, customer_address = ?, customer_phone = ?,
               customer_email = ?, customer_instagram = ?, purchase_channel = ?, selection_type = ?, size = ?, hoodie_size = ?, pants_size = ?, quantity = ?,
               registration_type = ?, deposit_amount = ?, notes = ?
           WHERE id = ? AND establishment_id = ? AND status = 'pending'`
        ).run(
          payload.customerName,
          payload.cedula,
          payload.city,
          payload.address,
          payload.phone,
          payload.email,
          payload.instagram,
          payload.purchaseChannel,
          payload.selectionType,
          payload.size,
          payload.hoodieSize,
          payload.pantsSize,
          payload.quantity,
          payload.registrationType,
          payload.depositAmount,
          payload.notes,
          req.params.id,
          establishmentId
        );
        if (!result.changes) {
          throw catalogError('Registro no encontrado o ya confirmado', 404);
        }
        if (payload.productId) db.prepare('UPDATE renji_registrations SET product_id = ?, product_name = ?, color = ?, stock_reserved = 1, email_sent = 0, catalog_items_json = ? WHERE id = ?')
          .run(payload.productId, payload.productName, payload.color, JSON.stringify([{
            item_type: 'pants', product_id: payload.productId, product_name: payload.productName,
            color: payload.color, size: payload.pantsSize, quantity: payload.quantity
          }]), registration.id);
      })();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo editar el registro' });
    }
  });

  app.delete('/api/renji/registrations/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      db.transaction(() => {
        const registration = db.prepare("SELECT * FROM renji_registrations WHERE id = ? AND establishment_id = ? AND status = 'pending'").get(req.params.id, establishmentId);
        if (!registration) throw catalogError('Registro no encontrado o ya procesado', 404);
        releaseRegistrationStock(db, registration, 'Cancelación');
        db.prepare("UPDATE renji_registrations SET status = 'deleted', stock_reserved = 0 WHERE id = ?").run(registration.id);
      })();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo eliminar el registro' });
    }
  });

  app.post('/api/renji/registrations/:id/confirm', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const registration = db
        .prepare("SELECT * FROM renji_registrations WHERE id = ? AND establishment_id = ? AND status = 'pending'")
        .get(req.params.id, establishmentId);
      if (!registration) {
        return res.status(404).json({ message: 'Registro no encontrado o ya procesado' });
      }
      const isSeparation = registration.registration_type === 'separation';
      const payload = readOrderPayload(registration, {
        paidByDefault: !isSeparation,
        registrationType: registration.registration_type || 'paid',
        requireDeposit: isSeparation
      });
      payload.catalogItems = parseJsonArray(registration.catalog_items_json);
      const transaction = db.transaction(() => {
        const orderId = insertRenjiOrder(db, establishmentId, payload, { alreadyReserved: Boolean(registration.product_id && registration.stock_reserved) });
        db.prepare(
          `UPDATE renji_registrations
           SET status = 'confirmed', stock_reserved = 0, order_id = ?, confirmed_at = datetime('now', 'localtime')
           WHERE id = ? AND establishment_id = ?`
        ).run(orderId, registration.id, establishmentId);
      });
      transaction();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo confirmar el registro' });
    }
  });

  app.post('/api/renji/registrations/:id/resend-email', requireAdmin, async (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const registration = db.prepare("SELECT * FROM renji_registrations WHERE id = ? AND establishment_id = ? AND status = 'pending'").get(req.params.id, establishmentId);
      if (!registration) throw catalogError('Registro no encontrado', 404);
      const payload = readOrderPayload(registration, { requireEmail: true });
      payload.catalogItems = parseJsonArray(registration.catalog_items_json);
      const result = await sendRenjiOrderConfirmationEmail({ ...payload, registrationId: registration.id });
      if (!result.sent) throw catalogError('No se pudo enviar el correo. Revisa la configuración de correo.', 503);
      db.prepare('UPDATE renji_registrations SET email_sent = 1 WHERE id = ?').run(registration.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 500).json({ message: 'No se pudo enviar la confirmación por correo. El pedido sigue registrado.' });
    }
  });

  app.patch('/api/renji/orders/:id/payment', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const order = db.prepare('SELECT * FROM renji_orders WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      const paymentStatus = req.body.payment_status === 'paid' ? 'paid' : 'pending';
      const pendingAmount = paymentStatus === 'paid' ? 0 : toMoney(req.body.pending_amount);
      db.prepare(
        `UPDATE renji_orders
         SET payment_status = ?, pending_amount = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(paymentStatus, pendingAmount, req.params.id, establishmentId);
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo actualizar el pago' });
    }
  });

  app.patch('/api/renji/orders/:id/shipping', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const shippingStatus = req.body.shipping_status === 'sent' ? 'sent' : 'not_sent';
      const order = db.prepare('SELECT * FROM renji_orders WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      if (shippingStatus === 'sent' && (order.production_status || 'ready') !== 'ready') {
        return res.status(400).json({ message: 'No puedes marcar enviado mientras hay prendas en produccion.' });
      }
      const result = db.prepare(
        `UPDATE renji_orders
         SET shipping_status = ?,
             sent_at = CASE WHEN ? = 'sent' THEN datetime('now', 'localtime') ELSE NULL END,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(shippingStatus, shippingStatus, req.params.id, establishmentId);
      if (!result.changes) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo actualizar el envio' });
    }
  });

  app.patch('/api/renji/orders/:id/production-ready', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const order = db.prepare('SELECT * FROM renji_orders WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId);
      if (!order) {
        return res.status(404).json({ message: 'Pedido no encontrado' });
      }
      const stockItems = parseJsonArray(order.stock_items_json);
      const productionItems = parseJsonArray(order.production_items_json);
      if (!productionItems.length) {
        return res.json(getRenjiOverview(db, establishmentId));
      }
      db.prepare(
        `UPDATE renji_orders
         SET stock_items_json = ?,
             production_items_json = '[]',
             production_status = 'ready',
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(JSON.stringify([...stockItems, ...productionItems]), order.id, establishmentId);
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo marcar como listo' });
    }
  });

  app.post('/api/renji/guides', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const ids = (Array.isArray(req.body.order_ids) ? req.body.order_ids : [])
        .map((id) => Number(id))
        .filter(Boolean);
      if (!ids.length) {
        return res.status(400).json({ message: 'Selecciona al menos un cliente para generar guias' });
      }

      const placeholders = ids.map(() => '?').join(',');
      const orders = db.prepare(
        `SELECT *
         FROM renji_orders
         WHERE establishment_id = ?
           AND payment_status = 'paid'
           AND COALESCE(production_status, 'ready') = 'ready'
           AND id IN (${placeholders})
         ORDER BY customer_name COLLATE NOCASE ASC, id ASC`
      ).all(establishmentId, ...ids).map(formatOrder);
      if (orders.length !== ids.length) {
        return res.status(400).json({ message: 'Solo los pedidos pagados y sin produccion pendiente pueden generar guia' });
      }

      const transaction = db.transaction(() => {
        db.prepare(
          `UPDATE renji_orders
           SET shipping_status = 'sent',
               sent_at = COALESCE(sent_at, datetime('now', 'localtime')),
               updated_at = datetime('now', 'localtime')
           WHERE establishment_id = ?
             AND payment_status = 'paid'
             AND COALESCE(production_status, 'ready') = 'ready'
             AND id IN (${placeholders})`
        ).run(establishmentId, ...ids);
      });
      transaction();

      res.json({ guides: orders, overview: getRenjiOverview(db, establishmentId) });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo generar guias' });
    }
  });
}
