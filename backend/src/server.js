import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToken, requireAdmin, requireAuth, requirePromoter, requireSupreme } from './auth.js';
import { db, initDb, normalizeCode, normalizeLookup, toMoney } from './db.js';
import {
  findProductionUserForLogin,
  productionLoginResponse,
  registerProducalzaRoutes
} from './producalza-routes.js';
import { registerRenjiRoutes } from './renji-routes.js';

dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '20mb' }));

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
    .prepare("SELECT COUNT(*) AS total FROM promoters WHERE establishment_id = ? AND status = 'active' AND deleted_at IS NULL")
    .get(establishmentId).total;
  const totals = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS sold, COALESCE(SUM(commission), 0) AS commission FROM sales WHERE event_id = ? AND payment_status = 'paid' AND deleted_at IS NULL")
    .get(eventId);
  const todaySales = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS sold FROM sales WHERE event_id = ? AND payment_status = 'paid' AND sale_date = date('now', 'localtime') AND deleted_at IS NULL")
    .get(eventId).sold;

  return {
    activePromoters,
    totalSold: toMoney(totals.sold),
    totalCommissions: toMoney(totals.commission),
    todaySales: toMoney(todaySales)
  };
}

function findPromoterForVerification(code) {
  const lookup = normalizeLookup(code);
  return db
    .prepare(
      `SELECT promoters.id, promoters.establishment_id, promoters.instagram, promoters.whatsapp, promoters.photo_url, promoters.code, promoters.status,
              establishments.name AS establishment_name,
              establishments.display_name AS establishment_display_name,
              establishments.theme AS establishment_theme,
              establishments.logo_url AS establishment_logo_url
       FROM promoters
       JOIN establishments ON establishments.id = promoters.establishment_id
       WHERE promoters.deleted_at IS NULL AND establishments.status = 'active'`
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
    ? db.prepare('SELECT id, name, code FROM promoters WHERE establishment_id = ? AND deleted_at IS NULL').all(establishmentId)
    : db.prepare('SELECT id, name, code FROM promoters WHERE deleted_at IS NULL').all();
  return rows
    .find((promoter) => normalizeLookup(promoter.code) === lookup);
}

function findPromoterForLogin(username, password) {
  const lookup = normalizeLookup(username);
  const cleanPassword = String(password || '').trim();
  return db
    .prepare('SELECT id, establishment_id, name, username, code, status, can_sell FROM promoters WHERE deleted_at IS NULL AND password = ?')
    .all(cleanPassword)
    .find((promoter) => normalizeLookup(promoter.username) === lookup || normalizeLookup(promoter.code) === lookup);
}

function containsBlockedWords(...values) {
  const blocked = [
    'puta',
    'puto',
    'mierda',
    'verga',
    'pendejo',
    'pendeja',
    'imbecil',
    'idiota',
    'cabron',
    'maricon',
    'hp'
  ];
  const text = values
    .map((value) => normalizeLookup(value))
    .join(' ');
  return blocked.some((word) => text.includes(normalizeLookup(word)));
}

function getEstablishmentCodePrefix(establishmentId) {
  const establishment = db.prepare('SELECT code_prefix FROM establishments WHERE id = ?').get(establishmentId);
  return normalizeLookup(establishment?.code_prefix || 'GEMA') || 'GEMA';
}

function buildPromoterCode(name, establishmentId = null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .map((part) => normalizeLookup(part))
    .filter(Boolean);
  const firstName = parts[0] || 'PROMOTOR';
  const firstLastName = parts.length > 1 ? parts[1] : '';
  const prefix = establishmentId ? getEstablishmentCodePrefix(establishmentId) : 'GEMA';
  const base = `${prefix}-${firstName}${firstLastName}`;
  let candidate = base;
  let counter = 2;

  while (db.prepare('SELECT id FROM promoters WHERE code = ?').get(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function formatEditablePromoterCode(code) {
  return String(code || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function generatePromoterPassword() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PROMO${random}`;
}

function emailTransportConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendPromoterCredentialsEmail({ to, name, username, password, code, brandName = 'GEMASHOW' }) {
  if (!emailTransportConfigured()) {
    return { sent: false, reason: 'SMTP no configurado' };
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
  const loginUrl = process.env.PUBLIC_APP_URL || 'https://promoters.onrender.com';

  await transporter.sendMail({
    from,
    to,
    subject: `Tus accesos a PROMOTERS / ${brandName}`,
    text: `Hola ${name},

Tu cuenta de promotor ${brandName} fue creada correctamente.

Usuario: ${username}
Contrasena: ${password}
Codigo de promotor: ${code}

Ingresa aqui: ${loginUrl}

Por seguridad, cambia tu contrasena desde tu perfil cuando ingreses.`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0f1020;color:#f7f4ff;padding:24px;border-radius:12px">
        <h2 style="margin-top:0">Bienvenido/a a PROMOTERS</h2>
        <p>Hola <strong>${name}</strong>, tu cuenta de promotor <strong>${brandName}</strong> fue creada correctamente.</p>
        <div style="background:#181a2f;border:1px solid #343856;padding:16px;border-radius:10px">
          <p><strong>Usuario:</strong> ${username}</p>
          <p><strong>Contrasena:</strong> ${password}</p>
          <p><strong>Codigo de promotor:</strong> ${code}</p>
        </div>
        <p><a href="${loginUrl}" style="color:#8bdcff">Ingresar a PROMOTERS</a></p>
        <p style="color:#b8b3ca;font-size:13px">Por seguridad, cambia tu contrasena desde tu perfil cuando ingreses.</p>
      </div>
    `
  });

  return { sent: true };
}

async function sendWithdrawalPaidEmail({ to, name, withdrawal }) {
  if (!emailTransportConfigured() || !to) {
    return { sent: false, reason: 'SMTP no configurado o promotor sin correo' };
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
  const requestNumber = `RET-${String(withdrawal.id).padStart(6, '0')}`;
  const amount = `$${toMoney(withdrawal.amount).toFixed(2)}`;

  await transporter.sendMail({
    from,
    to,
    subject: `Pago confirmado - ${requestNumber}`,
    text: `Hola ${name},

Tu retiro fue marcado como pagado.

Solicitud: ${requestNumber}
Valor pagado: ${amount}

Gracias por formar parte de PROMOTERS.`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0f1020;color:#f7f4ff;padding:24px;border-radius:12px">
        <h2 style="margin-top:0">Pago de retiro confirmado</h2>
        <p>Hola <strong>${name}</strong>, tu retiro fue marcado como pagado.</p>
        <div style="background:#181a2f;border:1px solid #343856;padding:16px;border-radius:10px">
          <p><strong>Solicitud:</strong> ${requestNumber}</p>
          <p><strong>Valor pagado:</strong> ${amount}</p>
        </div>
        <p style="color:#b8b3ca;font-size:13px">Gracias por formar parte de PROMOTERS.</p>
      </div>
    `
  });

  return { sent: true };
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

function recalculateCommissions(promoterId, locationName, eventId = getActiveEvent()?.id || 1) {
  const settings = getLevelSettings(eventId);
  const level = getPromoterLevel(promoterId, eventId);
  const rate = Number(settings.commissions?.[level.key] || 0);
  const sales = db
    .prepare(
      `SELECT id, total, payment_status
       FROM sales
       WHERE promoter_id = ? AND event_id = ? AND deleted_at IS NULL
       ORDER BY sale_date ASC, id ASC`
    )
    .all(promoterId, eventId);

  for (const sale of sales) {
    if (sale.payment_status !== 'paid') {
      db.prepare('UPDATE sales SET commission = 0 WHERE id = ?').run(sale.id);
      continue;
    }

    const commission = toMoney(Number(sale.total || 0) * (rate / 100));

    db.prepare('UPDATE sales SET commission = ? WHERE id = ?').run(commission, sale.id);
  }
}

function recalculateAllCommissions() {
  const groups = db.prepare('SELECT DISTINCT promoter_id, location, event_id FROM sales WHERE deleted_at IS NULL').all();
  for (const group of groups) {
    recalculateCommissions(group.promoter_id, group.location, group.event_id);
  }
}

function getLevelSettings(eventId = getActiveEvent()?.id || 1) {
  seedEventSettingsFromActive(eventId);
  const rows = db.prepare("SELECT key, value FROM event_settings WHERE event_id = ? AND (key LIKE 'level_%' OR key = 'referral_points')").all(eventId);
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const goldMin = Number(settings.level_gold_min ?? settings.level_diamond_min ?? 25);
  const benefitsFrom = (key, fallback) =>
    String(settings[key] || fallback)
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  const goldBenefits = benefitsFrom(
    settings.level_gold_benefits ? 'level_gold_benefits' : 'level_diamond_benefits',
    'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Gold GEMASHOW'
  );

  return {
    bronze: Number(settings.level_bronze_min ?? 1),
    silver: Number(settings.level_silver_min ?? 10),
    gold: goldMin,
    diamond: goldMin,
    referralPoints: Number(settings.referral_points ?? 3),
    commissions: {
      starter: 0,
      bronze: Number(settings.level_bronze_commission ?? 2),
      silver: Number(settings.level_silver_commission ?? 5),
      gold: Number(settings.level_gold_commission ?? settings.level_diamond_commission ?? 10),
      diamond: Number(settings.level_gold_commission ?? settings.level_diamond_commission ?? 10)
    },
    benefits: {
      bronze: benefitsFrom(
        'level_bronze_benefits',
        'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como Bronze promoter'
      ),
      silver: benefitsFrom(
        'level_silver_benefits',
        'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Silver en el perfil'
      ),
      gold: goldBenefits,
      diamond: goldBenefits
    }
  };
}

function getLevelCatalog(settings = getLevelSettings()) {
  return [
    {
      key: 'bronze',
      name: 'Bronze',
      min: settings.bronze,
      benefits: settings.benefits.bronze
    },
    {
      key: 'silver',
      name: 'Silver',
      min: settings.silver,
      benefits: settings.benefits.silver
    },
    {
      key: 'gold',
      name: 'Gold',
      min: settings.gold,
      benefits: settings.benefits.gold
    }
  ];
}

function getPromoterLevel(promoterId, eventId = getActiveEvent()?.id || 1) {
  const settings = getLevelSettings(eventId);
  const paidSalesRows = db
    .prepare("SELECT quantity, location FROM sales WHERE promoter_id = ? AND event_id = ? AND payment_status = 'paid' AND deleted_at IS NULL")
    .all(promoterId, eventId);
  const promoter = db
    .prepare(
      `SELECT promoters.manual_points,
              COALESCE(establishments.display_name, establishments.name, 'PROMOTERS') AS brand_name
       FROM promoters
       LEFT JOIN establishments ON establishments.id = promoters.establishment_id
       WHERE promoters.id = ?`
    )
    .get(promoterId);
  const referralCount = db.prepare('SELECT COUNT(*) AS total FROM promoters WHERE referred_by_promoter_id = ? AND deleted_at IS NULL').get(promoterId).total;
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
    name: 'Starter',
    description: `Promotor oficial ${promoter?.brand_name || 'PROMOTERS'}`
  };

  if (levelPoints >= settings.bronze) {
    level = { key: 'bronze', name: 'Bronze', description: `Promotor destacado ${promoter?.brand_name || 'PROMOTERS'}` };
  }
  if (levelPoints >= settings.silver) {
    level = { key: 'silver', name: 'Silver', description: `Promotor elite ${promoter?.brand_name || 'PROMOTERS'}` };
  }
  if (levelPoints >= settings.gold) {
    level = { key: 'gold', name: 'Gold', description: `Promotor top ${promoter?.brand_name || 'PROMOTERS'}` };
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
    { key: 'level_bronze_commission', value: '2' },
    { key: 'level_silver_commission', value: '5' },
    { key: 'level_diamond_commission', value: '10' },
    { key: 'level_bronze_benefits', value: 'Acceso a preventas internas\nMaterial digital GEMASHOW\nReconocimiento como Bronze promoter' },
    { key: 'level_silver_benefits', value: 'Prioridad en localidades de alta demanda\nBonos especiales por metas\nInsignia Silver en el perfil' },
    { key: 'level_diamond_benefits', value: 'Beneficios VIP de promotor top\nPrioridad maxima en cupos\nReconocimiento Gold GEMASHOW' }
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
    const establishment = db.prepare("SELECT * FROM establishments WHERE name = 'GEMASHOW'").get() || getDefaultEstablishment();
    return res.json({
      token: createToken({ role: 'admin', username, establishmentId: establishment?.id || 1 }),
      user: { username, role: 'admin', establishment_id: establishment?.id || 1, establishment_name: establishment?.name || 'GEMASHOW', establishment_display_name: establishment?.display_name || 'GEMASHOW' }
    });
  }

  const owner = db
    .prepare("SELECT * FROM establishments WHERE status = 'active' AND admin_username = ? AND admin_password = ?")
    .get(String(username || '').trim(), String(password || '').trim());
  if (owner) {
    const ownerRole = owner.module_type === 'production' ? 'production_admin' : 'admin';
    return res.json({
      token: createToken({ role: ownerRole, username, establishmentId: owner.id }),
      user: {
        username,
        role: ownerRole,
        name: owner.display_name || owner.name,
        establishment_id: owner.id,
        establishment_name: owner.name,
        establishment_display_name: owner.display_name || owner.name,
        establishment_module_type: owner.module_type || 'promoters'
      }
    });
  }

  const productionUser = findProductionUserForLogin(db, username, password);
  if (productionUser) {
    return res.json(productionLoginResponse(productionUser));
  }

  return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
});

app.post('/api/auth/promoter-login', (req, res) => {
  const { username, password } = req.body;
  const promoter = findPromoterForLogin(username, password);

  if (!promoter) {
    return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
  }

  return res.json({
    token: createToken({ role: 'promoter', promoterId: promoter.id, establishmentId: promoter.establishment_id, username: promoter.username }),
    user: { role: 'promoter', id: promoter.id, name: promoter.name, code: promoter.code, status: promoter.status, can_sell: promoter.can_sell, establishment_id: promoter.establishment_id }
  });
});

app.get('/api/public-establishments', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, display_name, theme, logo_url, code_prefix
       FROM establishments
       WHERE status = 'active'
         AND business_type = 'event'
         AND promoter_sales_enabled = 1
       ORDER BY name = 'GEMASHOW' DESC, display_name ASC`
    )
    .all();
  res.json(rows);
});

app.post('/api/promoter-register', async (req, res) => {
  const requestedEstablishmentId = Number(req.body.establishment_id || req.body.establishmentId || 0);
  const establishment = requestedEstablishmentId
    ? db.prepare("SELECT * FROM establishments WHERE id = ? AND status = 'active' AND business_type = 'event' AND promoter_sales_enabled = 1").get(requestedEstablishmentId)
    : db.prepare("SELECT * FROM establishments WHERE name = 'GEMASHOW'").get() || getDefaultEstablishment();
  const establishmentId = establishment?.id || 1;
  const {
    name,
    cedula,
    email,
    whatsapp,
    instagram,
    referral_code
  } = req.body;
  const cleanName = String(name || '').trim();
  const cleanCedula = String(cedula || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanWhatsapp = String(whatsapp || '').trim();
  const cleanInstagram = String(instagram || '').trim();
  const referrer = findPromoterByCode(referral_code, establishmentId);

  if (!cleanName || !cleanCedula || !cleanEmail || !cleanWhatsapp || !cleanInstagram) {
    return res.status(400).json({ message: 'Nombre, cedula, correo, WhatsApp e Instagram son obligatorios' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ message: 'Ingresa un correo valido' });
  }

  if (containsBlockedWords(cleanName, cleanEmail, cleanWhatsapp, cleanInstagram)) {
    return res.status(400).json({ message: 'El registro contiene palabras no permitidas. Revisa tus datos.' });
  }

  if (String(referral_code || '').trim() && !referrer) {
    return res.status(400).json({ message: 'Codigo de referido no registrado' });
  }

  const existing = db
    .prepare('SELECT id FROM promoters WHERE cedula = ? OR email = ?')
    .get(cleanCedula, cleanEmail);
  if (existing) {
    return res.status(409).json({ message: 'Ya existe un promotor registrado con esa cedula o correo' });
  }

  const code = buildPromoterCode(cleanName, establishmentId);
  const username = code;
  const password = generatePromoterPassword();

  try {
    const result = db
      .prepare(
        `INSERT INTO promoters
         (establishment_id, name, cedula, email, whatsapp, instagram, photo_url, code, username, password, referred_by_promoter_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive')`
      )
      .run(
        establishmentId,
        cleanName,
        cleanCedula,
        cleanEmail,
        cleanWhatsapp,
        cleanInstagram,
        '',
        code,
        username,
        password,
        referrer?.id || null
      );

    let emailResult = { sent: false };
    try {
      emailResult = await sendPromoterCredentialsEmail({
        to: cleanEmail,
        name: cleanName,
        username,
        password,
        code,
        brandName: establishment.display_name || establishment.name
      });
    } catch (error) {
      emailResult = { sent: false, reason: error.message };
    }

    return res.status(201).json({
      ok: true,
      promoter_id: result.lastInsertRowid,
      username,
      code,
      email_sent: Boolean(emailResult.sent),
      message: emailResult.sent
        ? 'Registro creado. Enviamos tus accesos al correo. Tu cuenta queda pendiente de activacion por el administrador.'
        : 'Registro creado. Tu cuenta queda pendiente de activacion por el administrador, pero el correo aun no esta configurado o no pudo enviarse.'
    });
  } catch (error) {
    return res.status(400).json({ message: 'No se pudo crear el registro del promotor' });
  }
});

app.get('/api/establishments', requireAdmin, (req, res) => {
  if (req.user.role !== 'supreme') {
    return res.json(db.prepare('SELECT * FROM establishments WHERE id = ?').all(req.user.establishmentId));
  }
  return res.json(db.prepare('SELECT * FROM establishments ORDER BY status ASC, created_at ASC, id ASC').all());
});

app.post('/api/establishments', requireSupreme, (req, res) => {
  const name = String(req.body.name || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const businessType = req.body.business_type === 'commercial' ? 'commercial' : 'event';
  const moduleType = req.body.module_type === 'production' ? 'production' : 'promoters';
  const codePrefix = normalizeLookup(req.body.code_prefix || name).slice(0, 12) || 'PROMO';
  const theme = normalizeLookup(req.body.theme || name).toLowerCase() || 'custom';
  const logoUrl = String(req.body.logo_url || '').trim();
  const adminUsername = String(req.body.admin_username || '').trim();
  const adminPassword = String(req.body.admin_password || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const promoterSalesEnabled = businessType === 'commercial' ? 0 : req.body.promoter_sales_enabled ? 1 : 0;

  if (!name || !adminUsername || !adminPassword) {
    return res.status(400).json({ message: 'Nombre, usuario admin y contrasena admin son obligatorios' });
  }

  try {
    const result = db
      .prepare('INSERT INTO establishments (name, display_name, business_type, module_type, code_prefix, theme, logo_url, admin_username, admin_password, status, promoter_sales_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, displayName || name, businessType, moduleType, codePrefix, theme, logoUrl, adminUsername, adminPassword, status, promoterSalesEnabled);
    if (moduleType !== 'production') {
      const eventResult = db
        .prepare('INSERT INTO events (establishment_id, name, description, status, is_active) VALUES (?, ?, ?, ?, 1)')
        .run(result.lastInsertRowid, name.toUpperCase(), `Evento principal ${name}`, 'active');
      seedEventSettingsFromActive(eventResult.lastInsertRowid);
    }
    return res.status(201).json(db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ message: 'El establecimiento ya existe' });
  }
});

app.put('/api/establishments/:id', requireSupreme, (req, res) => {
  const name = String(req.body.name || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const businessType = req.body.business_type === 'commercial' ? 'commercial' : 'event';
  const moduleType = req.body.module_type === 'production' ? 'production' : 'promoters';
  const codePrefix = normalizeLookup(req.body.code_prefix || name).slice(0, 12) || 'PROMO';
  const theme = normalizeLookup(req.body.theme || name).toLowerCase() || 'custom';
  const logoUrl = String(req.body.logo_url || '').trim();
  const adminUsername = String(req.body.admin_username || '').trim();
  const adminPassword = String(req.body.admin_password || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const promoterSalesEnabled = businessType === 'commercial' ? 0 : req.body.promoter_sales_enabled ? 1 : 0;

  if (!name || !adminUsername || !adminPassword) {
    return res.status(400).json({ message: 'Nombre, usuario admin y contrasena admin son obligatorios' });
  }

  try {
    const result = db
      .prepare('UPDATE establishments SET name = ?, display_name = ?, business_type = ?, module_type = ?, code_prefix = ?, theme = ?, logo_url = ?, admin_username = ?, admin_password = ?, status = ?, promoter_sales_enabled = ? WHERE id = ?')
      .run(name, displayName || name, businessType, moduleType, codePrefix, theme, logoUrl, adminUsername, adminPassword, status, promoterSalesEnabled, req.params.id);
    if (!result.changes) {
      return res.status(404).json({ message: 'Establecimiento no encontrado' });
    }
    return res.json(db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.params.id));
  } catch {
    return res.status(409).json({ message: 'El establecimiento ya existe' });
  }
});

app.get('/api/branches', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  res.json(db.prepare('SELECT * FROM branches WHERE establishment_id = ? ORDER BY status ASC, name ASC').all(establishmentId));
});

app.post('/api/branches', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const establishment = db.prepare('SELECT business_type FROM establishments WHERE id = ?').get(establishmentId);
  if (establishment?.business_type !== 'commercial') {
    return res.status(403).json({ message: 'Las sucursales solo aplican para locales comerciales' });
  }
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';

  if (!name) {
    return res.status(400).json({ message: 'Nombre de sucursal obligatorio' });
  }

  try {
    const result = db
      .prepare('INSERT INTO branches (establishment_id, name, address, status) VALUES (?, ?, ?, ?)')
      .run(establishmentId, name, address, status);
    return res.status(201).json(db.prepare('SELECT * FROM branches WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    return res.status(409).json({ message: 'La sucursal ya existe' });
  }
});

app.put('/api/branches/:id', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const establishment = db.prepare('SELECT business_type FROM establishments WHERE id = ?').get(establishmentId);
  if (establishment?.business_type !== 'commercial') {
    return res.status(403).json({ message: 'Las sucursales solo aplican para locales comerciales' });
  }
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim();
  const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active';

  if (!name) {
    return res.status(400).json({ message: 'Nombre de sucursal obligatorio' });
  }

  try {
    const result = db
      .prepare('UPDATE branches SET name = ?, address = ?, status = ? WHERE id = ? AND establishment_id = ?')
      .run(name, address, status, req.params.id, establishmentId);
    if (!result.changes) {
      return res.status(404).json({ message: 'Sucursal no encontrada' });
    }
    return res.json(db.prepare('SELECT * FROM branches WHERE id = ? AND establishment_id = ?').get(req.params.id, establishmentId));
  } catch {
    return res.status(409).json({ message: 'La sucursal ya existe' });
  }
});

app.get('/api/events', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  res.json(db.prepare('SELECT * FROM events WHERE establishment_id = ? ORDER BY is_active DESC, created_at DESC, id DESC').all(establishmentId));
});

app.post('/api/events', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const establishment = db.prepare('SELECT business_type FROM establishments WHERE id = ?').get(establishmentId);
  if (establishment?.business_type === 'commercial') {
    return res.status(403).json({ message: 'Los eventos solo aplican para negocios de eventos o conciertos' });
  }
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
  const establishment = db.prepare('SELECT business_type FROM establishments WHERE id = ?').get(establishmentId);
  if (establishment?.business_type === 'commercial') {
    return res.status(403).json({ message: 'Los eventos solo aplican para negocios de eventos o conciertos' });
  }
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
  const establishment = db.prepare('SELECT business_type FROM establishments WHERE id = ?').get(establishmentId);
  if (establishment?.business_type === 'commercial') {
    return res.status(403).json({ message: 'Los eventos solo aplican para negocios de eventos o conciertos' });
  }
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
              branches.name AS branch_name,
              (SELECT COUNT(*) FROM promoters AS referred WHERE referred.referred_by_promoter_id = promoters.id AND referred.deleted_at IS NULL) AS referral_count
       FROM promoters
       LEFT JOIN promoters AS referrer ON referrer.id = promoters.referred_by_promoter_id
       LEFT JOIN branches ON branches.id = promoters.branch_id
       WHERE promoters.establishment_id = ? AND promoters.deleted_at IS NULL
       ORDER BY promoters.registered_at DESC, promoters.id DESC`
    )
    .all(establishmentId);
  res.json(
    promoters.map((promoter) => ({
      ...promoter,
      level: getPromoterLevel(promoter.id, getRequestEventId(req)),
      referral_points_earned: toMoney(Number(promoter.referral_count || 0) * Number(settings.referralPoints || 0))
    }))
  );
});

app.post('/api/promoters', requireAdmin, (req, res) => {
  const establishmentId = getRequestEstablishmentId(req);
  const { name, cedula, email, whatsapp, instagram, photo_url, referral_code, branch_id, status = 'active' } = req.body;
  const normalizedCode = buildPromoterCode(name, establishmentId);
  const normalizedUsername = normalizedCode;
  const normalizedPassword = String(cedula || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const referrer = findPromoterByCode(referral_code, establishmentId);

  if (!name || !cedula || !whatsapp || !instagram || !normalizedPassword) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  if (String(referral_code || '').trim() && !referrer) {
    return res.status(400).json({ message: 'Codigo de referido no registrado' });
  }

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ message: 'Ingresa un correo valido' });
  }

  const branchId = branch_id ? Number(branch_id) : null;
  if (branchId) {
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND establishment_id = ?').get(branchId, establishmentId);
    if (!branch) {
      return res.status(400).json({ message: 'Sucursal no registrada para este establecimiento' });
    }
  }

  try {
    const result = db
      .prepare(
        'INSERT INTO promoters (establishment_id, branch_id, name, cedula, email, whatsapp, instagram, photo_url, code, username, password, referred_by_promoter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        establishmentId,
        branchId,
        name.trim(),
        cedula.trim(),
        cleanEmail,
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
  const { name, cedula, email, whatsapp, instagram, photo_url, referral_code, branch_id, status = 'active' } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const referrer = findPromoterByCode(referral_code, establishmentId);

  if (!name || !cedula || !whatsapp || !instagram) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  if (String(referral_code || '').trim() && !referrer) {
    return res.status(400).json({ message: 'Codigo de referido no registrado' });
  }

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ message: 'Ingresa un correo valido' });
  }

  if (referrer?.id === Number(id)) {
    return res.status(400).json({ message: 'Un promotor no puede referirse a si mismo' });
  }

  const branchId = branch_id ? Number(branch_id) : null;
  if (branchId) {
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND establishment_id = ?').get(branchId, establishmentId);
    if (!branch) {
      return res.status(400).json({ message: 'Sucursal no registrada para este establecimiento' });
    }
  }

  try {
    const result = db
      .prepare(
        'UPDATE promoters SET branch_id = ?, name = ?, cedula = ?, email = ?, whatsapp = ?, instagram = ?, photo_url = ?, referred_by_promoter_id = ?, status = ? WHERE id = ? AND establishment_id = ?'
      )
      .run(
        branchId,
        name.trim(),
        cedula.trim(),
        cleanEmail,
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

  recalculateAllCommissions();

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
});

app.delete('/api/promoters/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const promoter = db.prepare('SELECT id, name FROM promoters WHERE id = ? AND establishment_id = ? AND deleted_at IS NULL').get(id, establishmentId);

  if (!promoter) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  db.prepare("UPDATE promoters SET status = 'inactive', deleted_at = datetime('now', 'localtime') WHERE id = ? AND establishment_id = ?").run(id, establishmentId);
  res.json({ ok: true });
});

app.patch('/api/promoters/:id/selling', requireAdmin, (req, res) => {
  const { id } = req.params;
  const establishmentId = getRequestEstablishmentId(req);
  const canSell = req.body.can_sell ? 1 : 0;
  const result = db.prepare('UPDATE promoters SET can_sell = ? WHERE id = ? AND establishment_id = ?').run(canSell, id, establishmentId);

  if (!result.changes) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  recalculateAllCommissions();

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

  recalculateAllCommissions();

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ? AND establishment_id = ?').get(id, establishmentId));
});

app.get('/api/level-settings', requireAdmin, (req, res) => {
  res.json(getLevelSettings(getRequestEventId(req)));
});

app.put('/api/level-settings', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const bronze = Math.max(1, Number(req.body.bronze || 1));
  const silver = Math.max(bronze, Number(req.body.silver || bronze));
  const gold = Math.max(silver, Number(req.body.gold ?? req.body.diamond ?? silver));
  const referralPoints = Math.max(0, Number(req.body.referral_points ?? req.body.referralPoints ?? 3));
  const bronzeCommission = Math.max(0, Number(req.body.bronze_commission ?? 2));
  const silverCommission = Math.max(0, Number(req.body.silver_commission ?? 5));
  const goldCommission = Math.max(0, Number(req.body.gold_commission ?? req.body.diamond_commission ?? 10));
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
  save.run(eventId, 'level_diamond_min', String(gold));
  save.run(eventId, 'referral_points', String(toMoney(referralPoints)));
  save.run(eventId, 'level_bronze_commission', String(toMoney(bronzeCommission)));
  save.run(eventId, 'level_silver_commission', String(toMoney(silverCommission)));
  save.run(eventId, 'level_diamond_commission', String(toMoney(goldCommission)));
  save.run(eventId, 'level_bronze_benefits', cleanBenefits(req.body.bronze_benefits));
  save.run(eventId, 'level_silver_benefits', cleanBenefits(req.body.silver_benefits));
  save.run(eventId, 'level_diamond_benefits', cleanBenefits(req.body.gold_benefits ?? req.body.diamond_benefits));

  recalculateAllCommissions();

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
    return res.status(400).json({ message: 'Completa la localidad y precio' });
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
    return res.status(400).json({ message: 'Completa la localidad y precio' });
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

  const promoter = db.prepare("SELECT id, can_sell FROM promoters WHERE id = ? AND establishment_id = ? AND status = 'active' AND deleted_at IS NULL").get(selectedPromoterId, establishmentId);
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

  const orderNumber = `PED-${String(result.lastInsertRowid).padStart(6, '0')}`;
  db.prepare('UPDATE sales SET order_number = ? WHERE id = ?').run(orderNumber, result.lastInsertRowid);
  recalculateCommissions(selectedPromoterId, normalizedLocation, eventId);

  return res.status(201).json(db.prepare('SELECT * FROM sales WHERE id = ?').get(result.lastInsertRowid));
}

app.post('/api/sales', requireAdmin, (req, res) => createSale(req, res));

function getAvailableCommission(promoterId, eventId, establishmentId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(commission), 0) AS total
       FROM sales
       WHERE promoter_id = ?
         AND event_id = ?
         AND establishment_id = ?
         AND payment_status = 'paid'
         AND commission > 0
         AND commission_paid = 0
         AND deleted_at IS NULL`
    )
    .get(promoterId, eventId, establishmentId);
  return toMoney(row?.total || 0);
}

function markSalePaid(res, saleId, promoterId = null) {
  const sale = promoterId
    ? db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ? AND promoter_id = ? AND deleted_at IS NULL').get(saleId, promoterId)
    : db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ? AND deleted_at IS NULL').get(saleId);

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
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const sale = db.prepare('SELECT id, promoter_id, location, event_id FROM sales WHERE id = ? AND event_id = ? AND establishment_id = ? AND deleted_at IS NULL').get(req.params.id, eventId, establishmentId);

  if (!sale) {
    return res.status(404).json({ message: 'Venta no encontrada' });
  }

  db.prepare("UPDATE sales SET deleted_at = datetime('now', 'localtime'), deleted_by = ?, deletion_reason = ? WHERE id = ?").run(req.user.username || req.user.role || 'admin', 'Eliminada por administrador', req.params.id);
  recalculateCommissions(sale.promoter_id, sale.location, sale.event_id);
  res.json({ ok: true, archived: true });
});

function physicalPaymentMethod(value) {
  return ['cash', 'transfer', 'card', 'other'].includes(value) ? value : 'cash';
}

function normalizePhysicalSaleItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      location: String(item.location || '').trim(),
      quantity: Math.floor(Number(item.quantity || 0)),
      unit_price: Math.max(0, Number(item.unit_price || 0))
    }))
    .filter((item) => item.location && item.quantity > 0);
}

function validatePhysicalSaleItems(eventId, normalizedItems) {
  if (!normalizedItems.length) {
    return 'Agrega al menos una entrada para vender.';
  }
  const validLocations = new Set(db.prepare("SELECT name FROM event_locations WHERE event_id = ? AND status = 'active'").all(eventId).map((item) => item.name));
  if (normalizedItems.some((item) => !validLocations.has(item.location))) {
    return 'Selecciona solo localidades activas.';
  }
  return '';
}

function savePhysicalSaleItems(saleId, establishmentId, eventId, normalizedItems) {
  const insertItem = db.prepare(
    `INSERT INTO physical_ticket_sale_items
     (sale_id, establishment_id, event_id, location, quantity, unit_price, total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of normalizedItems) {
    insertItem.run(saleId, establishmentId, eventId, item.location, item.quantity, toMoney(item.unit_price), toMoney(item.quantity * item.unit_price));
  }
}

function physicalTicketsReport(eventId, establishmentId, dateFrom, dateTo) {
  const from = dateFrom || new Date().toISOString().slice(0, 10);
  const to = dateTo || from;
  const sales = db.prepare(
    `SELECT *
     FROM physical_ticket_sales
     WHERE establishment_id = ? AND event_id = ? AND sale_date BETWEEN ? AND ?
     ORDER BY sale_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const items = db.prepare(
    `SELECT items.*
     FROM physical_ticket_sale_items AS items
     JOIN physical_ticket_sales AS sales ON sales.id = items.sale_id
     WHERE items.establishment_id = ? AND items.event_id = ?
       AND sales.sale_date BETWEEN ? AND ?
     ORDER BY sales.sale_date DESC, sales.id DESC, items.id ASC`
  ).all(establishmentId, eventId, from, to);
  const allSales = db.prepare(
    `SELECT *
     FROM physical_ticket_sales
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY sale_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const allItems = db.prepare(
    `SELECT items.*
     FROM physical_ticket_sale_items AS items
     JOIN physical_ticket_sales AS sales ON sales.id = items.sale_id
     WHERE items.establishment_id = ? AND items.event_id = ?
     ORDER BY sales.sale_date DESC, sales.id DESC, items.id ASC`
  ).all(establishmentId, eventId);
  const stockEntries = db.prepare(
    `SELECT *
     FROM physical_ticket_stock_entries
     WHERE establishment_id = ? AND event_id = ? AND entry_date BETWEEN ? AND ?
     ORDER BY entry_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allStockEntries = db.prepare(
    `SELECT *
     FROM physical_ticket_stock_entries
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY entry_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const expenses = db.prepare(
    `SELECT *
     FROM physical_ticket_daily_expenses
     WHERE establishment_id = ? AND event_id = ? AND expense_date BETWEEN ? AND ?
     ORDER BY expense_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allExpenses = db.prepare(
    `SELECT *
     FROM physical_ticket_daily_expenses
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY expense_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const withdrawals = db.prepare(
    `SELECT *
     FROM physical_ticket_cash_withdrawals
     WHERE establishment_id = ? AND event_id = ? AND withdrawal_date BETWEEN ? AND ?
     ORDER BY withdrawal_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allWithdrawals = db.prepare(
    `SELECT *
     FROM physical_ticket_cash_withdrawals
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY withdrawal_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const locationPrices = db.prepare(
    `SELECT name, price
     FROM event_locations
     WHERE event_id = ?`
  ).all(eventId);
  const inventoryRows = db.prepare(
    `SELECT locations.name AS location,
            COALESCE(stock.quantity, 0) AS stock_quantity,
            COALESCE(sold.quantity, 0) AS sold_quantity
     FROM event_locations AS locations
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM physical_ticket_stock_entries
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS stock ON stock.location = locations.name
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM physical_ticket_sale_items
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS sold ON sold.location = locations.name
     WHERE locations.event_id = ?
     ORDER BY locations.name COLLATE NOCASE`
  ).all(establishmentId, eventId, establishmentId, eventId, eventId).map((row) => ({
    location: row.location,
    stock_quantity: Number(row.stock_quantity || 0),
    sold_quantity: Number(row.sold_quantity || 0),
    remaining_quantity: Number(row.stock_quantity || 0) - Number(row.sold_quantity || 0)
  }));
  const salesWithItems = sales.map((sale) => ({
    ...sale,
    items: items.filter((item) => Number(item.sale_id) === Number(sale.id))
  }));
  const allSalesWithItems = allSales.map((sale) => ({
    ...sale,
    items: allItems.filter((item) => Number(item.sale_id) === Number(sale.id))
  }));
  const byLocation = new Map();
  for (const item of items) {
    const current = byLocation.get(item.location) || { location: item.location, quantity: 0, total: 0 };
    current.quantity += Number(item.quantity || 0);
    current.total = toMoney(current.total + Number(item.total || 0));
    byLocation.set(item.location, current);
  }
  const byPayment = ['cash', 'transfer', 'card', 'other'].map((method) => ({
    method,
    quantity: salesWithItems
      .filter((sale) => sale.payment_method === method)
      .reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0),
    total: toMoney(salesWithItems.filter((sale) => sale.payment_method === method).reduce((sum, sale) => sum + Number(sale.total || 0), 0))
  }));
  const totals = {
    soldQuantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    stockQuantity: stockEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    subtotal: toMoney(sales.reduce((sum, sale) => sum + Number(sale.subtotal || 0), 0)),
    discounts: toMoney(sales.reduce((sum, sale) => sum + Number(sale.discount_value || 0), 0)),
    total: toMoney(sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    cashIncome: toMoney(sales.filter((sale) => ['cash', 'transfer'].includes(sale.payment_method)).reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    expenses: toMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
    withdrawals: toMoney(withdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.total || 0), 0))
  };
  totals.net = toMoney(totals.total - totals.expenses);
  totals.cashBox = toMoney(totals.cashIncome - totals.expenses - totals.withdrawals);
  const allTotals = {
    soldQuantity: allItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    stockQuantity: allStockEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    subtotal: toMoney(allSales.reduce((sum, sale) => sum + Number(sale.subtotal || 0), 0)),
    discounts: toMoney(allSales.reduce((sum, sale) => sum + Number(sale.discount_value || 0), 0)),
    total: toMoney(allSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    cashIncome: toMoney(allSales.filter((sale) => ['cash', 'transfer'].includes(sale.payment_method)).reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    expenses: toMoney(allExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
    withdrawals: toMoney(allWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.total || 0), 0))
  };
  allTotals.net = toMoney(allTotals.total - allTotals.expenses);
  allTotals.cashBox = toMoney(allTotals.cashIncome - allTotals.expenses - allTotals.withdrawals);
  return {
    date_from: from,
    date_to: to,
    sales: salesWithItems,
    all_sales: allSalesWithItems,
    stock_entries: stockEntries,
    all_stock_entries: allStockEntries,
    expenses,
    all_expenses: allExpenses,
    withdrawals,
    all_withdrawals: allWithdrawals,
    by_location: [...byLocation.values()],
    by_payment: byPayment,
    inventory_by_location: inventoryRows,
    standard_prices_by_location: Object.fromEntries(locationPrices.map((location) => [location.name, Number(location.price || 0)])),
    all_totals: allTotals,
    totals
  };
}

app.get('/api/physical-tickets/report', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const dateFrom = String(req.query.date_from || req.query.date || '').trim();
  const dateTo = String(req.query.date_to || dateFrom || '').trim();
  res.json(physicalTicketsReport(eventId, establishmentId, dateFrom, dateTo));
});

app.post('/api/physical-tickets/sales', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const saleDate = String(req.body.sale_date || new Date().toISOString().slice(0, 10)).trim();
  const paymentMethod = physicalPaymentMethod(req.body.payment_method);
  const discountValue = Math.max(0, Number(req.body.discount_value || 0));
  const normalizedItems = normalizePhysicalSaleItems(req.body.items);
  const validationMessage = validatePhysicalSaleItems(eventId, normalizedItems);
  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }
  const subtotal = toMoney(normalizedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
  const total = toMoney(Math.max(0, subtotal - discountValue));
  const createdBy = req.user?.username || req.user?.role || 'admin';
  const saleId = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO physical_ticket_sales
       (establishment_id, event_id, sale_date, payment_method, discount_value, subtotal, total, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(establishmentId, eventId, saleDate, paymentMethod, toMoney(discountValue), subtotal, total, String(req.body.notes || '').trim(), createdBy);
    const saleNumber = `FIS-${String(result.lastInsertRowid).padStart(6, '0')}`;
    db.prepare('UPDATE physical_ticket_sales SET sale_number = ? WHERE id = ?').run(saleNumber, result.lastInsertRowid);
    savePhysicalSaleItems(result.lastInsertRowid, establishmentId, eventId, normalizedItems);
    return result.lastInsertRowid;
  })();
  res.status(201).json({ ok: true, sale_id: saleId, report: physicalTicketsReport(eventId, establishmentId, saleDate, saleDate) });
});

app.put('/api/physical-tickets/sales/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const currentSale = db.prepare('SELECT id, sale_date FROM physical_ticket_sales WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!currentSale) {
    return res.status(404).json({ message: 'Venta fisica no encontrada.' });
  }
  const saleDate = String(req.body.sale_date || currentSale.sale_date || new Date().toISOString().slice(0, 10)).trim();
  const paymentMethod = physicalPaymentMethod(req.body.payment_method);
  const discountValue = Math.max(0, Number(req.body.discount_value || 0));
  const normalizedItems = normalizePhysicalSaleItems(req.body.items);
  const validationMessage = validatePhysicalSaleItems(eventId, normalizedItems);
  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }
  const subtotal = toMoney(normalizedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
  const total = toMoney(Math.max(0, subtotal - discountValue));
  db.transaction(() => {
    db.prepare(
      `UPDATE physical_ticket_sales
       SET sale_date = ?, payment_method = ?, discount_value = ?, subtotal = ?, total = ?, notes = ?
       WHERE id = ? AND establishment_id = ? AND event_id = ?`
    ).run(saleDate, paymentMethod, toMoney(discountValue), subtotal, total, String(req.body.notes || '').trim(), req.params.id, establishmentId, eventId);
    db.prepare('DELETE FROM physical_ticket_sale_items WHERE sale_id = ? AND establishment_id = ? AND event_id = ?').run(req.params.id, establishmentId, eventId);
    savePhysicalSaleItems(req.params.id, establishmentId, eventId, normalizedItems);
  })();
  res.json({ ok: true, report: physicalTicketsReport(eventId, establishmentId, saleDate, saleDate) });
});

app.delete('/api/physical-tickets/sales/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const currentSale = db.prepare('SELECT id, sale_date FROM physical_ticket_sales WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!currentSale) {
    return res.status(404).json({ message: 'Venta fisica no encontrada.' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM physical_ticket_sale_items WHERE sale_id = ? AND establishment_id = ? AND event_id = ?').run(req.params.id, establishmentId, eventId);
    db.prepare('DELETE FROM physical_ticket_sales WHERE id = ? AND establishment_id = ? AND event_id = ?').run(req.params.id, establishmentId, eventId);
  })();
  res.json({ ok: true, report: physicalTicketsReport(eventId, establishmentId, currentSale.sale_date, currentSale.sale_date) });
});

app.post('/api/physical-tickets/stock', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const entryDate = String(req.body.entry_date || new Date().toISOString().slice(0, 10)).trim();
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [{ location: req.body.location, quantity: req.body.quantity, notes: req.body.notes }];
  const normalizedItems = requestedItems
    .map((item) => ({
      location: String(item.location || '').trim(),
      quantity: Math.floor(Number(item.quantity || 0)),
      notes: String(item.notes || req.body.notes || '').trim()
    }))
    .filter((item) => item.location && item.quantity > 0);
  if (!normalizedItems.length) {
    return res.status(400).json({ message: 'Agrega al menos una localidad y cantidad ingresada.' });
  }
  const validLocations = new Set(db.prepare('SELECT name FROM event_locations WHERE event_id = ?').all(eventId).map((item) => item.name));
  if (normalizedItems.some((item) => !validLocations.has(item.location))) {
    return res.status(400).json({ message: 'Localidad no encontrada.' });
  }
  const createdBy = req.user?.username || req.user?.role || 'admin';
  db.transaction(() => {
    const insertEntry = db.prepare(
      `INSERT INTO physical_ticket_stock_entries
       (establishment_id, event_id, entry_date, location, quantity, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of normalizedItems) {
      insertEntry.run(establishmentId, eventId, entryDate, item.location, item.quantity, item.notes, createdBy);
    }
  })();
  res.status(201).json(physicalTicketsReport(eventId, establishmentId, entryDate, entryDate));
});

app.put('/api/physical-tickets/stock/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const currentEntry = db.prepare('SELECT id, entry_date FROM physical_ticket_stock_entries WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!currentEntry) {
    return res.status(404).json({ message: 'Ingreso de entradas no encontrado.' });
  }
  const entryDate = String(req.body.entry_date || currentEntry.entry_date || new Date().toISOString().slice(0, 10)).trim();
  const location = String(req.body.location || '').trim();
  const quantity = Math.floor(Number(req.body.quantity || 0));
  if (!location || quantity <= 0) {
    return res.status(400).json({ message: 'Selecciona localidad y cantidad ingresada.' });
  }
  const validLocation = db.prepare('SELECT id FROM event_locations WHERE event_id = ? AND name = ?').get(eventId, location);
  if (!validLocation) {
    return res.status(400).json({ message: 'Localidad no encontrada.' });
  }
  db.prepare(
    `UPDATE physical_ticket_stock_entries
     SET entry_date = ?, location = ?, quantity = ?, notes = ?
     WHERE id = ? AND establishment_id = ? AND event_id = ?`
  ).run(entryDate, location, quantity, String(req.body.notes || '').trim(), req.params.id, establishmentId, eventId);
  res.json({ ok: true, report: physicalTicketsReport(eventId, establishmentId, entryDate, entryDate) });
});

app.delete('/api/physical-tickets/stock/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const currentEntry = db.prepare('SELECT id, entry_date FROM physical_ticket_stock_entries WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!currentEntry) {
    return res.status(404).json({ message: 'Ingreso de entradas no encontrado.' });
  }
  db.prepare('DELETE FROM physical_ticket_stock_entries WHERE id = ? AND establishment_id = ? AND event_id = ?').run(req.params.id, establishmentId, eventId);
  res.json({ ok: true, report: physicalTicketsReport(eventId, establishmentId, currentEntry.entry_date, currentEntry.entry_date) });
});

app.post('/api/physical-tickets/expenses', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const expenseDate = String(req.body.expense_date || new Date().toISOString().slice(0, 10)).trim();
  const description = String(req.body.description || '').trim();
  const amount = Math.max(0, Number(req.body.amount || 0));
  if (!description || amount <= 0) {
    return res.status(400).json({ message: 'Escribe descripcion y valor del gasto.' });
  }
  db.prepare(
    `INSERT INTO physical_ticket_daily_expenses
     (establishment_id, event_id, expense_date, description, amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(establishmentId, eventId, expenseDate, description, toMoney(amount), req.user?.username || req.user?.role || 'admin');
  res.status(201).json(physicalTicketsReport(eventId, establishmentId, expenseDate, expenseDate));
});

app.post('/api/physical-tickets/withdrawals', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const withdrawalDate = String(req.body.withdrawal_date || new Date().toISOString().slice(0, 10)).trim();
  const quantity = Math.max(1, Math.floor(Number(req.body.quantity || 1)));
  const amount = Math.max(0, Number(req.body.amount || 0));
  const total = toMoney(quantity * amount);
  const notes = String(req.body.notes || '').trim();
  if (total <= 0) {
    return res.status(400).json({ message: 'Escribe cantidad y valor del retiro.' });
  }
  db.prepare(
    `INSERT INTO physical_ticket_cash_withdrawals
     (establishment_id, event_id, withdrawal_date, quantity, amount, total, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(establishmentId, eventId, withdrawalDate, quantity, toMoney(amount), total, notes, req.user?.username || req.user?.role || 'admin');
  res.status(201).json(physicalTicketsReport(eventId, establishmentId, withdrawalDate, withdrawalDate));
});

const eventBoxOfficeDefaults = [
  { match: 'FAN', quantity: 200, unit_price: 20 },
  { match: 'VIP', quantity: 200, unit_price: 30 },
  { match: 'BOX', quantity: 100, unit_price: 40 }
];

function eventBoxOfficePrice(location) {
  const lookup = normalizeLookup(location);
  const defaultRow = eventBoxOfficeDefaults.find((item) => lookup.includes(normalizeLookup(item.match)));
  return defaultRow ? defaultRow.unit_price : 0;
}

function ensureEventBoxOfficeStock(eventId, establishmentId) {
  const existing = db.prepare(
    'SELECT COUNT(*) AS total FROM event_box_office_ticket_stock_entries WHERE establishment_id = ? AND event_id = ?'
  ).get(establishmentId, eventId).total;
  if (existing > 0) return;
  const locations = db.prepare('SELECT name FROM event_locations WHERE event_id = ?').all(eventId);
  const createdBy = 'sistema';
  db.transaction(() => {
    const insertEntry = db.prepare(
      `INSERT INTO event_box_office_ticket_stock_entries
       (establishment_id, event_id, entry_date, location, quantity, unit_price, notes, created_by)
       VALUES (?, ?, date('now', 'localtime'), ?, ?, ?, ?, ?)`
    );
    for (const defaultRow of eventBoxOfficeDefaults) {
      const location = locations.find((item) => normalizeLookup(item.name).includes(normalizeLookup(defaultRow.match)));
      if (location) {
        insertEntry.run(establishmentId, eventId, location.name, defaultRow.quantity, defaultRow.unit_price, 'Stock inicial boleteria evento', createdBy);
      }
    }
  })();
}

function eventBoxOfficeReport(eventId, establishmentId, dateFrom, dateTo) {
  ensureEventBoxOfficeStock(eventId, establishmentId);
  const from = dateFrom || new Date().toISOString().slice(0, 10);
  const to = dateTo || from;
  const sales = db.prepare(
    `SELECT *
     FROM event_box_office_ticket_sales
     WHERE establishment_id = ? AND event_id = ? AND sale_date BETWEEN ? AND ?
     ORDER BY sale_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allSales = db.prepare(
    `SELECT *
     FROM event_box_office_ticket_sales
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY sale_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const stockEntries = db.prepare(
    `SELECT *
     FROM event_box_office_ticket_stock_entries
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY entry_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const inventoryRows = db.prepare(
    `SELECT locations.name AS location,
            COALESCE(stock.quantity, 0) AS stock_quantity,
            COALESCE(sold.quantity, 0) AS sold_quantity
     FROM event_locations AS locations
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM event_box_office_ticket_stock_entries
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS stock ON stock.location = locations.name
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM event_box_office_ticket_sales
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS sold ON sold.location = locations.name
     WHERE locations.event_id = ?
     ORDER BY locations.name COLLATE NOCASE`
  ).all(establishmentId, eventId, establishmentId, eventId, eventId).map((row) => ({
    location: row.location,
    unit_price: eventBoxOfficePrice(row.location),
    stock_quantity: Number(row.stock_quantity || 0),
    sold_quantity: Number(row.sold_quantity || 0),
    remaining_quantity: Number(row.stock_quantity || 0) - Number(row.sold_quantity || 0)
  }));
  const byLocationMap = new Map();
  for (const sale of sales) {
    const current = byLocationMap.get(sale.location) || { location: sale.location, quantity: 0, total: 0 };
    current.quantity += Number(sale.quantity || 0);
    current.total = toMoney(current.total + Number(sale.total || 0));
    byLocationMap.set(sale.location, current);
  }
  const totals = {
    soldQuantity: sales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0),
    total: toMoney(sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    stockQuantity: stockEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    remainingQuantity: inventoryRows.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0)
  };
  const allTotals = {
    soldQuantity: allSales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0),
    total: toMoney(allSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)),
    stockQuantity: stockEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    remainingQuantity: inventoryRows.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0)
  };
  return {
    date_from: from,
    date_to: to,
    sales,
    all_sales: allSales,
    stock_entries: stockEntries,
    inventory_by_location: inventoryRows,
    by_location: [...byLocationMap.values()],
    totals,
    all_totals: allTotals
  };
}

app.get('/api/event-box-office/report', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const dateFrom = String(req.query.date_from || req.query.date || '').trim();
  const dateTo = String(req.query.date_to || dateFrom || '').trim();
  res.json(eventBoxOfficeReport(eventId, establishmentId, dateFrom, dateTo));
});

app.post('/api/event-box-office/sales', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  ensureEventBoxOfficeStock(eventId, establishmentId);
  const saleDate = String(req.body.sale_date || new Date().toISOString().slice(0, 10)).trim();
  const location = String(req.body.location || '').trim();
  const quantity = Math.floor(Number(req.body.quantity || 0));
  const validLocation = db.prepare("SELECT id, name FROM event_locations WHERE event_id = ? AND name = ? AND status = 'active'").get(eventId, location);
  if (!saleDate || !validLocation || quantity <= 0) {
    return res.status(400).json({ message: 'Fecha, localidad y cantidad son obligatorios.' });
  }
  const inventory = eventBoxOfficeReport(eventId, establishmentId, saleDate, saleDate).inventory_by_location.find((row) => row.location === location);
  if (!inventory || Number(inventory.remaining_quantity || 0) < quantity) {
    return res.status(400).json({ message: 'No hay suficientes entradas disponibles en esa localidad.' });
  }
  const unitPrice = eventBoxOfficePrice(location);
  const total = toMoney(unitPrice * quantity);
  const result = db.prepare(
    `INSERT INTO event_box_office_ticket_sales
     (establishment_id, event_id, sale_date, location, quantity, unit_price, total, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(establishmentId, eventId, saleDate, location, quantity, unitPrice, total, req.user?.username || req.user?.role || 'admin');
  const saleNumber = `BEV-${String(result.lastInsertRowid).padStart(6, '0')}`;
  db.prepare('UPDATE event_box_office_ticket_sales SET sale_number = ? WHERE id = ?').run(saleNumber, result.lastInsertRowid);
  res.status(201).json({ ok: true, sale_id: result.lastInsertRowid, report: eventBoxOfficeReport(eventId, establishmentId, saleDate, saleDate) });
});

app.delete('/api/event-box-office/sales/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const currentSale = db.prepare('SELECT id, sale_date FROM event_box_office_ticket_sales WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!currentSale) {
    return res.status(404).json({ message: 'Venta de boleteria no encontrada.' });
  }
  db.prepare('DELETE FROM event_box_office_ticket_sales WHERE id = ? AND establishment_id = ? AND event_id = ?').run(req.params.id, establishmentId, eventId);
  res.json({ ok: true, report: eventBoxOfficeReport(eventId, establishmentId, currentSale.sale_date, currentSale.sale_date) });
});

function normalizeComplimentaryStockItems(items, fallbackNotes = '') {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      location: String(item.location || '').trim(),
      quantity: Math.floor(Number(item.quantity || 0)),
      notes: String(item.notes || fallbackNotes || '').trim()
    }))
    .filter((item) => item.location && item.quantity > 0);
}

function validateTicketLocations(eventId, locations, activeOnly = false) {
  const query = activeOnly
    ? "SELECT name FROM event_locations WHERE event_id = ? AND status = 'active'"
    : 'SELECT name FROM event_locations WHERE event_id = ?';
  const validLocations = new Set(db.prepare(query).all(eventId).map((item) => item.name));
  return locations.every((location) => validLocations.has(location));
}

function complimentaryTicketsReport(eventId, establishmentId, dateFrom, dateTo) {
  const from = dateFrom || new Date().toISOString().slice(0, 10);
  const to = dateTo || from;
  const entries = db.prepare(
    `SELECT *
     FROM complimentary_ticket_stock_entries
     WHERE establishment_id = ? AND event_id = ? AND entry_date BETWEEN ? AND ?
     ORDER BY entry_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allEntries = db.prepare(
    `SELECT *
     FROM complimentary_ticket_stock_entries
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY entry_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const redemptions = db.prepare(
    `SELECT *
     FROM complimentary_ticket_redemptions
     WHERE establishment_id = ? AND event_id = ? AND redemption_date BETWEEN ? AND ?
     ORDER BY redemption_date DESC, id DESC`
  ).all(establishmentId, eventId, from, to);
  const allRedemptions = db.prepare(
    `SELECT *
     FROM complimentary_ticket_redemptions
     WHERE establishment_id = ? AND event_id = ?
     ORDER BY redemption_date DESC, id DESC`
  ).all(establishmentId, eventId);
  const inventoryRows = db.prepare(
    `SELECT locations.name AS location,
            COALESCE(stock.quantity, 0) AS stock_quantity,
            COALESCE(redemptions.quantity, 0) AS redeemed_quantity
     FROM event_locations AS locations
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM complimentary_ticket_stock_entries
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS stock ON stock.location = locations.name
     LEFT JOIN (
       SELECT location, SUM(quantity) AS quantity
       FROM complimentary_ticket_redemptions
       WHERE establishment_id = ? AND event_id = ?
       GROUP BY location
     ) AS redemptions ON redemptions.location = locations.name
     WHERE locations.event_id = ?
     ORDER BY locations.name COLLATE NOCASE`
  ).all(establishmentId, eventId, establishmentId, eventId, eventId).map((row) => ({
    location: row.location,
    stock_quantity: Number(row.stock_quantity || 0),
    redeemed_quantity: Number(row.redeemed_quantity || 0),
    remaining_quantity: Number(row.stock_quantity || 0) - Number(row.redeemed_quantity || 0)
  }));
  const byLocationMap = new Map();
  for (const row of redemptions) {
    const current = byLocationMap.get(row.location) || { location: row.location, quantity: 0 };
    current.quantity += Number(row.quantity || 0);
    byLocationMap.set(row.location, current);
  }
  const totals = {
    stockQuantity: entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    redeemedQuantity: redemptions.reduce((sum, redemption) => sum + Number(redemption.quantity || 0), 0)
  };
  totals.remainingQuantity = inventoryRows.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0);
  const allTotals = {
    stockQuantity: allEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    redeemedQuantity: allRedemptions.reduce((sum, redemption) => sum + Number(redemption.quantity || 0), 0)
  };
  allTotals.remainingQuantity = inventoryRows.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0);
  return {
    date_from: from,
    date_to: to,
    entries,
    all_entries: allEntries,
    redemptions,
    all_redemptions: allRedemptions,
    by_location: [...byLocationMap.values()],
    inventory_by_location: inventoryRows,
    totals,
    all_totals: allTotals
  };
}

app.get('/api/complimentary-tickets/report', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const dateFrom = String(req.query.date_from || req.query.date || '').trim();
  const dateTo = String(req.query.date_to || dateFrom || '').trim();
  res.json(complimentaryTicketsReport(eventId, establishmentId, dateFrom, dateTo));
});

app.post('/api/complimentary-tickets/stock', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const entryDate = String(req.body.entry_date || new Date().toISOString().slice(0, 10)).trim();
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [{ location: req.body.location, quantity: req.body.quantity, notes: req.body.notes }];
  const normalizedItems = normalizeComplimentaryStockItems(requestedItems, req.body.notes);
  if (!normalizedItems.length) {
    return res.status(400).json({ message: 'Agrega al menos una localidad y cantidad de cortesia.' });
  }
  if (!validateTicketLocations(eventId, normalizedItems.map((item) => item.location))) {
    return res.status(400).json({ message: 'Localidad no encontrada.' });
  }
  const createdBy = req.user?.username || req.user?.role || 'admin';
  db.transaction(() => {
    const insertEntry = db.prepare(
      `INSERT INTO complimentary_ticket_stock_entries
       (establishment_id, event_id, entry_date, location, quantity, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of normalizedItems) {
      insertEntry.run(establishmentId, eventId, entryDate, item.location, item.quantity, item.notes, createdBy);
    }
  })();
  res.status(201).json(complimentaryTicketsReport(eventId, establishmentId, entryDate, entryDate));
});

app.post('/api/complimentary-tickets/redemptions', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const redemptionDate = String(req.body.redemption_date || new Date().toISOString().slice(0, 10)).trim();
  const promoterId = Number(req.body.promoter_id || 0);
  const recipientName = String(req.body.recipient_name || '').trim();
  const recipientCedula = String(req.body.recipient_cedula || '').trim();
  const location = String(req.body.location || '').trim();
  const quantity = Math.floor(Number(req.body.quantity || 0));
  if (!redemptionDate || !promoterId || !recipientName || !recipientCedula || !location || quantity <= 0) {
    return res.status(400).json({ message: 'Fecha, promotor, nombre, cedula, localidad y cantidad son obligatorios.' });
  }
  if (!validateTicketLocations(eventId, [location], true)) {
    return res.status(400).json({ message: 'Selecciona una localidad activa.' });
  }
  const promoter = db.prepare(
    `SELECT id, name
     FROM promoters
     WHERE id = ? AND establishment_id = ? AND deleted_at IS NULL`
  ).get(promoterId, establishmentId);
  if (!promoter) {
    return res.status(400).json({ message: 'Promotor no encontrado.' });
  }
  const inventory = complimentaryTicketsReport(eventId, establishmentId, redemptionDate, redemptionDate)
    .inventory_by_location
    .find((row) => row.location === location);
  if (!inventory || Number(inventory.remaining_quantity || 0) < quantity) {
    return res.status(400).json({ message: 'No hay suficientes entradas de cortesia disponibles para esa localidad.' });
  }
  const createdBy = req.user?.username || req.user?.role || 'admin';
  const result = db.prepare(
    `INSERT INTO complimentary_ticket_redemptions
     (establishment_id, event_id, redemption_date, promoter_id, promoter_name, recipient_name, recipient_cedula, location, quantity, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(establishmentId, eventId, redemptionDate, promoter.id, promoter.name, recipientName, recipientCedula, location, quantity, createdBy);
  const redemptionNumber = `CAN-${String(result.lastInsertRowid).padStart(6, '0')}`;
  db.prepare('UPDATE complimentary_ticket_redemptions SET redemption_number = ? WHERE id = ?').run(redemptionNumber, result.lastInsertRowid);
  res.status(201).json({ ok: true, redemption_id: result.lastInsertRowid, report: complimentaryTicketsReport(eventId, establishmentId, redemptionDate, redemptionDate) });
});

function boxOfficeTicketExchangeReport(eventId, establishmentId, search = '') {
  const cleanSearch = String(search || '').trim();
  const searchLike = `%${cleanSearch}%`;
  const rows = cleanSearch
    ? db.prepare(
      `SELECT *
       FROM box_office_ticket_exchanges
       WHERE establishment_id = ? AND event_id = ?
         AND (recipient_name LIKE ? OR recipient_cedula LIKE ? OR location LIKE ? OR exchange_number LIKE ?)
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, recipient_name COLLATE NOCASE, id DESC`
    ).all(establishmentId, eventId, searchLike, searchLike, searchLike, searchLike)
    : db.prepare(
      `SELECT *
       FROM box_office_ticket_exchanges
       WHERE establishment_id = ? AND event_id = ?
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, recipient_name COLLATE NOCASE, id DESC`
    ).all(establishmentId, eventId);
  const allRows = db.prepare(
    `SELECT *
     FROM box_office_ticket_exchanges
     WHERE establishment_id = ? AND event_id = ?`
  ).all(establishmentId, eventId);
  const byLocationMap = new Map();
  for (const row of allRows) {
    const current = byLocationMap.get(row.location) || { location: row.location, quantity: 0, pending: 0, exchanged: 0 };
    const quantity = Number(row.quantity || 0);
    current.quantity += quantity;
    if (row.status === 'exchanged') {
      current.exchanged += quantity;
    } else {
      current.pending += quantity;
    }
    byLocationMap.set(row.location, current);
  }
  const totals = allRows.reduce((current, row) => {
    const quantity = Number(row.quantity || 0);
    current.quantity += quantity;
    if (row.status === 'exchanged') {
      current.exchanged += quantity;
      current.exchanged_records += 1;
    } else {
      current.pending += quantity;
      current.pending_records += 1;
    }
    current.records += 1;
    return current;
  }, { records: 0, quantity: 0, pending: 0, exchanged: 0, pending_records: 0, exchanged_records: 0 });
  return {
    search: cleanSearch,
    exchanges: rows,
    all_exchanges: allRows,
    by_location: [...byLocationMap.values()].sort((a, b) => a.location.localeCompare(b.location)),
    totals
  };
}

app.get('/api/box-office-ticket-exchanges', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  res.json(boxOfficeTicketExchangeReport(eventId, establishmentId, req.query.search));
});

app.post('/api/box-office-ticket-exchanges', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const registeredDate = String(req.body.registered_date || new Date().toISOString().slice(0, 10)).trim();
  const recipientName = String(req.body.recipient_name || '').trim();
  const recipientCedula = String(req.body.recipient_cedula || '').trim();
  const location = String(req.body.location || '').trim();
  const quantity = Math.floor(Number(req.body.quantity || 0));
  const notes = String(req.body.notes || '').trim();
  if (!registeredDate || !recipientName || !recipientCedula || !location || quantity <= 0) {
    return res.status(400).json({ message: 'Fecha, nombre, cedula, localidad y cantidad son obligatorios.' });
  }
  if (!validateTicketLocations(eventId, [location], true)) {
    return res.status(400).json({ message: 'Selecciona una localidad activa.' });
  }
  const createdBy = req.user?.username || req.user?.role || 'admin';
  const matchingPending = db.prepare(
    `SELECT id, recipient_name
     FROM box_office_ticket_exchanges
     WHERE establishment_id = ? AND event_id = ? AND recipient_cedula = ? AND location = ? AND status = 'pending'`
  ).all(establishmentId, eventId, recipientCedula, location)
    .find((row) => normalizeLookup(row.recipient_name) === normalizeLookup(recipientName));
  if (matchingPending) {
    db.prepare(
      `UPDATE box_office_ticket_exchanges
       SET quantity = quantity + ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END
       WHERE id = ? AND establishment_id = ? AND event_id = ?`
    ).run(quantity, notes, notes, matchingPending.id, establishmentId, eventId);
    return res.status(200).json({ ok: true, exchange_id: matchingPending.id, merged: true, report: boxOfficeTicketExchangeReport(eventId, establishmentId) });
  }
  const result = db.prepare(
    `INSERT INTO box_office_ticket_exchanges
     (establishment_id, event_id, registered_date, recipient_name, recipient_cedula, location, quantity, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(establishmentId, eventId, registeredDate, recipientName, recipientCedula, location, quantity, notes, createdBy);
  const exchangeNumber = `BOL-${String(result.lastInsertRowid).padStart(6, '0')}`;
  db.prepare('UPDATE box_office_ticket_exchanges SET exchange_number = ? WHERE id = ?').run(exchangeNumber, result.lastInsertRowid);
  res.status(201).json({ ok: true, exchange_id: result.lastInsertRowid, report: boxOfficeTicketExchangeReport(eventId, establishmentId) });
});

app.put('/api/box-office-ticket-exchanges/:id', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const current = db.prepare('SELECT id FROM box_office_ticket_exchanges WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!current) {
    return res.status(404).json({ message: 'Registro no encontrado.' });
  }
  const registeredDate = String(req.body.registered_date || new Date().toISOString().slice(0, 10)).trim();
  const recipientName = String(req.body.recipient_name || '').trim();
  const recipientCedula = String(req.body.recipient_cedula || '').trim();
  const location = String(req.body.location || '').trim();
  const quantity = Math.floor(Number(req.body.quantity || 0));
  const notes = String(req.body.notes || '').trim();
  if (!registeredDate || !recipientName || !recipientCedula || !location || quantity <= 0) {
    return res.status(400).json({ message: 'Fecha, nombre, cedula, localidad y cantidad son obligatorios.' });
  }
  if (!validateTicketLocations(eventId, [location], true)) {
    return res.status(400).json({ message: 'Selecciona una localidad activa.' });
  }
  db.prepare(
    `UPDATE box_office_ticket_exchanges
     SET registered_date = ?, recipient_name = ?, recipient_cedula = ?, location = ?, quantity = ?, notes = ?
     WHERE id = ? AND establishment_id = ? AND event_id = ?`
  ).run(registeredDate, recipientName, recipientCedula, location, quantity, notes, req.params.id, establishmentId, eventId);
  res.json({ ok: true, report: boxOfficeTicketExchangeReport(eventId, establishmentId) });
});

app.patch('/api/box-office-ticket-exchanges/:id/status', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const status = String(req.body.status || '').trim() === 'exchanged' ? 'exchanged' : 'pending';
  const current = db.prepare('SELECT id FROM box_office_ticket_exchanges WHERE id = ? AND establishment_id = ? AND event_id = ?').get(req.params.id, establishmentId, eventId);
  if (!current) {
    return res.status(404).json({ message: 'Registro no encontrado.' });
  }
  db.prepare(
    `UPDATE box_office_ticket_exchanges
     SET status = ?, exchanged_at = CASE WHEN ? = 'exchanged' THEN datetime('now', 'localtime') ELSE NULL END,
         checked_by = CASE WHEN ? = 'exchanged' THEN ? ELSE NULL END
     WHERE id = ? AND establishment_id = ? AND event_id = ?`
  ).run(status, status, status, req.user?.username || req.user?.role || 'admin', req.params.id, establishmentId, eventId);
  res.json({ ok: true, report: boxOfficeTicketExchangeReport(eventId, establishmentId) });
});

app.get('/api/promoter/me', requirePromoter, (req, res) => {
  const establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.user.establishmentId);
  const activeEvent = getActiveEvent(req.user.establishmentId);
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url, status, can_sell FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, establishment, activeEvent, level: getPromoterLevel(req.user.promoterId, activeEvent?.id || 1) });
});

app.patch('/api/promoter/profile', requirePromoter, (req, res) => {
  const establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(req.user.establishmentId);
  const activeEvent = getActiveEvent(req.user.establishmentId);
  const photoUrl = String(req.body.photo_url || '').trim();
  const current = db.prepare('SELECT id, code, whatsapp FROM promoters WHERE id = ? AND deleted_at IS NULL').get(req.user.promoterId);

  if (!current) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  const nextCode = req.body.code === undefined ? current.code : formatEditablePromoterCode(req.body.code);
  const nextWhatsapp = req.body.whatsapp === undefined ? current.whatsapp : String(req.body.whatsapp || '').trim();

  if (!nextCode || nextCode.length < 3) {
    return res.status(400).json({ message: 'El codigo debe tener al menos 3 caracteres' });
  }

  if (nextCode.length > 40) {
    return res.status(400).json({ message: 'El codigo no puede tener mas de 40 caracteres' });
  }

  if (containsBlockedWords(nextCode)) {
    return res.status(400).json({ message: 'El codigo contiene palabras no permitidas' });
  }

  if (!nextWhatsapp || nextWhatsapp.length < 7) {
    return res.status(400).json({ message: 'Ingresa un WhatsApp valido' });
  }

  const repeatedCode = db
    .prepare('SELECT id, code FROM promoters WHERE id <> ? AND deleted_at IS NULL')
    .all(req.user.promoterId)
    .find((promoter) => normalizeLookup(promoter.code) === normalizeLookup(nextCode));

  if (repeatedCode) {
    return res.status(409).json({ message: 'Ese codigo ya esta registrado por otro promotor' });
  }

  db.prepare('UPDATE promoters SET photo_url = ?, code = ?, whatsapp = ? WHERE id = ?').run(photoUrl, nextCode, nextWhatsapp, req.user.promoterId);
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url, status, can_sell FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, establishment, activeEvent, level: getPromoterLevel(req.user.promoterId, activeEvent?.id || 1) });
});

app.get('/api/promoter/sales', requirePromoter, (req, res) => {
  const eventId = getActiveEvent(req.user.establishmentId)?.id || 1;
  const sales = db
    .prepare('SELECT * FROM sales WHERE promoter_id = ? AND establishment_id = ? AND event_id = ? AND deleted_at IS NULL ORDER BY sale_date DESC, id DESC')
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

app.get('/api/promoter/withdrawals', requirePromoter, (req, res) => {
  const eventId = getActiveEvent(req.user.establishmentId)?.id || 1;
  const rows = db
    .prepare(
      `SELECT *
       FROM withdrawal_requests
       WHERE promoter_id = ? AND establishment_id = ? AND event_id = ?
       ORDER BY requested_at DESC, id DESC`
    )
    .all(req.user.promoterId, req.user.establishmentId, eventId)
    .map((row) => ({ ...row, amount: toMoney(row.amount) }));
  res.json(rows);
});

app.post('/api/promoter/withdrawals', requirePromoter, (req, res) => {
  const eventId = getActiveEvent(req.user.establishmentId)?.id || 1;
  const bank = String(req.body.bank || '').trim();
  const accountHolder = String(req.body.account_holder || req.body.accountHolder || '').trim();
  const accountNumber = String(req.body.account_number || req.body.accountNumber || '').trim();
  const cedula = String(req.body.cedula || '').trim();
  const amount = getAvailableCommission(req.user.promoterId, eventId, req.user.establishmentId);

  if (!bank || !accountHolder || !accountNumber || !cedula) {
    return res.status(400).json({ message: 'Completa los datos bancarios para solicitar el retiro' });
  }

  if (amount <= 0) {
    return res.status(400).json({ message: 'No tienes comision disponible para retirar' });
  }

  const pending = db
    .prepare(
      `SELECT id
       FROM withdrawal_requests
       WHERE promoter_id = ? AND establishment_id = ? AND event_id = ? AND status = 'pending'`
    )
    .get(req.user.promoterId, req.user.establishmentId, eventId);

  if (pending) {
    return res.status(400).json({ message: 'Ya tienes una solicitud de retiro pendiente' });
  }

  const result = db
    .prepare(
      `INSERT INTO withdrawal_requests
       (establishment_id, event_id, promoter_id, amount, bank, account_holder, account_number, cedula)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.establishmentId, eventId, req.user.promoterId, amount, bank, accountHolder, accountNumber, cedula);

  res.status(201).json({
    ...db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(result.lastInsertRowid),
    message: 'Solicitud enviada. Sera acreditado en 24 a 48 horas.'
  });
});

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
       LEFT JOIN sales ON sales.promoter_id = promoters.id AND sales.event_id = ? AND sales.deleted_at IS NULL
       WHERE promoters.establishment_id = ? AND promoters.deleted_at IS NULL
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
       LEFT JOIN sales ON sales.promoter_id = promoters.id AND sales.event_id = ? AND sales.deleted_at IS NULL
       WHERE promoters.establishment_id = ? AND promoters.deleted_at IS NULL
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
    .prepare("UPDATE sales SET commission_paid = 1 WHERE promoter_id = ? AND event_id = ? AND payment_status = 'paid' AND commission > 0 AND commission_paid = 0 AND deleted_at IS NULL")
    .run(promoterId, eventId);
  res.json({ updatedSales: result.changes });
});

app.get('/api/withdrawals', requireAdmin, (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const rows = db
    .prepare(
      `SELECT withdrawal_requests.*,
              promoters.name AS promoter_name,
              promoters.code AS promoter_code
       FROM withdrawal_requests
       JOIN promoters ON promoters.id = withdrawal_requests.promoter_id
       WHERE withdrawal_requests.event_id = ?
         AND withdrawal_requests.establishment_id = ?
       ORDER BY withdrawal_requests.status ASC, withdrawal_requests.requested_at DESC, withdrawal_requests.id DESC`
    )
    .all(eventId, establishmentId)
    .map((row) => ({ ...row, amount: toMoney(row.amount) }));
  res.json(rows);
});

app.patch('/api/withdrawals/:id/pay', requireAdmin, async (req, res) => {
  const eventId = getRequestEventId(req);
  const establishmentId = getRequestEstablishmentId(req);
  const withdrawal = db
    .prepare(
      `SELECT withdrawal_requests.*,
              promoters.name AS promoter_name,
              promoters.email AS promoter_email
       FROM withdrawal_requests
       JOIN promoters ON promoters.id = withdrawal_requests.promoter_id
       WHERE withdrawal_requests.id = ?
         AND withdrawal_requests.event_id = ?
         AND withdrawal_requests.establishment_id = ?`
    )
    .get(req.params.id, eventId, establishmentId);

  if (!withdrawal) {
    return res.status(404).json({ message: 'Solicitud de retiro no encontrada' });
  }

  if (withdrawal.status === 'paid') {
    return res.json({ ok: true, message: 'Retiro ya estaba marcado como realizado' });
  }

  const transaction = db.transaction(() => {
    db.prepare("UPDATE withdrawal_requests SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(withdrawal.id);
    return db
      .prepare(
        `UPDATE sales
         SET commission_paid = 1
         WHERE promoter_id = ?
           AND event_id = ?
           AND establishment_id = ?
            AND payment_status = 'paid'
            AND commission > 0
            AND commission_paid = 0
            AND deleted_at IS NULL`
      )
      .run(withdrawal.promoter_id, eventId, establishmentId);
  });

  const result = transaction();
  let emailResult = { sent: false };
  try {
    emailResult = await sendWithdrawalPaidEmail({
      to: withdrawal.promoter_email,
      name: withdrawal.promoter_name,
      withdrawal
    });
  } catch (error) {
    emailResult = { sent: false, reason: error.message };
  }

  res.json({ ok: true, updatedSales: result.changes, email_sent: Boolean(emailResult.sent) });
});

app.get('/api/verify/:code', (req, res) => {
  const promoter = findPromoterForVerification(req.params.code);

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  const isActive = promoter.status === 'active';
  const eventId = getActiveEvent(promoter.establishment_id)?.id || 1;
  const brandName = promoter.establishment_display_name || promoter.establishment_name || 'PROMOTERS';
  return res.json({
    registered: true,
    active: isActive,
    message: isActive ? `Promotor oficial ${brandName}` : 'Promotor inactivo',
    promoter: {
      ...promoter,
      level: isActive ? getPromoterLevel(promoter.id, eventId) : { key: 'inactive', name: 'Inactive' }
    }
  });
});

app.post('/api/verify', (req, res) => {
  const promoter = findPromoterForVerification(req.body.code);

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  const isActive = promoter.status === 'active';
  const eventId = getActiveEvent(promoter.establishment_id)?.id || 1;
  const brandName = promoter.establishment_display_name || promoter.establishment_name || 'PROMOTERS';
  return res.json({
    registered: true,
    active: isActive,
    message: isActive ? `Promotor oficial ${brandName}` : 'Promotor inactivo',
    promoter: {
      ...promoter,
      level: isActive ? getPromoterLevel(promoter.id, eventId) : { key: 'inactive', name: 'Inactive' }
    }
  });
});

registerProducalzaRoutes(app, db, getRequestEstablishmentId);
registerRenjiRoutes(app, db, getRequestEstablishmentId);

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
