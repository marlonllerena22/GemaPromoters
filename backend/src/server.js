import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToken, requireAdmin, requireAuth, requirePromoter } from './auth.js';
import { db, initDb, normalizeCode, normalizeLookup, toMoney } from './db.js';

dotenv.config();
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '6mb' }));

function getDashboard() {
  const activePromoters = db
    .prepare("SELECT COUNT(*) AS total FROM promoters WHERE status = 'active'")
    .get().total;
  const totals = db
    .prepare('SELECT COALESCE(SUM(total), 0) AS sold, COALESCE(SUM(commission), 0) AS commission FROM sales')
    .get();
  const todaySales = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS sold FROM sales WHERE sale_date = date('now', 'localtime')")
    .get().sold;

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
    .prepare("SELECT id, name, instagram, whatsapp, photo_url, code FROM promoters WHERE status = 'active'")
    .all()
    .find((promoter) => normalizeLookup(promoter.code) === lookup);
}

function findActivePromoterForLogin(username, password) {
  const lookup = normalizeLookup(username);
  const cleanPassword = String(password || '').trim();
  return db
    .prepare("SELECT id, name, username, code FROM promoters WHERE status = 'active' AND password = ?")
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

function getLocationRule(locationName) {
  const lookup = normalizeLookup(locationName);
  const rule = db
    .prepare('SELECT * FROM event_locations')
    .all()
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

function recalculateCommissions(promoterId, locationName) {
  const rule = getLocationRule(locationName);
  const threshold = Math.max(1, Number(rule.commission_min_quantity || 1));
  const sales = db
    .prepare(
      `SELECT id, quantity, unit_price, payment_status
       FROM sales
       WHERE promoter_id = ? AND location = ?
       ORDER BY sale_date ASC, id ASC`
    )
    .all(promoterId, locationName);

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
  const groups = db.prepare('SELECT DISTINCT promoter_id, location FROM sales').all();
  for (const group of groups) {
    recalculateCommissions(group.promoter_id, group.location);
  }
}

function getLevelSettings() {
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'level_%_min'").all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));

  return {
    bronze: settings.level_bronze_min ?? 1,
    silver: settings.level_silver_min ?? 10,
    diamond: settings.level_diamond_min ?? 25
  };
}

function getPromoterLevel(promoterId) {
  const settings = getLevelSettings();
  const paidSalesRows = db
    .prepare("SELECT quantity, location FROM sales WHERE promoter_id = ? AND payment_status = 'paid'")
    .all(promoterId);
  const locations = db.prepare('SELECT name, level_points FROM event_locations').all();
  const paidSales = paidSalesRows.length;
  const levelPoints = paidSalesRows.reduce((sum, sale) => {
    const location = locations.find((item) => normalizeLookup(item.name) === normalizeLookup(sale.location));
    return sum + Number(sale.quantity || 0) * Number(location?.level_points ?? 1);
  }, 0);

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

  return { ...level, paidSales, levelPoints: Math.round(levelPoints * 100) / 100, settings };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'GemaPromoters' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === adminUser && password === adminPassword) {
    return res.json({ token: createToken({ role: 'admin', username }), user: { username, role: 'admin' } });
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
    token: createToken({ role: 'promoter', promoterId: promoter.id, username: promoter.username }),
    user: { role: 'promoter', id: promoter.id, name: promoter.name, code: promoter.code }
  });
});

app.get('/api/dashboard', requireAdmin, (_req, res) => {
  res.json(getDashboard());
});

app.get('/api/promoters', requireAdmin, (_req, res) => {
  const promoters = db.prepare('SELECT * FROM promoters ORDER BY registered_at DESC, id DESC').all();
  res.json(promoters);
});

app.post('/api/promoters', requireAdmin, (req, res) => {
  const { name, cedula, whatsapp, instagram, photo_url, status = 'active' } = req.body;
  const normalizedCode = buildPromoterCode(name);
  const normalizedUsername = normalizedCode;
  const normalizedPassword = String(cedula || '').trim();

  if (!name || !cedula || !whatsapp || !instagram || !normalizedPassword) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  try {
    const result = db
      .prepare(
        'INSERT INTO promoters (name, cedula, whatsapp, instagram, photo_url, code, username, password, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        name.trim(),
        cedula.trim(),
        whatsapp.trim(),
        instagram?.trim() || '',
        photo_url?.trim() || '',
        normalizedCode,
        normalizedUsername,
        normalizedPassword,
        status
      );

    return res.status(201).json(db.prepare('SELECT * FROM promoters WHERE id = ?').get(result.lastInsertRowid));
  } catch (error) {
    return res.status(409).json({ message: 'Cedula ya registrada' });
  }
});

app.put('/api/promoters/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, cedula, whatsapp, instagram, photo_url, status = 'active' } = req.body;

  if (!name || !cedula || !whatsapp || !instagram) {
    return res.status(400).json({ message: 'Nombre, cedula, WhatsApp e Instagram son obligatorios' });
  }

  try {
    const result = db
      .prepare(
        'UPDATE promoters SET name = ?, cedula = ?, whatsapp = ?, instagram = ?, photo_url = ?, status = ? WHERE id = ?'
      )
      .run(
        name.trim(),
        cedula.trim(),
        whatsapp.trim(),
        instagram?.trim() || '',
        photo_url?.trim() || '',
        status,
        id
      );

    if (!result.changes) {
      return res.status(404).json({ message: 'Promotor no encontrado' });
    }

    return res.json(db.prepare('SELECT * FROM promoters WHERE id = ?').get(id));
  } catch {
    return res.status(409).json({ message: 'Cedula ya registrada' });
  }
});

app.patch('/api/promoters/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: 'Estado invalido' });
  }

  const result = db.prepare('UPDATE promoters SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) {
    return res.status(404).json({ message: 'Promotor no encontrado' });
  }

  res.json(db.prepare('SELECT * FROM promoters WHERE id = ?').get(id));
});

app.get('/api/level-settings', requireAdmin, (_req, res) => {
  res.json(getLevelSettings());
});

app.put('/api/level-settings', requireAdmin, (req, res) => {
  const bronze = Math.max(1, Number(req.body.bronze || 1));
  const silver = Math.max(bronze, Number(req.body.silver || bronze));
  const diamond = Math.max(silver, Number(req.body.diamond || silver));
  const save = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  save.run('level_bronze_min', String(bronze));
  save.run('level_silver_min', String(silver));
  save.run('level_diamond_min', String(diamond));

  res.json(getLevelSettings());
});

app.get('/api/locations', requireAuth, (_req, res) => {
  const locations = db.prepare('SELECT * FROM event_locations ORDER BY status ASC, name ASC').all();
  res.json(locations);
});

app.post('/api/locations', requireAdmin, (req, res) => {
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
         (name, price, commission_type, commission_value, commission_min_quantity, level_points, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
    const current = db.prepare('SELECT name FROM event_locations WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ message: 'Localidad no encontrada' });
    }

    const result = db
      .prepare(
        `UPDATE event_locations
         SET name = ?, price = ?, commission_type = ?, commission_value = ?, commission_min_quantity = ?, level_points = ?, status = ?
         WHERE id = ?`
      )
      .run(
        name.trim(),
        toMoney(parsedPrice),
        commission_type,
        toMoney(parsedCommission),
        parsedMinQuantity,
        toMoney(parsedLevelPoints),
        status,
        id
      );

    if (!result.changes) {
      return res.status(404).json({ message: 'Localidad no encontrada' });
    }

    if (current.name !== name.trim()) {
      db.prepare('UPDATE sales SET location = ? WHERE location = ?').run(name.trim(), current.name);
    }
    recalculateAllCommissions();

    res.json(db.prepare('SELECT * FROM event_locations WHERE id = ?').get(id));
  } catch {
    res.status(409).json({ message: 'La localidad ya existe' });
  }
});

app.delete('/api/locations/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const location = db.prepare('SELECT name FROM event_locations WHERE id = ?').get(id);

  if (!location) {
    return res.status(404).json({ message: 'Localidad no encontrada' });
  }

  const usedSales = db.prepare('SELECT COUNT(*) AS total FROM sales WHERE location = ?').get(location.name).total;
  if (usedSales > 0) {
    return res.status(409).json({
      message: 'Esta localidad ya tiene ventas. Para conservar el historial, dejala inactiva en lugar de eliminarla.'
    });
  }

  db.prepare('DELETE FROM event_locations WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/sales', requireAdmin, (_req, res) => {
  const sales = db
    .prepare(
      `SELECT sales.*, promoters.name AS promoter_name, promoters.code AS promoter_code
       FROM sales
       JOIN promoters ON promoters.id = sales.promoter_id
       ORDER BY sales.sale_date DESC, sales.id DESC`
    )
    .all();
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
  const amount = Number(quantity);
  const price = Number(unit_price);

  if (!selectedPromoterId || !customer || !customer_whatsapp || !location || amount <= 0 || price < 0) {
    return res.status(400).json({ message: 'Completa los datos de la venta' });
  }

  const promoter = db.prepare("SELECT id FROM promoters WHERE id = ? AND status = 'active'").get(selectedPromoterId);
  if (!promoter) {
    return res.status(400).json({ message: 'Selecciona un promotor activo' });
  }

  const total = toMoney(amount * price);
  const normalizedPaymentStatus = payment_status === 'paid' ? 'paid' : 'pending';
  const normalizedDate = sale_date || new Date().toISOString().slice(0, 10);
  const normalizedLocation = location.trim();

  const result = db
    .prepare(
      `INSERT INTO sales
       (promoter_id, customer, customer_whatsapp, location, quantity, unit_price, total, commission, sale_date, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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

  recalculateCommissions(selectedPromoterId, normalizedLocation);

  return res.status(201).json(db.prepare('SELECT * FROM sales WHERE id = ?').get(result.lastInsertRowid));
}

app.post('/api/sales', requireAdmin, (req, res) => createSale(req, res));

function markSalePaid(res, saleId, promoterId = null) {
  const sale = promoterId
    ? db.prepare('SELECT id, promoter_id, location FROM sales WHERE id = ? AND promoter_id = ?').get(saleId, promoterId)
    : db.prepare('SELECT id, promoter_id, location FROM sales WHERE id = ?').get(saleId);

  if (!sale) {
    return res.status(404).json({ message: 'Venta no encontrada' });
  }

  db.prepare("UPDATE sales SET payment_status = 'paid', commission = 0 WHERE id = ?").run(saleId);
  recalculateCommissions(sale.promoter_id, sale.location);
  return res.json(db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
}

app.patch('/api/sales/:id/pay', requireAdmin, (req, res) => {
  markSalePaid(res, req.params.id);
});

app.delete('/api/sales/:id', requireAdmin, (req, res) => {
  const sale = db.prepare('SELECT id, promoter_id, location FROM sales WHERE id = ?').get(req.params.id);

  if (!sale) {
    return res.status(404).json({ message: 'Venta no encontrada' });
  }

  db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
  recalculateCommissions(sale.promoter_id, sale.location);
  res.json({ ok: true });
});

app.get('/api/promoter/me', requirePromoter, (req, res) => {
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, level: getPromoterLevel(req.user.promoterId) });
});

app.patch('/api/promoter/profile', requirePromoter, (req, res) => {
  const photoUrl = String(req.body.photo_url || '').trim();
  db.prepare('UPDATE promoters SET photo_url = ? WHERE id = ?').run(photoUrl, req.user.promoterId);
  const promoter = db.prepare('SELECT id, name, code, whatsapp, instagram, photo_url FROM promoters WHERE id = ?').get(req.user.promoterId);
  res.json({ ...promoter, level: getPromoterLevel(req.user.promoterId) });
});

app.get('/api/promoter/sales', requirePromoter, (req, res) => {
  const sales = db
    .prepare('SELECT * FROM sales WHERE promoter_id = ? ORDER BY sale_date DESC, id DESC')
    .all(req.user.promoterId);
  res.json(sales);
});

app.post('/api/promoter/sales', requirePromoter, (req, res) => createSale(req, res, req.user.promoterId));

app.patch('/api/promoter/sales/:id/pay', requirePromoter, (req, res) => {
  markSalePaid(res, req.params.id, req.user.promoterId);
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

app.get('/api/ranking', requireAdmin, (_req, res) => {
  const ranking = db
    .prepare(
      `SELECT promoters.id, promoters.name, promoters.code,
              COUNT(sales.id) AS sales_count,
              COALESCE(SUM(sales.total), 0) AS total_sold,
              COALESCE(SUM(sales.commission), 0) AS total_commission
       FROM promoters
       LEFT JOIN sales ON sales.promoter_id = promoters.id
       GROUP BY promoters.id
       ORDER BY total_sold DESC, sales_count DESC, promoters.name ASC`
    )
    .all()
    .map((row) => ({
      ...row,
      total_sold: toMoney(row.total_sold),
      total_commission: toMoney(row.total_commission)
    }));

  res.json(ranking);
});

app.get('/api/settlements', requireAdmin, (_req, res) => {
  const settlements = db
    .prepare(
      `SELECT promoters.id, promoters.name, promoters.code,
              COALESCE(SUM(sales.total), 0) AS total_sold,
              COALESCE(SUM(CASE WHEN sales.commission_paid = 0 THEN sales.commission ELSE 0 END), 0) AS pending_commission,
              COALESCE(SUM(CASE WHEN sales.commission_paid = 1 THEN sales.commission ELSE 0 END), 0) AS paid_commission
       FROM promoters
       LEFT JOIN sales ON sales.promoter_id = promoters.id
       GROUP BY promoters.id
       ORDER BY pending_commission DESC, total_sold DESC`
    )
    .all()
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
  const result = db.prepare('UPDATE sales SET commission_paid = 1 WHERE promoter_id = ? AND commission_paid = 0').run(promoterId);
  res.json({ updatedSales: result.changes });
});

app.get('/api/verify/:code', (req, res) => {
  const promoter = findActivePromoterByCode(req.params.code);

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  return res.json({
    registered: true,
    message: 'Promotor oficial GEMASHOW',
    promoter: {
      ...promoter,
      level: getPromoterLevel(promoter.id)
    }
  });
});

app.post('/api/verify', (req, res) => {
  const promoter = findActivePromoterByCode(req.body.code);

  if (!promoter) {
    return res.status(404).json({ registered: false, message: 'Codigo no registrado' });
  }

  return res.json({
    registered: true,
    message: 'Promotor oficial GEMASHOW',
    promoter: {
      ...promoter,
      level: getPromoterLevel(promoter.id)
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
