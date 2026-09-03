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

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
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

function payPhoneCredentials() {
  const token = String(process.env.PAYPHONE_TOKEN || '').trim();
  const storeId = String(process.env.PAYPHONE_STORE_ID || '').trim();
  if (!token || !storeId) throw new Error('PayPhone no esta configurado');
  return { token, storeId };
}

function cents(value) {
  return Math.round(money(value) * 100);
}

async function payPhoneRequest(url, body) {
  const { token } = payPhoneCredentials();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = cleanText(payload?.message || payload?.error || payload?.detail, 180);
    throw new Error(`PayPhone respondio HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return payload;
}

async function createPayPhonePayment({ orderNumber, eventTitle, ticketName, quantity, subtotal, fee, total }) {
  const { storeId } = payPhoneCredentials();
  const responseUrl = `${publicAppUrl()}/api/ticketing/payments/payphone/response`;
  const cancellationUrl = `${publicAppUrl()}/tickets/mi-cuenta?payment=cancelled`;
  const payload = await payPhoneRequest(
    process.env.PAYPHONE_PREPARE_URL || 'https://pay.payphonetodoesposible.com/api/button/Prepare',
    {
      amount: cents(total),
      amountWithoutTax: cents(subtotal),
      amountWithTax: 0,
      tax: 0,
      service: cents(fee),
      tip: 0,
      clientTransactionId: orderNumber,
      reference: cleanText(`${eventTitle} - ${ticketName} x${quantity}`, 100),
      storeId,
      currency: 'USD',
      responseUrl,
      cancellationUrl,
      timeZone: -5
    }
  );
  const paymentUrl = cleanText(payload.payWithCard || payload.payWithPayPhone, 2000);
  if (!paymentUrl || !payload.paymentId) throw new Error('PayPhone no devolvio el enlace de pago');
  return { paymentUrl, providerReference: cleanText(payload.paymentId, 180) };
}

async function confirmPayPhonePayment(id, clientTransactionId) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0 || !clientTransactionId) {
    throw new Error('La respuesta de PayPhone esta incompleta');
  }
  return payPhoneRequest(
    process.env.PAYPHONE_CONFIRM_URL || 'https://pay.payphonetodoesposible.com/api/button/V2/Confirm',
    { id: numericId, clientTxId: cleanText(clientTransactionId, 180) }
  );
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

function ticketCodeFromInput(value) {
  const input = cleanText(value, 2000);
  const codeMatch = input.match(/PT-[A-Z0-9-]+/i);
  if (codeMatch) return codeMatch[0].toUpperCase();
  try {
    const url = new URL(input);
    const pathMatch = url.pathname.match(/\/tickets\/entrada\/([^/?#]+)/i);
    if (pathMatch) return cleanText(decodeURIComponent(pathMatch[1]), 80).toUpperCase();
  } catch {
    // Manual codes are expected to be plain text, not necessarily URLs.
  }
  return cleanText(input, 80).toUpperCase();
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

  function requireTicketValidationAccess(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role === 'supreme' || req.user?.role === 'admin') {
        return requireTicketAdmin(req, res, next);
      }
      if (req.user?.role !== 'ticket_validator') {
        return res.status(403).json({ message: 'Acceso exclusivo para validacion' });
      }
      const validator = db.prepare(
        `SELECT validators.*, establishments.name AS establishment_name,
                establishments.display_name AS establishment_display_name
         FROM ticketing_validators AS validators
         JOIN establishments ON establishments.id = validators.establishment_id
         WHERE validators.id = ? AND validators.establishment_id = ?
           AND validators.status = 'active'
           AND establishments.module_type = 'ticketing' AND establishments.status = 'active'`
      ).get(req.user.validatorId, req.user.establishmentId);
      if (!validator) return res.status(401).json({ message: 'Usuario de validacion no disponible' });
      req.ticketValidator = validator;
      req.ticketEstablishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(validator.establishment_id);
      return next();
    });
  }

  function validationUser(req) {
    return cleanText(req.ticketValidator?.name || req.user?.username || 'Administrador', 120);
  }

  function recordValidation(req, { ticketId = null, code, result, message }) {
    db.prepare(
      `INSERT INTO ticketing_validation_logs
       (establishment_id, ticket_id, code, result, message, checked_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.ticketEstablishment.id, ticketId, code || '-', result, message, validationUser(req));
  }

  app.post('/api/ticketing/validator/login', (req, res) => {
    const establishment = ticketingEstablishment(db);
    const username = cleanText(req.body?.username, 80).toLowerCase();
    const password = String(req.body?.password || '');
    const validator = establishment && db.prepare(
      `SELECT * FROM ticketing_validators
       WHERE establishment_id = ? AND lower(username) = ? AND status = 'active'`
    ).get(establishment.id, username);
    if (!validator || !verifyPassword(password, validator.password_hash)) {
      return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
    }
    return res.json({
      token: createToken({
        role: 'ticket_validator',
        validatorId: validator.id,
        establishmentId: establishment.id,
        username: validator.username
      }),
      user: {
        id: validator.id,
        username: validator.username,
        role: 'ticket_validator',
        name: validator.name,
        establishment_id: establishment.id,
        establishment_name: establishment.name,
        establishment_display_name: establishment.display_name || establishment.name,
        establishment_module_type: 'ticketing'
      }
    });
  });

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

  async function confirmOrder(orderId, checkedBy = 'Administrador', provider = 'manual') {
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
         VALUES (?, ?, ?, 'paid', ?)`
      ).run(order.establishment_id, order.id, provider, JSON.stringify({ checked_by: checkedBy }));
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

  app.post('/api/ticketing/auth/forgot-password', async (req, res) => {
    const establishment = ticketingEstablishment(db);
    const email = cleanEmail(req.body.email);
    const genericMessage = 'Si el correo esta registrado, recibiras un enlace para cambiar tu contrasena.';
    if (!validEmail(email)) return res.status(400).json({ message: 'Ingresa un correo valido' });

    const customer = establishment && db.prepare(
      `SELECT * FROM ticketing_customers
       WHERE establishment_id = ? AND email = ? AND status = 'active'`
    ).get(establishment.id, email);
    if (!customer) return res.json({ message: genericMessage });

    db.prepare(
      `DELETE FROM ticketing_password_resets
       WHERE expires_at < datetime('now', 'localtime') OR used_at IS NOT NULL`
    ).run();
    const recentRequest = db.prepare(
      `SELECT id FROM ticketing_password_resets
       WHERE customer_id = ? AND used_at IS NULL
         AND created_at >= datetime('now', 'localtime', '-2 minutes')
       ORDER BY id DESC LIMIT 1`
    ).get(customer.id);
    if (recentRequest) return res.json({ message: genericMessage });

    const token = crypto.randomBytes(32).toString('hex');
    const reset = db.prepare(
      `INSERT INTO ticketing_password_resets
       (establishment_id, customer_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', 'localtime', '+1 hour'))`
    ).run(establishment.id, customer.id, hashResetToken(token));
    const resetUrl = `${publicAppUrl()}/tickets/restablecer-contrasena?token=${encodeURIComponent(token)}`;

    try {
      const transporter = ticketingTransporter();
      if (!transporter) throw new Error('SMTP no configurado');
      const safeName = escapeHtml(customer.name);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: customer.email,
        subject: 'Recupera tu contrasena de ProTickets',
        text: `Hola ${customer.name},\n\nAbre este enlace para crear una nueva contrasena de ProTickets:\n${resetUrl}\n\nEl enlace vence en 60 minutos y solo puede utilizarse una vez. Si no solicitaste este cambio, ignora este correo.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171719">
          <h2 style="margin-bottom:8px">Recupera tu contrasena</h2>
          <p>Hola ${safeName}, recibimos una solicitud para cambiar tu contrasena de ProTickets.</p>
          <p style="margin:28px 0"><a href="${resetUrl}" style="background:#ed1c2f;color:#fff;padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:700">Crear nueva contrasena</a></p>
          <p style="color:#6f7076;font-size:13px">Este enlace vence en 60 minutos y solo puede utilizarse una vez. Si no solicitaste este cambio, puedes ignorar este correo.</p>
        </div>`
      });
    } catch (error) {
      db.prepare('DELETE FROM ticketing_password_resets WHERE id = ?').run(reset.lastInsertRowid);
      console.error('No se pudo enviar la recuperacion de ProTickets:', error.message);
    }
    res.json({ message: genericMessage });
  });

  app.post('/api/ticketing/auth/reset-password', (req, res) => {
    const establishment = ticketingEstablishment(db);
    const token = cleanText(req.body.token, 180);
    const password = String(req.body.password || '');
    if (!token) return res.status(400).json({ message: 'El enlace de recuperacion no es valido' });
    if (password.length < 8) return res.status(400).json({ message: 'La contrasena debe tener al menos 8 caracteres' });

    const reset = establishment && db.prepare(
      `SELECT resets.id, resets.customer_id
       FROM ticketing_password_resets AS resets
       JOIN ticketing_customers AS customers ON customers.id = resets.customer_id
       WHERE resets.establishment_id = ? AND resets.token_hash = ?
         AND resets.used_at IS NULL
         AND resets.expires_at >= datetime('now', 'localtime')
         AND customers.status = 'active'`
    ).get(establishment.id, hashResetToken(token));
    if (!reset) return res.status(400).json({ message: 'Este enlace vencio o ya fue utilizado. Solicita uno nuevo.' });

    db.transaction(() => {
      db.prepare(
        `UPDATE ticketing_customers
         SET password_hash = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(hashPassword(password), reset.customer_id, establishment.id);
      db.prepare(
        `UPDATE ticketing_password_resets
         SET used_at = datetime('now', 'localtime')
         WHERE customer_id = ? AND used_at IS NULL`
      ).run(reset.customer_id);
    })();
    res.json({ message: 'Tu contrasena fue actualizada. Ya puedes ingresar a ProTickets.' });
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
       WHERE orders.customer_id = ? AND orders.payment_status IN ('pending', 'paid')
       ORDER BY orders.id DESC`
    ).all(req.ticketCustomer.id).map((order) => orderDetails(order.id));
    res.json(orders);
  });

  app.delete('/api/ticketing/me/orders/:id', requireTicketCustomer, (req, res) => {
    expireOldOrders(req.ticketCustomer.establishment_id);
    const order = db.prepare(
      `SELECT id, payment_status FROM ticketing_orders
       WHERE id = ? AND customer_id = ? AND establishment_id = ?`
    ).get(req.params.id, req.ticketCustomer.id, req.ticketCustomer.establishment_id);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (order.payment_status !== 'pending') {
      return res.status(409).json({ message: 'Solo puedes quitar pedidos pendientes de pago' });
    }
    db.prepare(
      `UPDATE ticketing_orders
       SET payment_status = 'rejected', updated_at = datetime('now', 'localtime')
       WHERE id = ? AND customer_id = ? AND payment_status = 'pending'`
    ).run(order.id, req.ticketCustomer.id);
    res.json({ ok: true });
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
    const expiresAt = sqlDateTime(new Date(Date.now() + 10 * 60 * 1000));
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
      const payment = await createPayPhonePayment({
        orderNumber,
        eventTitle: ticketType.event_title,
        ticketName: ticketType.name,
        quantity,
        subtotal,
        fee,
        total
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
      console.error('PayPhone checkout:', error.message);
      return res.status(502).json({ message: 'No fue posible iniciar el pago con PayPhone. Intenta nuevamente.' });
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

  app.get('/api/ticketing/admin/validators', requireTicketAdmin, (req, res) => {
    const validators = db.prepare(
      `SELECT id, name, username, status, created_at, updated_at
       FROM ticketing_validators WHERE establishment_id = ? ORDER BY name, id`
    ).all(req.ticketEstablishment.id);
    res.json(validators);
  });

  app.post('/api/ticketing/admin/validators', requireTicketAdmin, (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const username = cleanText(req.body?.username, 80).toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !username || !password) {
      return res.status(400).json({ message: 'Completa nombre, usuario y contrasena' });
    }
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
      return res.status(400).json({ message: 'El usuario debe tener al menos 3 caracteres y no usar espacios' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'La contrasena debe tener al menos 8 caracteres' });
    }
    try {
      const result = db.prepare(
        `INSERT INTO ticketing_validators
         (establishment_id, name, username, password_hash, status)
         VALUES (?, ?, ?, ?, 'active')`
      ).run(req.ticketEstablishment.id, name, username, hashPassword(password));
      return res.status(201).json(db.prepare(
        `SELECT id, name, username, status, created_at, updated_at
         FROM ticketing_validators WHERE id = ?`
      ).get(result.lastInsertRowid));
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).json({ message: 'Ese usuario ya esta registrado' });
      }
      throw error;
    }
  });

  app.put('/api/ticketing/admin/validators/:id', requireTicketAdmin, (req, res) => {
    const current = db.prepare(
      'SELECT * FROM ticketing_validators WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, req.ticketEstablishment.id);
    if (!current) return res.status(404).json({ message: 'Usuario no encontrado' });
    const name = cleanText(req.body?.name, 120) || current.name;
    const username = cleanText(req.body?.username, 80).toLowerCase() || current.username;
    const password = String(req.body?.password || '');
    const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
      return res.status(400).json({ message: 'El usuario debe tener al menos 3 caracteres y no usar espacios' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ message: 'La contrasena debe tener al menos 8 caracteres' });
    }
    try {
      db.prepare(
        `UPDATE ticketing_validators
         SET name = ?, username = ?, password_hash = ?, status = ?,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(
        name,
        username,
        password ? hashPassword(password) : current.password_hash,
        status,
        current.id,
        req.ticketEstablishment.id
      );
      return res.json(db.prepare(
        `SELECT id, name, username, status, created_at, updated_at
         FROM ticketing_validators WHERE id = ?`
      ).get(current.id));
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).json({ message: 'Ese usuario ya esta registrado' });
      }
      throw error;
    }
  });

  app.delete('/api/ticketing/admin/validators/:id', requireTicketAdmin, (req, res) => {
    const result = db.prepare(
      'DELETE FROM ticketing_validators WHERE id = ? AND establishment_id = ?'
    ).run(req.params.id, req.ticketEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json({ ok: true });
  });

  app.get('/api/ticketing/validation/history', requireTicketValidationAccess, (req, res) => {
    const history = db.prepare(
      `SELECT logs.*, tickets.status AS ticket_status, items.ticket_name,
              events.title AS event_title, customers.name AS customer_name
       FROM ticketing_validation_logs AS logs
       LEFT JOIN ticketing_tickets AS tickets ON tickets.id = logs.ticket_id
       LEFT JOIN ticketing_order_items AS items ON items.id = tickets.order_item_id
       LEFT JOIN ticketing_events AS events ON events.id = tickets.event_id
       LEFT JOIN ticketing_customers AS customers ON customers.id = tickets.customer_id
       WHERE logs.establishment_id = ?
       ORDER BY logs.id DESC LIMIT 200`
    ).all(req.ticketEstablishment.id);
    res.json(history);
  });

  app.post('/api/ticketing/admin/tickets/validate', requireTicketValidationAccess, (req, res) => {
    const code = ticketCodeFromInput(req.body?.code);
    if (!code) return res.status(400).json({ valid: false, message: 'Ingresa o escanea un codigo' });
    const ticket = db.prepare(
      `SELECT tickets.*, items.ticket_name, events.title AS event_title,
              customers.name AS customer_name
       FROM ticketing_tickets AS tickets
       JOIN ticketing_order_items AS items ON items.id = tickets.order_item_id
       JOIN ticketing_events AS events ON events.id = tickets.event_id
       JOIN ticketing_customers AS customers ON customers.id = tickets.customer_id
       WHERE tickets.code = ? AND tickets.establishment_id = ?`
    ).get(code, req.ticketEstablishment.id);
    if (!ticket) {
      recordValidation(req, { code, result: 'invalid', message: 'Entrada no registrada' });
      return res.status(404).json({ valid: false, message: 'Entrada no registrada' });
    }
    if (ticket.status === 'used') {
      recordValidation(req, { ticketId: ticket.id, code, result: 'already_used', message: 'Entrada ya utilizada' });
      return res.status(409).json({ valid: false, message: 'Entrada ya utilizada', ticket });
    }
    if (ticket.status !== 'valid') {
      recordValidation(req, { ticketId: ticket.id, code, result: 'void', message: 'Entrada anulada' });
      return res.status(409).json({ valid: false, message: 'Entrada anulada', ticket });
    }
    const checkedBy = validationUser(req);
    db.prepare(
      `UPDATE ticketing_tickets
       SET status = 'used', used_at = datetime('now', 'localtime'), checked_by = ? WHERE id = ?`
    ).run(checkedBy, ticket.id);
    const usage = db.prepare('SELECT used_at, checked_by FROM ticketing_tickets WHERE id = ?').get(ticket.id);
    recordValidation(req, { ticketId: ticket.id, code, result: 'valid', message: 'Entrada valida. Acceso registrado.' });
    res.json({
      valid: true,
      message: 'Entrada valida. Acceso registrado.',
      ticket: { ...ticket, ...usage, status: 'used' }
    });
  });

  app.all('/api/ticketing/payments/payphone/response', async (req, res) => {
    const responseData = { ...(req.query || {}), ...(req.body || {}) };
    const clientTransactionId = cleanText(
      responseData.clientTransactionId || responseData.clientTransactionID || responseData.clientTxId,
      180
    );
    const paymentId = responseData.id || responseData.transactionId;
    const accountUrl = new URL('/tickets/mi-cuenta', `${publicAppUrl()}/`);
    const finish = (status, orderNumber = '') => {
      accountUrl.searchParams.set('payment', status);
      if (orderNumber) accountUrl.searchParams.set('order', orderNumber);
      return res.redirect(303, accountUrl.toString());
    };

    const establishment = ticketingEstablishment(db);
    const order = establishment && clientTransactionId
      ? db.prepare(
        `SELECT * FROM ticketing_orders
         WHERE establishment_id = ? AND order_number = ?`
      ).get(establishment.id, clientTransactionId)
      : null;
    if (!order || !paymentId) return finish('failed', clientTransactionId);
    if (order.payment_status === 'paid') return finish('success', order.order_number);

    try {
      const payment = await confirmPayPhonePayment(paymentId, clientTransactionId);
      const confirmedTransactionId = cleanText(
        payment.clientTransactionId || payment.ClientTransactionId,
        180
      );
      const statusCode = Number(payment.statusCode ?? payment.StatusCode);
      const transactionStatus = cleanText(
        payment.transactionStatus || payment.TransactionStatus,
        40
      ).toLowerCase();
      const reportedAmount = Number(payment.amount ?? payment.Amount);
      const providerReference = cleanText(
        payment.transactionId || payment.TransactionId || paymentId,
        180
      );
      const eventPayload = {
        amount: reportedAmount,
        statusCode,
        transactionStatus,
        transactionId: providerReference,
        authorizationCode: cleanText(payment.authorizationCode || payment.AuthorizationCode, 80)
      };
      db.prepare(
        `INSERT INTO ticketing_payment_events
         (establishment_id, order_id, provider, provider_reference, event_status, payload)
         VALUES (?, ?, 'payphone', ?, ?, ?)`
      ).run(establishment.id, order.id, providerReference, transactionStatus, JSON.stringify(eventPayload));

      if (confirmedTransactionId !== order.order_number || !Number.isSafeInteger(reportedAmount) || reportedAmount !== cents(order.total)) {
        console.error('PayPhone confirmacion rechazada: pedido o valor no coincide');
        return finish('failed', order.order_number);
      }
      if (statusCode !== 3 || transactionStatus !== 'approved') {
        db.prepare(
          `UPDATE ticketing_orders SET payment_status = 'rejected',
           updated_at = datetime('now', 'localtime') WHERE id = ? AND payment_status = 'pending'`
        ).run(order.id);
        return finish('failed', order.order_number);
      }

      const result = await confirmOrder(order.id, 'PayPhone', 'payphone');
      accountUrl.searchParams.set('email', result.email?.sent ? 'sent' : 'pending');
      return finish('success', order.order_number);
    } catch (error) {
      console.error('PayPhone confirmacion:', error.message);
      return finish('failed', order.order_number);
    }
  });
}
