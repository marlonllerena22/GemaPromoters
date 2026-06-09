import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToken, requireAdmin, requireAuth, requirePromoter, requireSupreme } from './auth.js';
import { db, initDb, normalizeCode, normalizeLookup, toMoney } from './db.js';

dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '6mb' }));

function getDefaultEstablishment() {
  return db.prepare("SELECT * FROM establishments WHERE name = 'GEMASHOW'").get()
    || db.prepare("SELECT * FROM establishments WHERE status = 'active' ORDER BY id ASC").get()
    || db.prepare('SELECT * FROM establishments ORDER BY id ASC').get();
}

function getRequestEstablishmentId(req) {
  if (req.user?.role === 'promoter' && req.user.establishmentId) {
    return req.user.establishmentId;
  }

  if (req.user?.role === 'admin' && req.user.establishmentId) {
    return req.user.establishmentId;
  }

  const requested = Number(req.query.establishment_id || req.body?.establishment_id || 0);
  if (requested) {
    const establishment = db.prepare('SELECT id FROM establishments WHERE id = ?').get(requested);
    if (establishment) {
      return establishment.id;
    }
  }

  return getDefaultEstablishment()?.id || 1;
}

function getActiveEvent(establishmentId = getDefaultEstablishment()?.id || 1) {
  return db.prepare("SELECT * FROM events WHERE establishment_id = ? AND is_active = 1 AND status = 'active' ORDER BY id DESC").get(establishmentId)
    || db.prepare("SELECT * FROM events WHERE establishment_id = ? AND status = 'active' ORDER BY id DESC").get(establishmentId)
    || db.prepare('SELECT * FROM events WHERE establishment_id = ? ORDER BY id DESC').get(establishmentId);
}

function getRequestEventId(req) {
  const establishmentId = getRequestEstablishmentId(req);
  const requested = Number(req.query.event_id || req.body?.event_id || 0);
  if (requested) {
    const event = db.prepare('SELECT id FROM events WHERE id = ? AND establishment_id = ?').get(requested, establishmentId);
    if (event) {
      return event.id;
    }
  }

  return getActiveEvent(establishmentId)?.id || 1;
}

function getDashboard(eventId, establishmentId) {
  const activePromoters = db
    .prepare("SELECT COUNT(*) AS total FROM promoters WHERE establishment_id = ? AND status = 'active'")
    .get(establishmentId).total;
  const totals = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS sold, COALESCE(SUM(commission), 0) AS commission FROM sales WHERE event_id = ? AND payment_status = 'paid'")
    .get(eventId);
  const todaySales = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS sold FROM sales WHERE event_id = ? AND payment_status = 'paid' AND sale_date = date('now', 'localtime')")
    .get(eventId).sold;

  return {
    activePromoters,
    totalSold: toMoney(totals.sold),
    totalCommissions: toMoney(totals.commission),
    todaySales: toMoney(todaySales)
  };
}

function findActivePromoterByCode(code) {
  const lookup = normalizeLookup(code);
  return db
    .prepare(
      `SELECT promoters.id, promoters.name, promoters.instagram, promoters.whatsapp, promoters.photo_url, promoters.code,
              establishments.name AS establishment_name, establishments.display_name AS establishment_display_name
       FROM promoters
       JOIN establishments ON establishments.id = promoters.establishment_id
       WHERE promoters.status = 'active' AND establishments.status = 'active'`
    )
    .all()
    .find((promoter) => normalizeLookup(promoter.code) === lookup);
}

function findPromoterByCode(code, establishmentId = null) {
  const lookup = normalizeLookup(code);
  if (!lookup) {
    return null;
  }

  const rows = establishmentId
    ? db.prepare('SELECT id, name, code FROM promoters WHERE establishment_id = ?').all(establishmentId)
    : db.prepare('SELECT id, name, code FROM promoters').all();
  return rows
    .find((promoter) => normalizeLookup(promoter.code) === lookup);
}

function findActivePromoterForLogin(username, password) {
  const lookup = normalizeLookup(username);
  const cleanPassword = String(password || '').trim();
  return db
    .prepare("SELECT id, establishment_id, name, username, code FROM promoters WHERE status = 'active' AND password = ?")
    .all(cleanPassword)
    .find((promoter) => normalizeLookup(promoter.username) === lookup || normalizeLookup(promoter.code) === lookup);
}

function buildPromoterCode(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .map((part) => normalizeLookup(part))
    .filter(Boolean);
  const firstName = parts[0] || 'PROMOTOR';
  const firstLastName = parts.length > 1 ? parts[1] : '';
  const base = `GEMA-${firstName}${firstLastName}`;
  let candidate = base;
  let counter = 2;

  while (db.prepare('SELECT id FROM promoters WHERE code = ?').get(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function getLocationRule(locationName, eventId = getActiveEvent()?.id || 1) {
  const lookup = normalizeLookup(locationName);
  const rule = db
    .prepare('SELECT * FROM event_locations WHERE event_id = ?')
    .all(eventId)
    .find((location) => normalizeLookup(location.name) === lookup);

  return rule || {
    name: locationName,
    price: 0,
    commission_type: 'percent',
    commission_value: 3,
    commission_min_quantity: 1
  };
}

function calculateCommission(rule, unitPrice, tickets) {
  if (tickets <= 0) {
    return 0;
  }

  if (rule.commission_type === 'fixed') {
    return toMoney(Number(rule.commission_value || 0) * tickets);
  }

  return toMoney(Number(unitPrice || 0) * tickets * (Number(rule.commission_value || 0) / 100));
}

function recalculateCommissions(promoterId, locationName, eventId = getActiveEvent()?.id || 1) {
  const rule = getLocationRule(locationName, eventId);
  const threshold = Math.max(1, Number(rule.commission_min_quantity || 1));
  const sales = db
    .prepare(
      `SELECT id, quantity, unit_price, payment_status
       FROM sales
       WHERE promoter_id = ? AND location = ? AND event_id = ?
       ORDER BY sale_date ASC, id ASC`
    )
    .all(promoterId, locationName, eventId);

  let paidTickets = 0;

  for (const sale of sales) {
    if (sale.payment_status !== 'paid') {
      db.prepare('UPDATE sales SET commission = 0 WHERE id = ?').run(sale.id);
      continue;
    }

    const before = paidTickets;
    paidTickets += Number(sale.quantity || 0);
    const commissionableBefore = Math.max(0, before - threshold + 1);
    const commissionableAfter = Math.max(0, paidTickets - threshold + 1);
    const commissionableTickets = commissionableAfter - commissionableBefore;
    const commission = calculateCommission(rule, sale.unit_price, commissionableTickets);

    db.prepare('UPDATE sales SET commission = ? WHERE id = ?').run(commission, sale.id);
  }
}

function recalculateAllCommissions() {
  const groups = db.prepare('SELECT DISTINCT promoter_id, location, event_id FROM sales').all();
  for (const group of groups) {
    recalculateCommissions(group.promoter_id, group.location, group.event_id);
  }
}

function getLevelSettings(eventId = getActiveEvent()?.id || 1) {
  seedEventSettingsFromActive(eventId);
  const rows = db.prepare("SELECT key, value FROM event_settings WHERE event_id = ? AND (key LIKE 'level_%' OR key = 'referral_points')").all(eventId);
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const benefitsFrom = (key, fallback) =>
    String(settings[key] || fallback)
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    bronze: Number(settings.level_bronze_min ?? 1),
    silver: Number(settings.level_silver_min ?? 10),
    diamond: Number(settings.level_diamond_min ?? 25),
    referralPoints: Number(settings.referral_points ?? 3),
    benefits: {
      bronze: benefitsFrom(
        'level_bronze_benefits',
        'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como promotor Bronce'
      ),
      silver: benefitsFrom(
        'level_silver_benefits',
        'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Plata en el perfil'
      ),
      diamond: benefitsFrom(
        'level_diamond_benefits',
        'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Diamante GEMASHOW'
      )
    }
  };
}

function getLevelCatalog(settings = getLevelSettings()) {
  return [
    {
      key: 'bronze',
      name: 'Bronce',
      min: settings.bronze,
      benefits: settings.benefits.bronze
    },
    {
      key: 'silver',
      name: 'Plata',
      min: settings.silver,
      benefits: settings.benefits.silver
    },
    {
      key: 'diamond',
      name: 'Diamante',
      min: settings.diamond,
      benefits: settings.benefits.diamond
    }
  ];
}

function getPromoterLevel(promoterId, eventId = getActiveEvent()?.id || 1) {
  const settings = getLevelSettings(eventId);
  const paidSalesRows = db
    .prepare("SELECT quantity, location FROM sales WHERE promoter_id = ? AND event_id = ? AND payment_status = 'paid'")
    .all(promoterId, eventId);
  const promoter = db.prepare('SELECT manual_points FROM promoters WHERE id = ?').get(promoterId);
  const referralCount = db.prepare('SELECT COUNT(*) AS total FROM promoters WHERE referred_by_promoter_id = ?').get(promoterId).total;
  const locations = db.prepare('SELECT name, level_points FROM event_locations WHERE event_id = ?').all(eventId);
  const paidSales = paidSalesRows.length;
  const salesPoints = paidSalesRows.reduce((sum, sale) => {
    const location = locations.find((item) => normalizeLookup(item.name) === normalizeLookup(sale.location));
    return sum + Number(sale.quantity || 0) * Number(location?.level_points ?? 1);
  }, 0);
  const manualPoints = Number(promoter?.manual_points || 0);
  const referralPoints = referralCount * Number(settings.referralPoints || 0);
  const levelPoints = salesPoints + manualPoints + referralPoints;

  let level = {
    key: 'starter',
    name: 'Inicial',
    description: 'Promotor oficial GEMASHOW'
  };

  if (levelPoints >= settings.bronze) {
    level = { key: 'bronze', name: 'Bronce', description: 'Promotor destacado GEMASHOW' };
  }
  if (levelPoints >= settings.silver) {
    level = { key: 'silver', name: 'Plata', description: 'Promotor elite GEMASHOW' };
  }
  if (levelPoints >= settings.diamond) {
    level = { key: 'diamond', name: 'Diamante', description: 'Promotor top GEMASHOW' };
  }

  return {
    ...level,
    paidSales,
    referralCount,
    salesPoints: Math.round(salesPoints * 100) / 100,
    manualPoints: Math.round(manualPoints * 100) / 100,
    referralPoints: Math.round(referralPoints * 100) / 100,
    levelPoints: Math.round(levelPoints * 100) / 100,
    settings,
    catalog: getLevelCatalog(settings)
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'GemaPromoters' });
});

function seedEventSettingsFromActive(eventId) {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM event_settings WHERE event_id = ?').get(eventId).total;
  if (existing) {
    return;
  }

  const event = db.prepare('SELECT establishment_id FROM events WHERE id = ?').get(eventId);
  const sourceEvent = getActiveEvent(event?.establishment_id || getDefaultEstablishment()?.id || 1);
  const sourceRows = sourceEvent
    ? db.prepare('SELECT key, value FROM event_settings WHERE event_id = ?').all(sourceEvent.id)
    : [];
  const save = db.prepare('INSERT OR IGNORE INTO event_settings (event_id, key, value) VALUES (?, ?, ?)');
  const defaults = sourceRows.length ? sourceRows : [
    { key: 'level_bronze_min', value: '1' },
    { key: 'level_silver_min', value: '10' },
    { key: 'level_diamond_min', value: '25' },
    { key: 'referral_points', value: '3' },
    { key: 'level_bronze_benefits', value: 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como promotor Bronce' },
    { key: 'level_silver_benefits', value: 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Plata en el perfil' },
    { key: 'level_diamond_benefits', value: 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Diamante GEMASHOW' }
  ];

  for (const row of defaults) {
    save.run(eventId, row.key, row.value);
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const supremeUser = process.env.SUPREME_USER || 'promoters';
  const supremePassword = process.env.SUPREME_PASSWORD || 'promoters123';

  if (username === supremeUser && password === supremePassword) {
    return res.json({
      token: createToken({ role: 'supreme', username }),
      user: { username, role: 'supreme', name: 'PROMOTERS' }
    });
  }

  if (username === adminUser && password === adminPassword) {
    const establishment = getDefaultEstablishment();
    return res.json({
      token: createToken({ role: 'admin', username, establishmentId: establishment?.id || 1 }),
      user: { username, role: 'admin', establishment_id: establishment?.id || 1, establishment_name: establishment?.name || 'GEMASHOW' }
    });
  }

  return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
});

app.post('/api/auth/promoter-login', (req, res) => {
  const { username, password } = req.body;
  const promoter = findActivePromoterForLogin(username, password);

  if (!promoter) {
    return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
  }

  return res.json({
    token: createToken({ role: 'promoter', promoterId: promoter.id, establishmentId: promoter.establishment_id, username: promoter.username }),
    user: { role: 'promoter', id: promoter.id, name: promoter.name, code: promoter.code, establishment_id: promoter.establishment_id }
  });
});

app.get('/api/establishments', requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT * FROM establishments ORDER BY status ASC, created_at ASC, id ASC').all());
});

app.post('/api/establishments', requireSupreme, (req, res) => {
  const name = String(req.body.name || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const promoterSalesEnabled = req.body.promoter_sales_enabled ? 1 : 0;

  if (!name) {
    return res.status(400).json({ message: 'Nombre del establecimiento obligatorio' });
  }

  try {
    const result = db
      .prepare('INSERT INTO establishments (name, display_name, status, promoter_sales_enabled) VALUES (?, ?, ?, ?)')
      .run(name, displayName || name, status, promoterSalesEnabled);
    const eventResult = db
      .prepare('INSERT INTO events (establishment_id, name, description, status, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(result.lastInsertRowid, name.toUpperCase(), `Evento principal ${name}`, 'active');
    seedEventSettingsFromActive(eventResult.lastInsertRowid);
    return res.status(201).json(db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ message: 'El establecimiento ya existe' });
  }
});

app.put('/api/establishments/:id', requireSupreme, (req, res) => {
  const name = String(req.body.name || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const promoterSalesEnabled = req.body.promoter_sales_enabled ? 1 : 0;

  if (!name) {
    return res.status(400).json({ message: 'Nombre del establecimiento obligatorio' });
  }

  try {
    const result = db
      .prepare('UPDATE establishments SET name = ?, display_name = ?, status = ?, promoter_sales_enabled = ? WHERE id = ?')
      .run(name, displayName || name, status, promoterSalesEnabled, req.params.id);
    if (!result.changes) {
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    }
    return res.json(db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.params.id));
  } catch {
    return res.status(409).json({ message: 'El establecimiento ya existe' });
  }
});

app.get('/api/events', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  res.json(db.prepare('SELECT * FROM events WHERE establishment_id = ? ORDER BY is_active DESC, created_at DESC, id DESC').all(establishmentId));
});

app.post('/api/events', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';

  if (!name) {
    return res.status(400).json({ message: 'Nombre del evento obligatorio' });
  }

  try {
    const result = db.prepare('INSERT INTO events (establishment_id, name, description, status, is_active) VALUES (?, ?, ?, ?, 0)').run(establishmentId, name, description, status);
    seedEventSettingsFromActive(result.lastInsertRowid);
    return res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ message: 'El evento ya existe' });
  }
});

app.put('/api/events/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';

  if (!name) {
    return res.status(400).json({ message: 'Nombre del evento obligatorio' });
  }

  try {
    const result = db.prepare('UPDATE events SET name = ?, description = ?, status = ? WHERE id = ? AND establishment_id = ?').run(name, description, status, id, establishmentId);
    if (!result.changes) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }
    return res.json(db.prepare('SELECT * FROM events WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
  } catch {
    return res.status(409).json({ message: 'El evento ya existe' });
  }
});

app.patch('/api/events/:id/active', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const event = db.prepare("SELECT * FROM events WHERE id = ? AND establishment_id = ? AND status = 'active'").get(req.params.id, establishmentId);
  if (!event) {
    return res.status(404).json({ message: 'Evento activo no encontrado' });
  }

  db.prepare('UPDATE events SET is_active = 0 WHERE establishment_id = ?').run(establishmentId);
  db.prepare('UPDATE events SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id));
});

app.get('/api/event-banners', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  res.json(db.prepare('SELECT * FROM event_banners WHERE event_id = ? ORDER BY sort_order ASC, id DESC').all(eventId));
});

app.post('/api/event-banners', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const imageUrl = String(req.body.image_url || '').trim();
  const title = String(req.body.title || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const sortOrder = Number(req.body.sort_order || 0);

  if (!imageUrl) {
    return res.status(400).json({ message: 'Selecciona una imagen para el banner' });
  }

  const result = db
    .prepare('INSERT INTO event_banners (event_id, image_url, title, status, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, imageUrl, title, status, sortOrder);
  res.status(201).json(db.prepare('SELECT * FROM event_banners WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/event-banners/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const imageUrl = String(req.body.image_url || '').trim();
  const title = String(req.body.title || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const sortOrder = Number(req.body.sort_order || 0);

  if (!imageUrl) {
    return res.status(400).json({ message: 'Selecciona una imagen para el banner' });
  }

  const result = db
    .prepare('UPDATE event_banners SET image_url = ?, title = ?, status = ?, sort_order = ? WHERE id = ? AND event_id = ?')
    .run(imageUrl, title, status, sortOrder, req.params.id, eventId);
  if (!result.changes) {
    return res.status(404).json({ message: 'Banner no encontrado' });
  }
  res.json(db.prepare('SELECT * FROM event_banners WHERE id = ?').get(req.params.id));
});

app.delete('/api/event-banners/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const result = db.prepare('DELETE FROM event_banners WHERE id = ? AND event_id = ?').run(req.params.id, eventId);
  if (!result.changes) {
    return res.status(404).json({ message: 'Banner no encontrado' });
  }
  res.json({ ok: true });
});

app.get('/api/dashboard', requireAdmin, (req, res) => {
  res.json(getDashboard(getRequestEventId(req), getRequestEstablishmentId(req)));
});

app.get('/api/promoters', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const settings = getLevelSettings(getRequestEventId(req));
  const promoters = db
    .prepare(
      `SELECT promoters.*,
              referrer.code AS referrer_code,
              referrer.name AS referrer_name,
              (SELECT COUNT(*) FROM promoters AS referred WHERE referred.referred_by_promoter_id = promoters.id) AS referral_count
       FROM promoters
       LEFT JOIN promoters AS referrer ON referrer.id = promoters.referred_by_promoter_id
       WHERE promoters.establishment_id = ?
       ORDER BY promoters.registered_at DESC, promoters.id DESC`
    )
    .all(establishmentId);
  res.json(
    promoters.map((promoter) => ({
      ...promoter,
      referral_points_earned: toMoney(Number(promoter.referral_count || 0) * Number(settings.referralPoints || 0))
    }))
  );
});

app.post('/api/promoters', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const { name, cedula, whatsapp, instagram, photo_url, referral_code, status = 'active' } = req.body;
  const normalizedCode = buildPromoterCode(name);
  const normalizedUsername = normalizedCode;
  const normalizedPassword = String(cedula || '').trim();
  const referrer = findPromoterByCode(referral_code, establishmentId);

  if (!name || !cedula || !whatsapp || !instagram || !normalizedPassword) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  if (String(referral_code || '').trim() && !referrer) {
    return res.status(400).json({ message: 'Codigo de referido no registrado' });
  }

  try {
    const result = db
      .prepare(
        'INSERT INTO promoters (establishment_id, name, cedula, whatsapp, instagram, photo_url, code, username, password, referred_by_promoter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        establishmentId,
        name.trim(),
        cedula.trim(),
        whatsapp.trim(),
        instagram?.trim() || '',
        photo_url?.trim() || '',
        normalizedCode,
        normalizedUsername,
        normalizedPassword,
        referrer?.id || null,
        status
      );

    return res.status(201).json(db.prepare('SELECT * FROM promoters WHERE id = ?').get(result.lastInsertRowid));
  } catch (error) {
    return res.status(409).json({ message: 'Cedula ya registrada' });
  }
});

app.put('/api/promoters/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const { name, cedula, whatsapp, instagram, photo_url, referral_code, status = 'active' } = req.body;
  const referrer = findPromoterByCode(referral_code, establishmentId);

  if (!name || !cedula || !whatsapp || !instagram) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  if (String(referral_code || '').trim() && !referrer) {
    return res.status(400).json({ message: 'Codigo de referido no registrado' });
  }

  if (referrer?.id === Number(id)) {
    return res.status(400).json({ message: 'Un promotor no puede referirse a si mismo' });
  }

  try {
    const result = db
      .prepare(
        'UPDATE promoters SET name = ?, cedula = ?, whatsapp = ?, instagram = ?, photo_url = ?, referred_by_promoter_id = ?, status = ? WHERE id = ? AND establishment_id = ?'
      )
      .run(
        name.trim(),
        cedula.trim(),
        whatsapp.trim(),
        instagram?.trim() || '',
        photo_url?.trim() || '',
        referrer?.id || null,
        status,
        id,
        establishmentId
      );

    if (!result.changes) {
      return res.status(404).json({ message: 'Promotor no encontrado' });
    }

    return res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
  } catch {
    return res.status(409).json({ message: 'Cedula ya registrada' });
  }
});

app.patch('/api/promoters/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const { status } = req.body;

  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: 'Estado invalido' });
  }

  const result = db.prepare('UPDATE promoters SET status = ? WHERE id = ? AND establishment_id = ?').run(status, id, establishmentId);
  if (!result.changes) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
});

app.patch('/api/promoters/:id/selling', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const canSell = req.body.can_sell ? 1 : 0;
  const result = db.prepare('UPDATE promoters SET can_sell = ? WHERE id = ? AND establishment_id = ?').run(canSell, id, establishmentId);

  if (!result.changes) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
});

app.patch('/api/promoters/:id/manual-points', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const manualPoints = Math.max(0, Number(req.body.manual_points || 0));
  const result = db.prepare('UPDATE promoters SET manual_points = ? WHERE id = ? AND establishment_id = ?').run(toMoney(manualPoints), id, establishmentId);

  if (!result.changes) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
});

app.get('/api/level-settings', requireAdmin, (req, res) => {
  res.json(getLevelSettings(getRequestEventId(req)));
});

app.put('/api/level-settings', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const bronze = Math.max(1, Number(req.body.bronze || 1));
  const silver = Math.max(bronze, Number(req.body.silver || bronze));
  const diamond = Math.max(silver, Number(req.body.diamond || silver));
  const referralPoints = Math.max(0, Number(req.body.referral_points ?? req.body.referralPoints ?? 3));
  const cleanBenefits = (value) =>
    String(value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join('\n');
  const save = db.prepare('INSERT INTO event_settings (event_id, key, value) VALUES (?, ?, ?) ON CONFLICT(event_id, key) DO UPDATE SET value = excluded.value');

  save.run(eventId, 'level_bronze_min', String(bronze));
  save.run(eventId, 'level_silver_min', String(silver));
  save.run(eventId, 'level_diamond_min', String(diamond));
  save.run(eventId, 'referral_points', String(toMoney(referralPoints)));
  save.run(eventId, 'level_bronze_benefits', cleanBenefits(req.body.bronze_benefits));
  save.run(eventId, 'level_silver_benefits', cleanBenefits(req.body.silver_benefits));
  save.run(eventId, 'level_diamond_benefits', cleanBenefits(req.body.diamond_benefits));

  res.json(getLevelSettings(eventId));
});

app.get('/api/locations', requireAuth, (req, res) => {
  const eventId = req.user.role === 'promoter'
    ? getActiveEvent(req.user.establishmentId)?.id || 1
    : getRequestEventId(req);
  const locations = db.prepare('SELECT * FROM event_locations WHERE event_id = ? ORDER BY status ASC, name ASC').all(eventId);
  res.json(locations);
});

app.post('/api/locations', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const {
    name,
    price,
    commission_type = 'percent',
    commission_value = 3,
    commission_min_quantity = 1,
    level_points = 1,
    status = 'active'
  } = req.body;
  const parsedPrice = Number(price);
  const parsedCommission = Number(commission_value);
  const parsedMinQuantity = Math.max(1, Number(commission_min_quantity || 1));
  const parsedLevelPoints = Math.max(0, Number(level_points || 0));

  if (!name || parsedPrice < 0 || parsedCommission < 0 || !['percent', 'fixed'].includes(commission_type)) {
    return res.status(400).json({ message: 'Completa la localidad, precio y comision' });
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO event_locations
         (event_id, name, price, commission_type, commission_value, commission_min_quantity, level_points, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        name.trim(),
        toMoney(parsedPrice),
        commission_type,
        toMoney(parsedCommission),
        parsedMinQuantity,
        toMoney(parsedLevelPoints),
        status
      );
    res.status(201).json(db.prepare('SELECT * FROM event_locations WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    res.status(409).json({ message: 'La localidad ya existe' });
  }
});

app.put('/api/locations/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const eventId = getRequestEventId(req);
  const {
    name,
    price,
    commission_type = 'percent',
    commission_value = 3,
    commission_min_quantity = 1,
    level_points = 1,
    status = 'active'
  } = req.body;
  const parsedPrice = Number(price);
  const parsedCommission = Number(commission_value);
  const parsedMinQuantity = Math.max(1, Number(commission_min_quantity || 1));
  const parsedLevelPoints = Math.max(0, Number(level_points || 0));

  if (!name || parsedPrice < 0 || parsedCommission < 0 || !['percent', 'fixed'].includes(commission_type)) {
    return res.status(400).json({ message: 'Completa la localidad, precio y comision' });
  }

  try {
    const current = db.prepare('SELECT name FROM event_locations WHERE id = ? AND event_id = ?').get(id, eventId);
    if (!current) {
      return res.status(404).json({ message: 'Localidad no encontrada' });
    }

    const result = db
      .prepare(
        `UPDATE event_locations
         SET name = ?, price = ?, commission_type = ?, commission_value = ?, commission_min_quantity = ?, level_points = ?, status = ?
         WHERE id = ? AND event_id = ?`
      )
      .run(
        name.trim(),
        toMoney(parsedPrice),
        commission_type,
        toMoney(parsedCommission),
        parsedMinQuantity,
        toMoney(parsedLevelPoints),
        status,
        id,
        eventId
      );

    if (!result.changes) {
      return res.status(404).json({ message: 'Localidad no encontrada' });
    }

    if (current.name !== name.trim()) {
      db.prepare('UPDATE sales SET location = ? WHERE location = ? AND event_id = ?').run(name.trim(), current.name, eventId);
    }
    recalculateAllCommissions();

    res.json(db.prepare('SELECT * FROM event_locations WHERE id = ?').get(id));
  } catch {
    res.status(409).json({ message: 'La localidad ya existe' });
  }
});

app.delete('/api/locations/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const eventId = getRequestEventId(req);
  const location = db.prepare('SELECT name FROM event_locations WHERE id = ? AND event_id = ?').get(id, eventId);

  if (!location) {
    return res.status(404).json({ message: 'Localidad no encontrada' });
  }

  const usedSales = db.prepare('SELECT COUNT(*) AS total FROM sales WHERE location = ? AND event_id = ?').get(location.name, eventId).total;
  if (usedSales > 0) {
    return res.status(409).json({
      message: 'Esta localidad ya tiene ventas. Para conservar el historial, dejala inactiva en lugar de eliminarla.'
    });
  }

  db.prepare('DELETE FROM event_locations WHERE id = ? AND event_id = ?').run(id, eventId);
  res.json({ ok: true });
});

app.get('/api/sales', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const sales = db
    .prepare(
      `SELECT sales.*, promoters.name AS promoter_name, promoters.code AS promoter_code, events.name AS event_name
       FROM sales
       JOIN promoters ON promoters.id = sales.promoter_id
       JOIN events ON events.id = sales.event_id
       WHERE sales.event_id = ? AND sales.establishment_id = ?
       ORDER BY sales.sale_date DESC, sales.id DESC`
    )
    .all(eventId, establishmentId);
  res.json(sales);
});

function createSale(req, res, forcedPromoterId = null) {
  const {
    promoter_id,
    customer,
    customer_whatsapp,
    location,
    quantity,
    unit_price,
    sale_date,
    payment_status = 'pending'
  } = req.body;

  const selectedPromoterId = forcedPromoterId || promoter_id;
  const establishmentId = forcedPromoterId ? req.user.establishmentId : getRequestEstablishmentId(req);
  const eventId = forcedPromoterId ? getActiveEvent(establishmentId)?.id || 1 : getRequestEventId(req);
  const amount = Number(quantity);
  const price = Number(unit_price);

  if (!selectedPromoterId || !customer || !customer_whatsapp || !location || amount <= 0 || price < 0) {
    return res.status(400).json({ message: 'Completa los datos de la venta' });
  }

  const promoter = db.prepare("SELECT id, can_sell FROM promoters WHERE id = ? AND establishment_id = ? AND status = 'active'").get(selectedPromoterId, establishmentId);
  if (!promoter) {
    return res.status(400).json({ message: 'Selecciona un promotor activo' });
  }

  const establishment = db.prepare('SELECT promoter_sales_enabled FROM establishments WHERE id = ?').get(establishmentId);
  if (forcedPromoterId && (!promoter.can_sell || !establishment?.promoter_sales_enabled)) {
    return res.status(403).json({ message: 'Este promotor no esta habilitado para vender' });
  }

  const total = toMoney(amount * price);
  const normalizedPaymentStatus = forcedPromoterId ? 'pending' : payment_status === 'paid' ? 'paid' : 'pending';
  const normalizedDate = sale_date || new Date().toISOString().slice(0, 10);
  const normalizedLocation = location.trim();

  const result = db
    .prepare(
      `INSERT INTO sales
       (establishment_id, event_id, promoter_id, customer, customer_whatsapp, location, quantity, unit_price, total, commission, sale_date, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      establishmentId,
      eventId,
      selectedPromoterId,
      customer.trim(),
      customer_whatsapp.trim(),
      normalizedLocation,
      amount,
      price,
      total,
      0,
      normalizedDate,
      normalizedPaymentStatus
    );

  recalculateCommissions(selectedPromoterId, normalizedLocation, eventId);

  return res.status(201).json(db.prepare('SELECT * FROM sales WHERE id = ?').get(result.lastInsertRowid));
}

app.post('/api/sales', requireAdmin, (req, res) => createSale(req, res));

function markSalePaid(res, saleId, promoterId = null) {
  const sale = promoterId
    ? db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ? AND promoter_id = ?').get(saleId, promoterId)
    : db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ?').get(saleId);

  if (!sale) {
    return res.status(404).json({ message: 'Venta no encontrada' });
  }

  db.prepare("UPDATE sales SET payment_status = 'paid', commission = 0, commission_paid = 0 WHERE id = ?").run(saleId);
  recalculateCommissions(sale.promoter_id, sale.location, sale.event_id);
  return res.json(db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
}

app.patch('/api/sales/:id/pay', requireAdmin, (req, res) => {
  markSalePaid(res, req.params.id);
});

app.delete('/api/sales/:id', requireAdmin, (req, res) => {
  const sale = db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ?').get(req.params.id);

  if (!sale) {
    return res.status(404).json({ message: 'Venta no encontrada' });
  }

  db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
  recalculateCommissions(sale.promoter_id, sale.location, sale.event_id);
  res.json({ ok: true });
});

app.get('/api/promoter/me', requirePromoter, (req, res) => {
  const establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.user.establishmentId);
  const activeEvent = getActiveEvent(req.user.establishmentId);
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url, can_sell FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, establishment, activeEvent, level: getPromoterLevel(req.user.promoterId, activeEvent?.id || 1) });
});

app.patch('/api/promoter/profile', requirePromoter, (req, res) => {
  const establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.user.establishmentId);
  const activeEvent = getActiveEvent(req.user.establishmentId);
  const photoUrl = String(req.body.photo_url || '').trim();
  db.prepare('UPDATE promoters SET photo_url = ? WHERE id = ?').run(photoUrl, req.user.promoterId);
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url, can_sell FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, establishment, activeEvent, level: getPromoterLevel(req.user.promoterId, activeEvent?.id || 1) });
});

app.get('/api/promoter/sales', requirePromoter, (req, res) => {
  const eventId = getActiveEvent(req.user.establishmentId)?.id || 1;
  const sales = db
    .prepare('SELECT * FROM sales WHERE promoter_id = ? AND establishment_id = ? AND event_id = ? ORDER BY sale_date DESC, id DESC')
    .all(req.user.promoterId, req.user.establishmentId, eventId);
  res.json(sales);
});

app.get('/api/promoter/banners', requirePromoter, (req, res) => {
  const eventId = getActiveEvent(req.user.establishmentId)?.id || 1;
  res.json(
    db
      .prepare("SELECT * FROM event_banners WHERE event_id = ? AND status = 'active' ORDER BY sort_order ASC, id DESC")
      .all(eventId)
  );
});

app.post('/api/promoter/sales', requirePromoter, (req, res) => createSale(req, res, req.user.promoterId));

app.patch('/api/promoter/sales/:id/pay', requirePromoter, (_req, res) => {
  res.status(403).json({ message: 'La venta debe ser confirmada por el administrador' });
});

app.patch('/api/promoter/password', requirePromoter, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const cleanCurrent = String(currentPassword || '').trim();
  const cleanNext = String(newPassword || '').trim();

  if (cleanNext.length < 4) {
    return res.status(400).json({ message: 'La nueva contrasena debe tener al menos 4 caracteres' });
  }

  const promoter = db.prepare('SELECT id FROM promoters WHERE id = ? AND password = ?').get(req.user.promoterId, cleanCurrent);
  if (!promoter) {
    return res.status(400).json({ message: 'Contrasena actual incorrecta' });
  }

  db.prepare('UPDATE promoters SET password = ? WHERE id = ?').run(cleanNext, req.user.promoterId);
  res.json({ ok: true, message: 'Contrasena actualizada' });
});

app.get('/api/ranking', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const ranking = db
    .prepare(
      `SELECT promoters.id, promoters.name, promoters.code,
              COUNT(CASE WHEN sales.payment_status = 'paid' THEN sales.id END) AS sales_count,
              COALESCE(SUM(CASE WHEN sales.payment_status = 'paid' THEN sales.total ELSE 0 END), 0) AS total_sold,
              COALESCE(SUM(CASE WHEN sales.payment_status = 'paid' THEN sales.commission ELSE 0 END), 0) AS total_commission
       FROM promoters
       LEFT JOIN sales ON sales.promoter_id = promoters.id AND sales.event_id = ?
       WHERE promoters.establishment_id = ?
       GROUP BY promoters.id
       ORDER BY total_sold DESC, sales_count DESC, promoters.name ASC`
    )
    .all(eventId, establishmentId)
    .map((row) => ({
      ...row,
      total_sold: toMoney(row.total_sold),
      total_commission: toMoney(row.total_commission)
    }));

  res.json(ranking);
});

app.get('/api/settlements', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const settlements = db
    .prepare(
      `SELECT promoters.id, promoters.name, promoters.code,
              COALESCE(SUM(CASE WHEN sales.payment_status = 'paid' THEN sales.total ELSE 0 END), 0) AS total_sold,
              COALESCE(SUM(CASE WHEN sales.commission_paid = 0 THEN sales.commission ELSE 0 END), 0) AS pending_commission,
              COALESCE(SUM(CASE WHEN sales.commission_paid = 1 THEN sales.commission ELSE 0 END), 0) AS paid_commission
       FROM promoters
       LEFT JOIN sales ON sales.promoter_id = promoters.id AND sales.event_id = ?
       WHERE promoters.establishment_id = ?
       GROUP BY promoters.id
       ORDER BY pending_commission DESC, total_sold DESC`
    )
    .all(eventId, establishmentId)
    .map((row) => ({
      ...row,
      total_sold: toMoney(row.total_sold),
      amount_to_deliver: toMoney(row.total_sold - row.pending_commission - row.paid_commission),
      pending_commission: toMoney(row.pending_commission),
      paid_commission: toMoney(row.paid_commission)
    }));

  res.json(settlements);
});

app.patch('/api/settlements/:promoterId/pay', requireAdmin, (req, res) => {
  const { promoterId } = req.params;
  const eventId = getRequestEventId(req);
  const result = db
    .prepare("UPDATE sales SET commission_paid = 1 WHERE promoter_id = ? AND event_id = ? AND payment_status = 'paid' AND commission > 0 AND commission_paid = 0")
    .run(promoterId, eventId);
  res.json({ updatedSales: result.changes });
});

app.get('/api/verify/:code', (req, res) => {
  const promoter = findActivePromoterByCode(req.params.code);
  const eventId = getActiveEvent()?.id || 1;

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  return res.json({
    registered: true,
    message: 'Promotor oficial GEMASHOW',
    promoter: {
      ...promoter,
      level: getPromoterLevel(promoter.id, eventId)
    }
  });
});

app.post('/api/verify', (req, res) => {
  const promoter = findActivePromoterByCode(req.body.code);
  const eventId = getActiveEvent()?.id || 1;

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  return res.json({
    registered: true,
    message: 'Promotor oficial GEMASHOW',
    promoter: {
      ...promoter,
      level: getPromoterLevel(promoter.id, eventId)
    }
  });
});

recalculateAllCommissions();

const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(port, () => {
  console.log(`GemaPromoters API lista en http://localhost:${port}`);
});
