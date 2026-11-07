import crypto from 'node:crypto';
import { isIP } from 'node:net';

const ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
const workers = new WeakSet();
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function initTicketingTrackingDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticketing_tracking_settings (
      establishment_id INTEGER PRIMARY KEY REFERENCES establishments(id),
      tiktok_pixel_id TEXT NOT NULL DEFAULT '',
      tiktok_token_ciphertext TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS ticketing_order_attribution (
      order_id INTEGER PRIMARY KEY REFERENCES ticketing_orders(id),
      user_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticketing_conversion_events (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL UNIQUE REFERENCES ticketing_orders(id),
      establishment_id INTEGER NOT NULL REFERENCES establishments(id),
      pixel_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER,
      last_error TEXT NOT NULL DEFAULT ''
    );
  `);
}

function tokenKey() {
  if (!process.env.JWT_SECRET) throw new Error('Falta configurar el cifrado del servidor');
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

function accessToken(settings) {
  if (!settings?.tiktok_token_ciphertext) return process.env.TIKTOK_EVENTS_ACCESS_TOKEN || '';
  const [iv, tag, data] = settings.tiktok_token_ciphertext.split('.').map((part) => Buffer.from(part, 'base64url'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}

export function ticketingTrackingSettings(db, establishmentId) {
  const settings = db.prepare('SELECT * FROM ticketing_tracking_settings WHERE establishment_id = ?').get(establishmentId);
  return { ...settings, tiktok_pixel_id: settings?.tiktok_pixel_id || process.env.TIKTOK_PIXEL_ID || '' };
}

export function publicTrackingSettings(db, establishmentId) {
  return { tiktok_pixel_id: ticketingTrackingSettings(db, establishmentId).tiktok_pixel_id };
}

export function saveTrackingSettings(db, establishmentId, input) {
  const pixel = text(input.tiktok_pixel_id, 80);
  if (pixel && !/^[A-Za-z0-9]{10,40}$/.test(pixel)) throw new Error('El ID del píxel de TikTok no es válido');
  const token = text(input.tiktok_access_token, 4000);
  const current = ticketingTrackingSettings(db, establishmentId);
  let encrypted = current.tiktok_token_ciphertext || '';
  if (input.remove_access_token) encrypted = '';
  else if (token) encrypted = encryptToken(token);
  db.prepare(`INSERT INTO ticketing_tracking_settings (establishment_id, tiktok_pixel_id, tiktok_token_ciphertext)
    VALUES (?, ?, ?) ON CONFLICT(establishment_id) DO UPDATE SET
    tiktok_pixel_id = excluded.tiktok_pixel_id, tiktok_token_ciphertext = excluded.tiktok_token_ciphertext`)
    .run(establishmentId, pixel, encrypted);
}

export function trackingDiagnostics(db, establishmentId) {
  const settings = ticketingTrackingSettings(db, establishmentId);
  const counts = db.prepare(`SELECT COUNT(*) AS total, COUNT(sent_at) AS sent,
    SUM(CASE WHEN sent_at IS NULL AND attempts >= 10 THEN 1 ELSE 0 END) AS failed,
    MAX(sent_at) AS last_sent_at FROM ticketing_conversion_events WHERE establishment_id = ?`).get(establishmentId);
  return { tiktok_pixel_id: settings.tiktok_pixel_id,
    events_api_configured: Boolean(settings.tiktok_token_ciphertext || process.env.TIKTOK_EVENTS_ACCESS_TOKEN),
    sent: counts.sent, pending: counts.total - counts.sent - Number(counts.failed || 0),
    failed: Number(counts.failed || 0), last_sent_at: counts.last_sent_at };
}

export function saveOrderAttribution(db, orderId, req) {
  const input = req.body?.tracking || {};
  const user = {};
  const ttclid = text(input.ttclid, 2000);
  const ttp = text(input.ttp, 300);
  if (/^[A-Za-z0-9._~-]+$/.test(ttclid)) user.ttclid = ttclid;
  if (/^[A-Za-z0-9._~-]+$/.test(ttp)) user.ttp = ttp;
  const ip = String(req.get('x-forwarded-for')?.split(',')[0].trim() || req.ip || '').replace(/^::ffff:/, '');
  if (isIP(ip)) user.ip = ip;
  const agent = text(req.get('user-agent'), 1000);
  if (agent) user.user_agent = agent;
  db.prepare('INSERT INTO ticketing_order_attribution (order_id, user_json) VALUES (?, ?)')
    .run(orderId, JSON.stringify(user));
}

export function enqueueTikTokPurchase(db, orderId) {
  const order = db.prepare(`SELECT o.*, e.slug FROM ticketing_orders o
    JOIN ticketing_events e ON e.id = o.event_id WHERE o.id = ? AND o.payment_status = 'paid'`).get(orderId);
  if (!order) return;
  const pixel = ticketingTrackingSettings(db, order.establishment_id).tiktok_pixel_id;
  if (!pixel) return;
  const items = db.prepare('SELECT * FROM ticketing_order_items WHERE order_id = ?').all(orderId);
  const attribution = db.prepare('SELECT user_json FROM ticketing_order_attribution WHERE order_id = ?').get(orderId);
  const origin = process.env.PUBLIC_APP_URL || 'https://www.promotersec.com';
  const event = {
    event: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: `protickets-${order.order_number}`,
    user: attribution ? JSON.parse(attribution.user_json) : {},
    page: { url: new URL(`/tickets/evento/${encodeURIComponent(order.slug)}`, origin).href },
    properties: { currency: 'USD', value: Number(order.total), content_type: 'product',
      contents: items.map((item) => ({ content_id: String(item.ticket_type_id), content_name: item.ticket_name,
        quantity: Number(item.quantity), price: Number(item.unit_price) })) }
  };
  db.prepare(`INSERT OR IGNORE INTO ticketing_conversion_events
    (order_id, establishment_id, pixel_id, event_id, event_json) VALUES (?, ?, ?, ?, ?)`)
    .run(orderId, order.establishment_id, pixel, event.event_id, JSON.stringify(event));
}

export function browserPurchase(db, orderId) {
  const saved = db.prepare(`SELECT c.* FROM ticketing_conversion_events c
    JOIN ticketing_orders o ON o.id = c.order_id WHERE c.order_id = ? AND o.payment_status = 'paid'`).get(orderId);
  if (!saved) return null;
  const event = JSON.parse(saved.event_json);
  if (Date.now() - event.event_time * 1000 >= 24 * 60 * 60 * 1000) return null;
  return { pixel_id: saved.pixel_id, event_id: event.event_id, properties: event.properties };
}

export async function deliverTikTokPurchases(db, now = Date.now()) {
  if (workers.has(db)) return;
  workers.add(db);
  try {
    const due = db.prepare(`SELECT c.* FROM ticketing_conversion_events c JOIN ticketing_orders o ON o.id = c.order_id
      WHERE c.sent_at IS NULL AND c.attempts < 10 AND c.next_attempt_at <= ?
        AND o.payment_status = 'paid' ORDER BY c.id LIMIT 10`).all(now);
    for (const row of due) {
      const settings = ticketingTrackingSettings(db, row.establishment_id);
      if (settings.tiktok_pixel_id !== row.pixel_id) continue;
      let token;
      try { token = accessToken(settings); } catch { continue; }
      if (!token) continue;
      const event = JSON.parse(row.event_json);
      if (now - event.event_time * 1000 >= 47 * 60 * 60 * 1000) {
        db.prepare("UPDATE ticketing_conversion_events SET attempts = 10, last_error = 'Plazo de envío vencido' WHERE id = ?").run(row.id);
        continue;
      }
      const claim = db.prepare(`UPDATE ticketing_conversion_events SET attempts = attempts + 1, next_attempt_at = ?
        WHERE id = ? AND sent_at IS NULL AND next_attempt_at <= ? AND attempts = ?`)
        .run(now + 60000, row.id, now, row.attempts);
      if (!claim.changes) continue;
      try {
        const response = await fetch(ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(12000),
          headers: { 'Content-Type': 'application/json', 'Access-Token': token },
          body: JSON.stringify({ event_source: 'web', event_source_id: row.pixel_id, data: [event] }) });
        const result = await response.json();
        if (!response.ok || Number(result.code) !== 0 || result.code === undefined) throw new Error('TikTok no confirmó el evento');
        db.prepare("UPDATE ticketing_conversion_events SET sent_at = ?, last_error = '' WHERE id = ?").run(now, row.id);
      } catch {
        db.prepare(`UPDATE ticketing_conversion_events SET next_attempt_at = ?, last_error = 'No se pudo confirmar el envío a TikTok'
          WHERE id = ?`).run(now + Math.min(3600000, 60000 * 2 ** row.attempts), row.id);
      }
    }
  } finally { workers.delete(db); }
}

export function startTicketingTrackingWorker(db) {
  const tick = () => { void deliverTikTokPurchases(db).catch(() => console.error('No se pudo procesar la cola de conversiones de TikTok')); };
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
