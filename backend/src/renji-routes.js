import { requireAdmin } from './auth.js';
import { toMoney } from './db.js';
import nodemailer from 'nodemailer';

const sizes = ['S', 'M', 'L', 'XL'];
const itemTypes = ['hoodie', 'pants'];

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
  const hoodieSize = payload.hoodieSize || payload.hoodie_size || payload.size || 'M';
  const pantsSize = payload.pantsSize || payload.pants_size || payload.size || 'M';
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
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const detail = renjiItemDetailText(payload);
  const quantity = Number(payload.quantity || 1);

  await transporter.sendMail({
    from,
    to: payload.email,
    subject: 'Confirmacion de datos RENJI',
    text: `Hola ${payload.customerName},

Recibimos tus datos para RENJI.

Pedido: ${detail}
Cantidad: ${quantity}
Color: Negro

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
          <p><strong>Pedido:</strong> ${escapeHtml(detail)}</p>
          <p><strong>Cantidad:</strong> ${quantity}</p>
          <p><strong>Color:</strong> Negro</p>
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

function orderItemsForSelection(selectionType, quantity, sizesByType = {}) {
  const qty = Math.max(1, Number(quantity || 1));
  const hoodieSize = sizesByType.hoodie_size || sizesByType.hoodieSize || sizesByType.size;
  const pantsSize = sizesByType.pants_size || sizesByType.pantsSize || sizesByType.size;
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
    hoodie_size: hoodieSize,
    pants_size: pantsSize,
    quantity: Number(row.quantity || 0),
    deposit_amount: toMoney(row.deposit_amount)
  };
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
  const quantity = Math.max(1, Number(body.quantity || 1));
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

  return {
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
    .map(formatRegistration);

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

function insertRenjiOrder(db, establishmentId, payload) {
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

  const items = orderItemsForSelection(payload.selectionType, payload.quantity, payload);
  const reservation = reserveRenjiStockForOrder(db, { establishmentId, orderId, orderNumber, items });
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
  const itemsToRestore = stockItems.length ? stockItems : orderItemsForSelection(order.selection_type, order.quantity, order);
  for (const item of itemsToRestore) {
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
  app.post('/api/renji/public-registrations', async (req, res) => {
    try {
      const establishment = getRenjiEstablishment(db);
      if (!establishment) {
        return res.status(404).json({ message: 'RENJI no esta disponible' });
      }
      const payload = readOrderPayload(req.body, { paidByDefault: true, registrationType: 'paid', requireEmail: true });
      const result = db.prepare(
        `INSERT INTO renji_registrations
         (establishment_id, customer_name, customer_cedula, customer_email, customer_city, customer_address, customer_phone, customer_instagram, purchase_channel, selection_type, size, hoodie_size, pants_size, quantity, registration_type, deposit_amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        establishment.id,
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
        payload.registrationType,
        payload.depositAmount,
        payload.notes
      );
      const emailResult = await sendRenjiOrderConfirmationEmail(payload).catch((error) => ({ sent: false, reason: error.message }));
      res.status(201).json({ ok: true, registration_id: result.lastInsertRowid, email: emailResult });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar tus datos' });
    }
  });

  app.post('/api/renji/public-separations', async (req, res) => {
    try {
      const establishment = getRenjiEstablishment(db);
      if (!establishment) {
        return res.status(404).json({ message: 'RENJI no esta disponible' });
      }
      const payload = readOrderPayload(req.body, { registrationType: 'separation', requireDeposit: true, requireEmail: true });
      const result = db.prepare(
        `INSERT INTO renji_registrations
         (establishment_id, customer_name, customer_cedula, customer_email, customer_city, customer_address, customer_phone, customer_instagram, purchase_channel, selection_type, size, hoodie_size, pants_size, quantity, registration_type, deposit_amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        establishment.id,
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
        payload.registrationType,
        payload.depositAmount,
        payload.notes
      );
      const emailResult = await sendRenjiOrderConfirmationEmail(payload).catch((error) => ({ sent: false, reason: error.message }));
      res.status(201).json({ ok: true, registration_id: result.lastInsertRowid, email: emailResult });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar tu separacion' });
    }
  });

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
        item_type: normalizeItemType(item.item_type),
        size: normalizeSize(item.size),
        quantity: Number(item.quantity || 0)
      })).filter((item) => item.item_type && item.size && item.quantity > 0);

      if (!validItems.length) {
        return res.status(400).json({ message: 'Agrega al menos una prenda con talla y cantidad' });
      }

      const transaction = db.transaction(() => {
        for (const item of validItems) {
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
      const payload = readOrderPayload(req.body);
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
      const registrationType = req.body.registration_type === 'separation' ? 'separation' : 'paid';
      const payload = readOrderPayload(req.body, {
        paidByDefault: registrationType === 'paid',
        registrationType,
        requireDeposit: registrationType === 'separation'
      });
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
        return res.status(404).json({ message: 'Registro no encontrado o ya confirmado' });
      }
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo editar el registro' });
    }
  });

  app.delete('/api/renji/registrations/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const result = db.prepare(
        "UPDATE renji_registrations SET status = 'deleted' WHERE id = ? AND establishment_id = ? AND status = 'pending'"
      ).run(req.params.id, establishmentId);
      if (!result.changes) {
        return res.status(404).json({ message: 'Registro no encontrado o ya procesado' });
      }
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
      const transaction = db.transaction(() => {
        const orderId = insertRenjiOrder(db, establishmentId, payload);
        db.prepare(
          `UPDATE renji_registrations
           SET status = 'confirmed', order_id = ?, confirmed_at = datetime('now', 'localtime')
           WHERE id = ? AND establishment_id = ?`
        ).run(orderId, registration.id, establishmentId);
      });
      transaction();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo confirmar el registro' });
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
