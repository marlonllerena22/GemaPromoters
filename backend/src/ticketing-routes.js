import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { createToken, requireAuth } from './auth.js';

function money(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function ticketingServiceFeeRate() {
  const percentage = Number(process.env.TICKETING_SERVICE_FEE_PERCENT || 10);
  if (!Number.isFinite(percentage) || percentage < 0) return 0.1;
  return Math.min(percentage, 100) / 100;
}

function serviceFeeFor(subtotal) {
  return money(money(subtotal) * ticketingServiceFeeRate());
}

function cleanText(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function cleanEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function slugify(value) {
  return cleanText(value, 180)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `evento-${Date.now()}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function sqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function ticketingTransporter() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function publicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://promotersec.com').replace(/\/$/, '');
}

let bendoTokenCache = null;

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

function findMerchantId(value) {
  const preferredKeys = new Set(['merchant_id', 'merchantid', 'merchant_code', 'merchantcode']);
  const visited = new Set();
  function visit(current, key = '') {
    if (current == null) return null;
    if (typeof current !== 'object') {
      const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const parsed = Number(current);
      if ((preferredKeys.has(normalizedKey) || normalizedKey === 'merchant') && Number.isSafeInteger(parsed) && parsed > 0) {
        return parsed;
      }
      return null;
    }
    if (visited.has(current)) return null;
    visited.add(current);
    for (const [childKey, child] of Object.entries(current)) {
      const match = visit(child, childKey);
      if (match) return match;
    }
    return null;
  }
  return visit(value);
}

async function getBendoAccess() {
  const now = Date.now();
  if (bendoTokenCache?.token && bendoTokenCache.expiresAt > now + 30000) return bendoTokenCache;
  const clientId = String(process.env.BENDO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.BENDO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Bendo no esta configurado');
  const response = await fetch(process.env.BENDO_AUTH_URL || 'https://auth.prd.geopagos.io/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: '*' })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Bendo no pudo autenticar la cuenta (HTTP ${response.status})`);
  }
  const tokenPayload = decodeJwtPayload(payload.access_token);
  const configuredMerchant = Number(process.env.BENDO_MERCHANT_ID || 0);
  const merchantId = configuredMerchant || findMerchantId(payload) || findMerchantId(tokenPayload);
  const lifetime = Math.max(60, Number(payload.expires_in || 900));
  bendoTokenCache = {
    token: payload.access_token,
    merchantId,
    expiresAt: now + lifetime * 1000
  };
  return bendoTokenCache;
}

function checkoutUrlFromBendo(payload) {
  return cleanText(
    payload?.transaction_data?.checkout_url
      || payload?.transaction_data?.url
      || payload?.data?.links?.checkout
      || payload?.checkout_url
      || payload?.payment_url
      || payload?.url,
    2000
  );
}

async function createBendoPaymentLink({ orderNumber, eventTitle, ticketName, quantity, unitPrice, fee, buyer }) {
  const access = await getBendoAccess();
  if (!access.merchantId) throw new Error('Bendo no informo el identificador del comercio');
  const nameParts = cleanText(buyer.name, 120).split(/\s+/).filter(Boolean);
  const lastName = nameParts.length > 1 ? nameParts.pop() : '-';
  const firstName = nameParts.join(' ') || cleanText(buyer.name, 120) || 'Cliente';
  const webhookSecret = String(process.env.BENDO_WEBHOOK_SECRET || '').trim();
  const webhookUrl = webhookSecret
    ? `${publicAppUrl()}/api/ticketing/payments/bendo/webhook?secret=${encodeURIComponent(webhookSecret)}`
    : null;
  const items = [{
    description: `${cleanText(eventTitle, 90)} - ${cleanText(ticketName, 60)}`,
    quantity,
    unit_price: money(unitPrice),
    external_reference: orderNumber
  }];
  if (fee > 0) {
    items.push({ description: 'Tarifa de servicio', quantity: 1, unit_price: money(fee), external_reference: `${orderNumber}-SERVICIO` });
  }
  const body = {
    source: process.env.BENDO_SOURCE || 'BENDO_EC_SDK',
    currency: 'USD',
    items,
    expires_in_minutes: 20,
    successful_payment_quantity_limit: 1,
    failed_payment_quantity_limit: 5,
    webhook_url: webhookUrl,
    webhook_version: 'V4',
    redirect_on_success: `${publicAppUrl()}/tickets/mi-cuenta?payment=success`,
    redirect_on_failure: `${publicAppUrl()}/tickets/mi-cuenta?payment=failed`,
    external_data: JSON.stringify({ order_number: orderNumber }),
    merchant_id: access.merchantId,
    metadata: { order_number: orderNumber, platform: 'ProTickets' },
    customer: {
      document: cleanText(buyer.cedula, 30),
      first_name: firstName,
      last_name: lastName,
      email: cleanEmail(buyer.email),
      document_type: 'CI'
    }
  };
  const baseUrl = String(process.env.BENDO_API_URL || 'https://api.prd.geopagos.io').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/v4/payments/links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  const paymentUrl = checkoutUrlFromBendo(payload);
  if (!response.ok || !paymentUrl) {
    const detail = cleanText(payload?.message || payload?.error || payload?.detail, 180);
    throw new Error(`Bendo no pudo crear el pago (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
  }
  return { paymentUrl, providerReference: cleanText(payload.id || payload?.data?.id || orderNumber, 180) };
}

function ticketingEstablishment(db) {
  return db.prepare("SELECT * FROM establishments WHERE module_type = 'ticketing' ORDER BY id LIMIT 1").get();
}

function customerResponse(customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    cedula: customer.cedula || '',
    phone: customer.phone || ''
  };
}

function eventSelect() {
  return `SELECT events.*,
    (SELECT MIN(price) FROM ticketing_ticket_types WHERE event_id = events.id AND status = 'active') AS min_price,
    (SELECT COALESCE(SUM(stock - sold), 0) FROM ticketing_ticket_types WHERE event_id = events.id AND status = 'active') AS available_tickets`;
}

export function registerTicketingRoutes(app, db) {
  function requireTicketCustomer(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role !== 'ticket_customer') {
        return res.status(403).json({ message: 'Inicia sesion como comprador' });
      }
      const customer = db.prepare(
        `SELECT * FROM ticketing_customers
         WHERE id = ? AND establishment_id = ? AND status = 'active'`
      ).get(req.user.customerId, req.user.establishmentId);
      if (!customer) return res.status(401).json({ message: 'Cuenta no disponible' });
      req.ticketCustomer = customer;
      return next();
    });
  }

  function requireTicketAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role === 'supreme') {
        req.ticketEstablishment = ticketingEstablishment(db);
        return req.ticketEstablishment ? next() : res.status(404).json({ message: 'ProTickets no encontrado' });
      }
      if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Solo administrador ProTickets' });
      const establishment = db.prepare(
        `SELECT * FROM establishments
         WHERE id = ? AND module_type = 'ticketing' AND status = 'active'`
      ).get(req.user.establishmentId);
      if (!establishment) return res.status(403).json({ message: 'Solo administrador ProTickets' });
      req.ticketEstablishment = establishment;
      return next();
    });
  }

  function expireOldOrders(establishmentId) {
    db.prepare(
      `UPDATE ticketing_orders
       SET payment_status = 'expired', updated_at = datetime('now', 'localtime')
       WHERE establishment_id = ? AND payment_status = 'pending'
         AND expires_at IS NOT NULL AND expires_at < datetime('now', 'localtime')`
    ).run(establishmentId);
  }

  function availableForType(ticketType) {
    const reserved = db.prepare(
      `SELECT COALESCE(SUM(items.quantity), 0) AS total
       FROM ticketing_order_items AS items
       JOIN ticketing_orders AS orders ON orders.id = items.order_id
       WHERE items.ticket_type_id = ? AND orders.payment_status = 'pending'
         AND (orders.expires_at IS NULL OR orders.expires_at >= datetime('now', 'localtime'))`
    ).get(ticketType.id).total;
    return Math.max(0, Number(ticketType.stock || 0) - Number(ticketType.sold || 0) - Number(reserved || 0));
  }

  function orderDetails(orderId) {
    const order = db.prepare(
      `SELECT orders.*, events.title AS event_title, events.slug AS event_slug,
              events.event_date, events.venue, events.city,
              customers.name AS customer_name, customers.email AS customer_email
       FROM ticketing_orders AS orders
       JOIN ticketing_events AS events ON events.id = orders.event_id
       JOIN ticketing_customers AS customers ON customers.id = orders.customer_id
       WHERE orders.id = ?`
    ).get(orderId);
    if (!order) return null;
    const items = db.prepare(
      `SELECT * FROM ticketing_order_items WHERE order_id = ? ORDER BY id`
    ).all(orderId);
    const tickets = db.prepare(
      `SELECT tickets.*, items.ticket_name
       FROM ticketing_tickets AS tickets
       JOIN ticketing_order_items AS items ON items.id = tickets.order_item_id
       WHERE tickets.order_id = ? ORDER BY tickets.id`
    ).all(orderId);
    return { ...order, items, tickets };
  }

  async function sendTicketEmail(orderId) {
    const transporter = ticketingTransporter();
    const order = orderDetails(orderId);
    if (!transporter || !order?.customer_email || !order.tickets.length) {
      return { sent: false, reason: 'SMTP no configurado o entrada no disponible' };
    }
    const attachments = [];
    const ticketCards = [];
    for (const [index, ticket] of order.tickets.entries()) {
      const ticketUrl = `${publicAppUrl()}/tickets/entrada/${encodeURIComponent(ticket.code)}`;
      const qrDataUrl = await QRCode.toDataURL(ticketUrl, { width: 420, margin: 1, errorCorrectionLevel: 'M' });
      const cid = `ticket-${ticket.id}@protickets`;
      attachments.push({
        filename: `entrada-${ticket.code}.png`,
        content: qrDataUrl.split(',')[1],
        encoding: 'base64',
        cid
      });
      ticketCards.push(`
        <div style="margin:18px 0;padding:22px;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
          <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase">Entrada ${index + 1}</p>
          <h2 style="margin:6px 0 2px;color:#111">${order.event_title}</h2>
          <p style="margin:0 0 14px;color:#555">${ticket.ticket_name} · ${order.venue || 'Lugar por confirmar'} · ${order.city || ''}</p>
          <img src="cid:${cid}" width="210" height="210" alt="Codigo QR" style="display:block;margin:0 auto" />
          <p style="text-align:center;margin:12px 0 0;font-family:monospace;font-weight:700">${ticket.code}</p>
        </div>`);
    }
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: order.customer_email,
      subject: `Tus entradas ProTickets · ${order.order_number}`,
      attachments,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;background:#f6f6f6;padding:24px;color:#111">
          <div style="background:#111;color:#fff;padding:18px 22px;border-radius:12px">
            <strong style="font-size:22px">ProTickets</strong>
            <p style="margin:5px 0 0;color:#ddd">Tu compra fue confirmada</p>
          </div>
          <p>Hola ${order.customer_name}, tu pago del pedido <strong>${order.order_number}</strong> fue confirmado.</p>
          ${ticketCards.join('')}
          <p style="font-size:13px;color:#6b7280">Presenta cada QR desde tu celular. No compartas estas imágenes: cada entrada puede utilizarse una sola vez.</p>
        </div>`
    });
    db.prepare("UPDATE ticketing_orders SET email_sent_at = datetime('now', 'localtime') WHERE id = ?").run(orderId);
    return { sent: true };
  }

  async function confirmOrder(orderId, checkedBy = 'Administrador') {
    const result = db.transaction(() => {
      const order = db.prepare('SELECT * FROM ticketing_orders WHERE id = ?').get(orderId);
      if (!order) throw new Error('Pedido no encontrado');
      if (order.payment_status === 'paid') return order;
      if (!['pending', 'rejected'].includes(order.payment_status)) throw new Error('Este pedido no puede confirmarse');
      const items = db.prepare('SELECT * FROM ticketing_order_items WHERE order_id = ?').all(order.id);
      for (const item of items) {
        const type = db.prepare('SELECT * FROM ticketing_ticket_types WHERE id = ?').get(item.ticket_type_id);
        if (!type || Number(type.sold) + Number(item.quantity) > Number(type.stock)) {
          throw new Error(`No hay stock suficiente en ${item.ticket_name}`);
        }
      }
      db.prepare(
        `UPDATE ticketing_orders
         SET payment_status = 'paid', paid_at = datetime('now', 'localtime'),
             updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(order.id);
      const insertTicket = db.prepare(
        `INSERT INTO ticketing_tickets
         (establishment_id, event_id, order_id, order_item_id, customer_id, code, status)
         VALUES (?, ?, ?, ?, ?, ?, 'valid')`
      );
      for (const item of items) {
        db.prepare(
          `UPDATE ticketing_ticket_types
           SET sold = sold + ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(item.quantity, item.ticket_type_id);
        for (let index = 0; index < Number(item.quantity); index += 1) {
          const code = `PT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
          insertTicket.run(order.establishment_id, order.event_id, order.id, item.id, order.customer_id, code);
        }
      }
      db.prepare(
        `INSERT INTO ticketing_payment_events
         (establishment_id, order_id, provider, event_status, payload)
         VALUES (?, ?, 'manual', 'paid', ?)`
      ).run(order.establishment_id, order.id, JSON.stringify({ checked_by: checkedBy }));
      return order;
    })();
    const confirmedOrder = orderDetails(result.id);
    if (confirmedOrder?.email_sent_at) {
      return { order: confirmedOrder, email: { sent: true, already_sent: true } };
    }
    const email = await sendTicketEmail(result.id).catch((error) => ({ sent: false, reason: error.message }));
    return { order: orderDetails(result.id), email };
  }

  app.get('/api/ticketing/public/home', (_req, res) => {
    const establishment = ticketingEstablishment(db);
    if (!establishment) return res.status(404).json({ message: 'ProTickets no disponible' });
    expireOldOrders(establishment.id);
    const events = db.prepare(
      `${eventSelect()}
       FROM ticketing_events AS events
       WHERE events.establishment_id = ? AND events.status IN ('published', 'sold_out')
       ORDER BY events.featured DESC, COALESCE(events.event_date, '9999-12-31'), events.id DESC`
    ).all(establishment.id);
    const banners = db.prepare(
      `SELECT * FROM ticketing_banners
       WHERE establishment_id = ? AND status = 'active'
       ORDER BY sort_order, id DESC`
    ).all(establishment.id);
    res.json({
      brand: { name: establishment.display_name || 'ProTickets', logo_url: establishment.logo_url || '/protickets/protickets-logo.png' },
      google_client_id: process.env.GOOGLE_CLIENT_ID || '',
      events,
      banners
    });
  });

  app.get('/api/ticketing/public/events/:slug', (req, res) => {
    const establishment = ticketingEstablishment(db);
    if (!establishment) return res.status(404).json({ message: 'ProTickets no disponible' });
    expireOldOrders(establishment.id);
    const event = db.prepare(
      `${eventSelect()}
       FROM ticketing_events AS events
       WHERE events.establishment_id = ? AND events.slug = ? AND events.status IN ('published', 'sold_out')`
    ).get(establishment.id, req.params.slug);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });
    const ticketTypes = db.prepare(
      `SELECT * FROM ticketing_ticket_types
       WHERE event_id = ? AND status != 'inactive'
       ORDER BY sort_order, price, id`
    ).all(event.id).map((type) => ({ ...type, available: availableForType(type) }));
    res.json({ ...event, service_fee_rate: ticketingServiceFeeRate(), ticket_types: ticketTypes });
  });

  app.get('/api/ticketing/public/tickets/:code', (req, res) => {
    const ticket = db.prepare(
      `SELECT tickets.code, tickets.status, tickets.used_at, items.ticket_name,
              events.title AS event_title, events.event_date, events.venue, events.city,
              customers.name AS customer_name, orders.order_number
       FROM ticketing_tickets AS tickets
       JOIN ticketing_order_items AS items ON items.id = tickets.order_item_id
       JOIN ticketing_events AS events ON events.id = tickets.event_id
       JOIN ticketing_customers AS customers ON customers.id = tickets.customer_id
       JOIN ticketing_orders AS orders ON orders.id = tickets.order_id
       WHERE tickets.code = ?`
    ).get(cleanText(req.params.code, 80).toUpperCase());
    if (!ticket) return res.status(404).json({ message: 'Entrada no encontrada' });
    res.json(ticket);
  });

  app.post('/api/ticketing/auth/register', (req, res) => {
    const establishment = ticketingEstablishment(db);
    if (!establishment) return res.status(404).json({ message: 'ProTickets no disponible' });
    const name = cleanText(req.body.name, 120);
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    if (name.length < 3) return res.status(400).json({ message: 'Ingresa tus nombres completos' });
    if (!validEmail(email)) return res.status(400).json({ message: 'Ingresa un correo valido' });
    if (password.length < 8) return res.status(400).json({ message: 'La contrasena debe tener al menos 8 caracteres' });
    const existing = db.prepare(
      'SELECT id FROM ticketing_customers WHERE establishment_id = ? AND email = ?'
    ).get(establishment.id, email);
    if (existing) return res.status(409).json({ message: 'Ya existe una cuenta con este correo' });
    const result = db.prepare(
      `INSERT INTO ticketing_customers
       (establishment_id, name, email, cedula, phone, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      establishment.id,
      name,
      email,
      cleanText(req.body.cedula, 30),
      cleanText(req.body.phone, 30),
      hashPassword(password)
    );
    const customer = db.prepare('SELECT * FROM ticketing_customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      token: createToken({ role: 'ticket_customer', customerId: customer.id, establishmentId: establishment.id, email }),
      customer: customerResponse(customer)
    });
  });

  app.post('/api/ticketing/auth/login', (req, res) => {
    const establishment = ticketingEstablishment(db);
    const email = cleanEmail(req.body.email);
    const customer = establishment && db.prepare(
      `SELECT * FROM ticketing_customers
       WHERE establishment_id = ? AND email = ? AND status = 'active'`
    ).get(establishment.id, email);
    if (!customer || !verifyPassword(req.body.password, customer.password_hash)) {
      return res.status(401).json({ message: 'Correo o contrasena incorrectos' });
    }
    res.json({
      token: createToken({ role: 'ticket_customer', customerId: customer.id, establishmentId: establishment.id, email }),
      customer: customerResponse(customer)
    });
  });

  app.post('/api/ticketing/auth/google', async (req, res) => {
    const establishment = ticketingEstablishment(db);
    const credential = cleanText(req.body.credential, 5000);
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    if (!establishment || !credential || !clientId) {
      return res.status(400).json({ message: 'Ingreso con Google aun no configurado' });
    }
    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      const profile = await response.json();
      if (!response.ok || profile.aud !== clientId || !profile.email_verified) {
        return res.status(401).json({ message: 'No se pudo validar la cuenta de Google' });
      }
      const email = cleanEmail(profile.email);
      let customer = db.prepare(
        'SELECT * FROM ticketing_customers WHERE establishment_id = ? AND email = ?'
      ).get(establishment.id, email);
      if (!customer) {
        const result = db.prepare(
          `INSERT INTO ticketing_customers (establishment_id, name, email, google_sub)
           VALUES (?, ?, ?, ?)`
        ).run(establishment.id, cleanText(profile.name || email.split('@')[0], 120), email, cleanText(profile.sub, 180));
        customer = db.prepare('SELECT * FROM ticketing_customers WHERE id = ?').get(result.lastInsertRowid);
      } else if (!customer.google_sub) {
        db.prepare("UPDATE ticketing_customers SET google_sub = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
          .run(cleanText(profile.sub, 180), customer.id);
      }
      res.json({
        token: createToken({ role: 'ticket_customer', customerId: customer.id, establishmentId: establishment.id, email }),
        customer: customerResponse(customer)
      });
    } catch {
      res.status(502).json({ message: 'No se pudo conectar con Google' });
    }
  });

  app.get('/api/ticketing/me', requireTicketCustomer, (req, res) => {
    res.json({ customer: customerResponse(req.ticketCustomer) });
  });

  app.get('/api/ticketing/me/orders', requireTicketCustomer, (req, res) => {
    expireOldOrders(req.ticketCustomer.establishment_id);
    const orders = db.prepare(
      `SELECT orders.*, events.title AS event_title, events.slug AS event_slug,
              events.event_date, events.venue, events.city, events.card_image_url
       FROM ticketing_orders AS orders
       JOIN ticketing_events AS events ON events.id = orders.event_id
       WHERE orders.customer_id = ? ORDER BY orders.id DESC`
    ).all(req.ticketCustomer.id).map((order) => orderDetails(order.id));
    res.json(orders);
  });

  app.post('/api/ticketing/orders', requireTicketCustomer, async (req, res) => {
    const establishment = ticketingEstablishment(db);
    expireOldOrders(establishment.id);
    const ticketTypeId = Number(req.body.ticket_type_id || 0);
    const quantity = Math.max(1, Math.round(Number(req.body.quantity || 1)));
    const ticketType = db.prepare(
      `SELECT types.*, events.establishment_id, events.title AS event_title,
              events.status AS event_status, events.sales_enabled, events.payment_enabled,
              events.is_past, events.bendo_payment_url
       FROM ticketing_ticket_types AS types
       JOIN ticketing_events AS events ON events.id = types.event_id
       WHERE types.id = ? AND events.establishment_id = ?`
    ).get(ticketTypeId, establishment.id);
    if (!ticketType || ticketType.event_status !== 'published' || ticketType.status !== 'active') {
      return res.status(404).json({ message: 'Localidad no disponible' });
    }
    if (!Number(ticketType.sales_enabled)) {
      return res.status(409).json({ message: 'La venta de este evento aun no esta habilitada' });
    }
    if (Number(ticketType.is_past)) {
      return res.status(409).json({ message: 'Este evento ya finalizo' });
    }
    if (!Number(ticketType.payment_enabled)) {
      return res.status(409).json({ message: 'El pago de este evento se habilitara proximamente' });
    }
    if (quantity > Number(ticketType.max_per_order || 6)) {
      return res.status(400).json({ message: `Puedes comprar maximo ${ticketType.max_per_order} entradas por pedido` });
    }
    if (quantity > availableForType(ticketType)) {
      return res.status(409).json({ message: 'No hay suficientes entradas disponibles' });
    }
    const buyer = req.body.customer || {};
    const buyerName = cleanText(buyer.name, 120);
    const buyerCedula = cleanText(buyer.cedula, 30);
    const buyerPhone = cleanText(buyer.phone, 30);
    if (buyerName || buyerCedula || buyerPhone) {
      db.prepare(
        `UPDATE ticketing_customers
         SET name = COALESCE(NULLIF(?, ''), name), cedula = COALESCE(NULLIF(?, ''), cedula),
             phone = COALESCE(NULLIF(?, ''), phone), updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(buyerName, buyerCedula, buyerPhone, req.ticketCustomer.id);
    }
    const subtotal = money(ticketType.price * quantity);
    const fee = serviceFeeFor(subtotal);
    const total = money(subtotal + fee);
    const orderNumber = `PT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = sqlDateTime(new Date(Date.now() + 20 * 60 * 1000));
    const orderId = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO ticketing_orders
         (establishment_id, event_id, customer_id, order_number, subtotal, service_fee,
          total, payment_status, payment_url, external_reference, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(
        establishment.id,
        ticketType.event_id,
        req.ticketCustomer.id,
        orderNumber,
        subtotal,
        fee,
        total,
        null,
        orderNumber,
        expiresAt
      );
      db.prepare(
        `INSERT INTO ticketing_order_items
         (order_id, ticket_type_id, ticket_name, quantity, unit_price, unit_fee)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(result.lastInsertRowid, ticketType.id, ticketType.name, quantity, ticketType.price, money(fee / quantity));
      return result.lastInsertRowid;
    })();
    try {
      const payment = await createBendoPaymentLink({
        orderNumber,
        eventTitle: ticketType.event_title,
        ticketName: ticketType.name,
        quantity,
        unitPrice: ticketType.price,
        fee,
        buyer: { ...buyer, email: req.ticketCustomer.email }
      });
      db.prepare(
        `UPDATE ticketing_orders SET payment_url = ?, external_reference = ?,
         updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(payment.paymentUrl, payment.providerReference, orderId);
      return res.status(201).json(orderDetails(orderId));
    } catch (error) {
      db.transaction(() => {
        db.prepare('DELETE FROM ticketing_order_items WHERE order_id = ?').run(orderId);
        db.prepare("DELETE FROM ticketing_orders WHERE id = ? AND payment_status = 'pending'").run(orderId);
      })();
      console.error('Bendo checkout:', error.message);
      return res.status(502).json({ message: 'No fue posible iniciar el pago con Bendo. Intenta nuevamente.' });
    }
  });

  app.get('/api/ticketing/admin/overview', requireTicketAdmin, (req, res) => {
    const establishment = req.ticketEstablishment;
    expireOldOrders(establishment.id);
    const events = db.prepare(
      `${eventSelect()} FROM ticketing_events AS events
       WHERE events.establishment_id = ? ORDER BY events.id DESC`
    ).all(establishment.id);
    const banners = db.prepare(
      'SELECT * FROM ticketing_banners WHERE establishment_id = ? ORDER BY sort_order, id DESC'
    ).all(establishment.id);
    const orders = db.prepare(
      `SELECT orders.*, events.title AS event_title, customers.name AS customer_name,
              customers.email AS customer_email,
              (SELECT GROUP_CONCAT(ticket_name || ' x' || quantity, ', ') FROM ticketing_order_items WHERE order_id = orders.id) AS detail
       FROM ticketing_orders AS orders
       JOIN ticketing_events AS events ON events.id = orders.event_id
       JOIN ticketing_customers AS customers ON customers.id = orders.customer_id
       WHERE orders.establishment_id = ? ORDER BY orders.id DESC LIMIT 250`
    ).all(establishment.id);
    const stats = db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM ticketing_events WHERE establishment_id = ?) AS events,
        (SELECT COUNT(*) FROM ticketing_orders WHERE establishment_id = ? AND payment_status = 'pending') AS pending_orders,
        (SELECT COUNT(*) FROM ticketing_tickets WHERE establishment_id = ? AND status = 'valid') AS valid_tickets,
        (SELECT COALESCE(SUM(total), 0) FROM ticketing_orders WHERE establishment_id = ? AND payment_status = 'paid') AS revenue`
    ).get(establishment.id, establishment.id, establishment.id, establishment.id);
    res.json({ establishment, events, banners, orders, stats });
  });

  app.get('/api/ticketing/admin/events/:id', requireTicketAdmin, (req, res) => {
    const event = db.prepare(
      'SELECT * FROM ticketing_events WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });
    const ticketTypes = db.prepare(
      'SELECT * FROM ticketing_ticket_types WHERE event_id = ? ORDER BY sort_order, price, id'
    ).all(event.id);
    res.json({ ...event, ticket_types: ticketTypes });
  });

  app.post('/api/ticketing/admin/events', requireTicketAdmin, (req, res) => {
    const title = cleanText(req.body.title, 180);
    if (!title) return res.status(400).json({ message: 'El nombre del evento es obligatorio' });
    let slug = slugify(req.body.slug || title);
    const existing = db.prepare(
      'SELECT id FROM ticketing_events WHERE establishment_id = ? AND slug = ?'
    ).get(req.ticketEstablishment.id, slug);
    if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;
    const result = db.prepare(
      `INSERT INTO ticketing_events
       (establishment_id, slug, title, subtitle, description, venue, city, address,
        event_date, doors_time, hero_image_url, card_image_url, hero_display_mode,
        organizer, terms, bendo_payment_url, status, featured, sales_enabled,
        payment_enabled, is_past)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.ticketEstablishment.id,
      slug,
      title,
      cleanText(req.body.subtitle, 250),
      cleanText(req.body.description, 8000),
      cleanText(req.body.venue, 250),
      cleanText(req.body.city, 120),
      cleanText(req.body.address, 300),
      cleanText(req.body.event_date, 30) || null,
      cleanText(req.body.doors_time, 20),
      cleanText(req.body.hero_image_url, 10000000),
      cleanText(req.body.card_image_url || req.body.hero_image_url, 10000000),
      req.body.hero_display_mode === 'contain' ? 'contain' : 'cover',
      cleanText(req.body.organizer, 180),
      cleanText(req.body.terms, 8000),
      cleanText(req.body.bendo_payment_url, 2000),
      ['draft', 'published', 'sold_out', 'archived'].includes(req.body.status) ? req.body.status : 'draft',
      req.body.featured ? 1 : 0,
      req.body.sales_enabled ? 1 : 0,
      req.body.payment_enabled ? 1 : 0,
      req.body.is_past ? 1 : 0
    );
    res.status(201).json(db.prepare('SELECT * FROM ticketing_events WHERE id = ?').get(result.lastInsertRowid));
  });

  app.put('/api/ticketing/admin/events/:id', requireTicketAdmin, (req, res) => {
    const current = db.prepare(
      'SELECT * FROM ticketing_events WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!current) return res.status(404).json({ message: 'Evento no encontrado' });
    const title = cleanText(req.body.title, 180);
    if (!title) return res.status(400).json({ message: 'El nombre del evento es obligatorio' });
    const slug = slugify(req.body.slug || current.slug || title);
    db.prepare(
      `UPDATE ticketing_events SET
        slug = ?, title = ?, subtitle = ?, description = ?, venue = ?, city = ?, address = ?,
        event_date = ?, doors_time = ?, hero_image_url = ?, card_image_url = ?, hero_display_mode = ?, organizer = ?,
        terms = ?, bendo_payment_url = ?, status = ?, featured = ?, sales_enabled = ?,
        payment_enabled = ?, is_past = ?,
        updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    ).run(
      slug,
      title,
      cleanText(req.body.subtitle, 250),
      cleanText(req.body.description, 8000),
      cleanText(req.body.venue, 250),
      cleanText(req.body.city, 120),
      cleanText(req.body.address, 300),
      cleanText(req.body.event_date, 30) || null,
      cleanText(req.body.doors_time, 20),
      cleanText(req.body.hero_image_url, 10000000),
      cleanText(req.body.card_image_url || req.body.hero_image_url, 10000000),
      req.body.hero_display_mode === 'contain' ? 'contain' : 'cover',
      cleanText(req.body.organizer, 180),
      cleanText(req.body.terms, 8000),
      cleanText(req.body.bendo_payment_url, 2000),
      ['draft', 'published', 'sold_out', 'archived'].includes(req.body.status) ? req.body.status : 'draft',
      req.body.featured ? 1 : 0,
      req.body.sales_enabled ? 1 : 0,
      req.body.payment_enabled ? 1 : 0,
      req.body.is_past ? 1 : 0,
      current.id,
      req.ticketEstablishment.id
    );
    res.json(db.prepare('SELECT * FROM ticketing_events WHERE id = ?').get(current.id));
  });

  app.post('/api/ticketing/admin/events/:id/ticket-types', requireTicketAdmin, (req, res) => {
    const event = db.prepare(
      'SELECT id FROM ticketing_events WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });
    const name = cleanText(req.body.name, 120);
    if (!name) return res.status(400).json({ message: 'El nombre de la localidad es obligatorio' });
    const result = db.prepare(
      `INSERT INTO ticketing_ticket_types
       (event_id, name, description, price, service_fee, stock, max_per_order, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      name,
      cleanText(req.body.description, 400),
      Math.max(0, money(req.body.price)),
      Math.max(0, money(req.body.service_fee)),
      Math.max(0, Math.round(Number(req.body.stock || 0))),
      Math.max(1, Math.round(Number(req.body.max_per_order || 6))),
      ['active', 'inactive', 'sold_out'].includes(req.body.status) ? req.body.status : 'active',
      Math.round(Number(req.body.sort_order || 0))
    );
    res.status(201).json(db.prepare('SELECT * FROM ticketing_ticket_types WHERE id = ?').get(result.lastInsertRowid));
  });

  app.put('/api/ticketing/admin/ticket-types/:id', requireTicketAdmin, (req, res) => {
    const current = db.prepare(
      `SELECT types.* FROM ticketing_ticket_types AS types
       JOIN ticketing_events AS events ON events.id = types.event_id
       WHERE types.id = ? AND events.establishment_id = ?`
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!current) return res.status(404).json({ message: 'Localidad no encontrada' });
    const stock = Math.max(Number(current.sold || 0), Math.round(Number(req.body.stock ?? current.stock)));
    db.prepare(
      `UPDATE ticketing_ticket_types SET
        name = ?, description = ?, price = ?, service_fee = ?, stock = ?, max_per_order = ?,
        status = ?, sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(
      cleanText(req.body.name, 120) || current.name,
      cleanText(req.body.description, 400),
      Math.max(0, money(req.body.price)),
      Math.max(0, money(req.body.service_fee)),
      stock,
      Math.max(1, Math.round(Number(req.body.max_per_order || 6))),
      ['active', 'inactive', 'sold_out'].includes(req.body.status) ? req.body.status : 'active',
      Math.round(Number(req.body.sort_order || 0)),
      current.id
    );
    res.json(db.prepare('SELECT * FROM ticketing_ticket_types WHERE id = ?').get(current.id));
  });

  app.delete('/api/ticketing/admin/ticket-types/:id', requireTicketAdmin, (req, res) => {
    const current = db.prepare(
      `SELECT types.* FROM ticketing_ticket_types AS types
       JOIN ticketing_events AS events ON events.id = types.event_id
       WHERE types.id = ? AND events.establishment_id = ?`
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!current) return res.status(404).json({ message: 'Localidad no encontrada' });
    if (Number(current.sold || 0) > 0) {
      db.prepare("UPDATE ticketing_ticket_types SET status = 'inactive' WHERE id = ?").run(current.id);
      return res.json({ ok: true, deactivated: true });
    }
    db.prepare('DELETE FROM ticketing_ticket_types WHERE id = ?').run(current.id);
    res.json({ ok: true });
  });

  app.post('/api/ticketing/admin/banners', requireTicketAdmin, (req, res) => {
    const imageUrl = cleanText(req.body.image_url, 10000000);
    if (!imageUrl) return res.status(400).json({ message: 'Selecciona una imagen' });
    const result = db.prepare(
      `INSERT INTO ticketing_banners
       (establishment_id, event_id, image_url, mobile_image_url, title, subtitle,
        cta_label, cta_url, status, show_overlay, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.ticketEstablishment.id,
      Number(req.body.event_id || 0) || null,
      imageUrl,
      cleanText(req.body.mobile_image_url, 10000000),
      cleanText(req.body.title, 180),
      cleanText(req.body.subtitle, 250),
      cleanText(req.body.cta_label, 80),
      cleanText(req.body.cta_url, 2000),
      req.body.status === 'inactive' ? 'inactive' : 'active',
      req.body.show_overlay === false || Number(req.body.show_overlay) === 0 ? 0 : 1,
      Math.round(Number(req.body.sort_order || 0))
    );
    res.status(201).json(db.prepare('SELECT * FROM ticketing_banners WHERE id = ?').get(result.lastInsertRowid));
  });

  app.put('/api/ticketing/admin/banners/:id', requireTicketAdmin, (req, res) => {
    const current = db.prepare(
      'SELECT * FROM ticketing_banners WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!current) return res.status(404).json({ message: 'Banner no encontrado' });
    db.prepare(
      `UPDATE ticketing_banners SET event_id = ?, image_url = ?, mobile_image_url = ?, title = ?, subtitle = ?, cta_label = ?,
        cta_url = ?, status = ?, show_overlay = ?, sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(
      Number(req.body.event_id || 0) || current.event_id || null,
      cleanText(req.body.image_url, 10000000) || current.image_url,
      cleanText(req.body.mobile_image_url, 10000000),
      cleanText(req.body.title, 180),
      cleanText(req.body.subtitle, 250),
      cleanText(req.body.cta_label, 80),
      cleanText(req.body.cta_url, 2000),
      req.body.status === 'inactive' ? 'inactive' : 'active',
      req.body.show_overlay === false || Number(req.body.show_overlay) === 0 ? 0 : 1,
      Math.round(Number(req.body.sort_order || 0)),
      current.id
    );
    res.json(db.prepare('SELECT * FROM ticketing_banners WHERE id = ?').get(current.id));
  });

  app.delete('/api/ticketing/admin/banners/:id', requireTicketAdmin, (req, res) => {
    const result = db.prepare(
      'DELETE FROM ticketing_banners WHERE id = ? AND establishment_id = ?'
    ).run(req.params.id, req.ticketEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Banner no encontrado' });
    res.json({ ok: true });
  });

  app.put('/api/ticketing/admin/orders/:id/payment-link', requireTicketAdmin, (req, res) => {
    const order = db.prepare(
      'SELECT * FROM ticketing_orders WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    db.prepare("UPDATE ticketing_orders SET payment_url = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
      .run(cleanText(req.body.payment_url, 2000), order.id);
    res.json(orderDetails(order.id));
  });

  app.post('/api/ticketing/admin/orders/:id/confirm', requireTicketAdmin, async (req, res) => {
    try {
      const order = db.prepare(
        'SELECT id FROM ticketing_orders WHERE id = ? AND establishment_id = ?'
      ).get(req.params.id, req.ticketEstablishment.id);
      if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
      res.json(await confirmOrder(order.id, req.user.username || 'Administrador'));
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/ticketing/admin/orders/:id/reject', requireTicketAdmin, (req, res) => {
    const result = db.prepare(
      `UPDATE ticketing_orders SET payment_status = 'rejected', updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ? AND payment_status = 'pending'`
    ).run(req.params.id, req.ticketEstablishment.id);
    if (!result.changes) return res.status(400).json({ message: 'Pedido no encontrado o ya procesado' });
    res.json({ ok: true });
  });

  app.post('/api/ticketing/admin/tickets/validate', requireTicketAdmin, (req, res) => {
    const code = cleanText(req.body.code, 80).toUpperCase();
    const ticket = db.prepare(
      `SELECT tickets.*, items.ticket_name, events.title AS event_title,
              customers.name AS customer_name
       FROM ticketing_tickets AS tickets
       JOIN ticketing_order_items AS items ON items.id = tickets.order_item_id
       JOIN ticketing_events AS events ON events.id = tickets.event_id
       JOIN ticketing_customers AS customers ON customers.id = tickets.customer_id
       WHERE tickets.code = ? AND tickets.establishment_id = ?`
    ).get(code, req.ticketEstablishment.id);
    if (!ticket) return res.status(404).json({ valid: false, message: 'Entrada no registrada' });
    if (ticket.status === 'used') {
      return res.status(409).json({ valid: false, message: 'Entrada ya utilizada', ticket });
    }
    if (ticket.status !== 'valid') {
      return res.status(409).json({ valid: false, message: 'Entrada anulada', ticket });
    }
    db.prepare(
      `UPDATE ticketing_tickets
       SET status = 'used', used_at = datetime('now', 'localtime'), checked_by = ? WHERE id = ?`
    ).run(req.user.username || 'Administrador', ticket.id);
    res.json({ valid: true, message: 'Entrada valida. Acceso registrado.', ticket: { ...ticket, status: 'used' } });
  });

  app.post('/api/ticketing/payments/bendo/webhook', async (req, res) => {
    const expectedSecret = process.env.BENDO_WEBHOOK_SECRET || '';
    const receivedSecret = req.headers['x-bendo-secret'] || req.query.secret || '';
    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return res.status(401).json({ message: 'Webhook no autorizado' });
    }
    const establishment = ticketingEstablishment(db);
    let externalData = req.body.external_data || req.body.externalData || req.body.metadata || {};
    if (typeof externalData === 'string') {
      try { externalData = JSON.parse(externalData); } catch { externalData = {}; }
    }
    const reference = cleanText(
      req.body.orderUuid || req.body.order_uuid || req.body.payment_link_id || req.body.external_reference
        || req.body.reference || req.body.order_number || req.body.merchant_reference
        || externalData.order_number || externalData.orderNumber,
      180
    );
    const status = cleanText(req.body.status || req.body.payment_status, 40).toLowerCase();
    const order = db.prepare(
      `SELECT * FROM ticketing_orders
       WHERE establishment_id = ? AND (order_number = ? OR external_reference = ?)`
    ).get(establishment.id, reference, reference);
    db.prepare(
      `INSERT INTO ticketing_payment_events
       (establishment_id, order_id, provider, provider_reference, event_status, payload)
       VALUES (?, ?, 'bendo', ?, ?, ?)`
    ).run(establishment.id, order?.id || null, reference, status, JSON.stringify(req.body || {}));
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (['paid', 'approved', 'success', 'completed', 'aprobado'].includes(status)) {
      const reportedTotal = Number(req.body?.billing?.totals?.net ?? req.body.total ?? req.body.amount);
      if (Number.isFinite(reportedTotal) && money(reportedTotal) !== money(order.total)) {
        return res.status(409).json({ message: 'El valor confirmado no coincide con el pedido' });
      }
      try {
        const result = await confirmOrder(order.id, 'Bendo webhook');
        return res.json({ ok: true, email_sent: Boolean(result.email?.sent) });
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }
    res.json({ ok: true, processed: false });
  });
}
