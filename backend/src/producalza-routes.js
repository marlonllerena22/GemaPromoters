import { createToken, requireProductionAdmin, requireProductionUser } from './auth.js';
import { createProductionOrderPdf } from './production-pdf.js';

const ORDER_STATUSES = ['draft', 'received', 'reviewed', 'in_production', 'finished', 'delivered', 'cancelled'];
const MODEL_STATUSES = ['received', 'reviewed', 'in_production', 'cut', 'stitched', 'assembled', 'finished', 'delivered', 'cancelled'];
const PAYMENT_TYPES = ['abono', 'cheque', 'transferencia', 'efectivo', 'saldo', 'otro'];
const PAYMENT_STATUSES = ['pending', 'paid', 'cancelled'];
const SIZES = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const DELIVERY_NOTE_BALANCE_REF = 'AUTO-NOTA-ENTREGA';

export function findProductionUserForLogin(db, username, password) {
  return db
    .prepare(
      `SELECT production_users.*, establishments.display_name AS establishment_name
       FROM production_users
       JOIN establishments ON establishments.id = production_users.establishment_id
       WHERE production_users.username = ?
         AND production_users.password = ?
         AND production_users.status = 'active'
         AND establishments.status = 'active'
         AND establishments.module_type = 'production'`
    )
    .get(String(username || '').trim(), String(password || '').trim());
}

export function productionLoginResponse(user) {
  const role = user.role === 'admin' ? 'production_admin' : 'production_vendor';
  return {
    token: createToken({
      role,
      username: user.username,
      productionUserId: user.id,
      establishmentId: user.establishment_id,
      canViewAllOrders: Boolean(user.can_view_all_orders)
    }),
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role,
      establishment_id: user.establishment_id,
      establishment_display_name: user.establishment_name || 'PRODUCALZA',
      can_view_all_orders: Boolean(user.can_view_all_orders)
    }
  };
}

export function registerProducalzaRoutes(app, db, getRequestEstablishmentId) {
  function establishmentId(req) {
    return Number(req.user?.establishmentId || getRequestEstablishmentId(req));
  }

  function ensureProductionBusiness(req, res) {
    const id = establishmentId(req);
    const business = db
      .prepare("SELECT * FROM establishments WHERE id = ? AND module_type = 'production'")
      .get(id);
    if (!business) {
      res.status(403).json({ message: 'Este negocio no tiene habilitado el modulo de produccion' });
      return null;
    }
    return business;
  }

  function isProductionAdmin(req) {
    return ['admin', 'supreme', 'production_admin'].includes(req.user?.role);
  }

  function orderVisibility(req) {
    if (isProductionAdmin(req) || req.user?.canViewAllOrders) {
      return { sql: '', params: [] };
    }
    return { sql: ' AND orders.seller_user_id = ?', params: [req.user?.productionUserId || 0] };
  }

  function audit(req, action, entityType, entityId, details = '') {
    db.prepare(
      `INSERT INTO production_audit_log
       (establishment_id, user_label, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      establishmentId(req),
      req.user?.username || req.user?.role || 'system',
      action,
      entityType,
      entityId || null,
      details
    );
  }

  function nextOrderNumber(establishmentIdValue) {
    const year = new Date().getFullYear();
    const prefix = `PC-${year}-`;
    const latest = db
      .prepare(
        `SELECT order_number FROM production_orders
         WHERE establishment_id = ? AND order_number LIKE ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(establishmentIdValue, `${prefix}%`);
    const lastNumber = Number(String(latest?.order_number || '').split('-').pop()) || 0;
    return `${prefix}${String(lastNumber + 1).padStart(4, '0')}`;
  }

  function nextCardNumber(establishmentIdValue) {
    const row = db
      .prepare("SELECT value FROM production_settings WHERE establishment_id = ? AND key = 'next_card_number'")
      .get(establishmentIdValue);
    const next = Math.max(1, Number(row?.value || 62));
    db.prepare(
      `INSERT INTO production_settings (establishment_id, key, value)
       VALUES (?, 'next_card_number', ?)
       ON CONFLICT(establishment_id, key) DO UPDATE SET value = excluded.value`
    ).run(establishmentIdValue, String(next + 1));
    return next;
  }

  function normalizeGuideLogo(value) {
    const logo = String(value || '').trim();
    if (!logo) return '';
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(logo)) {
      throw new Error('La imagen de la guia debe ser PNG, JPG o WebP');
    }
    if (logo.length > 3500000) {
      throw new Error('La imagen de la guia es demasiado pesada');
    }
    return logo;
  }

  function normalizeTemplateName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function normalizeDateInput(value, fallback = '') {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
  }

  function normalizeOptionalDate(value) {
    return normalizeDateInput(value, '') || null;
  }

  function normalizePaymentPayload(body) {
    const amount = Math.max(0, Number(body.amount || 0) || 0);
    const paymentType = PAYMENT_TYPES.includes(body.payment_type) ? body.payment_type : 'abono';
    const status = PAYMENT_STATUSES.includes(body.status) ? body.status : 'pending';
    return {
      payment_type: paymentType,
      amount,
      payment_date: normalizeOptionalDate(body.payment_date),
      due_date: normalizeOptionalDate(body.due_date),
      status,
      bank: String(body.bank || '').trim(),
      reference: String(body.reference || '').trim(),
      notes: String(body.notes || '').trim()
    };
  }

  function moneyValue(value) {
    return Math.max(0, Math.round((Number(value || 0) || 0) * 100) / 100);
  }

  function slugFromName(value) {
    return normalizeTemplateName(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'cliente';
  }

  function nextCustomTemplateKey(establishmentIdValue, name) {
    const base = `custom-${slugFromName(name)}`;
    let key = base;
    let suffix = 2;
    const exists = db.prepare(
      'SELECT id FROM production_guide_templates WHERE establishment_id = ? AND template_key = ?'
    );
    while (exists.get(establishmentIdValue, key)) {
      key = `${base}-${suffix}`;
      suffix += 1;
    }
    return key;
  }

  function normalizeModels(models) {
    if (!Array.isArray(models) || !models.length) {
      throw new Error('Agrega al menos un modelo al pedido');
    }
    return models.map((model) => {
      const quantities = {};
      let totalPairs = 0;
      for (const size of SIZES) {
        const quantity = Math.max(0, Number(model.sizes?.[size] || 0));
        quantities[size] = Math.floor(quantity);
        totalPairs += quantities[size];
      }
      if (!String(model.model_code || '').trim()) {
        throw new Error('Todos los modelos deben tener codigo o nombre');
      }
      if (totalPairs <= 0) {
        throw new Error(`El modelo ${model.model_code} debe tener al menos un par`);
      }
      return {
        id: Number(model.id || 0),
        model_code: String(model.model_code).trim(),
        color: String(model.color || '').trim(),
        material: String(model.material || '').trim(),
        notes: String(model.notes || '').trim(),
        plant_area: String(model.plant_area || '').trim(),
        unit_price: moneyValue(model.unit_price),
        status: MODEL_STATUSES.includes(model.status) ? model.status : 'received',
        card_number: Number(model.card_number || 0) || null,
        sizes: quantities,
        total_pairs: totalPairs
      };
    });
  }

  function getOrder(orderId, req) {
    const businessId = establishmentId(req);
    const visibility = orderVisibility(req);
    const order = db
      .prepare(
        `SELECT orders.*, clients.name AS client_name, clients.business_name, clients.tax_id,
                clients.city, clients.address, clients.phone, clients.email,
                clients.guide_template_key AS client_guide_template_key,
                clients.guide_logo_url AS client_guide_logo_url,
                users.name AS seller_name
         FROM production_orders AS orders
         JOIN production_clients AS clients ON clients.id = orders.client_id
         LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
         WHERE orders.id = ? AND orders.establishment_id = ? AND orders.deleted_at IS NULL
         ${visibility.sql}`
      )
      .get(orderId, businessId, ...visibility.params);
    if (!order) {
      return null;
    }
    const models = db
      .prepare(
        `SELECT * FROM production_order_models
         WHERE order_id = ? AND establishment_id = ?
         ORDER BY id ASC`
      )
      .all(order.id, businessId);
    const sizes = db
      .prepare(
        `SELECT sizes.* FROM production_model_sizes AS sizes
         JOIN production_order_models AS models ON models.id = sizes.model_id
         WHERE models.order_id = ? AND sizes.establishment_id = ?
         ORDER BY sizes.size`
      )
      .all(order.id, businessId);
    const payments = db
      .prepare(
        `SELECT * FROM production_order_payments
         WHERE order_id = ? AND establishment_id = ?
         ORDER BY COALESCE(due_date, payment_date, created_at) DESC, id DESC`
      )
      .all(order.id, businessId);
    return {
      ...order,
      payments,
      models: models.map((model) => ({
        ...model,
        sizes: Object.fromEntries(
          sizes.filter((size) => size.model_id === model.id).map((size) => [size.size, size.quantity])
        )
      }))
    };
  }

  app.get('/api/producalza/bootstrap', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const id = business.id;
    const users = isProductionAdmin(req)
      ? db.prepare(
        `SELECT id, name, username, role, can_view_all_orders, status, created_at
         FROM production_users WHERE establishment_id = ? ORDER BY name`
      ).all(id)
      : [];
    res.json({
      business,
      user: req.user,
      users,
      sizes: SIZES,
      order_statuses: ORDER_STATUSES,
      model_statuses: MODEL_STATUSES
    });
  });

  app.get('/api/producalza/guide-templates', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    res.json(db.prepare(
      `SELECT template_key AS key, name, logo_url, custom_layout, updated_at
       FROM production_guide_templates
       WHERE establishment_id = ?
       ORDER BY custom_layout DESC, name`
    ).all(business.id));
  });

  app.post('/api/producalza/guide-templates', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const name = normalizeTemplateName(req.body.name);
    if (!name) return res.status(400).json({ message: 'El nombre del cliente es obligatorio' });
    let logoUrl;
    try {
      logoUrl = normalizeGuideLogo(req.body.logo_url);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    if (!logoUrl) return res.status(400).json({ message: 'Carga el logo para crear el formato' });
    const key = nextCustomTemplateKey(business.id, name);
    const result = db.prepare(
      `INSERT INTO production_guide_templates
       (establishment_id, template_key, name, logo_url, custom_layout)
       VALUES (?, ?, ?, ?, 1)`
    ).run(business.id, key, name, logoUrl);
    audit(req, 'create', 'guide_template', result.lastInsertRowid, name);
    res.status(201).json({ key, name, logo_url: logoUrl, custom_layout: 1 });
  });

  app.put('/api/producalza/guide-templates/:key', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const key = String(req.params.key || '').trim();
    const current = db.prepare(
      'SELECT * FROM production_guide_templates WHERE establishment_id = ? AND template_key = ?'
    ).get(business.id, key);
    const name = normalizeTemplateName(req.body.name) || current?.name || normalizeTemplateName(key.replace(/^custom-/, '').replace(/-/g, ' '));
    let logoUrl;
    try {
      logoUrl = normalizeGuideLogo(req.body.logo_url);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    if (!logoUrl) return res.status(400).json({ message: 'Carga una imagen para guardar este formato' });
    db.prepare(
      `INSERT INTO production_guide_templates
       (establishment_id, template_key, name, logo_url, custom_layout, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(establishment_id, template_key) DO UPDATE SET
         name = excluded.name,
         logo_url = excluded.logo_url,
         custom_layout = MAX(production_guide_templates.custom_layout, excluded.custom_layout),
         updated_at = datetime('now', 'localtime')`
    ).run(business.id, key, name, logoUrl, current?.custom_layout ? 1 : 0);
    audit(req, 'update', 'guide_template', current?.id || null, key);
    res.json({ key, name, logo_url: logoUrl, custom_layout: current?.custom_layout ? 1 : 0 });
  });

  app.get('/api/producalza/dashboard', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const visibility = orderVisibility(req);
    const params = [business.id, ...visibility.params];
    const counts = db.prepare(
      `SELECT
         SUM(CASE WHEN orders.status IN ('received', 'reviewed') THEN 1 ELSE 0 END) AS new_orders,
         SUM(CASE WHEN orders.status = 'in_production' THEN 1 ELSE 0 END) AS in_production,
         SUM(CASE WHEN orders.status IN ('finished', 'delivered') THEN 1 ELSE 0 END) AS finished
       FROM production_orders AS orders
       WHERE orders.establishment_id = ? AND orders.deleted_at IS NULL ${visibility.sql}`
    ).get(...params);
    const pendingPairs = db.prepare(
      `SELECT COALESCE(SUM(models.total_pairs), 0) AS total
       FROM production_order_models AS models
       JOIN production_orders AS orders ON orders.id = models.order_id
       WHERE orders.establishment_id = ? AND orders.deleted_at IS NULL
         AND models.status NOT IN ('finished', 'delivered', 'cancelled') ${visibility.sql}`
    ).get(...params).total;
    const bySeller = db.prepare(
      `SELECT COALESCE(users.name, 'Sin vendedor') AS seller_name,
              COALESCE(SUM(models.total_pairs), 0) AS total_pairs
       FROM production_orders AS orders
       LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
       LEFT JOIN production_order_models AS models ON models.order_id = orders.id
       WHERE orders.establishment_id = ? AND orders.deleted_at IS NULL ${visibility.sql}
       GROUP BY orders.seller_user_id
      ORDER BY total_pairs DESC`
    ).all(...params);
    const alertParams = [business.id];
    const alertOwnerFilter = isProductionAdmin(req)
      ? ''
      : ' AND visits.visited_by_user_id = ?';
    if (!isProductionAdmin(req)) alertParams.push(req.user?.productionUserId || 0);
    const followUpAlerts = db.prepare(
      `SELECT visits.id, visits.client_id, visits.next_visit_date, visits.next_visit_type,
              visits.visit_type, visits.result, visits.notes,
              clients.name AS client_name, clients.city, clients.phone,
              COALESCE(users.name, visits.visitor_name, clients.imported_seller_code, 'Sin responsable') AS responsible_name,
              CASE
                WHEN COALESCE(NULLIF(visits.next_visit_type, ''), visits.visit_type) = 'visit' THEN 96
                ELSE 24
              END AS alert_hours
       FROM production_client_visits AS visits
       JOIN production_clients AS clients ON clients.id = visits.client_id
       LEFT JOIN production_users AS users ON users.id = visits.visited_by_user_id
       WHERE visits.establishment_id = ?
         AND visits.next_visit_date IS NOT NULL
         AND visits.next_visit_date <> ''
         AND visits.next_visit_date <= date(
           'now',
           'localtime',
           CASE
             WHEN COALESCE(NULLIF(visits.next_visit_type, ''), visits.visit_type) = 'visit' THEN '+4 day'
             ELSE '+1 day'
           END
         )
         ${alertOwnerFilter}
       ORDER BY visits.next_visit_date ASC, visits.id DESC
       LIMIT 12`
    ).all(...alertParams);
    const paymentAlertParams = [business.id];
    if (!isProductionAdmin(req)) paymentAlertParams.push(req.user?.productionUserId || 0);
    const paymentAlerts = db.prepare(
      `SELECT payments.id, payments.order_id, payments.payment_type, payments.amount,
              payments.due_date, payments.status, payments.bank, payments.reference,
              orders.order_number, clients.name AS client_name, clients.city, clients.phone,
              COALESCE(users.name, 'Sin vendedor') AS seller_name
       FROM production_order_payments AS payments
       JOIN production_orders AS orders ON orders.id = payments.order_id
       JOIN production_clients AS clients ON clients.id = orders.client_id
       LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
       WHERE payments.establishment_id = ?
         AND orders.deleted_at IS NULL
         AND payments.status = 'pending'
         AND payments.due_date IS NOT NULL
         AND payments.due_date <> ''
         AND payments.due_date <= date('now', 'localtime', '+1 day')
         ${isProductionAdmin(req) ? '' : 'AND orders.seller_user_id = ?'}
       ORDER BY payments.due_date ASC, payments.id DESC
       LIMIT 12`
    ).all(...paymentAlertParams);
    res.json({
      new_orders: Number(counts.new_orders || 0),
      in_production: Number(counts.in_production || 0),
      finished: Number(counts.finished || 0),
      pending_pairs: Number(pendingPairs || 0),
      by_seller: bySeller,
      follow_up_alerts: followUpAlerts,
      payment_alerts: paymentAlerts
    });
  });

  app.get('/api/producalza/users', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    res.json(db.prepare(
      `SELECT id, name, username, role, can_view_all_orders, status, created_at
       FROM production_users WHERE establishment_id = ? ORDER BY name`
    ).all(business.id));
  });

  app.post('/api/producalza/users', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    const role = req.body.role === 'admin' ? 'admin' : 'vendor';
    if (!name || !username || password.length < 6) {
      return res.status(400).json({ message: 'Nombre, usuario y una contrasena de al menos 6 caracteres son obligatorios' });
    }
    try {
      const result = db.prepare(
        `INSERT INTO production_users
         (establishment_id, name, username, password, role, can_view_all_orders, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        business.id,
        name,
        username,
        password,
        role,
        req.body.can_view_all_orders ? 1 : 0,
        req.body.status === 'inactive' ? 'inactive' : 'active'
      );
      audit(req, 'create', 'production_user', result.lastInsertRowid, name);
      return res.status(201).json({ id: result.lastInsertRowid });
    } catch {
      return res.status(409).json({ message: 'Ese nombre de usuario ya existe' });
    }
  });

  app.put('/api/producalza/users/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = db.prepare(
      'SELECT * FROM production_users WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!current) return res.status(404).json({ message: 'Usuario no encontrado' });
    const result = db.prepare(
      `UPDATE production_users
       SET name = ?, username = ?, password = ?, role = ?, can_view_all_orders = ?, status = ?
       WHERE id = ? AND establishment_id = ?`
    ).run(
      String(req.body.name || current.name).trim(),
      String(req.body.username || current.username).trim(),
      String(req.body.password || current.password).trim(),
      req.body.role === 'admin' ? 'admin' : 'vendor',
      req.body.can_view_all_orders ? 1 : 0,
      req.body.status === 'inactive' ? 'inactive' : 'active',
      current.id,
      business.id
    );
    audit(req, 'update', 'production_user', current.id, current.name);
    res.json({ ok: Boolean(result.changes) });
  });

  app.get('/api/producalza/clients', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const search = `%${String(req.query.search || '').trim()}%`;
    const clients = db.prepare(
      `SELECT clients.id, clients.establishment_id, clients.external_number, clients.name,
              clients.business_name, clients.tax_id, clients.city, clients.address, clients.phone,
              clients.email, clients.brand, clients.payment_method, clients.bank_reference,
              clients.classification, clients.imported_seller_code, clients.guide_template_key,
              clients.general_notes, clients.created_at, clients.updated_at,
              CASE WHEN COALESCE(clients.guide_logo_url, '') <> '' THEN 1 ELSE 0 END AS has_guide_logo,
              (SELECT COUNT(*) FROM production_orders AS orders
               WHERE orders.client_id = clients.id AND orders.deleted_at IS NULL) AS order_count,
              (SELECT COUNT(*) FROM production_client_visits AS visits
               WHERE visits.client_id = clients.id) AS visit_count
       FROM production_clients AS clients
       WHERE clients.establishment_id = ?
         AND (clients.name LIKE ? OR clients.business_name LIKE ? OR clients.city LIKE ?
              OR clients.phone LIKE ? OR clients.tax_id LIKE ?)
       ORDER BY clients.name`
    ).all(business.id, search, search, search, search, search);
    res.json(clients);
  });

  app.post('/api/producalza/clients/import', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const clients = Array.isArray(req.body.clients) ? req.body.clients : [];
    if (!clients.length || clients.length > 5000) {
      return res.status(400).json({ message: 'El archivo de importacion no contiene clientes validos' });
    }

    const findClient = db.prepare(
      `SELECT id FROM production_clients
       WHERE establishment_id = ? AND external_number = ?`
    );
    const insertClient = db.prepare(
      `INSERT INTO production_clients
       (establishment_id, external_number, name, business_name, tax_id, city, address, phone, email,
        payment_method, classification, imported_seller_code, general_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateClient = db.prepare(
      `UPDATE production_clients SET
       name = ?, business_name = ?, tax_id = ?, city = ?, address = ?, phone = ?, email = ?,
       payment_method = ?, classification = ?, imported_seller_code = ?, general_notes = ?,
       updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    );
    const clearImportedVisits = db.prepare(
      `DELETE FROM production_client_visits
       WHERE client_id = ? AND establishment_id = ? AND notes = 'Importado del listado CLIENTES 2026'`
    );
    const insertVisit = db.prepare(
      `INSERT INTO production_client_visits
       (establishment_id, client_id, visitor_name, visit_type, visit_date, visit_date_text, pairs, notes)
       VALUES (?, ?, ?, 'visit', ?, ?, ?, ?)`
    );
    let importedClients = 0;
    let importedVisits = 0;

    try {
      db.transaction(() => {
        for (const client of clients) {
          const externalNumber = Number(client.external_number || 0) || null;
          const name = String(client.name || '').trim();
          if (!name) continue;
          let row = externalNumber ? findClient.get(business.id, externalNumber) : null;
          if (row) {
            updateClient.run(
              name,
              String(client.business_name || '').trim(),
              String(client.tax_id || '').trim(),
              String(client.city || '').trim(),
              String(client.address || '').trim(),
              String(client.phone || '').trim(),
              String(client.email || '').trim(),
              String(client.payment_method || '').trim(),
              String(client.classification || '').trim(),
              String(client.imported_seller_code || '').trim(),
              String(client.general_notes || '').trim(),
              row.id,
              business.id
            );
          } else {
            const result = insertClient.run(
              business.id,
              externalNumber,
              name,
              String(client.business_name || '').trim(),
              String(client.tax_id || '').trim(),
              String(client.city || '').trim(),
              String(client.address || '').trim(),
              String(client.phone || '').trim(),
              String(client.email || '').trim(),
              String(client.payment_method || '').trim(),
              String(client.classification || '').trim(),
              String(client.imported_seller_code || '').trim(),
              String(client.general_notes || '').trim()
            );
            row = { id: Number(result.lastInsertRowid) };
          }

          clearImportedVisits.run(row.id, business.id);
          for (const visit of Array.isArray(client.visits) ? client.visits : []) {
            insertVisit.run(
              business.id,
              row.id,
              String(client.imported_seller_code || '').trim(),
              visit.visit_date || null,
              String(visit.visit_date_text || '').trim(),
              visit.pairs == null ? null : Math.max(0, Number(visit.pairs)),
              'Importado del listado CLIENTES 2026'
            );
            importedVisits += 1;
          }
          importedClients += 1;
        }
      })();
    } catch {
      return res.status(400).json({ message: 'No se pudo procesar el archivo de clientes' });
    }

    audit(req, 'import', 'clients', null, `${importedClients} clientes, ${importedVisits} antecedentes`);
    res.json({ imported_clients: importedClients, imported_visits: importedVisits });
  });

  app.get('/api/producalza/clients/:id', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const client = db.prepare(
      'SELECT * FROM production_clients WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!client) return res.status(404).json({ message: 'Cliente no encontrado' });
    const visits = db.prepare(
      `SELECT visits.*,
              COALESCE(users.name, visits.visitor_name, clients.imported_seller_code, 'Sin responsable') AS visited_by_name,
              orders.order_number AS related_order_number
       FROM production_client_visits AS visits
       JOIN production_clients AS clients ON clients.id = visits.client_id
       LEFT JOIN production_users AS users ON users.id = visits.visited_by_user_id
       LEFT JOIN production_orders AS orders ON orders.id = visits.order_id
       WHERE visits.client_id = ? AND visits.establishment_id = ?
       ORDER BY COALESCE(visits.visit_date, visits.created_at) DESC, visits.id DESC`
    ).all(client.id, business.id);
    const orders = db.prepare(
      `SELECT orders.id, orders.order_number, orders.order_date, orders.status,
              users.name AS seller_name,
              COUNT(models.id) AS model_count,
              COALESCE(SUM(models.total_pairs), 0) AS total_pairs,
              GROUP_CONCAT(DISTINCT models.model_code) AS model_codes
       FROM production_orders AS orders
       LEFT JOIN production_order_models AS models ON models.order_id = orders.id
       LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
       WHERE orders.client_id = ? AND orders.establishment_id = ? AND orders.deleted_at IS NULL
       GROUP BY orders.id ORDER BY orders.order_date DESC, orders.id DESC`
    ).all(client.id, business.id);
    const totalPairs = orders.reduce((sum, order) => sum + Number(order.total_pairs || 0), 0);
    const lastActivity = [
      ...visits.map((visit) => visit.visit_date || visit.created_at),
      ...orders.map((order) => order.order_date)
    ].filter(Boolean).sort().at(-1) || null;
    const nextVisit = visits
      .filter((visit) => visit.next_visit_date && visit.next_visit_date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.next_visit_date.localeCompare(b.next_visit_date))[0]?.next_visit_date || null;
    res.json({
      ...client,
      visits,
      orders,
      summary: {
        visit_count: visits.length,
        order_count: orders.length,
        total_pairs: totalPairs,
        last_activity: lastActivity,
        next_visit: nextVisit
      }
    });
  });

  app.post('/api/producalza/clients', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'El nombre del cliente es obligatorio' });
    let guideLogoUrl = '';
    try {
      guideLogoUrl = isProductionAdmin(req) ? normalizeGuideLogo(req.body.guide_logo_url) : '';
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const result = db.prepare(
      `INSERT INTO production_clients
       (establishment_id, name, business_name, tax_id, city, address, phone, email, brand,
        payment_method, bank_reference, classification, guide_template_key, guide_logo_url, general_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      business.id,
      name,
      String(req.body.business_name || '').trim(),
      String(req.body.tax_id || '').trim(),
      String(req.body.city || '').trim(),
      String(req.body.address || '').trim(),
      String(req.body.phone || '').trim(),
      String(req.body.email || '').trim(),
      String(req.body.brand || '').trim(),
      String(req.body.payment_method || '').trim(),
      String(req.body.bank_reference || '').trim(),
      String(req.body.classification || '').trim(),
      String(req.body.guide_template_key || '').trim(),
      guideLogoUrl,
      String(req.body.general_notes || '').trim()
    );
    audit(req, 'create', 'client', result.lastInsertRowid, name);
    res.status(201).json(db.prepare('SELECT * FROM production_clients WHERE id = ?').get(result.lastInsertRowid));
  });

  app.put('/api/producalza/clients/:id', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = db.prepare(
      'SELECT * FROM production_clients WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!current) return res.status(404).json({ message: 'Cliente no encontrado' });
    let guideLogoUrl = current.guide_logo_url || '';
    if (isProductionAdmin(req) && Object.prototype.hasOwnProperty.call(req.body, 'guide_logo_url')) {
      try {
        guideLogoUrl = normalizeGuideLogo(req.body.guide_logo_url);
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }
    const result = db.prepare(
      `UPDATE production_clients SET
       name = ?, business_name = ?, tax_id = ?, city = ?, address = ?, phone = ?, email = ?,
       brand = ?, payment_method = ?, bank_reference = ?, classification = ?, guide_template_key = ?,
       guide_logo_url = ?, general_notes = ?,
       updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    ).run(
      String(req.body.name || '').trim(),
      String(req.body.business_name || '').trim(),
      String(req.body.tax_id || '').trim(),
      String(req.body.city || '').trim(),
      String(req.body.address || '').trim(),
      String(req.body.phone || '').trim(),
      String(req.body.email || '').trim(),
      String(req.body.brand || '').trim(),
      String(req.body.payment_method || '').trim(),
      String(req.body.bank_reference || '').trim(),
      String(req.body.classification || '').trim(),
      String(req.body.guide_template_key || '').trim(),
      guideLogoUrl,
      String(req.body.general_notes || '').trim(),
      req.params.id,
      business.id
    );
    audit(req, 'update', 'client', req.params.id, req.body.name);
    res.json({ ok: true });
  });

  app.post('/api/producalza/clients/:id/visits', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const client = db.prepare(
      'SELECT id FROM production_clients WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!client) return res.status(404).json({ message: 'Cliente no encontrado' });
    const requestedUserId = Number(req.body.visited_by_user_id || 0);
    const visitedByUserId = isProductionAdmin(req)
      ? requestedUserId || null
      : req.user.productionUserId || null;
    const orderId = Number(req.body.order_id || 0) || null;
    if (orderId) {
      const order = db.prepare(
        'SELECT id FROM production_orders WHERE id = ? AND client_id = ? AND establishment_id = ? AND deleted_at IS NULL'
      ).get(orderId, client.id, business.id);
      if (!order) return res.status(400).json({ message: 'El pedido relacionado no pertenece a este cliente' });
    }
    const result = db.prepare(
      `INSERT INTO production_client_visits
       (establishment_id, client_id, visited_by_user_id, visitor_name, visit_type, result,
        next_visit_date, next_visit_type, order_id, visit_date, visit_date_text, pairs, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      business.id,
      client.id,
      visitedByUserId,
      String(req.body.visitor_name || '').trim(),
      String(req.body.visit_type || 'visit').trim(),
      String(req.body.result || '').trim(),
      req.body.next_visit_date || null,
      String(req.body.next_visit_type || '').trim(),
      orderId,
      req.body.visit_date || null,
      String(req.body.visit_date_text || req.body.visit_date || '').trim(),
      req.body.pairs === '' || req.body.pairs == null ? null : Math.max(0, Number(req.body.pairs)),
      String(req.body.notes || '').trim()
    );
    audit(req, 'create', 'client_visit', result.lastInsertRowid, `Cliente ${client.id}`);
    res.status(201).json({ id: result.lastInsertRowid });
  });

  app.put('/api/producalza/clients/:clientId/visits/:visitId', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const visit = db.prepare(
      `SELECT * FROM production_client_visits
       WHERE id = ? AND client_id = ? AND establishment_id = ?`
    ).get(req.params.visitId, req.params.clientId, business.id);
    if (!visit) return res.status(404).json({ message: 'Visita no encontrada' });
    if (!isProductionAdmin(req) && visit.visited_by_user_id && visit.visited_by_user_id !== req.user.productionUserId) {
      return res.status(403).json({ message: 'Solo puedes editar tus propios seguimientos' });
    }
    const requestedUserId = Number(req.body.visited_by_user_id || 0);
    const visitedByUserId = isProductionAdmin(req)
      ? requestedUserId || null
      : req.user.productionUserId || visit.visited_by_user_id || null;
    const orderId = Number(req.body.order_id || 0) || null;
    if (orderId) {
      const order = db.prepare(
        'SELECT id FROM production_orders WHERE id = ? AND client_id = ? AND establishment_id = ? AND deleted_at IS NULL'
      ).get(orderId, visit.client_id, business.id);
      if (!order) return res.status(400).json({ message: 'El pedido relacionado no pertenece a este cliente' });
    }
    db.prepare(
      `UPDATE production_client_visits SET
       visited_by_user_id = ?, visitor_name = ?, visit_type = ?, result = ?,
       next_visit_date = ?, next_visit_type = ?, order_id = ?, visit_date = ?, visit_date_text = ?,
       pairs = ?, notes = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ? AND client_id = ? AND establishment_id = ?`
    ).run(
      visitedByUserId,
      String(req.body.visitor_name || '').trim(),
      String(req.body.visit_type || 'visit').trim(),
      String(req.body.result || '').trim(),
      req.body.next_visit_date || null,
      String(req.body.next_visit_type || '').trim(),
      orderId,
      req.body.visit_date || null,
      String(req.body.visit_date_text || req.body.visit_date || '').trim(),
      req.body.pairs === '' || req.body.pairs == null ? null : Math.max(0, Number(req.body.pairs)),
      String(req.body.notes || '').trim(),
      visit.id,
      visit.client_id,
      business.id
    );
    audit(req, 'update', 'client_visit', visit.id, `Cliente ${visit.client_id}`);
    res.json({ ok: true });
  });

  app.delete('/api/producalza/clients/:clientId/visits/:visitId', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const result = db.prepare(
      `DELETE FROM production_client_visits
       WHERE id = ? AND client_id = ? AND establishment_id = ?`
    ).run(req.params.visitId, req.params.clientId, business.id);
    if (!result.changes) return res.status(404).json({ message: 'Visita no encontrada' });
    audit(req, 'delete', 'client_visit', req.params.visitId, `Cliente ${req.params.clientId}`);
    res.json({ ok: true });
  });

  app.get('/api/producalza/client-activity-report', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.prepare(
      `SELECT clients.id, clients.name, clients.business_name, clients.city, clients.phone,
              (SELECT COUNT(*) FROM production_client_visits AS visits
               WHERE visits.client_id = clients.id) AS visit_count,
              (SELECT COUNT(*) FROM production_orders AS orders
               WHERE orders.client_id = clients.id AND orders.deleted_at IS NULL) AS order_count,
              (SELECT COALESCE(SUM(models.total_pairs), 0)
               FROM production_order_models AS models
               JOIN production_orders AS orders ON orders.id = models.order_id
               WHERE orders.client_id = clients.id AND orders.deleted_at IS NULL) AS total_pairs,
              NULLIF(MAX(
                COALESCE(
                  (SELECT MAX(COALESCE(visits.visit_date, visits.created_at))
                   FROM production_client_visits AS visits WHERE visits.client_id = clients.id),
                  '1900-01-01'
                ),
                COALESCE(
                  (SELECT MAX(orders.order_date)
                   FROM production_orders AS orders WHERE orders.client_id = clients.id AND orders.deleted_at IS NULL),
                  '1900-01-01'
                )
              ), '1900-01-01') AS last_activity,
              (SELECT MIN(visits.next_visit_date)
               FROM production_client_visits AS visits
               WHERE visits.client_id = clients.id AND visits.next_visit_date >= ?) AS next_visit
       FROM production_clients AS clients
       WHERE clients.establishment_id = ?
       ORDER BY COALESCE(last_activity, '1900-01-01') DESC, clients.name`
    ).all(today, business.id);
    res.json(rows);
  });

  app.get('/api/producalza/monthly-report', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = normalizeDateInput(req.query.date_from, today.slice(0, 8) + '01');
    const dateTo = normalizeDateInput(req.query.date_to, today);
    const days = Math.max(1, Number(req.query.days || 1) || 1);

    const historicalRows = db.prepare(
      `SELECT source_key,
              report_month,
              entry_date,
              client_name,
              CASE WHEN entry_date BETWEEN ? AND ? THEN entered_pairs ELSE NULL END AS entered_pairs,
              observations,
              CASE WHEN dispatched_date BETWEEN ? AND ? THEN dispatched_pairs ELSE NULL END AS dispatched_pairs,
              dispatched_date,
              source,
              'historico' AS row_source
       FROM production_monthly_report_rows
       WHERE establishment_id = ?
         AND (
           entry_date BETWEEN ? AND ?
           OR dispatched_date BETWEEN ? AND ?
         )`
    ).all(
      dateFrom, dateTo,
      dateFrom, dateTo,
      business.id,
      dateFrom, dateTo,
      dateFrom, dateTo
    );

    const liveEntered = db.prepare(
      `SELECT 'live-order-' || orders.id AS source_key,
              substr(orders.order_date, 1, 7) AS report_month,
              orders.order_date AS entry_date,
              clients.name AS client_name,
              COALESCE(SUM(models.total_pairs), 0) AS entered_pairs,
              orders.general_notes AS observations,
              NULL AS dispatched_pairs,
              NULL AS dispatched_date,
              'Sistema Producalza' AS source,
              'sistema' AS row_source
       FROM production_orders AS orders
       JOIN production_clients AS clients ON clients.id = orders.client_id
       LEFT JOIN production_order_models AS models ON models.order_id = orders.id
       WHERE orders.establishment_id = ?
         AND orders.deleted_at IS NULL
         AND orders.order_date BETWEEN ? AND ?
       GROUP BY orders.id`
    ).all(business.id, dateFrom, dateTo);

    const liveDispatched = db.prepare(
      `SELECT 'live-dispatch-' || models.id AS source_key,
              substr(date(COALESCE(orders.dispatched_date, models.updated_at)), 1, 7) AS report_month,
              orders.order_date AS entry_date,
              clients.name AS client_name,
              NULL AS entered_pairs,
              models.notes AS observations,
              models.total_pairs AS dispatched_pairs,
              date(COALESCE(orders.dispatched_date, models.updated_at)) AS dispatched_date,
              'Sistema Producalza' AS source,
              'sistema' AS row_source
       FROM production_order_models AS models
       JOIN production_orders AS orders ON orders.id = models.order_id
       JOIN production_clients AS clients ON clients.id = orders.client_id
       WHERE orders.establishment_id = ?
         AND orders.deleted_at IS NULL
         AND models.status IN ('finished', 'delivered')
         AND date(COALESCE(orders.dispatched_date, models.updated_at)) BETWEEN ? AND ?`
    ).all(business.id, dateFrom, dateTo);

    const rows = [...historicalRows, ...liveEntered, ...liveDispatched]
      .filter((row) => row.client_name)
      .sort((left, right) => {
        const leftDate = left.entry_date || left.dispatched_date || '';
        const rightDate = right.entry_date || right.dispatched_date || '';
        return leftDate.localeCompare(rightDate) || left.client_name.localeCompare(right.client_name);
      });
    const totalEntered = rows.reduce((sum, row) => sum + Number(row.entered_pairs || 0), 0);
    const totalDispatched = rows.reduce((sum, row) => sum + Number(row.dispatched_pairs || 0), 0);
    const storedMonths = db.prepare(
      `SELECT report_month, COUNT(*) AS rows_count,
              COALESCE(SUM(entered_pairs), 0) AS entered_pairs,
              COALESCE(SUM(dispatched_pairs), 0) AS dispatched_pairs
       FROM production_monthly_report_rows
       WHERE establishment_id = ?
       GROUP BY report_month
       ORDER BY report_month`
    ).all(business.id);
    res.json({
      date_from: dateFrom,
      date_to: dateTo,
      days,
      rows,
      stored_months: storedMonths,
      totals: {
        entered_pairs: totalEntered,
        dispatched_pairs: totalDispatched,
        entered_daily: totalEntered / days,
        dispatched_daily: totalDispatched / days
      }
    });
  });

  app.get('/api/producalza/dispatch-collections-report', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const status = String(req.query.status || 'all').trim();
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = normalizeDateInput(req.query.date_from, '');
    const dateTo = normalizeDateInput(req.query.date_to, today);
    const filters = ["orders.status = 'delivered'", 'orders.deleted_at IS NULL'];
    const params = [business.id];
    if (dateFrom) {
      filters.push('date(COALESCE(orders.dispatched_date, orders.updated_at)) >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push('date(COALESCE(orders.dispatched_date, orders.updated_at)) <= ?');
      params.push(dateTo);
    }

    const rows = db.prepare(
      `SELECT orders.id, orders.order_number, orders.order_date,
              date(COALESCE(orders.dispatched_date, orders.updated_at)) AS dispatched_date,
              orders.payment_method, orders.shipping_value, orders.discount_value,
              clients.name AS client_name, clients.city,
              COALESCE(model_totals.subtotal, 0) AS subtotal,
              COALESCE(payments.paid_total, 0) AS paid_total,
              COALESCE(payments.pending_total, 0) AS pending_total,
              GROUP_CONCAT(
                CASE
                  WHEN pay_rows.id IS NULL THEN NULL
                  ELSE pay_rows.payment_type || '|' || pay_rows.amount || '|' || COALESCE(pay_rows.due_date, '') || '|' || COALESCE(pay_rows.payment_date, '') || '|' || pay_rows.status
                END,
                ';;'
              ) AS payment_rows
       FROM production_orders AS orders
       JOIN production_clients AS clients ON clients.id = orders.client_id
       LEFT JOIN (
         SELECT order_id, COALESCE(SUM(total_pairs * unit_price), 0) AS subtotal
         FROM production_order_models
         WHERE establishment_id = ?
         GROUP BY order_id
       ) AS model_totals ON model_totals.order_id = orders.id
       LEFT JOIN (
         SELECT order_id,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid_total,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending_total
         FROM production_order_payments
         WHERE establishment_id = ?
         GROUP BY order_id
       ) AS payments ON payments.order_id = orders.id
       LEFT JOIN production_order_payments AS pay_rows
         ON pay_rows.order_id = orders.id AND pay_rows.establishment_id = orders.establishment_id
       WHERE orders.establishment_id = ?
         AND ${filters.join(' AND ')}
       GROUP BY orders.id
       ORDER BY dispatched_date ASC, orders.id ASC`
    ).all(business.id, business.id, ...params);

    const normalized = rows.map((row) => {
      const subtotal = moneyValue(row.subtotal);
      const total = moneyValue(subtotal + Number(row.shipping_value || 0) - Number(row.discount_value || 0));
      const paid = moneyValue(row.paid_total);
      const balance = moneyValue(Math.max(0, total - paid));
      const paymentStatus = balance <= 0 ? 'paid' : 'pending';
      return {
        ...row,
        subtotal,
        total,
        paid_total: paid,
        balance,
        payment_status: paymentStatus,
        payment_rows: String(row.payment_rows || '')
          .split(';;')
          .filter(Boolean)
          .map((item) => {
            const [payment_type, amount, due_date, payment_date, payment_status] = item.split('|');
            return { payment_type, amount: Number(amount || 0), due_date, payment_date, status: payment_status };
          })
      };
    }).filter((row) => status === 'all' || row.payment_status === status);

    res.json({
      date_from: dateFrom,
      date_to: dateTo,
      status,
      rows: normalized,
      totals: {
        total: normalized.reduce((sum, row) => sum + Number(row.total || 0), 0),
        paid: normalized.reduce((sum, row) => sum + Number(row.paid_total || 0), 0),
        balance: normalized.reduce((sum, row) => sum + Number(row.balance || 0), 0)
      }
    });
  });

  app.get('/api/producalza/orders', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const visibility = orderVisibility(req);
    const search = `%${String(req.query.search || '').trim()}%`;
    const status = String(req.query.status || '').trim();
    const sellerId = Number(req.query.seller_id || 0);
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const filters = [];
    const params = [business.id, search, search];
    if (status) {
      filters.push('orders.status = ?');
      params.push(status);
    }
    if (sellerId && isProductionAdmin(req)) {
      filters.push('orders.seller_user_id = ?');
      params.push(sellerId);
    }
    if (dateFrom) {
      filters.push('orders.order_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      filters.push('orders.order_date <= ?');
      params.push(dateTo);
    }
    params.push(...visibility.params);
    const rows = db.prepare(
      `SELECT orders.*, clients.name AS client_name, clients.city,
              users.name AS seller_name,
              COUNT(models.id) AS model_count,
              COALESCE(SUM(models.total_pairs), 0) AS total_pairs,
              COALESCE(payments.total_paid, 0) AS total_paid,
              COALESCE(payments.total_pending, 0) AS total_pending
       FROM production_orders AS orders
       JOIN production_clients AS clients ON clients.id = orders.client_id
       LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
       LEFT JOIN production_order_models AS models ON models.order_id = orders.id
       LEFT JOIN (
         SELECT order_id,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS total_paid,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS total_pending
         FROM production_order_payments
         WHERE establishment_id = ?
         GROUP BY order_id
       ) AS payments ON payments.order_id = orders.id
       WHERE orders.establishment_id = ? AND orders.deleted_at IS NULL
         AND (orders.order_number LIKE ? OR clients.name LIKE ?)
         ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
         ${visibility.sql}
       GROUP BY orders.id
       ORDER BY orders.order_date DESC, orders.id DESC`
    ).all(business.id, ...params);
    res.json(rows);
  });

  app.get('/api/producalza/orders/:id', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    res.json(order);
  });

  app.get('/api/producalza/orders/:id/pdf', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const safeClientName = String(order.client_name || 'Cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 -]/g, '')
      .trim() || 'Cliente';
    const filename = `Pedido Producalza ${safeClientName}.pdf`;
    const pdf = createProductionOrderPdf(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  });

  app.patch('/api/producalza/orders/:id/shipped', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const dispatchedDate = normalizeDateInput(req.body.dispatched_date, new Date().toISOString().slice(0, 10));

    db.transaction(() => {
      db.prepare(
        `UPDATE production_order_models
         SET status = 'delivered',
             process_cut = 1,
             process_prepared = 1,
             process_stitched = 1,
             process_assembled = 1,
             process_planted = 1,
             process_finished = 1,
             updated_at = datetime('now', 'localtime')
         WHERE order_id = ? AND establishment_id = ?`
      ).run(order.id, business.id);
      db.prepare(
        `UPDATE production_orders
         SET status = 'delivered',
             dispatched_date = ?,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(dispatchedDate, order.id, business.id);
    })();
    audit(req, 'ship', 'order', order.id, dispatchedDate);
    res.json(getOrder(order.id, req));
  });

  app.post('/api/producalza/orders/:id/payments', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const payment = normalizePaymentPayload(req.body);
    if (!payment.amount && !payment.due_date && !payment.reference && !payment.notes) {
      return res.status(400).json({ message: 'Agrega al menos un valor, fecha o detalle del cobro' });
    }
    const result = db.prepare(
      `INSERT INTO production_order_payments
       (establishment_id, order_id, payment_type, amount, payment_date, due_date,
        status, bank, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      business.id,
      order.id,
      payment.payment_type,
      payment.amount,
      payment.payment_date,
      payment.due_date,
      payment.status,
      payment.bank,
      payment.reference,
      payment.notes,
      req.user?.username || req.user?.role || 'system'
    );
    audit(req, 'create', 'order_payment', result.lastInsertRowid, order.order_number);
    res.status(201).json(getOrder(order.id, req));
  });

  app.patch('/api/producalza/orders/:id/payments/:paymentId', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const current = db.prepare(
      'SELECT * FROM production_order_payments WHERE id = ? AND order_id = ? AND establishment_id = ?'
    ).get(req.params.paymentId, order.id, business.id);
    if (!current) return res.status(404).json({ message: 'Cobro no encontrado' });
    const payment = normalizePaymentPayload({ ...current, ...req.body });
    db.prepare(
      `UPDATE production_order_payments
       SET payment_type = ?, amount = ?, payment_date = ?, due_date = ?, status = ?,
           bank = ?, reference = ?, notes = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ? AND order_id = ? AND establishment_id = ?`
    ).run(
      payment.payment_type,
      payment.amount,
      payment.payment_date,
      payment.due_date,
      payment.status,
      payment.bank,
      payment.reference,
      payment.notes,
      current.id,
      order.id,
      business.id
    );
    audit(req, 'update', 'order_payment', current.id, payment.status);
    res.json(getOrder(order.id, req));
  });

  app.delete('/api/producalza/orders/:id/payments/:paymentId', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const result = db.prepare(
      'DELETE FROM production_order_payments WHERE id = ? AND order_id = ? AND establishment_id = ?'
    ).run(req.params.paymentId, order.id, business.id);
    if (!result.changes) return res.status(404).json({ message: 'Cobro no encontrado' });
    audit(req, 'delete', 'order_payment', req.params.paymentId, order.order_number);
    res.json(getOrder(order.id, req));
  });

  app.patch('/api/producalza/orders/:id/invoice', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    db.prepare(
      `UPDATE production_orders
       SET invoice_number = ?, invoice_date = ?, invoice_value = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    ).run(
      String(req.body.invoice_number || '').trim(),
      normalizeOptionalDate(req.body.invoice_date),
      moneyValue(req.body.invoice_value),
      order.id,
      business.id
    );
    audit(req, 'update', 'order_invoice', order.id, req.body.invoice_number || '');
    res.json(getOrder(order.id, req));
  });

  app.patch('/api/producalza/orders/:id/delivery-note-values', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const prices = Array.isArray(req.body.models) ? req.body.models : [];
    const validModelIds = new Set(order.models.map((model) => Number(model.id)));
    const priceByModelId = new Map(
      prices
        .map((model) => [Number(model.id || 0), moneyValue(model.unit_price)])
        .filter(([modelId]) => validModelIds.has(modelId))
    );
    const subtotal = order.models.reduce((sum, model) => {
      const price = priceByModelId.has(Number(model.id)) ? priceByModelId.get(Number(model.id)) : moneyValue(model.unit_price);
      return sum + Number(model.total_pairs || 0) * price;
    }, 0);
    const shippingValue = moneyValue(req.body.shipping_value);
    const discountValue = moneyValue(req.body.discount_value);
    const totalValue = moneyValue(Math.max(0, subtotal + shippingValue - discountValue));

    db.transaction(() => {
      db.prepare(
        `UPDATE production_orders
         SET shipping_value = ?, discount_value = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(
        shippingValue,
        discountValue,
        order.id,
        business.id
      );

      const updateModel = db.prepare(
        `UPDATE production_order_models
         SET unit_price = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND order_id = ? AND establishment_id = ?`
      );
      for (const model of prices) {
        const modelId = Number(model.id || 0);
        if (!validModelIds.has(modelId)) continue;
        updateModel.run(moneyValue(model.unit_price), modelId, order.id, business.id);
      }

      const paymentTotals = db.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total,
           COALESCE(SUM(CASE WHEN status = 'pending' AND COALESCE(reference, '') <> ? THEN amount ELSE 0 END), 0) AS manual_pending_total
         FROM production_order_payments
         WHERE order_id = ? AND establishment_id = ?`
      ).get(DELIVERY_NOTE_BALANCE_REF, order.id, business.id);
      const pendingBalance = moneyValue(Math.max(
        0,
        totalValue - Number(paymentTotals.paid_total || 0) - Number(paymentTotals.manual_pending_total || 0)
      ));
      db.prepare(
        `DELETE FROM production_order_payments
         WHERE order_id = ? AND establishment_id = ? AND status = 'pending' AND reference = ?`
      ).run(order.id, business.id, DELIVERY_NOTE_BALANCE_REF);
      if (pendingBalance > 0) {
        db.prepare(
          `INSERT INTO production_order_payments
           (establishment_id, order_id, payment_type, amount, payment_date, due_date,
            status, bank, reference, notes, created_by)
           VALUES (?, ?, 'saldo', ?, NULL, NULL, 'pending', '', ?, ?, ?)`
        ).run(
          business.id,
          order.id,
          pendingBalance,
          DELIVERY_NOTE_BALANCE_REF,
          'Saldo automatico de nota de entrega',
          req.user?.username || req.user?.role || 'system'
        );
      }
    })();
    audit(req, 'update', 'delivery_note_values', order.id, order.order_number);
    res.json(getOrder(order.id, req));
  });

  app.post('/api/producalza/orders', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const client = db.prepare(
      'SELECT id FROM production_clients WHERE id = ? AND establishment_id = ?'
    ).get(req.body.client_id, business.id);
    if (!client) return res.status(400).json({ message: 'Selecciona un cliente valido' });
    let models;
    try {
      models = normalizeModels(req.body.models);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const status = req.body.status === 'draft' ? 'draft' : 'received';
    const sellerId = isProductionAdmin(req)
      ? Number(req.body.seller_user_id || 0) || null
      : req.user.productionUserId;
    const orderNumber = nextOrderNumber(business.id);
    let orderId;

    db.transaction(() => {
      const orderResult = db.prepare(
        `INSERT INTO production_orders
         (establishment_id, order_number, client_id, seller_user_id, order_date, brand,
          delivery_date, origin_label, card_alert, payment_method, bank_reference,
          guide_template_key, general_notes, shipping_value, discount_value,
          invoice_number, invoice_date, invoice_value, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        business.id,
        orderNumber,
        client.id,
        sellerId,
        req.body.order_date || new Date().toISOString().slice(0, 10),
        String(req.body.brand || '').trim(),
        String(req.body.delivery_date || '').trim(),
        String(req.body.origin_label || '').trim(),
        String(req.body.card_alert || '').trim(),
        String(req.body.payment_method || '').trim(),
        String(req.body.bank_reference || '').trim(),
        String(req.body.guide_template_key || '').trim(),
        String(req.body.general_notes || '').trim(),
        moneyValue(req.body.shipping_value),
        moneyValue(req.body.discount_value),
        String(req.body.invoice_number || '').trim(),
        normalizeOptionalDate(req.body.invoice_date),
        moneyValue(req.body.invoice_value),
        status,
        req.user.username || req.user.role
      );
      orderId = Number(orderResult.lastInsertRowid);
      insertModels(db, business.id, orderId, models, nextCardNumber);
    })();
    audit(req, 'create', 'order', orderId, orderNumber);
    res.status(201).json(getOrder(orderId, req));
  });

  app.put('/api/producalza/orders/:id', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = getOrder(req.params.id, req);
    if (!current) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (!isProductionAdmin(req) && !['draft', 'received'].includes(current.status)) {
      return res.status(403).json({ message: 'El pedido ya esta en revision y solo el administrador puede editarlo' });
    }
    let models;
    try {
      models = normalizeModels(req.body.models);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const client = db.prepare(
      'SELECT id FROM production_clients WHERE id = ? AND establishment_id = ?'
    ).get(req.body.client_id, business.id);
    if (!client) return res.status(400).json({ message: 'Selecciona un cliente valido' });
    const status = ORDER_STATUSES.includes(req.body.status) ? req.body.status : current.status;
    const sellerId = isProductionAdmin(req)
      ? Number(req.body.seller_user_id || 0) || null
      : current.seller_user_id;

    db.transaction(() => {
      db.prepare(
        `UPDATE production_orders SET client_id = ?, seller_user_id = ?, order_date = ?, brand = ?,
         delivery_date = ?, origin_label = ?, card_alert = ?, payment_method = ?, bank_reference = ?,
         guide_template_key = ?, general_notes = ?, shipping_value = ?, discount_value = ?,
         invoice_number = ?, invoice_date = ?, invoice_value = ?, status = ?,
         updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(
        client.id,
        sellerId,
        req.body.order_date || current.order_date,
        String(req.body.brand || '').trim(),
        String(req.body.delivery_date || '').trim(),
        String(req.body.origin_label || '').trim(),
        String(req.body.card_alert || '').trim(),
        String(req.body.payment_method || '').trim(),
        String(req.body.bank_reference || '').trim(),
        String(req.body.guide_template_key || '').trim(),
        String(req.body.general_notes || '').trim(),
        moneyValue(req.body.shipping_value),
        moneyValue(req.body.discount_value),
        String(req.body.invoice_number || '').trim(),
        normalizeOptionalDate(req.body.invoice_date),
        moneyValue(req.body.invoice_value),
        status,
        current.id,
        business.id
      );
      db.prepare(
        `DELETE FROM production_model_sizes
         WHERE model_id IN (SELECT id FROM production_order_models WHERE order_id = ? AND establishment_id = ?)`
      ).run(current.id, business.id);
      db.prepare(
        'DELETE FROM production_order_models WHERE order_id = ? AND establishment_id = ?'
      ).run(current.id, business.id);
      insertModels(db, business.id, current.id, models, nextCardNumber);
    })();
    audit(req, 'update', 'order', current.id, current.order_number);
    res.json(getOrder(current.id, req));
  });

  app.delete('/api/producalza/orders/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const result = db.prepare(
      `UPDATE production_orders
       SET deleted_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ? AND deleted_at IS NULL`
    ).run(req.params.id, business.id);
    if (!result.changes) return res.status(404).json({ message: 'Pedido no encontrado' });
    audit(req, 'delete', 'order', req.params.id, 'Eliminacion logica');
    res.json({ ok: true });
  });

  app.get('/api/producalza/production', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const visibility = orderVisibility(req);
    const status = String(req.query.status || '').trim();
    const params = [business.id];
    const statusFilter = status ? ' AND models.status = ?' : '';
    if (status) params.push(status);
    params.push(...visibility.params);
    const rows = db.prepare(
      `SELECT models.*, orders.order_number, orders.order_date,
              clients.name AS client_name, clients.city,
              users.name AS seller_name
       FROM production_order_models AS models
       JOIN production_orders AS orders ON orders.id = models.order_id
       JOIN production_clients AS clients ON clients.id = orders.client_id
       LEFT JOIN production_users AS users ON users.id = orders.seller_user_id
       WHERE orders.establishment_id = ? AND orders.deleted_at IS NULL
         ${statusFilter} ${visibility.sql}
       ORDER BY CASE models.status
         WHEN 'received' THEN 1 WHEN 'reviewed' THEN 2 WHEN 'in_production' THEN 3
         WHEN 'cut' THEN 4 WHEN 'stitched' THEN 5 WHEN 'assembled' THEN 6
         WHEN 'finished' THEN 7 ELSE 8 END, orders.order_date, models.id`
    ).all(...params);
    res.json(rows);
  });

  app.patch('/api/producalza/models/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = db.prepare(
      'SELECT * FROM production_order_models WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!current) return res.status(404).json({ message: 'Modelo no encontrado' });
    const status = MODEL_STATUSES.includes(req.body.status)
      ? req.body.status
      : deriveModelStatus(req.body, current.status);
    const cardNumber = Number(req.body.card_number || current.card_number) || current.card_number;
    try {
      db.prepare(
        `UPDATE production_order_models SET
         card_number = ?, status = ?, plant_area = ?,
         process_cut = ?, process_prepared = ?, process_stitched = ?,
         process_assembled = ?, process_planted = ?, process_finished = ?,
         updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(
        cardNumber,
        status,
        String(req.body.plant_area ?? current.plant_area ?? '').trim(),
        req.body.process_cut ? 1 : 0,
        req.body.process_prepared ? 1 : 0,
        req.body.process_stitched ? 1 : 0,
        req.body.process_assembled ? 1 : 0,
        req.body.process_planted ? 1 : 0,
        req.body.process_finished ? 1 : 0,
        current.id,
        business.id
      );
    } catch {
      return res.status(409).json({ message: 'Ese numero de tarjeta ya esta utilizado' });
    }
    syncOrderStatus(db, current.order_id, business.id);
    audit(req, 'update', 'production_model', current.id, status);
    res.json({ ok: true });
  });

  app.patch('/api/producalza/models-batch', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    if (!updates.length || updates.length > 500) {
      return res.status(400).json({ message: 'No hay avances validos para guardar' });
    }
    const findModel = db.prepare(
      'SELECT * FROM production_order_models WHERE id = ? AND establishment_id = ?'
    );
    const updateModel = db.prepare(
      `UPDATE production_order_models SET
       card_number = ?, status = ?, plant_area = ?,
       process_cut = ?, process_prepared = ?, process_stitched = ?,
       process_assembled = ?, process_planted = ?, process_finished = ?,
       updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    );
    const affectedOrders = new Set();

    try {
      db.transaction(() => {
        for (const update of updates) {
          const current = findModel.get(update.id, business.id);
          if (!current) {
            throw new Error('Modelo no encontrado');
          }
          const merged = { ...current, ...update };
          const status = MODEL_STATUSES.includes(update.status)
            ? update.status
            : deriveModelStatus(merged, current.status);
          const cardNumber = Number(update.card_number || current.card_number) || current.card_number;
          updateModel.run(
            cardNumber,
            status,
            String(update.plant_area ?? current.plant_area ?? '').trim(),
            merged.process_cut ? 1 : 0,
            merged.process_prepared ? 1 : 0,
            merged.process_stitched ? 1 : 0,
            merged.process_assembled ? 1 : 0,
            merged.process_planted ? 1 : 0,
            merged.process_finished ? 1 : 0,
            current.id,
            business.id
          );
          affectedOrders.add(current.order_id);
        }
        for (const orderId of affectedOrders) {
          syncOrderStatus(db, orderId, business.id);
        }
      })();
    } catch (error) {
      return res.status(400).json({ message: error.message || 'No se pudieron guardar los avances' });
    }

    audit(req, 'batch_update', 'production_model', null, `${updates.length} modelos actualizados`);
    res.json({ ok: true, updated: updates.length });
  });
}

function deriveModelStatus(model, fallback = 'received') {
  if (model.process_finished) return 'finished';
  if (model.process_planted || model.process_assembled) return 'assembled';
  if (model.process_stitched) return 'stitched';
  if (model.process_cut) return 'cut';
  if (model.process_prepared) return 'in_production';
  return fallback;
}

function insertModels(db, establishmentId, orderId, models, nextCardNumber) {
  const insertModel = db.prepare(
    `INSERT INTO production_order_models
     (establishment_id, order_id, card_number, model_code, color, material, notes, plant_area, total_pairs, unit_price, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSize = db.prepare(
    `INSERT INTO production_model_sizes
     (establishment_id, model_id, size, quantity)
     VALUES (?, ?, ?, ?)`
  );
  for (const model of models) {
    const cardNumber = model.card_number || nextCardNumber(establishmentId);
    const result = insertModel.run(
      establishmentId,
      orderId,
      cardNumber,
      model.model_code,
      model.color,
      model.material,
      model.notes,
      model.plant_area,
      model.total_pairs,
      model.unit_price,
      model.status
    );
    for (const [size, quantity] of Object.entries(model.sizes)) {
      insertSize.run(establishmentId, result.lastInsertRowid, Number(size), Number(quantity));
    }
  }
}

function syncOrderStatus(db, orderId, establishmentId) {
  const models = db.prepare(
    'SELECT status FROM production_order_models WHERE order_id = ? AND establishment_id = ?'
  ).all(orderId, establishmentId);
  if (!models.length) return;
  const statuses = models.map((model) => model.status);
  let status = 'in_production';
  if (statuses.every((item) => item === 'delivered')) status = 'delivered';
  else if (statuses.every((item) => ['finished', 'delivered'].includes(item))) status = 'finished';
  else if (statuses.every((item) => item === 'cancelled')) status = 'cancelled';
  else if (statuses.every((item) => item === 'received')) status = 'received';
  else if (statuses.every((item) => ['received', 'reviewed'].includes(item))) status = 'reviewed';
  db.prepare(
    `UPDATE production_orders
     SET status = ?,
         dispatched_date = CASE
           WHEN ? = 'delivered' THEN COALESCE(dispatched_date, date('now', 'localtime'))
           ELSE dispatched_date
         END,
         updated_at = datetime('now', 'localtime')
     WHERE id = ? AND establishment_id = ?`
  ).run(status, status, orderId, establishmentId);
}
