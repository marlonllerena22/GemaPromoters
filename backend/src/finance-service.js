import crypto from "node:crypto";
import {notificationBankMatch} from './finance-notification-match.js';
import {linkRecordedBankEvidence} from './finance-evidence-links.js';
import {matchOwnTransferCredit} from './finance-own-transfers.js';
import {
  recordedAccountBalance,
  matchReportedChecks,
} from "./finance-check-ledger.js";
import { audit, cents, financeDay, validDay } from "./finance-db.js";

export const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const text = (value, max = 200) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
export const tableExists = (db, name) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  );
export const isManager = (user) => ["owner", "manager"].includes(user.role);
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === "object"
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

export function businessAccess(user, id) {
  if (!user.business_ids.includes(id))
    fail("No tienes acceso a este negocio", 403);
}

export function unitAccess(db, user, id, business) {
  if (!id) {
    if (user.unit_ids.length)
      fail("Selecciona tu local o unidad asignada", 403);
    return null;
  }
  const unit = db.prepare("SELECT * FROM finance_units WHERE id=?").get(id);
  if (!unit || unit.business_id !== business)
    fail("La unidad no pertenece al negocio");
  if (user.unit_ids.length && !user.unit_ids.includes(id))
    fail("No tienes acceso a esta unidad", 403);
  return unit;
}

export function scoped(user, row) {
  return (
    user.business_ids.includes(row.business_id) &&
    (!user.unit_ids.length || user.unit_ids.includes(row.unit_id))
  );
}

export function requireRow(db, table, id, user) {
  if (
    !["finance_movements", "finance_evidence", "finance_recurring"].includes(
      table,
    )
  )
    fail("Recurso inválido");
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  const ownLegacyReceipt=row&&row.unit_id===null&&row.created_by===user.username&&user.business_ids.includes(row.business_id)&&(table==='finance_evidence'||(table==='finance_movements'&&row.kind==='income'&&row.evidence_id));
  if (!row || (!scoped(user, row)&&!ownLegacyReceipt)) fail("Registro no encontrado", 404);
  return row;
}

export function visibleAccounts(db, user) {
  if (user.role === "collector") return [];
  return db
    .prepare("SELECT * FROM finance_accounts WHERE active=1 ORDER BY id")
    .all()
    .filter(
      (a) =>
        user.role === "owner" ||
        (user.work_view && !a.business_id && !user.unit_ids.length) ||
        (user.business_ids.includes(a.business_id) && !user.unit_ids.length),
    );
}

export function createMovement(db, user, body, {receiptAccount=false}={}) {
  businessAccess(user, body.business_id);
  unitAccess(db, user, body.unit_id, body.business_id);
  if (!["income", "expense", "transfer", "refund"].includes(body.kind))
    fail("Tipo de movimiento inválido");
  if (body.kind === "transfer")
    fail(
      "Registra el traslado identificando cuenta de origen y destino desde Cuentas",
    );
  if (
    !["cash", "transfer", "card", "payphone", "other"].includes(
      body.payment_method || "transfer",
    )
  )
    fail("Medio de pago inválido");
  const amount = cents(body.amount_cents);
  const day = validDay(body.day);
  if (day > financeDay())
    fail("La fecha del movimiento no puede ser futura; utiliza el vencimiento");
  const due = body.due_date ? validDay(body.due_date) : null;
  if (!text(body.counterparty) || !text(body.category))
    fail("Completa responsable o proveedor y categoría");
  if (body.account_id) {
    const account = db
      .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
      .get(body.account_id);
    if (
      !account ||
      (account.business_id &&
        account.business_id !== body.business_id &&
        !(user.role === "owner" && body.allow_cross_account === true) &&
        !(receiptAccount && body.kind==='income' && body.evidence_id && account.kind==='bank'))
    )
      fail("La cuenta no corresponde al negocio");
  }
  if (body.evidence_id) {
    const evidence = db
      .prepare("SELECT * FROM finance_evidence WHERE id=?")
      .get(body.evidence_id);
    if (
      !evidence ||
      evidence.business_id !== body.business_id ||
      (user.role === "collector" && evidence.created_by !== user.username)
    )
      fail("Comprobante no disponible", 403);
  }
  if (body.order_id) {
    if (
      body.business_id !== "producalza" ||
      !tableExists(db, "production_orders")
    )
      fail("Pedido no disponible");
    const order = db
      .prepare(
        "SELECT id FROM production_orders WHERE id=? AND deleted_at IS NULL",
      )
      .get(body.order_id);
    if (!order) fail("Pedido no encontrado");
  }
  if (
    body.unit_id &&
    db
      .prepare("SELECT id FROM finance_closings WHERE unit_id=? AND day=?")
      .get(body.unit_id, day)
  )
    fail(
      "Ese día está cerrado. Solicita su reapertura antes de registrar cambios.",
      409,
    );
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO finance_movements
      (business_id,unit_id,account_id,kind,amount_cents,day,due_date,category,counterparty,description,reference,payment_method,evidence_id,order_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        body.business_id,
        body.unit_id || null,
        body.account_id || null,
        body.kind,
        amount,
        day,
        due,
        text(body.category, 80),
        text(body.counterparty),
        text(body.description, 2000),
        text(body.reference),
        body.payment_method || "transfer",
        body.evidence_id || null,
        body.order_id || null,
        user.username,
      );
    if (
      ((user.role === "owner" && body.allow_cross_account === true) || receiptAccount) &&
      body.account_id
    ) {
      const a = db
        .prepare("SELECT business_id FROM finance_accounts WHERE id=?")
        .get(body.account_id);
      if (a.business_id && a.business_id !== body.business_id)
        db.prepare(
          "UPDATE finance_movements SET cross_account=1 WHERE id=?",
        ).run(result.lastInsertRowid);
    }
    const row = db
      .prepare("SELECT * FROM finance_movements WHERE id=?")
      .get(result.lastInsertRowid);
    audit(
      db,
      user.username,
      "movement.created",
      "movement",
      row.id,
      null,
      row,
      row.business_id,
    );
    return row;
  })();
}

export function importBank(db, user, body) {
  if (user.role !== "owner")
    fail("Solo el propietario puede importar movimientos bancarios", 403);
  const account = db
    .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
    .get(body.account_id);
  if (!account) fail("Selecciona una cuenta activa");
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 5000)
    fail("Importa entre 1 y 5000 movimientos");
  const rows = body.rows.map((row) => {
    const day = validDay(row.day);
    if (day < account.opening_date)
      fail("Hay movimientos anteriores al saldo inicial de la cuenta");
    if (account.opening_at && day === account.opening_date) {
      const timestamp = Date.parse(row.occurred_at || "");
      if (
        !Number.isFinite(timestamp) ||
        timestamp <= Date.parse(account.opening_at)
      )
        fail(
          "El primer día requiere la hora del movimiento posterior al saldo inicial; evita sumar operaciones ya incluidas en la captura",
        );
    }
    if (day > financeDay()) fail("Hay movimientos con fecha futura");
    return {
      day,
      occurred_at:
        row.occurred_at && Number.isFinite(Date.parse(row.occurred_at))
          ? new Date(row.occurred_at).toISOString()
          : null,
      amount_cents: cents(row.amount_cents, { signed: true }),
      reference: text(row.reference),
      description: text(row.description, 500),
      external_id: text(row.external_id),
      counterparty: text(row.counterparty,150),
      origin_account_id: Number(row.origin_account_id)||null,
    };
  });
  // Two identical rows without a stable bank identifier cannot be distinguished safely.
  const identities = rows.map(
    (row) =>
      row.external_id ||
      JSON.stringify([
        row.day,
        row.amount_cents,
        row.reference,
        row.description,
      ]),
  );
  if (new Set(identities).size !== identities.length)
    fail(
      "Hay filas indistinguibles. Agrega un identificador bancario único a cada una.",
    );
  return db.transaction(() => {
    const batch = crypto.randomUUID();
    let imported = 0;
    const transactionIds = [];
    const source = ["bank-email", "assistant", "statement-image", "bank-notification"].includes(body.source_system) ? body.source_system : "csv";
    rows.forEach((row, index) => {
      const ownCredit=matchOwnTransferCredit(db,{account_id:account.id,...row},source);
      if(ownCredit){transactionIds.push(ownCredit.id);return;}
      const fingerprint = crypto
        .createHash("sha256")
        .update(identities[index])
        .digest("hex");
      const existing = db
        .prepare(
          "SELECT * FROM finance_bank_transactions WHERE account_id=? AND fingerprint=?",
        )
        .get(account.id, fingerprint);
      if (existing) {
        if (
          existing.day !== row.day ||
          existing.amount_cents !== row.amount_cents ||
          existing.reference !== row.reference
        )
          fail(
            "Un identificador bancario existente tiene datos diferentes. Revisa el archivo.",
            409,
          );
        transactionIds.push(existing.id);
        return;
      }
      if(source!=='bank-notification'){
        const notice=notificationBankMatch(db,{account_id:account.id,...row});
        if(notice){transactionIds.push(notice.id);return;}
      }
      if (row.reference) {
        const matching = db
          .prepare(
            "SELECT * FROM finance_bank_transactions WHERE account_id=? AND day=? AND amount_cents=? AND reference=? AND import_source!=?",
          )
          .all(account.id, row.day, row.amount_cents, row.reference, source);
        if (matching.length > 1)
          fail(
            "Hay varios movimientos de otra fuente con esta referencia. Revisa antes de sumar",
            409,
          );
        if (matching.length === 1) {
          transactionIds.push(matching[0].id);
          return;
        }
      }
      const taxCode = /\bisd\b/i.test(row.description) ? "ISD" : /\biva(?:sd)?\b|retencion\s+iva/i.test(row.description) ? "IVA" : null;
      const merchant = /facebk|facebook/i.test(row.description) ? "Facebook" : /google.*chatgpt|google\s*\*?c\b|g\.co\/helppay/i.test(row.description) ? "Google ChatGPT" : null;
      if (taxCode && merchant && row.amount_cents < 0) {
        const taxes = db.prepare("SELECT t.bank_transaction_id FROM finance_digital_taxes t JOIN finance_bank_transactions b ON b.id=t.bank_transaction_id WHERE b.account_id=? AND b.day=? AND b.amount_cents=? AND t.tax_code=? AND t.merchant=? AND t.state='calculated'").all(account.id, row.day, row.amount_cents, taxCode, merchant);
        if (taxes.length > 1) fail("Hay varios impuestos calculados iguales. Relaciona el consumo antes de importar para no duplicarlos", 409);
        if (taxes.length === 1) {
          const taxId = taxes[0].bank_transaction_id;
          db.prepare("UPDATE finance_bank_transactions SET import_source=?,reference=?,description=?,fingerprint=?,occurred_at=COALESCE(?,occurred_at) WHERE id=?").run(source, row.reference, row.description, fingerprint, row.occurred_at, taxId);
          db.prepare("UPDATE finance_digital_taxes SET state='verified' WHERE bank_transaction_id=?").run(taxId);
          transactionIds.push(taxId);
          return;
        }
      }
      const inserted = db
        .prepare(
          `INSERT INTO finance_bank_transactions (account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by,import_source,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          account.id,
          row.day,
          row.amount_cents,
          row.reference,
          row.description,
          fingerprint,
          batch,
          user.username,
          source,
          row.occurred_at,
        );
      transactionIds.push(Number(inserted.lastInsertRowid));
      imported++;
    });
    linkRecordedBankEvidence(db);
    matchReportedChecks(db, user.username);
    const result = {
      imported,
      duplicates: rows.length - imported,
      batch_id: batch,
      transaction_ids: transactionIds,
    };
    audit(
      db,
      user.username,
      "bank.imported",
      "account",
      account.id,
      null,
      result,
      account.business_id,
    );
    db.prepare(
      "UPDATE finance_sync_log SET last_run=?,count=count+?,state='manual',detail='Movimientos importados desde archivo' WHERE source='bank'",
    ).run(new Date().toISOString(), imported);
    return result;
  })();
}

export function reconcile(db, user, body, bridges = {}) {
  if (user.role !== "owner")
    fail("Solo el propietario puede conciliar cuentas", 403);
  return db.transaction(() => {
    const movement = requireRow(
      db,
      "finance_movements",
      body.movement_id,
      user,
    );
    if (movement.is_payment_request)
      fail("Concilia el pago realizado, no la solicitud de transferencia", 409);
    const bank = db
      .prepare(
        "SELECT b.*,a.business_id AS account_business FROM finance_bank_transactions b JOIN finance_accounts a ON a.id=b.account_id WHERE b.id=?",
      )
      .get(body.bank_transaction_id);
    if (!bank) fail("Movimiento bancario no encontrado");
    if (
      bank.account_business &&
      bank.account_business !== movement.business_id &&
      !(user.role === "owner" && movement.cross_account)
    )
      fail("El banco y el movimiento pertenecen a negocios diferentes");
    if (movement.account_id && movement.account_id !== bank.account_id)
      fail("La cuenta del comprobante no coincide");
    if (movement.kind === "transfer" && !movement.transfer_side)
      fail("El traslado debe identificar su origen y destino");
    if (["rejected", "reconciled"].includes(movement.status))
      fail("Este movimiento no está disponible para conciliación", 409);
    if (
      movement.kind === "expense" &&
      !["approved", "reported"].includes(movement.status)
    )
      fail("Aprueba el gasto antes de conciliarlo");
    const direction =
      movement.kind === "income" || movement.transfer_side === "incoming"
        ? 1
        : -1;
    if (Math.sign(bank.amount_cents) !== direction)
      fail("La dirección bancaria no coincide con el movimiento");
    const amount = cents(body.amount_cents);
    const bankUsed = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_allocations WHERE bank_transaction_id=?",
      )
      .get(bank.id).n;
    const movementUsed = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_allocations WHERE movement_id=?",
      )
      .get(movement.id).n;
    if (
      amount > Math.abs(bank.amount_cents) - bankUsed ||
      amount > movement.amount_cents - movementUsed
    )
      fail("La asignación supera el saldo disponible", 409);
    if (
      db
        .prepare(
          "SELECT id FROM finance_allocations WHERE bank_transaction_id=? AND movement_id=?",
        )
        .get(bank.id, movement.id)
    )
      fail("Esta asociación ya existe", 409);
    db.prepare(
      "INSERT INTO finance_allocations (bank_transaction_id,movement_id,amount_cents,created_by) VALUES (?,?,?,?)",
    ).run(bank.id, movement.id, amount, user.username);
    const full = movementUsed + amount === movement.amount_cents;
    db.prepare(
      "UPDATE finance_movements SET status=?,account_id=?,updated_at=? WHERE id=?",
    ).run(
      full ? "reconciled" : movement.status,
      bank.account_id,
      new Date().toISOString(),
      movement.id,
    );
    if (
      full &&
      movement.kind === "income" &&
      movement.order_id &&
      bridges.production
    ) {
      const account = db
        .prepare("SELECT bank FROM finance_accounts WHERE id=?")
        .get(bank.account_id);
      const link = bridges.production.applyFinancePayment(
        movement,
        bank.day,
        account.bank,
        user.username,
      );
      const duplicate = db
        .prepare(
          "SELECT * FROM finance_movements WHERE id<>? AND ((production_payment_id=?) OR (source_system='producalza' AND external_id=?))",
        )
        .get(movement.id, link.id, String(link.id));
      if (duplicate) {
        const used = db
          .prepare(
            "SELECT COUNT(*) n FROM finance_allocations WHERE movement_id=?",
          )
          .get(duplicate.id).n;
        if (used || !["reported", "rejected"].includes(duplicate.status))
          fail("El abono ya está asociado a otro movimiento financiero", 409);
        db.prepare(
          "UPDATE finance_movements SET status='rejected',production_payment_id=NULL,review_note=? WHERE id=?",
        ).run(
          `Respaldo incorporado al movimiento #${movement.id}`,
          duplicate.id,
        );
        audit(
          db,
          user.username,
          "legacy.merged",
          "movement",
          duplicate.id,
          duplicate,
          { canonical_movement_id: movement.id },
          movement.business_id,
        );
      }
      db.prepare(
        "UPDATE finance_movements SET production_payment_id=?,production_payment_owned=? WHERE id=?",
      ).run(link.id, link.owned ? 1 : 0, movement.id);
      audit(
        db,
        user.username,
        "order.payment_applied",
        "movement",
        movement.id,
        null,
        { production_payment_id: link.id, owned: link.owned },
        movement.business_id,
      );
    }
    audit(
      db,
      user.username,
      "movement.reconciled",
      "movement",
      movement.id,
      movement,
      {
        bank_transaction_id: bank.id,
        amount_cents: amount,
        fully_reconciled: full,
      },
      movement.business_id,
    );
    return { fully_reconciled: full };
  })();
}

export function importSale(db, sale, actor = "integration:alfabusiness") {
  if (sale.currency && sale.currency !== "USD")
    fail("Las ventas de esta integración deben estar expresadas en USD");
  if (
    !db
      .prepare("SELECT id FROM finance_businesses WHERE id=?")
      .get(sale.business_id)
  )
    fail("Negocio desconocido");
  if (
    !text(sale.source_system) ||
    !text(sale.external_id) ||
    !["active", "cancelled", "pending", "refunded"].includes(sale.state)
  )
    fail("Faltan identificadores o estado de venta");
  if (
    String(sale.external_id).length > 200 ||
    String(sale.source_system).length > 200
  )
    fail("El identificador del origen o de la venta es demasiado largo");
  const day = validDay(sale.day);
  const amount = cents(sale.total_cents, { zero: true });
  const refunded = cents(sale.refunded_cents || 0, { zero: true });
  if (refunded > amount) fail("La devolución excede la venta");
  if (
    !sale.source_updated_at ||
    !Number.isFinite(Date.parse(sale.source_updated_at)) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(sale.source_updated_at)
  )
    fail("Incluye source_updated_at con zona horaria");
  if (
    sale.unit_id &&
    !db
      .prepare("SELECT id FROM finance_units WHERE id=? AND business_id=?")
      .get(sale.unit_id, sale.business_id)
  )
    fail("Local o evento desconocido");
  const payments = sale.payments || [];
  if (!Array.isArray(payments) || payments.length > 20)
    fail("Desglose de pagos inválido");
  let paid = 0;
  for (const payment of payments) {
    if (
      !["cash", "card", "transfer", "payphone", "other"].includes(
        payment.method,
      )
    )
      fail("Medio de pago desconocido");
    paid += cents(payment.amount_cents, { zero: true });
    cents(payment.refunded_cents || 0, { zero: true });
    if ((payment.refunded_cents || 0) > payment.amount_cents)
      fail("Devolución de cobro inválida");
  }
  if (
    paid > amount ||
    payments.reduce((s, p) => s + (p.refunded_cents || 0), 0) > refunded
  )
    fail("El desglose de cobros no coincide con la venta");
  return db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT * FROM finance_sales WHERE source_system=? AND business_id=? AND external_id=?",
      )
      .get(sale.source_system, sale.business_id, String(sale.external_id));
    const version = new Date(sale.source_updated_at).toISOString();
    const payload = canonical({
      ...sale,
      source_updated_at: version,
      payments,
    });
    if (existing && version < existing.source_updated_at)
      return { id: existing.id, ignored: true };
    if(existing&&sale.source_system==='alfabusiness'&&version===existing.source_updated_at&&existing.unit_id===(sale.unit_id||null)&&existing.document_number===text(sale.document_number)&&existing.day===day&&existing.total_cents===amount&&existing.refunded_cents===refunded&&existing.state===sale.state&&canonical(JSON.parse(existing.payments_json))===canonical(payments)&&canonical(JSON.parse(existing.payload_json).retail)===canonical(sale.retail))return {id:existing.id,ignored:true};
    if (existing && existing.payload_json === payload)
      return { id: existing.id, ignored: true };
    if (existing && version === existing.source_updated_at)
      fail(
        "La misma versión de venta contiene datos diferentes. Envía una fecha de actualización más precisa.",
        409,
      );
    const values = [
      sale.business_id,
      sale.unit_id || null,
      text(sale.source_system),
      text(sale.external_id),
      text(sale.document_number),
      day,
      amount,
      refunded,
      sale.state,
      JSON.stringify(payments),
      version,
      payload,
    ];
    db.prepare(
      `INSERT INTO finance_sales (business_id,unit_id,source_system,external_id,document_number,day,total_cents,refunded_cents,state,payments_json,source_updated_at,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_system,business_id,external_id) DO UPDATE SET
      unit_id=excluded.unit_id,document_number=excluded.document_number,day=excluded.day,total_cents=excluded.total_cents,
      refunded_cents=excluded.refunded_cents,state=excluded.state,payments_json=excluded.payments_json,source_updated_at=excluded.source_updated_at,payload_json=excluded.payload_json`,
    ).run(...values);
    const row = db
      .prepare(
        "SELECT * FROM finance_sales WHERE source_system=? AND business_id=? AND external_id=?",
      )
      .get(sale.source_system, sale.business_id, String(sale.external_id));
    const closed = db
      .prepare(
        "SELECT * FROM finance_closings WHERE (unit_id=? AND day=?) OR (unit_id=? AND day=?)",
      )
      .all(
        sale.unit_id || null,
        day,
        existing?.unit_id || null,
        existing?.day || day,
      );
    for (const closing of closed) {
      db.prepare("UPDATE finance_closings SET needs_review=1 WHERE id=?").run(
        closing.id,
      );
      audit(
        db,
        actor,
        "cash.source_changed",
        "closing",
        closing.id,
        { needs_review: Boolean(closing.needs_review) },
        { sale_id: row.id, needs_review: true },
        sale.business_id,
      );
    }
    audit(
      db,
      actor,
      existing ? "sale.updated" : "sale.imported",
      "sale",
      row.id,
      existing,
      row,
      sale.business_id,
    );
    return { id: row.id, ignored: false };
  })();
}

export function snapshot(db, user, filters = {}) {
  const today = financeDay();
  const from = filters.from
    ? validDay(filters.from)
    : `${today.slice(0, 7)}-01`;
  const to = filters.to ? validDay(filters.to) : today;
  if (from > to) fail("El inicio del período debe ser anterior al fin");
  if (filters.business_id && filters.business_id !== "all")
    businessAccess(user, filters.business_id);
  const businessIds =
    filters.business_id && filters.business_id !== "all"
      ? [filters.business_id]
      : user.business_ids;
  const permitted = (row) =>
    scoped(user, row) &&
    businessIds.includes(row.business_id) &&
    (user.role !== "collector" || row.created_by === user.username);
  const allMovements = db
    .prepare(
      `SELECT m.*,COALESCE((SELECT SUM(a.amount_cents) FROM finance_allocations a WHERE a.movement_id=m.id),0) allocated_cents,
      COALESCE((SELECT SUM(p.amount_cents) FROM finance_payments p WHERE p.request_id=m.id AND p.voided_at IS NULL),0) paid_total_cents,
    e.name evidence_name FROM finance_movements m LEFT JOIN finance_evidence e ON e.id=m.evidence_id WHERE m.hidden_at IS NULL ORDER BY m.day DESC,m.id DESC`,
    )
    .all()
    .filter(permitted);
  const movements = allMovements.filter((m) => m.day >= from && m.day <= to);
  const sales = db
    .prepare("SELECT * FROM finance_sales ORDER BY day DESC,id DESC")
    .all()
    .filter(
      (s) =>
        scoped(user, s) &&
        businessIds.includes(s.business_id) &&
        (user.role !== "collector" || user.unit_ids.length > 0),
    )
    .filter((s) => s.day >= from && s.day <= to)
    .map((s) => ({
      ...s,
      payload_json: undefined,
      payments: JSON.parse(s.payments_json),
      payments_json: undefined,
    }));
  const bankTransactions =
    user.role === "owner"
      ? db
          .prepare(
            `SELECT b.*,a.name account_name,
    COALESCE((SELECT SUM(x.amount_cents) FROM finance_allocations x WHERE x.bank_transaction_id=b.id),0) allocated_cents
    FROM finance_bank_transactions b JOIN finance_accounts a ON a.id=b.account_id ORDER BY b.day DESC,b.id DESC`,
          )
          .all()
          .filter(
            (b) =>
              !filters.account_id ||
              b.account_id === Number(filters.account_id),
          )
      : [];
  const accounts = visibleAccounts(db, user)
    .filter((a) => !a.business_id || businessIds.includes(a.business_id))
    .map((a) => {
      const sum = db.prepare(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_bank_transactions WHERE account_id=? AND day>=? AND day<=?",
      );
      const balance = recordedAccountBalance(db, a, today);
      const atVerification = a.verified_at
        ? recordedAccountBalance(
            db,
            a,
            financeDay(new Date(a.verified_at)),
            a.verified_at,
          )
        : null;
      const openingAllocations = db
        .prepare(
          "SELECT business_id,amount_cents FROM finance_account_allocations WHERE account_id=?",
        )
        .all(a.id);
      const positions = {};
      if (a.business_id) positions[a.business_id] = balance;
      else {
        for (const entry of openingAllocations)
          positions[entry.business_id] =
            (positions[entry.business_id] || 0) + entry.amount_cents;
        const allocations = db
          .prepare(
            `SELECT m.business_id,SUM(CASE WHEN b.amount_cents>0 THEN x.amount_cents ELSE -x.amount_cents END) n
          FROM finance_allocations x JOIN finance_bank_transactions b ON b.id=x.bank_transaction_id JOIN finance_movements m ON m.id=x.movement_id
          WHERE b.account_id=? AND b.day>=? AND b.day<=? GROUP BY m.business_id`,
          )
          .all(a.id, a.opening_date, today);
        for (const entry of allocations)
          positions[entry.business_id] =
            (positions[entry.business_id] || 0) + entry.n;
      }
      return {
        ...a,
        ...(user.work_view && !a.business_id
          ? { name: "Cuenta compartida", personal_details_private: true }
          : {}),
        balance_cents: balance,
        opening_allocations: user.work_view
          ? openingAllocations.filter((p) =>
              user.business_ids.includes(p.business_id),
            )
          : openingAllocations,
        positions: user.work_view
          ? Object.fromEntries(
              Object.entries(positions).filter(([id]) =>
                user.business_ids.includes(id),
              ),
            )
          : positions,
        unassigned_cents: user.work_view
          ? 0
          : a.business_id
            ? 0
            : balance - Object.values(positions).reduce((s, n) => s + n, 0),
        discrepancy_cents:
          a.verified_cents === null ? null : a.verified_cents - atVerification,
        transaction_count: user.work_view
          ? undefined
          : db
              .prepare(
                "SELECT COUNT(*) n FROM finance_bank_transactions WHERE account_id=?",
              )
              .get(a.id).n,
      };
    });
  const activeSales = sales.filter((s) => s.state === "active");
  const positionAmount = (a) =>
    filters.business_id && filters.business_id !== "all"
      ? a.positions[filters.business_id] || 0
      : a.balance_cents;
  const accepted = movements.filter(
    (m) =>
      !m.is_payment_request &&
      ["approved", "reconciled", "reported"].includes(m.status),
  );
  const summary = {
    balances_visible: user.role !== "collector" && !user.unit_ids.length,
    balance_cents: accounts
      .filter((a) => ["bank", "wallet"].includes(a.kind))
      .reduce((s, a) => s + positionAmount(a), 0),
    custody_cents: accounts
      .filter((a) => ["cash", "custody"].includes(a.kind))
      .reduce((s, a) => s + positionAmount(a), 0),
    unassigned_cents: accounts
      .filter(
        (a) =>
          !a.business_id &&
          ["bank", "wallet", "cash", "custody"].includes(a.kind),
      )
      .reduce((s, a) => s + a.unassigned_cents, 0),
    card_debt_cents: accounts
      .filter((a) => a.kind === "card")
      .reduce((s, a) => s + Math.max(0, -positionAmount(a)), 0),
    income_cents: movements
      .filter((m) => m.kind === "income" && m.status === "reconciled")
      .reduce((s, m) => s + m.amount_cents, 0),
    expense_cents: accepted
      .filter((m) => m.kind === "expense")
      .reduce((s, m) => s + m.amount_cents, 0),
    sales_cents: activeSales.reduce(
      (s, v) => s + v.total_cents - v.refunded_cents,
      0,
    ),
    pending_cents: allMovements
      .filter(
        (m) =>
          m.kind === "expense" &&
          (m.is_payment_request
            ? m.status !== "rejected"
            : ["pending", "approved"].includes(m.status)),
      )
      .reduce(
        (s, m) =>
          s +
          Math.max(
            0,
            m.amount_cents -
              (m.is_payment_request ? m.paid_total_cents : m.allocated_cents),
          ),
        0,
      ),
    pending_count: allMovements.filter(
      (m) =>
        !m.is_payment_request && ["pending", "reported"].includes(m.status),
    ).length,
    reconciled_count: movements.filter((m) => m.status === "reconciled").length,
    movement_count: movements.filter((m) => m.status !== "rejected").length,
    unassigned_bank_count: bankTransactions.filter(
      (b) => Math.abs(b.amount_cents) > b.allocated_cents,
    ).length,
    unverified_accounts: accounts.filter(
      (a) => !a.verified_at || a.discrepancy_cents !== 0,
    ).length,
  };
  const daily = new Map();
  for (const m of accepted) {
    const row = daily.get(m.day) || {
      day: m.day,
      income_cents: 0,
      expense_cents: 0,
    };
    if (m.kind === "income" && m.status === "reconciled")
      row.income_cents += m.amount_cents;
    if (m.kind === "expense") row.expense_cents += m.amount_cents;
    daily.set(m.day, row);
  }
  const businessSummary = db
    .prepare("SELECT * FROM finance_businesses")
    .all()
    .filter((b) => businessIds.includes(b.id))
    .map((b) => ({
      ...b,
      funds_cents: accounts
        .filter((a) => ["bank", "wallet"].includes(a.kind))
        .reduce((s, a) => s + (a.positions[b.id] || 0), 0),
      income_cents: movements
        .filter(
          (m) =>
            m.business_id === b.id &&
            m.kind === "income" &&
            m.status === "reconciled",
        )
        .reduce((s, m) => s + m.amount_cents, 0),
      expense_cents: accepted
        .filter((m) => m.business_id === b.id && m.kind === "expense")
        .reduce((s, m) => s + m.amount_cents, 0),
      sales_cents: activeSales
        .filter((s) => s.business_id === b.id)
        .reduce((a, s) => a + s.total_cents - s.refunded_cents, 0),
      pending_count: allMovements.filter(
        (m) =>
          m.business_id === b.id && ["pending", "reported"].includes(m.status),
      ).length,
    }));
  return {
    period: { from, to, today, time_zone: "America/Guayaquil" },
    summary,
    businesses: businessSummary,
    units: db
      .prepare("SELECT * FROM finance_units ORDER BY business_id,name")
      .all()
      .filter(
        (u) =>
          businessIds.includes(u.business_id) &&
          (!user.unit_ids.length || user.unit_ids.includes(u.id)),
      ),
    movements:
      filters.export_all === true ? movements : movements.slice(0, 500),
    movements_total: movements.length,
    pending: allMovements
      .filter(
        (m) =>
          !m.is_payment_request &&
          ["pending", "approved", "reported"].includes(m.status),
      )
      .slice(0, 200),
    sales: sales.slice(0, 500),
    sales_total: sales.length,
    accounts,
    bank_transactions: bankTransactions.slice(0, 1000),
    bank_transactions_total: bankTransactions.length,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    recurring: db
      .prepare(
        "SELECT * FROM finance_recurring WHERE active=1 ORDER BY due_day",
      )
      .all()
      .filter(permitted),
    budgets:
      user.role === "collector" || user.unit_ids.length
        ? []
        : db
            .prepare("SELECT * FROM finance_budgets WHERE month=?")
            .all(from.slice(0, 7))
            .filter((b) => businessIds.includes(b.business_id))
            .map((b) => ({
              ...b,
              actual_cents: allMovements
                .filter(
                  (m) =>
                    m.business_id === b.business_id &&
                    m.day.startsWith(b.month) &&
                    m.category === b.category &&
                    m.kind === "expense" &&
                    !m.is_payment_request &&
                    ["approved", "reconciled", "reported"].includes(m.status),
                )
                .reduce((s, m) => s + m.amount_cents, 0),
            })),
    closings: db
      .prepare(
        "SELECT c.*,u.business_id,u.name unit_name FROM finance_closings c JOIN finance_units u ON u.id=c.unit_id ORDER BY day DESC",
      )
      .all()
      .filter(permitted)
      .slice(0, 100),
    ticketing_receipts:
      businessIds.includes("gemashow") && user.role !== "collector"
        ? {
            ...sales
              .filter((s) => s.source_system === "protickets")
              .reduce(
                (result, sale) => {
                  if (sale.state === "pending") result.pending_orders++;
                  if (sale.state === "refunded") result.refunded_orders++;
                  if (sale.state !== "active") return result;
                  result.paid_orders++;
                  for (const payment of sale.payments) {
                    const amount = Math.max(
                      0,
                      payment.amount_cents - (payment.refunded_cents || 0),
                    );
                    if (payment.method === "payphone")
                      result.payphone_cents += amount;
                    if (payment.method === "transfer")
                      result.transfer_cents += amount;
                  }
                  return result;
                },
                { paid_orders: 0, pending_orders: 0, refunded_orders: 0, payphone_cents: 0, transfer_cents: 0 },
              ),
            provider_fees_verified: false,
            wallet_auto_updated: false,
          }
        : null,
    integrations: db.prepare("SELECT * FROM finance_sync_log").all(),
    capabilities: {
      ai: Boolean(process.env.OPENAI_API_KEY),
      webhook: Boolean(process.env.FINANCE_SALES_WEBHOOK_SECRET),
      upload: Boolean(
        process.env.FINANCE_DOCUMENT_KEY ||
          (process.env.FINANCE_DEMO === "1" &&
            process.env.NODE_ENV !== "production") ||
          process.env.NODE_ENV === "test",
      ),
      email: false,
      demo:
        process.env.FINANCE_DEMO === "1" &&
        process.env.NODE_ENV !== "production",
    },
    generated_at: new Date().toISOString(),
  };
}

export function csvExport(rows) {
  const columns = [
    "id",
    "business_id",
    "day",
    "kind",
    "counterparty",
    "category",
    "amount_usd",
    "amount_cents",
    "status",
    "reference",
    "source_system",
    "is_payment_request",
    "paid_total_cents",
  ];
  const escape = (value) => {
    let string = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(string)) string = `'${string}`;
    return `"${string.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      columns.join(","),
      ...rows.map((row) =>
        columns
          .map((c) =>
            escape(
              c === "kind" && row.is_payment_request
                ? "payment_request"
                : c === "amount_usd"
                  ? (row.amount_cents / 100).toFixed(2)
                  : row[c],
            ),
          )
          .join(","),
      ),
    ].join("\r\n")
  );
}

export function closingFigures(db, user, unitId, day) {
  validDay(day);
  const unit = db.prepare("SELECT * FROM finance_units WHERE id=?").get(unitId);
  if (!unit) fail("Selecciona un local");
  businessAccess(user, unit.business_id);
  unitAccess(db, user, unitId, unit.business_id);
  const sales = db
    .prepare(
      "SELECT payments_json FROM finance_sales WHERE unit_id=? AND day=? AND state='active'",
    )
    .all(unitId, day)
    .flatMap((s) => JSON.parse(s.payments_json))
    .filter((p) => p.method === "cash")
    .reduce((s, p) => s + p.amount_cents - (p.refunded_cents || 0), 0);
  const expenses = db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_movements WHERE unit_id=? AND day=? AND kind IN ('expense','refund') AND payment_method='cash' AND status='reconciled'",
    )
    .get(unitId, day).n;
  const pending = db
    .prepare(
      "SELECT COUNT(*) n FROM finance_movements WHERE unit_id=? AND day=? AND payment_method='cash' AND is_payment_request=0 AND status IN ('pending','approved','reported')",
    )
    .get(unitId, day).n;
  return {
    sales_cents: sales,
    expenses_cents: expenses,
    pending_count: pending,
  };
}
