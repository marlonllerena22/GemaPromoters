import crypto from 'node:crypto';

const BASE = '/api/ticketing';
const allowedFiles = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

function eventIdFrom(value) {
  if (value === undefined || value === null || value === '') return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function fileFromBody(value) {
  if (!value) return null;
  const name = clean(value.name, 120).replace(/[\\/:*?"<>|]/g, '_');
  const data = String(value.data_url || '');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || !allowedFiles.has(match[1]) || !name || match[2].length > 7_000_000) return false;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return false;
  return { name, mime: match[1], data: match[2] };
}

export function promotionRecipients(db, establishmentId, eventId = 0) {
  const rows = db.prepare([
    'SELECT c.id, c.name, c.email, c.phone, recent.event_id, recent.payment_status AS last_status,',
    'recent.created_at AS last_attempt_at, e.title AS event_title',
    'FROM ticketing_customers c',
    'JOIN ticketing_orders recent ON recent.id = (',
    '  SELECT o.id FROM ticketing_orders o',
    "  WHERE o.establishment_id = c.establishment_id AND o.customer_id = c.id",
    "    AND o.payment_status IN ('rejected', 'expired')",
    '    AND (? = 0 OR o.event_id = ?)',
    '  ORDER BY o.created_at DESC, o.id DESC LIMIT 1',
    ')',
    'JOIN ticketing_events e ON e.id = recent.event_id',
    "WHERE c.establishment_id = ? AND c.status = 'active' AND COALESCE(c.marketing_opt_out, 0) = 0",
    'AND NOT EXISTS (',
    '  SELECT 1 FROM ticketing_orders paid',
    '  JOIN ticketing_customers buyer ON buyer.id = paid.customer_id',
    "  WHERE paid.establishment_id = c.establishment_id AND paid.payment_status IN ('paid', 'refunded')",
    '    AND (buyer.id = c.id OR LOWER(TRIM(buyer.email)) = LOWER(TRIM(c.email)))',
    ')',
    'AND NOT EXISTS (',
    '  SELECT 1 FROM ticketing_orders open_order',
    '  JOIN ticketing_customers buyer ON buyer.id = open_order.customer_id',
    "  WHERE open_order.establishment_id = c.establishment_id AND open_order.payment_status = 'pending'",
    "    AND (open_order.expires_at IS NULL OR open_order.expires_at >= datetime('now', 'localtime'))",
    '    AND (buyer.id = c.id OR LOWER(TRIM(buyer.email)) = LOWER(TRIM(c.email)))',
    ')',
    'ORDER BY recent.created_at DESC, recent.id DESC'
  ].join(' ')).all(eventId, eventId, establishmentId);
  const unique = new Map();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || unique.has(email)) continue;
    unique.set(email, { ...row, email });
  }
  return [...unique.values()];
}

function whatsappNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = '593' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('9')) digits = '593' + digits;
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

export function registerTicketingPromotionRoutes(app, db, { requireTicketAdmin, expireOldOrders, ticketingTransporter, publicAppUrl }) {
  const running = new Set();

  function summary(campaignId, establishmentId) {
    const campaign = db.prepare(
      'SELECT id, event_id, subject, status, created_at, completed_at FROM ticketing_promotion_campaigns WHERE id = ? AND establishment_id = ?'
    ).get(campaignId, establishmentId);
    if (!campaign) return null;
    const counts = db.prepare([
      'SELECT COUNT(*) AS total,',
      "SUM(CASE WHEN status = 'queued' OR status = 'sending' THEN 1 ELSE 0 END) AS pending,",
      "SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,",
      "SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,",
      "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed",
      'FROM ticketing_promotion_deliveries WHERE campaign_id = ?'
    ].join(' ')).get(campaignId);
    const failedRecipients = db.prepare([
      'SELECT d.email, d.reason FROM ticketing_promotion_deliveries d',
      "WHERE d.campaign_id = ? AND d.status = 'failed' ORDER BY d.id LIMIT 20"
    ].join(' ')).all(campaignId);
    return { ...campaign, total: counts.total, pending: counts.pending || 0,
      sent: counts.sent || 0, skipped: counts.skipped || 0, failed: counts.failed || 0,
      failed_recipients: failedRecipients };
  }

  async function runCampaign(campaignId) {
    if (running.has(campaignId)) return;
    running.add(campaignId);
    try {
      const campaign = db.prepare('SELECT * FROM ticketing_promotion_campaigns WHERE id = ?').get(campaignId);
      if (!campaign || campaign.status === 'completed') return;
      db.prepare("UPDATE ticketing_promotion_campaigns SET status = 'running' WHERE id = ?").run(campaignId);
      const transporter = ticketingTransporter();
      const deliveries = db.prepare(
        "SELECT * FROM ticketing_promotion_deliveries WHERE campaign_id = ? AND status = 'queued' ORDER BY id"
      ).all(campaignId);
      for (const delivery of deliveries) {
        expireOldOrders(campaign.establishment_id);
        const eligible = promotionRecipients(db, campaign.establishment_id, campaign.event_id || 0)
          .find((recipient) => recipient.id === delivery.customer_id && recipient.email === delivery.email);
        if (!eligible) {
          db.prepare("UPDATE ticketing_promotion_deliveries SET status = 'skipped', reason = 'Compra confirmada, pago en curso o contacto ya no elegible' WHERE id = ?")
            .run(delivery.id);
          continue;
        }
        db.prepare("UPDATE ticketing_promotion_deliveries SET status = 'sending' WHERE id = ?").run(delivery.id);
        try {
          if (!transporter) throw new Error('SMTP no configurado');
          let token = db.prepare('SELECT marketing_unsubscribe_token AS token FROM ticketing_customers WHERE id = ?')
            .get(delivery.customer_id)?.token;
          if (!token) {
            token = crypto.randomBytes(24).toString('hex');
            db.prepare('UPDATE ticketing_customers SET marketing_unsubscribe_token = ? WHERE id = ?')
              .run(token, delivery.customer_id);
          }
          const unsubscribeUrl = publicAppUrl() + BASE + '/promotions/unsubscribe/' + token;
          const attachments = [];
          let image = '';
          if (campaign.file_data) {
            const attachment = { filename: campaign.file_name, content: Buffer.from(campaign.file_data, 'base64'),
              contentType: campaign.file_mime };
            if (campaign.file_mime.startsWith('image/')) {
              attachment.cid = 'promotion@protickets';
              image = '<p><img src="cid:promotion@protickets" alt="Promoción" style="max-width:100%;height:auto;border-radius:12px"></p>';
            }
            attachments.push(attachment);
          }
          const html = [
            '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#202024">',
            '<h1 style="background:#171717;color:#fff;padding:20px;border-radius:10px">ProTickets</h1>',
            '<p>Hola ' + escapeHtml(eligible.name) + ',</p>',
            '<p style="line-height:1.6;white-space:pre-line">' + escapeHtml(campaign.message) + '</p>',
            image,
            '<p><a href="' + escapeHtml(campaign.link_url) + '" style="display:inline-block;background:#e93251;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none">Ver eventos</a></p>',
            '<p style="font-size:12px;color:#777">Si no deseas recibir más promociones, ',
            '<a href="' + escapeHtml(unsubscribeUrl) + '">deja de recibirlas aquí</a>.</p></div>'
          ].join('');
          await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: delivery.email, subject: campaign.subject,
            text: 'Hola ' + eligible.name + ',\n\n' + campaign.message + '\n\n' + campaign.link_url
              + '\n\nDejar de recibir promociones: ' + unsubscribeUrl,
            html, attachments
          });
          db.prepare("UPDATE ticketing_promotion_deliveries SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?")
            .run(delivery.id);
        } catch (error) {
          db.prepare("UPDATE ticketing_promotion_deliveries SET status = 'failed', reason = ? WHERE id = ?")
            .run(clean(error.message, 180), delivery.id);
        }
      }
      db.prepare("UPDATE ticketing_promotion_campaigns SET status = 'completed', file_data = NULL, completed_at = datetime('now','localtime') WHERE id = ?")
        .run(campaignId);
    } finally { running.delete(campaignId); }
  }

  app.get(BASE + '/promotions/unsubscribe/:token', (req, res) => {
    const token = clean(req.params.token, 80);
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send('Enlace no válido');
    if (!db.prepare('SELECT id FROM ticketing_customers WHERE marketing_unsubscribe_token = ?').get(token))
      return res.status(404).send('Enlace no válido');
    res.type('html').send('<!doctype html><html lang="es"><meta charset="utf-8"><title>ProTickets</title><body style="font-family:Arial;padding:40px"><h1>Promociones de ProTickets</h1><p>Confirma si deseas dejar de recibir nuestros correos promocionales.</p><form method="post"><button type="submit" style="padding:12px 18px">Dejar de recibir promociones</button></form></body></html>');
  });

  app.post(BASE + '/promotions/unsubscribe/:token', (req, res) => {
    const token = clean(req.params.token, 80);
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send('Enlace no válido');
    const updated = db.prepare('UPDATE ticketing_customers SET marketing_opt_out = 1 WHERE marketing_unsubscribe_token = ?')
      .run(token);
    if (!updated.changes) return res.status(404).send('Enlace no válido');
    res.type('html').send('<!doctype html><html lang="es"><meta charset="utf-8"><title>ProTickets</title><body style="font-family:Arial;padding:40px"><h1>Listo</h1><p>Ya no recibirás correos promocionales de ProTickets.</p></body></html>');
  });

  app.get(BASE + '/admin/promotions/recipients', requireTicketAdmin, (req, res) => {
    const eventId = eventIdFrom(req.query.event_id);
    if (eventId === null) return res.status(400).json({ message: 'Evento no válido' });
    expireOldOrders(req.ticketEstablishment.id);
    res.json({ recipients: promotionRecipients(db, req.ticketEstablishment.id, eventId)
      .map((recipient) => ({ ...recipient, has_whatsapp: Boolean(whatsappNumber(recipient.phone)) })) });
  });

  app.get(BASE + '/admin/promotions/recipients/:id/whatsapp', requireTicketAdmin, (req, res) => {
    const eventId = eventIdFrom(req.query.event_id);
    if (eventId === null) return res.status(400).json({ message: 'Evento no válido' });
    expireOldOrders(req.ticketEstablishment.id);
    const recipient = promotionRecipients(db, req.ticketEstablishment.id, eventId)
      .find((item) => item.id === Number(req.params.id));
    if (!recipient) return res.status(409).json({ message: 'Este cliente ya no cumple las condiciones para la promoción' });
    const phone = whatsappNumber(recipient.phone);
    if (!phone) return res.status(400).json({ message: 'Este cliente no tiene un WhatsApp válido' });
    res.json({ phone, name: recipient.name });
  });

  app.post(BASE + '/admin/promotions/email', requireTicketAdmin, (req, res) => {
    const eventId = eventIdFrom(req.body.event_id);
    const subject = clean(req.body.subject, 140);
    const message = clean(req.body.message, 5000);
    const requestedLink = clean(req.body.link_url, 1200);
    const file = fileFromBody(req.body.file);
    const key = clean(req.body.request_key, 80);
    if (eventId === null || (eventId && !db.prepare('SELECT id FROM ticketing_events WHERE id = ? AND establishment_id = ?').get(eventId, req.ticketEstablishment.id)))
      return res.status(400).json({ message: 'Evento no válido' });
    if (!subject || !message || !/^[a-zA-Z0-9-]{12,80}$/.test(key))
      return res.status(400).json({ message: 'Completa el asunto y mensaje de la campaña' });
    if (file === false) return res.status(400).json({ message: 'Adjunta una imagen o PDF de hasta 5 MB' });
    if (requestedLink && !validLink(requestedLink)) return res.status(400).json({ message: 'El enlace debe comenzar con https:// o http://' });
    const existing = db.prepare('SELECT id FROM ticketing_promotion_campaigns WHERE establishment_id = ? AND request_key = ?')
      .get(req.ticketEstablishment.id, key);
    if (existing) return res.json(summary(existing.id, req.ticketEstablishment.id));
    if (!ticketingTransporter()) return res.status(503).json({ message: 'Configura el correo SMTP antes de enviar promociones' });
    expireOldOrders(req.ticketEstablishment.id);
    const recipients = promotionRecipients(db, req.ticketEstablishment.id, eventId);
    if (!recipients.length) return res.status(409).json({ message: 'No hay clientes elegibles para esta campaña' });
    const event = eventId ? db.prepare('SELECT slug FROM ticketing_events WHERE id = ?').get(eventId) : null;
    const link = validLink(requestedLink) || publicAppUrl() + '/tickets' + (event ? '/evento/' + encodeURIComponent(event.slug) : '');
    const campaignId = db.transaction(() => {
      const campaign = db.prepare([
        'INSERT INTO ticketing_promotion_campaigns',
        '(establishment_id, request_key, event_id, subject, message, link_url, file_name, file_mime, file_data)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join(' ')).run(req.ticketEstablishment.id, key, eventId || null, subject, message, link,
        file?.name || null, file?.mime || null, file?.data || null);
      const insert = db.prepare('INSERT INTO ticketing_promotion_deliveries (campaign_id, customer_id, email) VALUES (?, ?, ?)');
      for (const recipient of recipients) insert.run(campaign.lastInsertRowid, recipient.id, recipient.email);
      return Number(campaign.lastInsertRowid);
    })();
    res.status(202).json(summary(campaignId, req.ticketEstablishment.id));
    void runCampaign(campaignId).catch((error) => {
      db.prepare("UPDATE ticketing_promotion_campaigns SET status = 'failed', file_data = NULL WHERE id = ?").run(campaignId);
      console.error('ProTickets promotion delivery failed:', error);
    });
  });

  app.get(BASE + '/admin/promotions/email/:id', requireTicketAdmin, (req, res) => {
    const campaign = summary(Number(req.params.id), req.ticketEstablishment.id);
    if (!campaign) return res.status(404).json({ message: 'Campaña no encontrada' });
    res.json(campaign);
  });

  for (const campaign of db.prepare("SELECT id FROM ticketing_promotion_campaigns WHERE status IN ('queued','running')").all()) {
    db.prepare("UPDATE ticketing_promotion_deliveries SET status = 'failed', reason = 'Entrega interrumpida; revisar antes de reenviar' WHERE campaign_id = ? AND status = 'sending'")
      .run(campaign.id);
    setImmediate(() => { void runCampaign(campaign.id).catch((error) => {
      db.prepare("UPDATE ticketing_promotion_campaigns SET status = 'failed', file_data = NULL WHERE id = ?").run(campaign.id);
      console.error('ProTickets promotion resume failed:', error);
    }); });
  }
}
