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

  const soldGarments = orders.reduce((sum, order) => sum + order.garments, 0);
  const pendingPayments = orders
    .filter((order) => order.payment_status === 'pending')
    .reduce((sum, order) => sum + Number(order.pending_amount || 0), 0);

  return {
    stock,
    orders,
    summary: {
      sold_orders: orders.length,
      sold_garments: soldGarments,
      pending_shipping: orders.filter((order) => order.shipping_status !== 'sent').length,
      paid_orders: orders.filter((order) => order.payment_status === 'paid').length,
      pending_amount: toMoney(pendingPayments)
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

export function registerRenjiRoutes(app, db, getRequestEstablishmentId) {
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
      const customerName = cleanText(req.body.customer_name);
      const city = cleanText(req.body.customer_city);
      const address = cleanText(req.body.customer_address);
      const phone = cleanText(req.body.customer_phone);
      const cedula = cleanText(req.body.customer_cedula);
      const selectionType = ['set', 'hoodie', 'pants'].includes(req.body.selection_type) ? req.body.selection_type : '';
      const size = normalizeSize(req.body.size);
      const quantity = Math.max(1, Number(req.body.quantity || 1));
      const pendingAmount = toMoney(req.body.pending_amount);
      const notes = cleanText(req.body.notes);

      if (!customerName || !city || !address || !phone || !selectionType || !size) {
        return res.status(400).json({ message: 'Cliente, ciudad, direccion, celular, prenda y talla son obligatorios' });
      }

      const transaction = db.transaction(() => {
        const result = db.prepare(
          `INSERT INTO renji_orders
           (establishment_id, customer_name, customer_cedula, customer_city, customer_address, customer_phone, selection_type, size, quantity, pending_amount, payment_status, shipping_status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'not_sent', ?)`
        ).run(establishmentId, customerName, cedula, city, address, phone, selectionType, size, quantity, pendingAmount, notes);

        const orderId = result.lastInsertRowid;
        const orderNumber = `RENJI-${String(orderId).padStart(5, '0')}`;
        db.prepare('UPDATE renji_orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);

        for (const item of orderItemsForSelection(selectionType, quantity)) {
          applyStockMovement(db, {
            establishmentId,
            orderId,
            itemType: item.item_type,
            size,
            quantity: -item.quantity,
            movementType: 'sale',
            notes: orderNumber
          });
        }
      });

      transaction();
      res.status(201).json(getRenjiOverview(db, establishmentId));
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message || 'No se pudo registrar la venta' });
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
