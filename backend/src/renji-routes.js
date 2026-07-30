import { requireAdmin } from './auth.js';
import { toMoney } from './db.js';

const sizes = ['S', 'M', 'L', 'XL'];
const itemTypes = ['hoodie', 'pants'];

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeItemType(value) {
  return itemTypes.includes(value) ? value : '';
}

function normalizeSize(value) {
  const size = cleanText(value).toUpperCase();
  return sizes.includes(size) ? size : '';
}

function orderItemsForSelection(selectionType, quantity) {
  const qty = Math.max(1, Number(quantity || 1));
  if (selectionType === 'set') {
    return [
      { item_type: 'hoodie', quantity: qty },
      { item_type: 'pants', quantity: qty }
    ];
  }
  return [{ item_type: selectionType, quantity: qty }];
}

function formatOrder(row) {
  const garments = row.selection_type === 'set' ? Number(row.quantity || 0) * 2 : Number(row.quantity || 0);
  return {
    ...row,
    quantity: Number(row.quantity || 0),
    garments,
    pending_amount: toMoney(row.pending_amount)
  };
}

function formatRegistration(row) {
  return {
    ...row,
    quantity: Number(row.quantity || 0)
  };
}

function getRenjiEstablishment(db) {
  return db.prepare("SELECT * FROM establishments WHERE name = 'RENJI' AND status = 'active'").get()
    || db.prepare("SELECT * FROM establishments WHERE module_type = 'clothing' AND status = 'active' ORDER BY id ASC").get();
}

function readOrderPayload(body, { paidByDefault = false } = {}) {
  const customerName = cleanText(body.customer_name);
  const city = cleanText(body.customer_city);
  const address = cleanText(body.customer_address);
  const phone = cleanText(body.customer_phone);
  const cedula = cleanText(body.customer_cedula);
  const instagram = cleanText(body.customer_instagram).replace(/^@+/, '');
  const purchaseChannel = body.purchase_channel === 'instagram' ? 'instagram' : 'other';
  const selectionType = ['set', 'hoodie', 'pants'].includes(body.selection_type) ? body.selection_type : '';
  const size = normalizeSize(body.size);
  const quantity = Math.max(1, Number(body.quantity || 1));
  const pendingAmount = paidByDefault ? 0 : toMoney(body.pending_amount);
  const paymentStatus = paidByDefault ? 'paid' : (body.payment_status === 'paid' ? 'paid' : 'pending');
  const notes = cleanText(body.notes);

  if (!customerName || !city || !address || !phone || !selectionType || !size) {
    const error = new Error('Cliente, ciudad, direccion, celular, prenda y talla son obligatorios');
    error.status = 400;
    throw error;
  }

  if (purchaseChannel === 'instagram' && !instagram) {
    const error = new Error('El usuario de Instagram es obligatorio si la compra fue por Instagram');
    error.status = 400;
    throw error;
  }

  return {
    customerName,
    cedula,
    city,
    address,
    phone,
    instagram,
    purchaseChannel,
    selectionType,
    size,
    quantity,
    pendingAmount: paymentStatus === 'paid' ? 0 : pendingAmount,
    paymentStatus,
    notes
  };
}

function getRenjiOverview(db, establishmentId) {
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
    .map(formatOrder);
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
      pending_registrations: registrations.length
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

function insertRenjiOrder(db, establishmentId, payload) {
  const result = db.prepare(
    `INSERT INTO renji_orders
     (establishment_id, customer_name, customer_cedula, customer_city, customer_address, customer_phone, customer_instagram, purchase_channel, selection_type, size, quantity, pending_amount, payment_status, shipping_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_sent', ?)`
  ).run(
    establishmentId,
    payload.customerName,
    payload.cedula,
    payload.city,
    payload.address,
    payload.phone,
    payload.instagram,
    payload.purchaseChannel,
    payload.selectionType,
    payload.size,
    payload.quantity,
    payload.pendingAmount,
    payload.paymentStatus,
    payload.notes
  );

  const orderId = result.lastInsertRowid;
  const orderNumber = `RENJI-${String(orderId).padStart(5, '0')}`;
  db.prepare('UPDATE renji_orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);

  for (const item of orderItemsForSelection(payload.selectionType, payload.quantity)) {
    applyStockMovement(db, {
      establishmentId,
      orderId,
      itemType: item.item_type,
      size: payload.size,
      quantity: -item.quantity,
      movementType: 'sale',
      notes: orderNumber
    });
  }

  return orderId;
}

function restoreOrderStock(db, order) {
  for (const item of orderItemsForSelection(order.selection_type, order.quantity)) {
    applyStockMovement(db, {
      establishmentId: order.establishment_id,
      orderId: order.id,
      itemType: item.item_type,
      size: order.size,
      quantity: item.quantity,
      movementType: 'return',
      notes: `Reversa ${order.order_number || order.id}`
    });
  }
}

export function registerRenjiRoutes(app, db, getRequestEstablishmentId) {
  app.post('/api/renji/public-registrations', (req, res) => {
    try {
      const establishment = getRenjiEstablishment(db);
      if (!establishment) {
        return res.status(404).json({ message: 'RENJI no esta disponible' });
      }
      const payload = readOrderPayload(req.body, { paidByDefault: true });
      const result = db.prepare(
        `INSERT INTO renji_registrations
         (establishment_id, customer_name, customer_cedula, customer_city, customer_address, customer_phone, customer_instagram, purchase_channel, selection_type, size, quantity, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        establishment.id,
        payload.customerName,
        payload.cedula,
        payload.city,
        payload.address,
        payload.phone,
        payload.instagram,
        payload.purchaseChannel,
        payload.selectionType,
        payload.size,
        payload.quantity,
        payload.notes
      );
      res.status(201).json({ ok: true, registration_id: result.lastInsertRowid });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar tus datos' });
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
      const transaction = db.transaction(() => {
        restoreOrderStock(db, order);
        db.prepare(
          `UPDATE renji_orders
           SET customer_name = ?, customer_cedula = ?, customer_city = ?, customer_address = ?, customer_phone = ?,
               customer_instagram = ?, purchase_channel = ?, selection_type = ?, size = ?, quantity = ?,
               pending_amount = ?, payment_status = ?, notes = ?, updated_at = datetime('now', 'localtime')
           WHERE id = ? AND establishment_id = ?`
        ).run(
          payload.customerName,
          payload.cedula,
          payload.city,
          payload.address,
          payload.phone,
          payload.instagram,
          payload.purchaseChannel,
          payload.selectionType,
          payload.size,
          payload.quantity,
          payload.pendingAmount,
          payload.paymentStatus,
          payload.notes,
          order.id,
          establishmentId
        );
        for (const item of orderItemsForSelection(payload.selectionType, payload.quantity)) {
          applyStockMovement(db, {
            establishmentId,
            orderId: order.id,
            itemType: item.item_type,
            size: payload.size,
            quantity: -item.quantity,
            movementType: 'sale',
            notes: `Edicion ${order.order_number || order.id}`
          });
        }
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
      const transaction = db.transaction(() => {
        restoreOrderStock(db, order);
        db.prepare('DELETE FROM renji_orders WHERE id = ? AND establishment_id = ?').run(order.id, establishmentId);
      });
      transaction();
      res.json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo eliminar el pedido' });
    }
  });

  app.put('/api/renji/registrations/:id', requireAdmin, (req, res) => {
    try {
      const establishmentId = getRequestEstablishmentId(req);
      assertRenjiBusiness(db, establishmentId);
      const payload = readOrderPayload(req.body, { paidByDefault: true });
      const result = db.prepare(
        `UPDATE renji_registrations
         SET customer_name = ?, customer_cedula = ?, customer_city = ?, customer_address = ?, customer_phone = ?,
             customer_instagram = ?, purchase_channel = ?, selection_type = ?, size = ?, quantity = ?, notes = ?
         WHERE id = ? AND establishment_id = ? AND status = 'pending'`
      ).run(
        payload.customerName,
        payload.cedula,
        payload.city,
        payload.address,
        payload.phone,
        payload.instagram,
        payload.purchaseChannel,
        payload.selectionType,
        payload.size,
        payload.quantity,
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
      const payload = readOrderPayload(registration, { paidByDefault: true });
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
         WHERE establishment_id = ? AND id IN (${placeholders})
         ORDER BY customer_name COLLATE NOCASE ASC, id ASC`
      ).all(establishmentId, ...ids).map(formatOrder);

      const transaction = db.transaction(() => {
        db.prepare(
          `UPDATE renji_orders
           SET shipping_status = 'sent',
               sent_at = COALESCE(sent_at, datetime('now', 'localtime')),
               updated_at = datetime('now', 'localtime')
           WHERE establishment_id = ? AND id IN (${placeholders})`
        ).run(establishmentId, ...ids);
      });
      transaction();

      res.json({ guides: orders, overview: getRenjiOverview(db, establishmentId) });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo generar guias' });
    }
  });
}
