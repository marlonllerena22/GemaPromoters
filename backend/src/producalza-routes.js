import { createToken, requireProductionAdmin, requireProductionUser } from './auth.js';
import { createProductionOrderPdf } from './production-pdf.js';

const ORDER_STATUSES = ['draft', 'received', 'reviewed', 'in_production', 'finished', 'delivered', 'cancelled'];
const MODEL_STATUSES = ['received', 'reviewed', 'in_production', 'cut', 'stitched', 'assembled', 'finished', 'delivered', 'cancelled'];
const PAYMENT_TYPES = ['abono', 'cheque', 'transferencia', 'efectivo', 'saldo', 'otro'];
const PAYMENT_STATUSES = ['pending', 'paid', 'cancelled'];
const SIZES = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const DELIVERY_NOTE_BALANCE_REF = 'AUTO-NOTA-ENTREGA';
const MANUAL_PAID_TOTAL_REF = 'MANUAL-TOTAL-PAGADO';
const MANUAL_PENDING_TOTAL_REF = 'MANUAL-TOTAL-PENDIENTE';
const DEFAULT_PAYROLL_START = '08:00';
const DEFAULT_PAYROLL_END = '16:30';
const NORMA_LLAMUCA_KEY = 'norma llamuca';

function cleanEmployeeName(value = '') {
  return String(value || '')
    .replace(/^Nombre\s*:\s*/i, '')
    .replace(/^(SRTA\.?|SRA\.?|SR\.?)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function employeeKey(value = '') {
  return cleanEmployeeName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money2(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function parseNumberFromText(value) {
  const match = String(value || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseClockMinutes(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60);
    return totalMinutes >= 0 && totalMinutes < 24 * 60 ? totalMinutes : null;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseHoursValue(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim().replace(',', '.');
  if (!text || /feriado/i.test(text)) return 0;
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function sheetRows(xlsx, workbook, preferredNames = []) {
  const sheetName = preferredNames.find((name) => workbook.Sheets[name])
    || workbook.SheetNames.find((name) => preferredNames.some((preferred) => name.trim().toLowerCase() === preferred.trim().toLowerCase()))
    || workbook.SheetNames[0];
  if (!sheetName) return [];
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
}

function parseSalaryDefaults(xlsx, workbook) {
  const rows = sheetRows(xlsx, workbook, ['ROLL (2)', 'ROLL']);
  const defaults = new Map();
  const readCard = (rowIndex, nameCol, valueCol) => {
    const name = cleanEmployeeName(rows[rowIndex]?.[nameCol]);
    if (!name) return;
    const salary = money2(rows[rowIndex + 4]?.[valueCol]);
    const defaultIess = money2(rows[rowIndex + 10]?.[valueCol]);
    if (salary || defaultIess) {
      defaults.set(employeeKey(name), { name, salary, defaultIess });
    }
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (typeof row[1] === 'string' && /Nombre|^SR|^SRA|^SRTA/i.test(row[1])) readCard(index, 1, 2);
    if (typeof row[5] === 'string' && /Nombre|^SR|^SRA|^SRTA/i.test(row[5])) readCard(index, 5, 6);
  }
  return defaults;
}

function parseAttendanceDetail(xlsx, workbook) {
  const rows = sheetRows(xlsx, workbook, ['DETALLE ', 'DETALLE']);
  const blocks = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!String(row[0] || '').includes('ID:') || !String(row[2] || '').includes('Nombre:')) continue;
    const sourceName = cleanEmployeeName(row[2]);
    const nextHeader = rows.findIndex((nextRow, nextIndex) =>
      nextIndex > rowIndex && String(nextRow?.[0] || '').includes('ID:') && String(nextRow?.[2] || '').includes('Nombre:')
    );
    const endIndex = nextHeader > rowIndex ? nextHeader : rows.length;
    const summary = rows[rowIndex + 1] || [];
    const block = {
      source_name: sourceName,
      name: sourceName,
      work_days: parseNumberFromText(summary[0]),
      attendance_days_reported: parseNumberFromText(summary[2]),
      absent_days: parseNumberFromText(summary[8]),
      early_leave_days: parseNumberFromText(summary[6]),
      late_days_reported: parseNumberFromText(summary[4]),
      attendance_days: 0,
      late_days: 0,
      late_minutes: 0,
      overtime_hours: 0
    };
    const isNorma = employeeKey(sourceName).includes('norma') && employeeKey(sourceName).includes('llamuca');
    const startMinutes = parseClockMinutes(DEFAULT_PAYROLL_START) + 5;
    const normalEnd = isNorma ? '17:00' : DEFAULT_PAYROLL_END;
    const endMinutes = parseClockMinutes(normalEnd);
    const processDay = (dataRow, offset) => {
      if (!dataRow?.[offset]) return;
      const candidateTimes = [dataRow[offset + 2], dataRow[offset + 4], dataRow[offset + 6]]
        .map(parseClockMinutes)
        .filter((value) => value != null);
      const outTimes = [dataRow[offset + 3], dataRow[offset + 5], dataRow[offset + 7]]
        .map(parseClockMinutes)
        .filter((value) => value != null);
      if (candidateTimes.length || outTimes.length) {
        block.attendance_days += 1;
      }
      if (candidateTimes.length) {
        const firstIn = Math.min(...candidateTimes);
        if (firstIn > startMinutes) {
          block.late_days += 1;
          block.late_minutes += firstIn - startMinutes;
        }
      }
      if (outTimes.length && endMinutes && Math.max(...outTimes) < endMinutes) {
        block.early_leave_days += 1;
      }
      block.overtime_hours += parseHoursValue(dataRow[offset + 6]);
    };
    for (let dataRowIndex = rowIndex + 5; dataRowIndex < endIndex; dataRowIndex += 1) {
      processDay(rows[dataRowIndex], 0);
      processDay(rows[dataRowIndex], 8);
    }
    blocks.push({
      ...block,
      overtime_hours: money2(block.overtime_hours)
    });
  }
  return blocks;
}

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
    const status = PAYMENT_STATUSES.includes(body.status) ? body.status : 'paid';
    return {
      payment_type: paymentType,
      amount,
      payment_date: normalizeOptionalDate(body.payment_date) || (status === 'paid' ? new Date().toISOString().slice(0, 10) : null),
      due_date: normalizeOptionalDate(body.due_date),
      status,
      bank: String(body.bank || '').trim(),
      reference: String(body.reference || '').trim(),
      notes: String(body.notes || '').trim()
    };
  }

  function refreshDeliveryNoteBalance(orderId, businessId, userLabel = 'system') {
    const order = db.prepare(
      `SELECT id, shipping_value, discount_value
       FROM production_orders
       WHERE id = ? AND establishment_id = ? AND deleted_at IS NULL`
    ).get(orderId, businessId);
    if (!order) return;
    const subtotal = db.prepare(
      `SELECT COALESCE(SUM(total_pairs * unit_price), 0) AS subtotal
       FROM production_order_models
       WHERE order_id = ? AND establishment_id = ?`
    ).get(orderId, businessId).subtotal;
    const totalValue = moneyValue(Math.max(
      0,
      Number(subtotal || 0) + Number(order.shipping_value || 0) - Number(order.discount_value || 0)
    ));
    const paymentTotals = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total,
         COALESCE(SUM(CASE WHEN status = 'pending' AND COALESCE(reference, '') <> ? THEN amount ELSE 0 END), 0) AS manual_pending_total
       FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ?`
    ).get(DELIVERY_NOTE_BALANCE_REF, orderId, businessId);
    const pendingBalance = moneyValue(Math.max(
      0,
      totalValue - Number(paymentTotals.paid_total || 0) - Number(paymentTotals.manual_pending_total || 0)
    ));
    db.prepare(
      `DELETE FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ? AND status = 'pending' AND reference = ?`
    ).run(orderId, businessId, DELIVERY_NOTE_BALANCE_REF);
    if (pendingBalance > 0) {
      db.prepare(
        `INSERT INTO production_order_payments
         (establishment_id, order_id, payment_type, amount, payment_date, due_date,
          status, bank, reference, notes, created_by)
         VALUES (?, ?, 'saldo', ?, NULL, NULL, 'pending', '', ?, ?, ?)`
      ).run(
        businessId,
        orderId,
        pendingBalance,
        DELIVERY_NOTE_BALANCE_REF,
        'Saldo automatico de nota de entrega',
        userLabel
      );
    }
  }

  function deleteAutomaticDeliveryBalance(orderId, businessId) {
    db.prepare(
      `DELETE FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ? AND reference = ?`
    ).run(orderId, businessId, DELIVERY_NOTE_BALANCE_REF);
  }

  function createInitialPendingBalance(orderId, businessId, amount, userLabel = 'system') {
    const pendingAmount = moneyValue(amount);
    if (pendingAmount <= 0) return;
    db.prepare(
      `INSERT INTO production_order_payments
       (establishment_id, order_id, payment_type, amount, payment_date, due_date,
        status, bank, reference, notes, created_by)
       VALUES (?, ?, 'saldo', ?, NULL, NULL, 'pending', '', ?, ?, ?)`
    ).run(
      businessId,
      orderId,
      pendingAmount,
      MANUAL_PENDING_TOTAL_REF,
      'Saldo pendiente generado desde nota de entrega',
      userLabel
    );
  }

  function addPendingBalance(orderId, businessId, amount, userLabel = 'system') {
    const pendingAmount = moneyValue(amount);
    if (pendingAmount <= 0) return;
    const current = db.prepare(
      `SELECT id, amount
       FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ?
         AND status = 'pending'
         AND reference = ?
         AND due_date IS NULL
       ORDER BY id DESC
       LIMIT 1`
    ).get(orderId, businessId, MANUAL_PENDING_TOTAL_REF);
    if (current) {
      db.prepare(
        `UPDATE production_order_payments
         SET amount = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND order_id = ? AND establishment_id = ?`
      ).run(moneyValue(Number(current.amount || 0) + pendingAmount), current.id, orderId, businessId);
      return;
    }
    createInitialPendingBalance(orderId, businessId, pendingAmount, userLabel);
  }

  function reducePendingBalance(orderId, businessId, amount, excludedPaymentId = null) {
    let remaining = moneyValue(amount);
    if (remaining <= 0) return;
    const rows = db.prepare(
      `SELECT id, amount
       FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ?
         AND status = 'pending'
         AND id <> COALESCE(?, -1)
       ORDER BY
         CASE
           WHEN reference = ? THEN 0
           WHEN reference = ? THEN 1
           WHEN reference = ? THEN 2
           WHEN payment_type = 'saldo' THEN 3
           ELSE 4
         END,
         id DESC`
    ).all(
      orderId,
      businessId,
      excludedPaymentId,
      MANUAL_PENDING_TOTAL_REF,
      DELIVERY_NOTE_BALANCE_REF,
      MANUAL_PAID_TOTAL_REF
    );
    const remove = db.prepare('DELETE FROM production_order_payments WHERE id = ? AND order_id = ? AND establishment_id = ?');
    const update = db.prepare(
      `UPDATE production_order_payments
       SET amount = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ? AND order_id = ? AND establishment_id = ?`
    );
    for (const row of rows) {
      if (remaining <= 0) break;
      const currentAmount = moneyValue(row.amount);
      if (currentAmount <= 0) continue;
      if (currentAmount <= remaining + 0.009) {
        remove.run(row.id, orderId, businessId);
        remaining = moneyValue(remaining - currentAmount);
      } else {
        update.run(moneyValue(currentAmount - remaining), row.id, orderId, businessId);
        remaining = 0;
      }
    }
  }

  function paymentTotalsForOrder(orderId, businessId, excludedRefs = [DELIVERY_NOTE_BALANCE_REF]) {
    const refs = excludedRefs.length ? excludedRefs : [''];
    const placeholders = refs.map(() => '?').join(', ');
    return db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_total,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_total
       FROM production_order_payments
       WHERE order_id = ? AND establishment_id = ?
         AND status IN ('paid', 'pending')
         AND COALESCE(reference, '') NOT IN (${placeholders})`
    ).get(orderId, businessId, ...refs);
  }

  function displayMoneyValue(value) {
    return `$${moneyValue(value).toFixed(2)}`;
  }

  function normalizeEmployeePayload(body) {
    const name = cleanEmployeeName(body.name);
    if (!name) throw new Error('El nombre del empleado es obligatorio');
    const key = employeeKey(name);
    return {
      name,
      source_name: String(body.source_name || name).trim(),
      pay_type: body.pay_type === 'piecework' ? 'piecework' : 'salary',
      monthly_salary: moneyValue(body.monthly_salary),
      default_iess: moneyValue(body.default_iess),
      late_penalty: moneyValue(body.late_penalty ?? 5),
      normal_start: /^\d{2}:\d{2}$/.test(String(body.normal_start || '')) ? body.normal_start : DEFAULT_PAYROLL_START,
      normal_end: /^\d{2}:\d{2}$/.test(String(body.normal_end || ''))
        ? body.normal_end
        : key.includes('norma') && key.includes('llamuca') ? '17:00' : DEFAULT_PAYROLL_END,
      grace_minutes: Math.max(0, Number(body.grace_minutes ?? 5) || 0),
      status: body.status === 'inactive' ? 'inactive' : 'active',
      notes: String(body.notes || '').trim()
    };
  }

  function payrollMath(entry) {
    const monthlySalary = moneyValue(entry.monthly_salary);
    const hourlyRate = moneyValue(entry.hourly_rate || (monthlySalary ? monthlySalary / 240 : 0));
    const overtimeRate = moneyValue(entry.overtime_rate || (hourlyRate * 1.5));
    const overtimePay = moneyValue(Number(entry.overtime_hours || 0) * overtimeRate);
    const unworkedDiscount = moneyValue(Number(entry.manual_unworked_hours || 0) * hourlyRate);
    const lateDiscount = moneyValue(Number(entry.late_days || 0) * Number(entry.late_penalty || 0));
    const salaryIncome = entry.pay_type === 'piecework' ? 0 : monthlySalary;
    const totalIncome = moneyValue(salaryIncome + overtimePay + Number(entry.other_income || 0) + Number(entry.piece_income || 0));
    const totalDeductions = moneyValue(
      Number(entry.iess_amount || 0)
      + Number(entry.advance_amount || 0)
      + Number(entry.savings_amount || 0)
      + Number(entry.footwear_amount || 0)
      + Number(entry.other_deductions || 0)
      + unworkedDiscount
      + lateDiscount
    );
    return {
      ...entry,
      monthly_salary: monthlySalary,
      hourly_rate: hourlyRate,
      overtime_rate: overtimeRate,
      total_income: totalIncome,
      total_deductions: totalDeductions,
      net_pay: moneyValue(totalIncome - totalDeductions)
    };
  }

  function getPayrollPeriod(periodId, req) {
    const businessId = establishmentId(req);
    const period = db.prepare(
      'SELECT * FROM production_payroll_periods WHERE id = ? AND establishment_id = ?'
    ).get(periodId, businessId);
    if (!period) return null;
    const entries = db.prepare(
      `SELECT entries.*, employees.normal_start, employees.normal_end, employees.grace_minutes
       FROM production_payroll_entries AS entries
       LEFT JOIN production_employees AS employees ON employees.id = entries.employee_id
       WHERE entries.period_id = ? AND entries.establishment_id = ?
       ORDER BY entries.employee_name`
    ).all(period.id, businessId);
    return { ...period, entries };
  }

  function payrollPeriodSummary(period) {
    const entries = db.prepare(
      `SELECT COUNT(*) AS employees_count,
              COALESCE(SUM(total_income), 0) AS total_income,
              COALESCE(SUM(total_deductions), 0) AS total_deductions,
              COALESCE(SUM(net_pay), 0) AS net_pay
       FROM production_payroll_entries
       WHERE period_id = ? AND establishment_id = ?`
    ).get(period.id, period.establishment_id);
    return { ...period, ...entries };
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
                clients.classification AS client_classification,
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
           AND COALESCE(reference, '') <> ?
         ORDER BY COALESCE(due_date, payment_date, created_at) DESC, id DESC`
      )
      .all(order.id, businessId, DELIVERY_NOTE_BALANCE_REF);
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

  app.get('/api/producalza/employees', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const rows = db.prepare(
      `SELECT * FROM production_employees
       WHERE establishment_id = ?
       ORDER BY status DESC, name`
    ).all(business.id);
    res.json(rows);
  });

  app.post('/api/producalza/employees', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    let employee;
    try {
      employee = normalizeEmployeePayload(req.body);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      const result = db.prepare(
        `INSERT INTO production_employees
         (establishment_id, name, source_name, pay_type, monthly_salary, default_iess,
          late_penalty, normal_start, normal_end, grace_minutes, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        business.id,
        employee.name,
        employee.source_name,
        employee.pay_type,
        employee.monthly_salary,
        employee.default_iess,
        employee.late_penalty,
        employee.normal_start,
        employee.normal_end,
        employee.grace_minutes,
        employee.status,
        employee.notes
      );
      audit(req, 'create', 'production_employee', result.lastInsertRowid, employee.name);
      res.status(201).json(db.prepare('SELECT * FROM production_employees WHERE id = ?').get(result.lastInsertRowid));
    } catch {
      res.status(409).json({ message: 'Ya existe un empleado con ese nombre' });
    }
  });

  app.put('/api/producalza/employees/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = db.prepare(
      'SELECT * FROM production_employees WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!current) return res.status(404).json({ message: 'Empleado no encontrado' });
    let employee;
    try {
      employee = normalizeEmployeePayload({ ...current, ...req.body });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      db.prepare(
        `UPDATE production_employees
         SET name = ?, source_name = ?, pay_type = ?, monthly_salary = ?, default_iess = ?,
             late_penalty = ?, normal_start = ?, normal_end = ?, grace_minutes = ?,
             status = ?, notes = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      ).run(
        employee.name,
        employee.source_name,
        employee.pay_type,
        employee.monthly_salary,
        employee.default_iess,
        employee.late_penalty,
        employee.normal_start,
        employee.normal_end,
        employee.grace_minutes,
        employee.status,
        employee.notes,
        current.id,
        business.id
      );
      audit(req, 'update', 'production_employee', current.id, employee.name);
      res.json({ ok: true });
    } catch {
      res.status(409).json({ message: 'Ya existe otro empleado con ese nombre' });
    }
  });

  app.get('/api/producalza/payroll-periods', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const periods = db.prepare(
      `SELECT * FROM production_payroll_periods
       WHERE establishment_id = ?
       ORDER BY date_from DESC, id DESC`
    ).all(business.id).map(payrollPeriodSummary);
    res.json(periods);
  });

  app.get('/api/producalza/payroll-periods/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const period = getPayrollPeriod(req.params.id, req);
    if (!period) return res.status(404).json({ message: 'Rol no encontrado' });
    res.json(period);
  });

  app.post('/api/producalza/payroll-periods/import-detail', requireProductionAdmin, async (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const dateFrom = normalizeDateInput(req.body.date_from, '');
    const dateTo = normalizeDateInput(req.body.date_to, '');
    const label = String(req.body.label || '').trim() || (dateFrom && dateTo ? `${dateFrom} / ${dateTo}` : '');
    const fileBase64 = String(req.body.file_base64 || '').replace(/^data:.*?;base64,/, '');
    if (!dateFrom || !dateTo || !label) {
      return res.status(400).json({ message: 'Selecciona fecha inicial, fecha final y nombre del rol' });
    }
    if (!fileBase64) {
      return res.status(400).json({ message: 'Sube el archivo Excel del detalle' });
    }
    let xlsx;
    try {
      const xlsxModule = await import('xlsx');
      xlsx = xlsxModule.default || xlsxModule;
    } catch {
      return res.status(500).json({ message: 'Falta instalar la libreria de Excel. Sube los cambios y Render la instalara automaticamente.' });
    }
    let attendanceRows;
    let salaryDefaults;
    try {
      const workbook = xlsx.read(Buffer.from(fileBase64, 'base64'), { type: 'buffer', cellDates: true });
      attendanceRows = parseAttendanceDetail(xlsx, workbook);
      salaryDefaults = parseSalaryDefaults(xlsx, workbook);
    } catch (error) {
      return res.status(400).json({ message: `No se pudo leer el Excel: ${error.message}` });
    }
    if (!attendanceRows.length) {
      return res.status(400).json({ message: 'No encontre trabajadores en la hoja DETALLE' });
    }

    let periodId;
    db.transaction(() => {
      const periodResult = db.prepare(
        `INSERT INTO production_payroll_periods
         (establishment_id, label, date_from, date_to, source_filename)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(establishment_id, label) DO UPDATE SET
           date_from = excluded.date_from,
           date_to = excluded.date_to,
           source_filename = excluded.source_filename,
           updated_at = datetime('now', 'localtime')`
      ).run(business.id, label, dateFrom, dateTo, String(req.body.filename || '').trim());
      const period = db.prepare(
        'SELECT id FROM production_payroll_periods WHERE establishment_id = ? AND label = ?'
      ).get(business.id, label);
      periodId = period.id;

      const employees = db.prepare('SELECT * FROM production_employees WHERE establishment_id = ?').all(business.id);
      const findEmployee = (name) => employees.find((employee) =>
        employeeKey(employee.name) === employeeKey(name) || employeeKey(employee.source_name) === employeeKey(name)
      );
      const insertEmployee = db.prepare(
        `INSERT INTO production_employees
         (establishment_id, name, source_name, monthly_salary, default_iess, normal_end)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const updateEmployeeDefaults = db.prepare(
        `UPDATE production_employees
         SET source_name = ?,
             monthly_salary = CASE WHEN monthly_salary = 0 THEN ? ELSE monthly_salary END,
             default_iess = CASE WHEN default_iess = 0 THEN ? ELSE default_iess END,
             normal_end = CASE WHEN ? = 1 THEN '17:00' ELSE normal_end END,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND establishment_id = ?`
      );
      const upsertEntry = db.prepare(
        `INSERT INTO production_payroll_entries
         (establishment_id, period_id, employee_id, employee_name, source_name, pay_type,
          monthly_salary, hourly_rate, overtime_rate, work_days, attendance_days, absent_days,
          late_days, late_minutes, early_leave_days, overtime_hours, manual_unworked_hours,
          late_penalty, iess_amount, advance_amount, savings_amount, footwear_amount,
          other_deductions, other_income, piece_income, total_income, total_deductions, net_pay, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(establishment_id, period_id, employee_name) DO UPDATE SET
           employee_id = excluded.employee_id,
           source_name = excluded.source_name,
           pay_type = excluded.pay_type,
           monthly_salary = excluded.monthly_salary,
           hourly_rate = excluded.hourly_rate,
           overtime_rate = excluded.overtime_rate,
           work_days = excluded.work_days,
           attendance_days = excluded.attendance_days,
           absent_days = excluded.absent_days,
           late_days = excluded.late_days,
           late_minutes = excluded.late_minutes,
           early_leave_days = excluded.early_leave_days,
           overtime_hours = excluded.overtime_hours,
           late_penalty = excluded.late_penalty,
           iess_amount = CASE WHEN production_payroll_entries.iess_amount = 0 THEN excluded.iess_amount ELSE production_payroll_entries.iess_amount END,
           total_income = excluded.total_income,
           total_deductions = excluded.total_deductions,
           net_pay = excluded.net_pay,
           updated_at = datetime('now', 'localtime')`
      );

      for (const attendance of attendanceRows) {
        const defaults = salaryDefaults.get(employeeKey(attendance.name)) || {};
        let employee = findEmployee(attendance.name);
        const isNorma = employeeKey(attendance.name).includes('norma') && employeeKey(attendance.name).includes('llamuca');
        if (!employee) {
          const employeeResult = insertEmployee.run(
            business.id,
            attendance.name,
            attendance.source_name,
            moneyValue(defaults.salary),
            moneyValue(defaults.defaultIess),
            isNorma ? '17:00' : DEFAULT_PAYROLL_END
          );
          employee = db.prepare('SELECT * FROM production_employees WHERE id = ?').get(employeeResult.lastInsertRowid);
          employees.push(employee);
        } else {
          updateEmployeeDefaults.run(
            attendance.source_name,
            moneyValue(defaults.salary),
            moneyValue(defaults.defaultIess),
            isNorma ? 1 : 0,
            employee.id,
            business.id
          );
          employee = db.prepare('SELECT * FROM production_employees WHERE id = ?').get(employee.id);
        }
        const calculated = payrollMath({
          ...attendance,
          employee_id: employee.id,
          employee_name: employee.name,
          source_name: attendance.source_name,
          pay_type: employee.pay_type,
          monthly_salary: employee.monthly_salary || defaults.salary || 0,
          hourly_rate: (employee.monthly_salary || defaults.salary || 0) / 240,
          overtime_rate: ((employee.monthly_salary || defaults.salary || 0) / 240) * 1.5,
          manual_unworked_hours: 0,
          late_penalty: employee.late_penalty,
          iess_amount: employee.default_iess || defaults.defaultIess || 0,
          advance_amount: 0,
          savings_amount: 0,
          footwear_amount: 0,
          other_deductions: 0,
          other_income: 0,
          piece_income: 0,
          notes: ''
        });
        upsertEntry.run(
          business.id,
          periodId,
          calculated.employee_id,
          calculated.employee_name,
          calculated.source_name,
          calculated.pay_type,
          calculated.monthly_salary,
          calculated.hourly_rate,
          calculated.overtime_rate,
          calculated.work_days,
          calculated.attendance_days,
          calculated.absent_days,
          calculated.late_days,
          calculated.late_minutes,
          calculated.early_leave_days,
          calculated.overtime_hours,
          calculated.manual_unworked_hours,
          calculated.late_penalty,
          calculated.iess_amount,
          calculated.advance_amount,
          calculated.savings_amount,
          calculated.footwear_amount,
          calculated.other_deductions,
          calculated.other_income,
          calculated.piece_income,
          calculated.total_income,
          calculated.total_deductions,
          calculated.net_pay,
          calculated.notes
        );
      }
    })();

    audit(req, 'import', 'production_payroll', periodId, label);
    res.status(201).json(getPayrollPeriod(periodId, req));
  });

  app.patch('/api/producalza/payroll-entries/:id', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const current = db.prepare(
      'SELECT * FROM production_payroll_entries WHERE id = ? AND establishment_id = ?'
    ).get(req.params.id, business.id);
    if (!current) return res.status(404).json({ message: 'Registro de rol no encontrado' });
    const updated = payrollMath({
      ...current,
      monthly_salary: req.body.monthly_salary ?? current.monthly_salary,
      overtime_hours: req.body.overtime_hours ?? current.overtime_hours,
      manual_unworked_hours: req.body.manual_unworked_hours ?? current.manual_unworked_hours,
      late_penalty: req.body.late_penalty ?? current.late_penalty,
      iess_amount: req.body.iess_amount ?? current.iess_amount,
      advance_amount: req.body.advance_amount ?? current.advance_amount,
      savings_amount: req.body.savings_amount ?? current.savings_amount,
      footwear_amount: req.body.footwear_amount ?? current.footwear_amount,
      other_deductions: req.body.other_deductions ?? current.other_deductions,
      other_income: req.body.other_income ?? current.other_income,
      piece_income: req.body.piece_income ?? current.piece_income,
      notes: req.body.notes ?? current.notes
    });
    db.prepare(
      `UPDATE production_payroll_entries
       SET monthly_salary = ?, hourly_rate = ?, overtime_rate = ?, overtime_hours = ?,
           manual_unworked_hours = ?, late_penalty = ?, iess_amount = ?,
           advance_amount = ?, savings_amount = ?, footwear_amount = ?,
           other_deductions = ?, other_income = ?, piece_income = ?,
           total_income = ?, total_deductions = ?, net_pay = ?, notes = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ? AND establishment_id = ?`
    ).run(
      updated.monthly_salary,
      updated.hourly_rate,
      updated.overtime_rate,
      moneyValue(updated.overtime_hours),
      moneyValue(updated.manual_unworked_hours),
      moneyValue(updated.late_penalty),
      moneyValue(updated.iess_amount),
      moneyValue(updated.advance_amount),
      moneyValue(updated.savings_amount),
      moneyValue(updated.footwear_amount),
      moneyValue(updated.other_deductions),
      moneyValue(updated.other_income),
      moneyValue(updated.piece_income),
      updated.total_income,
      updated.total_deductions,
      updated.net_pay,
      String(updated.notes || '').trim(),
      current.id,
      business.id
    );
    audit(req, 'update', 'production_payroll_entry', current.id, current.employee_name);
    res.json(getPayrollPeriod(current.period_id, req));
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
         AND visits.next_visit_date >= date('now', 'localtime', '-1 day')
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
         AND payments.due_date >= date('now', 'localtime', '-1 day')
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
    const userLabel = req.user?.username || req.user?.role || 'system';
    const result = db.transaction(() => {
      const insert = db.prepare(
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
        userLabel
      );
      deleteAutomaticDeliveryBalance(order.id, business.id);
      if ((payment.status === 'paid' || payment.status === 'pending') && payment.amount > 0) {
        reducePendingBalance(order.id, business.id, payment.amount, insert.lastInsertRowid);
      }
      return insert;
    })();
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
    db.transaction(() => {
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
      deleteAutomaticDeliveryBalance(order.id, business.id);
      const userLabel = req.user?.username || req.user?.role || 'system';
      if (current.status === payment.status && (payment.status === 'paid' || payment.status === 'pending')) {
        const delta = moneyValue(payment.amount - Number(current.amount || 0));
        if (delta > 0) reducePendingBalance(order.id, business.id, delta, current.id);
        if (delta < 0) addPendingBalance(order.id, business.id, Math.abs(delta), userLabel);
      } else if (current.status === 'paid' && payment.status !== 'paid') {
        addPendingBalance(order.id, business.id, current.amount, userLabel);
      }
    })();
    audit(req, 'update', 'order_payment', current.id, payment.status);
    res.json(getOrder(order.id, req));
  });

  app.delete('/api/producalza/orders/:id/payments/:paymentId', requireProductionAdmin, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const current = db.prepare(
      'SELECT * FROM production_order_payments WHERE id = ? AND order_id = ? AND establishment_id = ?'
    ).get(req.params.paymentId, order.id, business.id);
    if (!current) return res.status(404).json({ message: 'Cobro no encontrado' });
    let result;
    db.transaction(() => {
      result = db.prepare(
        'DELETE FROM production_order_payments WHERE id = ? AND order_id = ? AND establishment_id = ?'
      ).run(req.params.paymentId, order.id, business.id);
      if (result.changes) {
        deleteAutomaticDeliveryBalance(order.id, business.id);
        if ((current.status === 'paid' || current.status === 'pending') && Number(current.amount || 0) > 0) {
          addPendingBalance(order.id, business.id, current.amount, req.user?.username || req.user?.role || 'system');
        }
      }
    })();
    audit(req, 'delete', 'order_payment', req.params.paymentId, order.order_number);
    res.json(getOrder(order.id, req));
  });

  app.patch('/api/producalza/orders/:id/payment-summary', requireProductionUser, (req, res) => {
    const business = ensureProductionBusiness(req, res);
    if (!business) return;
    const order = getOrder(req.params.id, req);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    const paidTotal = moneyValue(req.body.paid_total);
    const pendingTotal = moneyValue(req.body.pending_total);
    const userLabel = req.user?.username || req.user?.role || 'system';
    const manualRefs = [DELIVERY_NOTE_BALANCE_REF, MANUAL_PAID_TOTAL_REF, MANUAL_PENDING_TOTAL_REF];

    try {
      db.transaction(() => {
        db.prepare(
          `DELETE FROM production_order_payments
           WHERE order_id = ? AND establishment_id = ?
             AND COALESCE(reference, '') IN (?, ?, ?)`
        ).run(order.id, business.id, ...manualRefs);

        const baseTotals = paymentTotalsForOrder(order.id, business.id, manualRefs);
        const paidAdjustment = moneyValue(paidTotal - Number(baseTotals.paid_total || 0));
        const pendingAdjustment = moneyValue(pendingTotal - Number(baseTotals.pending_total || 0));

        if (paidAdjustment < 0) {
          throw new Error(`El total pagado no puede ser menor a los pagos ya registrados (${displayMoneyValue(baseTotals.paid_total)}).`);
        }
        if (pendingAdjustment < 0) {
          throw new Error(`El total pendiente no puede ser menor a los cobros pendientes ya registrados (${displayMoneyValue(baseTotals.pending_total)}).`);
        }

        const insert = db.prepare(
          `INSERT INTO production_order_payments
           (establishment_id, order_id, payment_type, amount, payment_date, due_date,
            status, bank, reference, notes, created_by)
           VALUES (?, ?, ?, ?, ?, NULL, ?, '', ?, ?, ?)`
        );
        if (paidAdjustment > 0) {
          insert.run(
            business.id,
            order.id,
            'abono',
            paidAdjustment,
            new Date().toISOString().slice(0, 10),
            'paid',
            MANUAL_PAID_TOTAL_REF,
            'Ajuste manual total pagado',
            userLabel
          );
        }
        if (pendingAdjustment > 0) {
          insert.run(
            business.id,
            order.id,
            'saldo',
            pendingAdjustment,
            null,
            'pending',
            MANUAL_PENDING_TOTAL_REF,
            'Ajuste manual total pendiente',
            userLabel
          );
        }
      })();
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    audit(req, 'update', 'order_payment_summary', order.id, `${paidTotal}/${pendingTotal}`);
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
    const isPartialDelivery = Boolean(req.body.partial_delivery);
    const sentModelIds = Array.isArray(req.body.sent_model_ids)
      ? req.body.sent_model_ids.map((id) => Number(id || 0)).filter((id) => validModelIds.has(id))
      : [];
    if (isPartialDelivery && !sentModelIds.length) {
      return res.status(400).json({ message: 'Selecciona al menos un modelo enviado para generar la nota.' });
    }
    const modelsForNote = isPartialDelivery
      ? order.models.filter((model) => sentModelIds.includes(Number(model.id)))
      : order.models;
    const shippingValue = moneyValue(req.body.shipping_value);
    const discountValue = moneyValue(req.body.discount_value);
    const priceByModel = new Map(prices.map((model) => [Number(model.id || 0), moneyValue(model.unit_price)]));
    const noteSubtotal = modelsForNote.reduce((sum, model) => {
      const unitPrice = priceByModel.has(Number(model.id))
        ? priceByModel.get(Number(model.id))
        : moneyValue(model.unit_price);
      return sum + (Number(model.total_pairs || 0) * unitPrice);
    }, 0);
    const noteTotal = moneyValue(Math.max(0, noteSubtotal + shippingValue - discountValue));
    const paymentTotals = paymentTotalsForOrder(order.id, business.id);
    const paymentBalance = moneyValue(Number(paymentTotals.paid_total || 0) + Number(paymentTotals.pending_total || 0));
    if (!isPartialDelivery && paymentBalance > 0.009 && Math.abs(noteTotal - paymentBalance) > 0.009) {
      return res.status(400).json({
        message: `El total de la nota (${displayMoneyValue(noteTotal)}) no coincide con pagado + pendiente (${displayMoneyValue(paymentBalance)}). Corrige los cobros del pedido antes de imprimir.`
      });
    }

    db.transaction(() => {
      if (!isPartialDelivery) {
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
      }

      const updateModel = db.prepare(
        `UPDATE production_order_models
         SET unit_price = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND order_id = ? AND establishment_id = ?`
      );
      for (const model of prices) {
        const modelId = Number(model.id || 0);
        if (!validModelIds.has(modelId)) continue;
        if (isPartialDelivery) continue;
        updateModel.run(moneyValue(model.unit_price), modelId, order.id, business.id);
      }
      deleteAutomaticDeliveryBalance(order.id, business.id);
      if (isPartialDelivery) {
        addPendingBalance(order.id, business.id, noteTotal, req.user?.username || req.user?.role || 'system');
      } else if (paymentBalance <= 0.009) {
        createInitialPendingBalance(order.id, business.id, noteTotal, req.user?.username || req.user?.role || 'system');
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
