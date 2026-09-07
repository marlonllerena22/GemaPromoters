import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { createToken, requireAuth } from './auth.js';

export const MARJORIE_TERMS_VERSION = '2026-09-06';

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const bool = (value) => value ? 1 : 0;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
const dayDate = (value) => new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (value, days) => {
  const date = dayDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
};
const dayDiff = (from, to) => Math.floor((dayDate(to) - dayDate(from)) / 86400000);

export function marjorieCommissionRate(pairs) {
  if (pairs >= 10) return 5;
  if (pairs >= 5) return 4;
  if (pairs >= 1) return 2.5;
  return 0;
}

export function marjorieCycleFor(activatedAt, targetDate = today()) {
  const start = String(activatedAt || targetDate).slice(0, 10);
  const elapsed = Math.max(0, dayDiff(start, targetDate));
  const index = Math.floor(elapsed / 30);
  const cycleStart = addDays(start, index * 30);
  return {
    index,
    start: cycleStart,
    first_cut: addDays(cycleStart, 15),
    end: addDays(cycleStart, 30),
    days_remaining: Math.max(0, dayDiff(targetDate, addDays(cycleStart, 30)))
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, salt, expected] = String(stored || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validImage(value) {
  return !value || /^(data:image\/(png|jpeg|webp);base64,|\/)/i.test(value);
}

function statusLabel(status) {
  return ({ pending: 'Pendiente', active: 'Activa', review: 'En revision', suspended: 'Suspendida', revoked: 'Revocada', rejected: 'Rechazada' })[status] || status;
}

function safePromoter(promoter) {
  const { password_hash: _passwordHash, ...safe } = promoter;
  return safe;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

export function registerMarjoriePromotersRoutes(app, db) {
  const publicUrl = () => String(process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');

  async function sendApprovalEmail(promoter) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return { sent: false, reason: 'SMTP no configurado' };
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const loginUrl = publicUrl();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: promoter.email,
      subject: 'Tu cuenta de promotora Marjorie Botas fue aprobada',
      text: `Hola ${promoter.name},\n\nTu registro fue aprobado y tu cuenta ya esta activa.\n\nUsuario: ${promoter.email}\nCodigo de promotora: ${promoter.code}\nContrasena: utiliza la que creaste al registrarte.\n\nIngresa aqui: ${loginUrl}\n\nTambien puedes iniciar sesion usando tu codigo de promotora como usuario.`,
      html: `<div style="font-family:Arial,sans-serif;background:#fff8f2;color:#3f2924;padding:28px;border:1px solid #ead8cb;border-radius:8px">
        <h2 style="margin:0 0 12px;color:#a5211c">Bienvenida a Marjorie Botas</h2>
        <p>Hola <strong>${escapeHtml(promoter.name)}</strong>, tu registro fue aprobado y tu cuenta ya esta activa.</p>
        <div style="background:#fff;border:1px solid #e5cfc0;padding:16px;border-radius:6px">
          <p><strong>Usuario:</strong> ${escapeHtml(promoter.email)}</p>
          <p><strong>Codigo de promotora:</strong> ${escapeHtml(promoter.code)}</p>
          <p><strong>Contrasena:</strong> utiliza la que creaste al registrarte.</p>
        </div>
        <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#a5211c;color:#fff;text-decoration:none;padding:11px 18px;border-radius:5px">Ingresar a PROMOTERS</a></p>
        <p style="color:#75625b;font-size:13px">Tambien puedes iniciar sesion usando tu codigo de promotora como usuario.</p>
      </div>`
    });
    return { sent: true };
  }

  function audit(promoterId, actor, action, entityType, entityId = null, details = '') {
    db.prepare(`INSERT INTO marjorie_promoter_audit
      (promoter_id, actor, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(promoterId || null, actor || 'system', action, entityType, entityId, clean(details, 2000));
  }

  function requireMember(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role !== 'marjorie_promoter') return res.status(403).json({ message: 'Acceso exclusivo para promotoras Marjorie Botas' });
      const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.user.marjoriePromoterId);
      if (!promoter || ['rejected', 'revoked'].includes(promoter.status)) return res.status(403).json({ message: 'Esta cuenta no se encuentra disponible' });
      req.marjoriePromoter = promoter;
      next();
    });
  }

  function requireMarjorieAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user?.role === 'supreme' || req.user?.role === 'production_admin' || (req.user?.role === 'production_vendor' && req.user?.isLocalSecretary)) return next();
      if (req.user?.role === 'admin') {
        const establishment = db.prepare('SELECT name, theme FROM establishments WHERE id = ?').get(req.user.establishmentId || 0);
        if (establishment?.theme === 'marjorie' || /marjorie/i.test(establishment?.name || '')) return next();
      }
      return res.status(403).json({ message: 'No tienes acceso a la administracion de promotoras Marjorie' });
    });
  }

  function requireInventoryIntegration(req, res, next) {
    const configured = String(process.env.MARJORIE_INVENTORY_API_KEY || '');
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!configured) return res.status(503).json({ message: 'Integracion de inventario aun no configurada' });
    const left = Buffer.from(configured);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return res.status(401).json({ message: 'Credencial de integracion no valida' });
    next();
  }

  function realBranches() {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'production_clients'").get();
    if (!table) return [];
    return db.prepare(`SELECT id, name, city, address, phone
      FROM production_clients WHERE local_store_key IS NOT NULL
      ORDER BY CASE WHEN name LIKE '%Norte%' THEN 1 WHEN name LIKE '%Sur%' THEN 2 WHEN name LIKE '%Valle%' THEN 3 ELSE 4 END, name`).all();
  }

  function effectivePairs(row) {
    return row.is_paid && row.is_delivered && !row.is_voided ? Math.max(0, Number(row.pairs) - Number(row.returned_pairs || 0)) : 0;
  }

  function salesFor(promoterId) {
    return db.prepare('SELECT * FROM marjorie_promoter_sales WHERE promoter_id = ? ORDER BY sale_date DESC, id DESC').all(promoterId)
      .map((row) => ({ ...row, effective_pairs: effectivePairs(row) }));
  }

  function cycleStartFor(promoter, saleDate) {
    return marjorieCycleFor(promoter.activated_at, saleDate).start;
  }

  function commissionLedger(promoter, sales) {
    const cycles = new Map();
    for (const sale of sales) {
      if (!promoter.activated_at || sale.sale_date < String(promoter.activated_at).slice(0, 10)) continue;
      const key = cycleStartFor(promoter, sale.sale_date);
      cycles.set(key, (cycles.get(key) || 0) + effectivePairs(sale));
    }
    return [...cycles.entries()].map(([cycle_start, pairs]) => {
      const rate = marjorieCommissionRate(pairs);
      return { cycle_start, cycle_end: addDays(cycle_start, 30), pairs, rate, commission: money(pairs * rate) };
    }).sort((a, b) => a.cycle_start.localeCompare(b.cycle_start));
  }

  function lowCycleAlert(promoter, ledger, targetDate = today()) {
    const completed = ledger.filter((cycle) => cycle.cycle_end <= targetDate).sort((a, b) => b.cycle_start.localeCompare(a.cycle_start));
    let consecutive = 0;
    for (const cycle of completed) {
      if (cycle.pairs >= 10) break;
      consecutive += 1;
    }
    if (consecutive >= 3) return { level: 'revocation', label: 'Recomendar revocacion', cycles: consecutive };
    if (consecutive >= 2) return { level: 'review', label: 'En revision recomendada', cycles: consecutive };
    if (consecutive === 1) return { level: 'warning', label: 'Advertencia por ciclo bajo meta', cycles: 1 };
    return null;
  }

  function cutLiability(promoter, sales, bonuses, payments, cut) {
    const ledger = commissionLedger(promoter, sales.filter((sale) => sale.sale_date < cut.due_date));
    const commissionTotal = money(ledger.reduce((sum, row) => sum + row.commission, 0));
    const bonusTotal = money(bonuses.filter((row) => row.status === 'approved' && addDays(row.cycle_start, Number(row.cut_number) * 15) <= cut.due_date)
      .reduce((sum, row) => sum + Number(row.amount), 0));
    const commissionPaid = money(payments.reduce((sum, row) => sum + Number(row.commission_amount) + Number(row.adjustment_amount), 0));
    const bonusPaid = money(payments.reduce((sum, row) => sum + Number(row.bonus_amount), 0));
    const unpaidCommission = money(commissionTotal - commissionPaid);
    const unpaidBonus = money(bonusTotal - bonusPaid);
    const adjustment = Math.min(0, unpaidCommission);
    const commission = Math.max(0, unpaidCommission);
    const bonus = Math.max(0, unpaidBonus);
    return { commission, bonus, adjustment, total: money(Math.max(0, commission + bonus + adjustment)) };
  }

  function findPayableCut(promoter, sales, bonuses, payments, targetDate = today()) {
    if (!promoter.activated_at) return null;
    const activation = String(promoter.activated_at).slice(0, 10);
    const cyclesElapsed = Math.max(0, Math.floor(dayDiff(activation, targetDate) / 30));
    for (let cycleIndex = 0; cycleIndex <= cyclesElapsed; cycleIndex += 1) {
      const start = addDays(activation, cycleIndex * 30);
      for (const cutNumber of [1, 2]) {
        const dueDate = addDays(start, cutNumber * 15);
        if (dueDate > targetDate) continue;
        if (!payments.some((payment) => payment.cycle_start === start && Number(payment.cut_number) === cutNumber)) {
          const candidate = { cycle_start: start, cut_number: cutNumber, due_date: dueDate };
          const liability = cutLiability(promoter, sales, bonuses, payments, candidate);
          if (liability.total > 0) return { ...candidate, ...liability };
        }
      }
    }
    const current = marjorieCycleFor(activation, targetDate);
    const next = targetDate < current.first_cut
      ? { cycle_start: current.start, cut_number: 1, due_date: current.first_cut }
      : { cycle_start: current.start, cut_number: 2, due_date: current.end };
    return { ...next, ...cutLiability(promoter, sales, bonuses, payments, next) };
  }

  function promoterPayload(promoter, targetDate = today()) {
    const sales = salesFor(promoter.id);
    const payments = db.prepare('SELECT * FROM marjorie_promoter_payments WHERE promoter_id = ? ORDER BY paid_at DESC, id DESC').all(promoter.id);
    const bonuses = db.prepare('SELECT * FROM marjorie_promoter_bonuses WHERE promoter_id = ? ORDER BY cycle_start DESC, cut_number DESC').all(promoter.id);
    const ledger = commissionLedger(promoter, sales);
    const cycle = promoter.activated_at ? marjorieCycleFor(promoter.activated_at, targetDate) : null;
    const cycleRow = cycle ? ledger.find((row) => row.cycle_start === cycle.start) : null;
    const commissionTotal = money(ledger.reduce((sum, row) => sum + row.commission, 0));
    const bonusTotal = money(bonuses.filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.amount), 0));
    const totalPaid = money(payments.reduce((sum, row) => sum + Number(row.total_amount), 0));
    const commissionPaidEffective = money(payments.reduce((sum, row) => sum + Number(row.commission_amount) + Number(row.adjustment_amount), 0));
    const bonusPaid = money(payments.reduce((sum, row) => sum + Number(row.bonus_amount), 0));
    const balance = money(commissionTotal + bonusTotal - totalPaid);
    const cyclePairs = cycleRow?.pairs || 0;
    const level = cyclePairs >= 30 ? { name: 'Platino', next: null, remaining: 0, progress: 100 }
      : cyclePairs >= 10 ? { name: 'Oro', next: 'Platino', remaining: 30 - cyclePairs, progress: Math.round((cyclePairs / 30) * 100) }
        : cyclePairs >= 5 ? { name: 'Plata', next: 'Oro', remaining: 10 - cyclePairs, progress: Math.round((cyclePairs / 10) * 100) }
          : { name: 'Inicial', next: 'Plata', remaining: 5 - cyclePairs, progress: Math.round((cyclePairs / 5) * 100) };
    const payableCut = findPayableCut(promoter, sales, bonuses, payments, targetDate);
    return {
      ...safePromoter(promoter),
      status_label: statusLabel(promoter.status),
      cycle,
      level,
      cycle_pairs: cyclePairs,
      cycle_rate: marjorieCommissionRate(cyclePairs),
      cycle_commission: cycleRow?.commission || 0,
      commission_total: commissionTotal,
      approved_bonus_total: bonusTotal,
      total_paid: totalPaid,
      pending_total: Math.max(0, balance),
      ledger_balance: balance,
      unpaid_commission: money(commissionTotal - commissionPaidEffective),
      unpaid_bonus: money(bonusTotal - bonusPaid),
      payable_cut: payableCut,
      payable_total: payableCut?.total || 0,
      performance_alert: lowCycleAlert(promoter, ledger, targetDate),
      referral_url: promoter.code ? `${publicUrl()}/r/${encodeURIComponent(promoter.code)}` : '',
      qr_url: promoter.code ? `${publicUrl()}/api/marjorie/ref/${encodeURIComponent(promoter.code)}/qr` : '',
      sales,
      payments,
      bonuses,
      cycles: ledger
    };
  }

  app.post('/api/marjorie/register', (req, res) => {
    const name = clean(req.body.name, 160);
    const cedula = clean(req.body.cedula, 20);
    const whatsapp = clean(req.body.whatsapp, 30);
    const email = clean(req.body.email, 180).toLowerCase();
    const instagram = clean(req.body.instagram, 120).replace(/^@/, '');
    const city = clean(req.body.city, 120);
    const photoUrl = clean(req.body.photo_url, 6000000);
    const password = String(req.body.password || '');
    if (!name || !cedula || !whatsapp || !email || !instagram || !city || !photoUrl || password.length < 6) {
      return res.status(400).json({ message: 'Completa todos los datos, la foto y una contrasena de al menos 6 caracteres' });
    }
    if (!validEmail(email)) return res.status(400).json({ message: 'Ingresa un correo valido' });
    if (!/^\d{10,13}$/.test(cedula.replace(/\D/g, ''))) return res.status(400).json({ message: 'Ingresa una cedula valida' });
    if (!validImage(photoUrl)) return res.status(400).json({ message: 'La foto debe ser una imagen valida' });
    if (!req.body.accepted_terms) return res.status(400).json({ message: 'Debes aceptar las condiciones del programa' });
    const duplicate = db.prepare('SELECT id FROM marjorie_promoters WHERE cedula = ? OR email = ?').get(cedula, email);
    if (duplicate) return res.status(409).json({ message: 'Ya existe una solicitud con esa cedula o correo' });
    const result = db.prepare(`INSERT INTO marjorie_promoters
      (name, cedula, whatsapp, email, instagram, city, photo_url, password_hash, terms_version, terms_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`)
      .run(name, cedula, whatsapp, email, instagram, city, photoUrl, hashPassword(password), MARJORIE_TERMS_VERSION);
    audit(result.lastInsertRowid, email, 'register', 'promoter', result.lastInsertRowid, `Condiciones ${MARJORIE_TERMS_VERSION}`);
    res.status(201).json({ ok: true, message: 'Solicitud enviada. La administracion revisara tus datos antes de activar el perfil.' });
  });

  app.post('/api/marjorie/auth/login', (req, res) => {
    const username = clean(req.body.username, 180);
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE LOWER(email) = LOWER(?) OR UPPER(code) = UPPER(?)').get(username, username);
    if (!promoter || !verifyPassword(String(req.body.password || ''), promoter.password_hash)) return res.status(401).json({ message: 'Usuario o contrasena incorrectos' });
    if (['rejected', 'revoked'].includes(promoter.status)) return res.status(403).json({ message: 'Esta cuenta no se encuentra habilitada' });
    res.json({
      token: createToken({ role: 'marjorie_promoter', marjoriePromoterId: promoter.id, username: promoter.code || promoter.email }),
      user: { role: 'marjorie_promoter', id: promoter.id, name: promoter.name, code: promoter.code, status: promoter.status }
    });
  });

  app.get('/api/marjorie/terms', (_req, res) => res.json({ version: MARJORIE_TERMS_VERSION }));

  app.get('/api/marjorie/ref/:code', (req, res) => {
    const promoter = db.prepare("SELECT code, status FROM marjorie_promoters WHERE UPPER(code) = UPPER(?)").get(clean(req.params.code, 40));
    if (!promoter) return res.status(404).json({ message: 'Codigo no registrado' });
    res.json({ code: promoter.code, active: promoter.status === 'active', status: statusLabel(promoter.status), branches: realBranches() });
  });

  app.get('/api/marjorie/ref/:code/qr', async (req, res) => {
    const promoter = db.prepare("SELECT code, status FROM marjorie_promoters WHERE UPPER(code) = UPPER(?)").get(clean(req.params.code, 40));
    if (!promoter || promoter.status !== 'active') return res.status(404).end();
    const png = await QRCode.toBuffer(`${publicUrl()}/r/${encodeURIComponent(promoter.code)}`, { width: 360, margin: 1, color: { dark: '#4f2f21', light: '#fffaf4' } });
    res.type('png').send(png);
  });

  app.get('/api/integrations/marjorie/promoters/:code', requireInventoryIntegration, (req, res) => {
    const promoter = db.prepare("SELECT * FROM marjorie_promoters WHERE UPPER(code) = UPPER(?)").get(clean(req.params.code, 40));
    if (!promoter) return res.status(404).json({ valid: false, message: 'Codigo no registrado' });
    const detail = promoterPayload(promoter);
    res.json({ valid: promoter.status === 'active', code: promoter.code, status: promoter.status, cycle_points: detail.cycle_pairs, cycle_pairs: detail.cycle_pairs });
  });

  app.post('/api/integrations/marjorie/sales', requireInventoryIntegration, (req, res) => {
    const source = clean(req.body.source || 'inventory', 80).toLowerCase();
    const externalId = clean(req.body.sale_id || req.body.invoice_id, 120);
    const promoter = db.prepare("SELECT * FROM marjorie_promoters WHERE UPPER(code) = UPPER(?)").get(clean(req.body.promoter_code, 40));
    const branches = realBranches();
    const branchLookup = clean(req.body.branch_name, 180).toLowerCase();
    const branch = branches.find((row) => Number(row.id) === Number(req.body.branch_client_id))
      || branches.find((row) => row.name.toLowerCase() === branchLookup)
      || branches.find((row) => branchLookup && (row.name.toLowerCase().includes(branchLookup) || branchLookup.includes(row.name.toLowerCase())));
    const pairs = Math.floor(Number(req.body.pairs));
    const returnedPairs = Math.floor(Number(req.body.returned_pairs || 0));
    const saleDate = clean(req.body.sale_date, 10);
    if (!externalId || !promoter || promoter.status !== 'active') return res.status(400).json({ message: 'La venta requiere un identificador y un codigo de promotora activo' });
    if (!branch || pairs < 1 || returnedPairs < 0 || returnedPairs > pairs || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || saleDate > today() || saleDate < String(promoter.activated_at).slice(0, 10)) return res.status(400).json({ message: 'Revisa el local, la fecha, los pares vendidos y las devoluciones' });
    const existing = db.prepare('SELECT * FROM marjorie_promoter_sales WHERE external_source = ? AND external_sale_id = ?').get(source, externalId);
    if (existing && Number(existing.promoter_id) !== Number(promoter.id)) return res.status(409).json({ message: 'Esta venta ya pertenece a otra promotora' });
    const values = [promoter.id, branch.id, branch.name, clean(req.body.customer_name, 160) || 'Cliente facturacion', clean(req.body.customer_whatsapp, 30), pairs, returnedPairs, saleDate, bool(req.body.is_paid), bool(req.body.is_delivered), bool(req.body.is_voided || req.body.is_cancelled), clean(req.body.notes, 1200), source, externalId, JSON.stringify(req.body).slice(0, 12000)];
    let id;
    if (existing) {
      db.prepare(`UPDATE marjorie_promoter_sales SET promoter_id=?, branch_client_id=?, branch_name=?, customer_name=?, customer_whatsapp=?, pairs=?, returned_pairs=?, sale_date=?, is_paid=?, is_delivered=?, is_voided=?, notes=?, external_source=?, external_sale_id=?, external_payload=?, updated_at=datetime('now','localtime') WHERE id=?`).run(...values, existing.id);
      id = existing.id;
      audit(promoter.id, `integration:${source}`, 'update', 'sale', id, externalId);
    } else {
      const result = db.prepare(`INSERT INTO marjorie_promoter_sales
        (promoter_id, branch_client_id, branch_name, customer_name, customer_whatsapp, pairs, returned_pairs, sale_date, is_paid, is_delivered, is_voided, notes, external_source, external_sale_id, external_payload, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(...values, `integration:${source}`);
      id = result.lastInsertRowid;
      audit(promoter.id, `integration:${source}`, 'create', 'sale', id, externalId);
    }
    const detail = promoterPayload(promoter);
    res.status(existing ? 200 : 201).json({ ok: true, id, promoter_code: promoter.code, cycle_points: detail.cycle_pairs, cycle_pairs: detail.cycle_pairs, commission: detail.cycle_commission, pending_payment: detail.pending_total });
  });

  app.get('/api/marjorie/me', requireMember, (req, res) => res.json({ ...promoterPayload(req.marjoriePromoter), branches: realBranches() }));
  app.get('/api/marjorie/my-content', requireMember, (req, res) => res.json({
    library: db.prepare("SELECT * FROM marjorie_content_library WHERE status = 'active' ORDER BY id DESC").all(),
    requests: db.prepare('SELECT * FROM marjorie_content_requests WHERE promoter_id = ? ORDER BY id DESC').all(req.marjoriePromoter.id),
    branches: realBranches()
  }));

  app.patch('/api/marjorie/me', requireMember, (req, res) => {
    const whatsapp = clean(req.body.whatsapp, 30);
    const instagram = clean(req.body.instagram, 120).replace(/^@/, '');
    const city = clean(req.body.city, 120);
    const photoUrl = clean(req.body.photo_url, 6000000);
    if (!whatsapp || !instagram || !city || !validImage(photoUrl)) return res.status(400).json({ message: 'Revisa los datos del perfil' });
    db.prepare("UPDATE marjorie_promoters SET whatsapp = ?, instagram = ?, city = ?, photo_url = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(whatsapp, instagram, city, photoUrl, req.marjoriePromoter.id);
    audit(req.marjoriePromoter.id, req.marjoriePromoter.email, 'update', 'profile', req.marjoriePromoter.id);
    res.json(promoterPayload(db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.marjoriePromoter.id)));
  });

  app.patch('/api/marjorie/password', requireMember, (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    if (!verifyPassword(current, req.marjoriePromoter.password_hash)) return res.status(400).json({ message: 'La contrasena actual no coincide' });
    if (next.length < 6) return res.status(400).json({ message: 'La nueva contrasena debe tener al menos 6 caracteres' });
    db.prepare("UPDATE marjorie_promoters SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hashPassword(next), req.marjoriePromoter.id);
    audit(req.marjoriePromoter.id, req.marjoriePromoter.email, 'password', 'promoter', req.marjoriePromoter.id);
    res.json({ ok: true });
  });

  app.post('/api/marjorie/content-requests', requireMember, (req, res) => {
    if (req.marjoriePromoter.status !== 'active') return res.status(403).json({ message: 'Tu perfil debe estar activo para solicitar una visita' });
    const branch = realBranches().find((row) => Number(row.id) === Number(req.body.branch_client_id));
    const requestType = clean(req.body.request_type, 60);
    const desiredDate = clean(req.body.desired_date, 10);
    if (!branch || !['Fotografias', 'Videos', 'Reels', 'TikTok Live', 'Otro'].includes(requestType) || !/^\d{4}-\d{2}-\d{2}$/.test(desiredDate) || desiredDate < today()) {
      return res.status(400).json({ message: 'Selecciona un local, tipo y fecha validos' });
    }
    const result = db.prepare(`INSERT INTO marjorie_content_requests
      (promoter_id, branch_client_id, branch_name, request_type, desired_date, comment)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.marjoriePromoter.id, branch.id, branch.name, requestType, desiredDate, clean(req.body.comment, 1200));
    audit(req.marjoriePromoter.id, req.marjoriePromoter.email, 'create', 'content_request', result.lastInsertRowid, branch.name);
    res.status(201).json({ ok: true });
  });

  app.get('/api/marjorie/admin/dashboard', requireMarjorieAdmin, (_req, res) => {
    const promoters = db.prepare('SELECT * FROM marjorie_promoters ORDER BY registered_at DESC').all();
    const details = promoters.map((row) => promoterPayload(row));
    const sales = details.flatMap((row) => row.sales);
    const payments = db.prepare('SELECT * FROM marjorie_promoter_payments').all();
    const bonuses = db.prepare('SELECT * FROM marjorie_promoter_bonuses').all();
    const todayPayments = details.filter((row) => row.payable_cut?.due_date <= today() && row.payable_total > 0 && ['active', 'review'].includes(row.status));
    res.json({
      stats: {
        active: promoters.filter((row) => row.status === 'active').length,
        pending: promoters.filter((row) => row.status === 'pending').length,
        review: promoters.filter((row) => row.status === 'review').length,
        suspended: promoters.filter((row) => row.status === 'suspended').length,
        sales: sales.filter((row) => row.effective_pairs > 0).length,
        pairs: sales.reduce((sum, row) => sum + row.effective_pairs, 0),
        commissions_pending: money(details.reduce((sum, row) => sum + Math.max(0, row.unpaid_commission), 0)),
        commissions_paid: money(payments.reduce((sum, row) => sum + Number(row.commission_amount), 0)),
        bonuses_pending: money(details.reduce((sum, row) => sum + Math.max(0, row.unpaid_bonus), 0)),
        bonuses_paid: money(payments.reduce((sum, row) => sum + Number(row.bonus_amount), 0))
      },
      payments_today: todayPayments.map((row) => ({ id: row.id, name: row.name, code: row.code, commission: row.payable_cut.commission, bonus: row.payable_cut.bonus, adjustment: row.payable_cut.adjustment, total: row.payable_total, cut: row.payable_cut })),
      alerts: details.filter((row) => row.performance_alert).map((row) => ({ id: row.id, name: row.name, code: row.code, ...row.performance_alert }))
    });
  });

  app.get('/api/marjorie/admin/promoters', requireMarjorieAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM marjorie_promoters ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, registered_at DESC').all()
      .map((row) => { const detail = promoterPayload(row); return { ...safePromoter(row), status_label: detail.status_label, cycle_pairs: detail.cycle_pairs, pending_total: detail.pending_total, next_cut: detail.payable_cut?.due_date, performance_alert: detail.performance_alert }; }));
  });

  app.get('/api/marjorie/admin/promoters/:id', requireMarjorieAdmin, (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.params.id);
    if (!promoter) return res.status(404).json({ message: 'Promotora no encontrada' });
    res.json({ ...promoterPayload(promoter), branches: realBranches(), requests: db.prepare('SELECT * FROM marjorie_content_requests WHERE promoter_id = ? ORDER BY id DESC').all(promoter.id), audit: db.prepare('SELECT * FROM marjorie_promoter_audit WHERE promoter_id = ? ORDER BY id DESC LIMIT 100').all(promoter.id) });
  });

  app.patch('/api/marjorie/admin/promoters/:id', requireMarjorieAdmin, (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.params.id);
    if (!promoter) return res.status(404).json({ message: 'Promotora no encontrada' });
    const allowedStatuses = ['pending', 'active', 'review', 'suspended', 'revoked', 'rejected'];
    const status = allowedStatuses.includes(req.body.status) ? req.body.status : promoter.status;
    try {
      db.prepare(`UPDATE marjorie_promoters SET name = ?, cedula = ?, whatsapp = ?, email = ?, instagram = ?, city = ?, photo_url = ?, status = ?, admin_notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(clean(req.body.name || promoter.name, 160), clean(req.body.cedula || promoter.cedula, 20), clean(req.body.whatsapp || promoter.whatsapp, 30), clean(req.body.email || promoter.email, 180).toLowerCase(), clean(req.body.instagram || promoter.instagram, 120).replace(/^@/, ''), clean(req.body.city || promoter.city, 120), clean(req.body.photo_url ?? promoter.photo_url, 6000000), status, clean(req.body.admin_notes ?? promoter.admin_notes, 2000), promoter.id);
    } catch {
      return res.status(409).json({ message: 'La cedula o el correo ya pertenecen a otra solicitud' });
    }
    audit(promoter.id, req.user.username || req.user.role, 'update', 'promoter', promoter.id, status);
    res.json(promoterPayload(db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(promoter.id)));
  });

  app.post('/api/marjorie/admin/promoters/:id/approve', requireMarjorieAdmin, async (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.params.id);
    if (!promoter) return res.status(404).json({ message: 'Promotora no encontrada' });
    if (promoter.status === 'rejected' || promoter.status === 'revoked') return res.status(409).json({ message: 'Cambia primero el estado de esta solicitud' });
    const code = promoter.code || `MB-${String(promoter.id).padStart(4, '0')}`;
    db.prepare(`UPDATE marjorie_promoters SET code = ?, status = 'active', activated_at = COALESCE(activated_at, date('now','localtime')), updated_at = datetime('now','localtime') WHERE id = ?`).run(code, promoter.id);
    audit(promoter.id, req.user.username || req.user.role, 'approve', 'promoter', promoter.id, code);
    const approved = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(promoter.id);
    let email = { sent: false, reason: 'No se pudo enviar el correo' };
    try {
      email = await sendApprovalEmail(approved);
    } catch (error) {
      email = { sent: false, reason: error.message };
    }
    res.json({ ...promoterPayload(approved), email_sent: Boolean(email.sent), email_reason: email.reason || null });
  });

  app.post('/api/marjorie/admin/sales', requireMarjorieAdmin, (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.body.promoter_id);
    if (!promoter?.activated_at) return res.status(400).json({ message: 'Selecciona una promotora activa' });
    const branch = realBranches().find((row) => Number(row.id) === Number(req.body.branch_client_id));
    const pairs = Math.floor(Number(req.body.pairs));
    const saleDate = clean(req.body.sale_date, 10);
    if (!branch || pairs < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || saleDate > today() || saleDate < String(promoter.activated_at).slice(0, 10)) return res.status(400).json({ message: 'Revisa el local, los pares y la fecha de venta' });
    const result = db.prepare(`INSERT INTO marjorie_promoter_sales
      (promoter_id, branch_client_id, branch_name, customer_name, customer_whatsapp, pairs, sale_date, is_paid, is_delivered, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(promoter.id, branch.id, branch.name, clean(req.body.customer_name, 160) || 'Cliente local', clean(req.body.customer_whatsapp, 30), pairs, saleDate, bool(req.body.is_paid), bool(req.body.is_delivered), clean(req.body.notes, 1200), req.user.username || req.user.role);
    audit(promoter.id, req.user.username || req.user.role, 'create', 'sale', result.lastInsertRowid, `${pairs} pares ${branch.name}`);
    res.status(201).json({ ok: true, id: result.lastInsertRowid });
  });

  app.patch('/api/marjorie/admin/sales/:id', requireMarjorieAdmin, (req, res) => {
    const sale = db.prepare('SELECT * FROM marjorie_promoter_sales WHERE id = ?').get(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada' });
    const returned = Math.floor(Number(req.body.returned_pairs ?? sale.returned_pairs));
    if (returned < 0 || returned > sale.pairs) return res.status(400).json({ message: 'Los pares devueltos no pueden superar los pares vendidos' });
    db.prepare(`UPDATE marjorie_promoter_sales SET is_paid = ?, is_delivered = ?, returned_pairs = ?, is_voided = ?, notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(bool(req.body.is_paid ?? sale.is_paid), bool(req.body.is_delivered ?? sale.is_delivered), returned, bool(req.body.is_voided ?? sale.is_voided), clean(req.body.notes ?? sale.notes, 1200), sale.id);
    audit(sale.promoter_id, req.user.username || req.user.role, 'update', 'sale', sale.id, `Pagada ${bool(req.body.is_paid ?? sale.is_paid)} entregada ${bool(req.body.is_delivered ?? sale.is_delivered)} devueltos ${returned}`);
    res.json({ ok: true });
  });

  app.put('/api/marjorie/admin/bonuses', requireMarjorieAdmin, (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.body.promoter_id);
    const cycleStart = clean(req.body.cycle_start, 10);
    const cutNumber = Number(req.body.cut_number);
    const status = ['pending', 'approved', 'rejected'].includes(req.body.status) ? req.body.status : 'pending';
    if (!promoter?.activated_at || !/^\d{4}-\d{2}-\d{2}$/.test(cycleStart) || ![1, 2].includes(cutNumber)) return res.status(400).json({ message: 'Periodo de bono no valido' });
    db.prepare(`INSERT INTO marjorie_promoter_bonuses
      (promoter_id, cycle_start, cut_number, active_page, published_content, stories_reels, correct_information, appropriate_content, status, amount, evidence_url, observation, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 25, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(promoter_id, cycle_start, cut_number) DO UPDATE SET
        active_page=excluded.active_page, published_content=excluded.published_content, stories_reels=excluded.stories_reels,
        correct_information=excluded.correct_information, appropriate_content=excluded.appropriate_content, status=excluded.status,
        evidence_url=excluded.evidence_url, observation=excluded.observation, reviewed_by=excluded.reviewed_by,
        reviewed_at=datetime('now','localtime'), updated_at=datetime('now','localtime')`)
      .run(promoter.id, cycleStart, cutNumber, bool(req.body.active_page), bool(req.body.published_content), bool(req.body.stories_reels), bool(req.body.correct_information), bool(req.body.appropriate_content), status, clean(req.body.evidence_url, 1000), clean(req.body.observation, 1200), req.user.username || req.user.role);
    const bonus = db.prepare('SELECT * FROM marjorie_promoter_bonuses WHERE promoter_id = ? AND cycle_start = ? AND cut_number = ?').get(promoter.id, cycleStart, cutNumber);
    audit(promoter.id, req.user.username || req.user.role, 'review', 'bonus', bonus.id, `${status} corte ${cutNumber}`);
    res.json(bonus);
  });

  app.post('/api/marjorie/admin/promoters/:id/pay', requireMarjorieAdmin, (req, res) => {
    const promoter = db.prepare('SELECT * FROM marjorie_promoters WHERE id = ?').get(req.params.id);
    if (!promoter?.activated_at) return res.status(404).json({ message: 'Promotora no encontrada o sin activar' });
    const detail = promoterPayload(promoter);
    const cut = detail.payable_cut;
    if (!cut || cut.due_date > today()) return res.status(409).json({ message: `El proximo corte corresponde al ${cut?.due_date || '-'}` });
    if (detail.payable_total <= 0) return res.status(409).json({ message: 'No existe un saldo pendiente para pagar en este corte' });
    const adjustment = detail.payable_cut.adjustment;
    const commission = detail.payable_cut.commission;
    const bonus = detail.payable_cut.bonus;
    const total = detail.payable_total;
    if (total <= 0) return res.status(409).json({ message: 'El ajuste pendiente compensa el valor de este corte' });
    try {
      const result = db.prepare(`INSERT INTO marjorie_promoter_payments
        (promoter_id, cycle_start, cut_number, commission_amount, bonus_amount, adjustment_amount, total_amount, notes, paid_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(promoter.id, cut.cycle_start, cut.cut_number, money(commission), money(bonus), money(adjustment), total, clean(req.body.notes, 1000), req.user.username || req.user.role);
      audit(promoter.id, req.user.username || req.user.role, 'pay', 'payment', result.lastInsertRowid, `$${total.toFixed(2)}`);
      res.json({ ok: true, payment: db.prepare('SELECT * FROM marjorie_promoter_payments WHERE id = ?').get(result.lastInsertRowid) });
    } catch (error) {
      res.status(409).json({ message: 'Este corte ya fue marcado como pagado' });
    }
  });

  app.get('/api/marjorie/admin/content', requireMarjorieAdmin, (_req, res) => res.json({
    library: db.prepare('SELECT * FROM marjorie_content_library ORDER BY id DESC').all(),
    requests: db.prepare(`SELECT requests.*, promoters.name AS promoter_name, promoters.code AS promoter_code
      FROM marjorie_content_requests requests JOIN marjorie_promoters promoters ON promoters.id = requests.promoter_id
      ORDER BY CASE requests.status WHEN 'pending' THEN 0 ELSE 1 END, requests.desired_date, requests.id DESC`).all()
  }));

  app.post('/api/marjorie/admin/content', requireMarjorieAdmin, (req, res) => {
    const title = clean(req.body.title, 180);
    const type = ['image', 'video', 'reel', 'promotion', 'text', 'link'].includes(req.body.content_type) ? req.body.content_type : 'image';
    const assetUrl = clean(req.body.asset_url, 6000000);
    if (!title || (!assetUrl && !clean(req.body.description, 4000))) return res.status(400).json({ message: 'Agrega un titulo y el contenido o enlace' });
    const result = db.prepare(`INSERT INTO marjorie_content_library (title, content_type, asset_url, description, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(title, type, assetUrl, clean(req.body.description, 4000), req.body.status === 'inactive' ? 'inactive' : 'active', req.user.username || req.user.role);
    res.status(201).json({ ok: true, id: result.lastInsertRowid });
  });

  app.patch('/api/marjorie/admin/content/:id', requireMarjorieAdmin, (req, res) => {
    const current = db.prepare('SELECT * FROM marjorie_content_library WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ message: 'Contenido no encontrado' });
    db.prepare(`UPDATE marjorie_content_library SET title=?, content_type=?, asset_url=?, description=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(clean(req.body.title ?? current.title, 180), clean(req.body.content_type ?? current.content_type, 30), clean(req.body.asset_url ?? current.asset_url, 6000000), clean(req.body.description ?? current.description, 4000), req.body.status === 'inactive' ? 'inactive' : 'active', current.id);
    res.json({ ok: true });
  });

  app.patch('/api/marjorie/admin/content-requests/:id', requireMarjorieAdmin, (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(req.body.status) ? req.body.status : 'pending';
    const request = db.prepare('SELECT * FROM marjorie_content_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ message: 'Solicitud no encontrada' });
    db.prepare(`UPDATE marjorie_content_requests SET status=?, admin_observation=?, reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?`)
      .run(status, clean(req.body.admin_observation, 1200), req.user.username || req.user.role, request.id);
    audit(request.promoter_id, req.user.username || req.user.role, 'review', 'content_request', request.id, status);
    res.json({ ok: true });
  });
}
