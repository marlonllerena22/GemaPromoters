import { incomingNotices } from "./finance-bank-review.js";
import {receiptAccounts,receiptInbox,queueReceiptNotice} from './finance-receipts.js';
import crypto from "node:crypto";
import { audit, cents, financeDay } from "./finance-db.js";
import {
  businessAccess,
  unitAccess,
  createMovement,
  fail,
  text,
} from "./finance-service.js";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { receivingBank, storeReceiptRoute } from "../../shared/finance-store-receipts.mjs";
import { loanOverview } from "./finance-loans.js";
import { payphoneReceiptStatus } from "./finance-payphone.js";
import {
  accountPresentation,
  liquidityView,
  isFamilyView,
} from "./finance-liquidity.js";
import { fundingOverview } from "./finance-funding.js";
export const putPrivateSetting = (db, key, value) =>
  db
    .prepare(
      "INSERT INTO finance_runtime_settings (key,encrypted) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted",
    )
    .run(key, encryptDocument(Buffer.from(JSON.stringify(value))));
export function privateSetting(db, key) {
  const r = db
    .prepare("SELECT encrypted FROM finance_runtime_settings WHERE key=?")
    .get(key);
  return r ? JSON.parse(decryptDocument(r.encrypted).toString()) : null;
}
export const canAdjustPhysicalCash = (user) =>
  user.role === "owner" || (user.username === "german" && user.work_view);
export function custodyFunds(db, user, scope = null) {
  if (user.role === "collector") return [];
  const numbers = privateSetting(db, "custody_account_numbers") || {};
  return db
    .prepare("SELECT * FROM finance_custody_balances")
    .all()
    .filter((f) =>
      f.id === "efectivo"
        ? canAdjustPhysicalCash(user) && (!scope || scope.length > 1)
        : user.business_ids.includes(f.business_id) &&
          (!scope || scope.includes(f.business_id)),
    )
    .map((f) => ({
      ...f,
      kind: f.id === "efectivo" ? "cash" : "custody",
      can_adjust:
        f.id === "efectivo"
          ? canAdjustPhysicalCash(user)
          : user.role === "owner" || Boolean(user.custody_adjust),
      account_number:
        f.id === "efectivo"
          ? null
          : user.role === "owner" || isFamilyView(user)
            ? numbers[f.id] || null
            : null,
    }));
}
export function adjustCustody(db, user, id, body) {
  if (id === "efectivo" && !canAdjustPhysicalCash(user))
    fail("Solo Marlon y Germán pueden actualizar EFECTIVO", 403);
  if (user.role !== "owner" && !user.custody_adjust)
    fail("No puedes modificar estos fondos", 403);
  if (id !== "efectivo") businessAccess(user, "gemashow");
  if (
    !Number.isSafeInteger(body.balance_cents) ||
    body.balance_cents < 0 ||
    body.balance_cents > 100_000_000_000 ||
    !text(body.reason, 500) ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(body.request_key || "")
  )
    fail("Completa el saldo nuevo y el motivo");
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        id,
        body.balance_cents,
        text(body.reason, 500),
        body.version,
      ]),
    )
    .digest("hex");
  return db.transaction(() => {
    const old = db
      .prepare(
        "SELECT * FROM finance_custody_adjustments WHERE actor=? AND request_key=?",
      )
      .get(user.username, body.request_key);
    if (old) {
      if (old.fingerprint !== fingerprint)
        fail("Ese envío ya se utilizó con otros datos", 409);
      return { adjustment: old, duplicate: true };
    }
    const current = db
      .prepare("SELECT * FROM finance_custody_balances WHERE id=?")
      .get(id);
    if (!current) fail("Responsable no encontrado", 404);
    if (current.version !== body.version)
      fail(
        "Este saldo fue actualizado por otra persona. Revisa el nuevo valor antes de guardar",
        409,
      );
    const delta = body.balance_cents - (current.balance_cents || 0),
      now = new Date().toISOString();
    db.prepare(
      "UPDATE finance_custody_balances SET balance_cents=?,version=version+1,updated_at=?,updated_by=? WHERE id=?",
    ).run(body.balance_cents, now, user.username, id);
    const inserted = db
      .prepare(
        "INSERT INTO finance_custody_adjustments (custody_id,before_cents,after_cents,delta_cents,reason,actor,request_key,fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        current.balance_cents,
        body.balance_cents,
        delta,
        text(body.reason, 500),
        user.username,
        body.request_key,
        fingerprint,
        now,
      );
    audit(
      db,
      user.username,
      "custody.adjusted",
      "custodian",
      id,
      { balance_cents: current.balance_cents, version: current.version },
      {
        balance_cents: body.balance_cents,
        delta_cents: delta,
        reason: text(body.reason, 500),
      },
      id === "efectivo" ? null : "gemashow",
    );
    return {
      adjustment: db
        .prepare("SELECT * FROM finance_custody_adjustments WHERE id=?")
        .get(inserted.lastInsertRowid),
      duplicate: false,
    };
  })();
}
export function canConfirmStore(user, m) {
  const target = storeReceiptRoute(m);
  return (
    m.business_id === "marjorie" &&
    m.kind === "income" &&
    !m.is_payment_request &&
    user.business_ids.includes("marjorie") &&
    (user.role === "owner" ||
      (target?.role !== "owner" && (user.review_unit_ids || []).includes(m.unit_id)))
  );
}
export function confirmStoreReceipt(db, user, id, mode = "review") {
  return db.transaction(() => {
    const m = db.prepare("SELECT * FROM finance_movements WHERE id=?").get(id);
    if (
      !m ||
      m.business_id !== "marjorie" ||
      m.kind !== "income" ||
      m.is_payment_request ||
      (!canConfirmStore(user, m) &&
        !(
          mode === "on_upload" &&
          m.created_by === user.username &&
          (user.auto_confirm_unit_ids || []).includes(m.unit_id)
        ))
    )
      fail("No puedes confirmar esta transferencia", 403);
    const old = db
      .prepare("SELECT * FROM finance_store_confirmations WHERE movement_id=?")
      .get(id);
    if (old) return { confirmation: old, duplicate: true };
    if (
      !m.evidence_id ||
      !["pending", "reported", "approved"].includes(m.status)
    )
      fail("Revisa el comprobante y el estado de la transferencia", 409);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO finance_store_confirmations VALUES (?,?,?,?)").run(
      id,
      user.username,
      now,
      mode,
    );
    db.prepare(
      "UPDATE finance_movements SET status='approved',reviewed_by=?,updated_at=? WHERE id=?",
    ).run(user.username, now, id);
    audit(
      db,
      user.username,
      "store.receipt_confirmed",
      "movement",
      id,
      { status: m.status },
      { status: "approved", mode, bank_reconciled: false },
      "marjorie",
    );
    return {
      confirmation: {
        movement_id: id,
        actor: user.username,
        confirmed_at: now,
        mode,
      },
      duplicate: false,
    };
  })();
}
export function storeReceipts(db, user) {
  if (!user.business_ids.includes("marjorie")) return [];
  return db
    .prepare(
      "SELECT m.*,c.actor confirmed_by,c.confirmed_at,c.mode confirmation_mode,u.name creator_name FROM finance_movements m LEFT JOIN finance_store_confirmations c ON c.movement_id=m.id LEFT JOIN finance_members u ON u.username=m.created_by WHERE m.business_id='marjorie' AND m.kind='income' AND m.unit_id LIKE 'marjorie-%' AND m.is_payment_request=0 AND m.hidden_at IS NULL ORDER BY m.created_at DESC,m.id DESC",
    )
    .all()
    .filter((m) => !user.unit_ids.length || user.unit_ids.includes(m.unit_id))
    .filter(
      (m) =>
        user.role === "owner" ||
        user.role === "manager" ||
        user.work_view ||
        m.created_by === user.username ||
        canConfirmStore(user, m),
    )
    .map((m) => {
      const target = storeReceiptRoute(m);
      return {
        ...m,
        confirmation_responsible: target?.name || null,
        can_confirm: canConfirmStore(user, m),
        assigned_to_me: canConfirmStore(user, m) &&
          (!target || (target.role === "owner" ? user.role === "owner" : user.role !== "owner")),
      };
    });
}
export function attachOperations(db, user, data) {
  const scope = data.businesses.map((b) => b.id);
  data.incoming_notices = incomingNotices(db, user);
  data.receipt_inbox=receiptInbox(db,user);
  data.receipt_accounts=receiptAccounts(db,user);
  if(user.role==='owner')data.review_counts={mail:db.prepare("SELECT COUNT(*) n FROM finance_mail_messages WHERE state='draft' AND archived_at IS NULL").get().n,bank_notifications:db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get()?db.prepare("SELECT COUNT(*) n FROM finance_notification_events WHERE state='review'").get().n:0};
  data.custody_funds = custodyFunds(db, user, scope);
  const registry = privateSetting(db, "own_account_registry");
  data.store_receipts = scope.includes("marjorie")
    ? storeReceipts(db, user)
    : [];
  data.loan_overview =
    user.role === "owner" ? loanOverview(db, user) : { loans: [], alerts: [] };
  data.funding_overview = fundingOverview(db, user);
  accountPresentation(db, user, data, registry);
  const payphoneObservation = privateSetting(
    db,
    "payphone_balance_observation",
  );
  if (payphoneObservation)
    data.accounts = data.accounts.map((a) =>
      a.id === payphoneObservation.account_id
        ? {
            ...a,
            manual_provider: false,
            provider_auto_receipts: true,
            provider_calculation: payphoneReceiptStatus(db, a.id),
            balance_as_of: payphoneObservation.as_of_at,
            provider_fee_policy:
              "Actualización automática con cobros confirmados de ProTickets, menos la tarifa PayPhone guardada en cada venta. La parte de ProTickets pertenece al propietario. El saldo inicial no descuenta otra vez comisiones. Registra los retiros; las devoluciones y cambios de cobros quedan para revisar.",
          }
        : a,
    );
  if (data.ticketing_receipts) {
    const wallet = data.accounts.find((a) => a.provider_auto_receipts);
    data.ticketing_receipts.wallet_auto_updated = Boolean(wallet);
  }
  data.liquidity = liquidityView(db, user, data, registry);
  data.mail_status =
    user.role === "owner"
      ? {
          connected: Boolean(
            db
              .prepare("SELECT id FROM finance_mail_oauth WHERE id='gmail'")
              .get(),
          ),
          configured: Boolean(
            process.env.FINANCE_GMAIL_CLIENT_ID &&
              process.env.FINANCE_GMAIL_CLIENT_SECRET &&
              process.env.FINANCE_GMAIL_REDIRECT_URI,
          ),
          email:
            privateSetting(db, "mail_address") ||
            process.env.FINANCE_GMAIL_ADDRESS ||
            null,
          draft_count: db
            .prepare(
              "SELECT COUNT(*) n FROM finance_mail_messages WHERE state='draft' AND archived_at IS NULL",
            )
            .get().n,
          auto_posting_after:
            process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER || null,
          auto_posting_enabled:
            process.env.FINANCE_GMAIL_AUTO_APPLY !== "0" &&
            (!process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER ||
              Date.now() >=
                Date.parse(process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER)),
          auto_posting_last_run: privateSetting(db, "mail_auto_posting_last_run"),
          cutoff: privateSetting(db, "opening_cutoff"),
          last_sync: privateSetting(db, "mail_last_sync"),
          last_error: privateSetting(db, "mail_sync_error"),
        }
      : null;
  return data;
}
export function registerOperationsRoutes(app, db, { route, owner }) {
  const normalizeNumber = (value) => {
    const number = String(value || "").replace(/[\s-]/g, "");
    if (!/^\d{6,24}$/.test(number))
      fail(
        "Escribe el número de cuenta completo, conservando los ceros iniciales",
      );
    return number;
  };
  app.post(
    "/api/finance/accounts/:id/number",
    route((req, res) => {
      owner(req);
      const a = db
        .prepare("SELECT * FROM finance_accounts WHERE id=?")
        .get(req.params.id);
      if (!a) fail("Cuenta no encontrada", 404);
      const number = normalizeNumber(req.body.number);
      if (a.last_four && !number.endsWith(a.last_four))
        fail(
          `El número debe corresponder a la cuenta terminada en ${a.last_four}`,
        );
      db.transaction(() => {
        const registry = privateSetting(db, "own_account_registry") || {
          accounts: [],
        };
        let row = registry.accounts.find((r) => r.account_id === a.id);
        if (!row) {
          row = { account_id: a.id, bank: a.bank };
          registry.accounts.push(row);
        }
        row.number = number;
        row.suffix = number.slice(-4);
        putPrivateSetting(db, "own_account_registry", registry);
        db.prepare("UPDATE finance_accounts SET last_four=? WHERE id=?").run(
          number.slice(-4),
          a.id,
        );
        audit(
          db,
          req.financeUser.username,
          "account.number_saved",
          "account",
          a.id,
          null,
          { last_four: number.slice(-4) },
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/custody/:id/account-number",
    route((req, res) => {
      owner(req);
      const f = db
        .prepare("SELECT id FROM finance_custody_balances WHERE id=?")
        .get(req.params.id);
      if (!f) fail("Responsable no encontrado", 404);
      if (f.id === "efectivo") fail("EFECTIVO no utiliza un número de cuenta");
      const number = normalizeNumber(req.body.number);
      db.transaction(() => {
        const all = privateSetting(db, "custody_account_numbers") || {};
        all[f.id] = number;
        putPrivateSetting(db, "custody_account_numbers", all);
        audit(
          db,
          req.financeUser.username,
          "custody.account_saved",
          "custodian",
          f.id,
          null,
          { bank: "Pichincha", last_four: number.slice(-4) },
          "gemashow",
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/finance/custody",
    route((req, res) => {
      businessAccess(req.financeUser, "gemashow");
      if (req.financeUser.role === "collector")
        fail("Acceso de consulta restringido", 403);
      const funds = custodyFunds(db, req.financeUser),
        visible = new Set(funds.map((f) => f.id));
      res.json({
        funds,
        adjustments: db
          .prepare(
            "SELECT a.*,m.name actor_name FROM finance_custody_adjustments a LEFT JOIN finance_members m ON m.username=a.actor ORDER BY a.id DESC LIMIT 500",
          )
          .all()
          .filter((a) => visible.has(a.custody_id)),
      });
    }),
  );
  app.post(
    "/api/finance/custody/:id/adjust",
    route((req, res) =>
      res.json(adjustCustody(db, req.financeUser, req.params.id, req.body)),
    ),
  );
  app.get(
    "/api/finance/store-receipts",
    route((req, res) =>
      res.json({ receipts: storeReceipts(db, req.financeUser) }),
    ),
  );
  app.post(
    "/api/finance/store-receipts",
    route((req, res) => {
      const u = req.financeUser,
        b = req.body;
      if (!["owner", "manager", "collector"].includes(u.role))
        fail("Acceso de consulta", 403);
      businessAccess(u, "marjorie");
      unitAccess(db, u, b.unit_id, "marjorie");
      if (!String(b.unit_id).startsWith("marjorie-") || !b.evidence_id)
        fail("Selecciona el local y adjunta el comprobante");
      const e = db
        .prepare("SELECT * FROM finance_evidence WHERE id=?")
        .get(b.evidence_id);
      if (
        !e ||
        e.business_id !== "marjorie" ||
        e.unit_id !== b.unit_id ||
        (u.role === "collector" && e.created_by !== u.username)
      )
        fail("Comprobante fuera del local", 403);
      let analysis = {};
      try { analysis = JSON.parse(e.analysis || "{}"); } catch {}
      const bank = receivingBank(b.receiving_bank || analysis.receiving_bank);
      if (b.unit_id === "marjorie-sur" && !bank)
        fail("Selecciona el banco que recibió la transferencia para enviarla a Marlon o Morelia");
      const existing = db
        .prepare(
          "SELECT * FROM finance_movements WHERE evidence_id=? AND kind='income' AND status!='rejected'",
        )
        .get(e.id);
      if (existing) {
        if (
          existing.created_by === u.username &&
          existing.unit_id === b.unit_id &&
          existing.amount_cents === b.amount_cents &&
          existing.receiving_bank === bank
        )
          return res.json({
            id: existing.id,
            confirmed: Boolean(
              db
                .prepare(
                  "SELECT movement_id FROM finance_store_confirmations WHERE movement_id=?",
                )
                .get(existing.id),
            ),
            duplicate: true,
          });
        fail("Este comprobante ya fue registrado con otros datos", 409);
      }
      const result = db.transaction(() => {
        const m = createMovement(db, u, {
          business_id: "marjorie",
          unit_id: b.unit_id,
          kind: "income",
          amount_cents: cents(b.amount_cents),
          day: b.day || financeDay(),
          category: "Ventas de local",
          counterparty: text(b.customer, 150) || "Transferencia de cliente",
          description: "Transferencia recibida en local",
          payment_method: "transfer",
          evidence_id: e.id,
          reference: text(b.reference, 200),
        });
        db.prepare(
          "UPDATE finance_movements SET source_system='store-receipt',status='pending',receiving_bank=? WHERE id=?",
        ).run(bank, m.id);
        audit(db, u.username, "store.receipt_routed", "movement", m.id, null,
          { receiving_bank: bank, responsible: storeReceiptRoute({ unit_id: b.unit_id, receiving_bank: bank })?.name || null }, "marjorie");
        const auto = (u.auto_confirm_unit_ids || []).includes(b.unit_id);
        if (auto) confirmStoreReceipt(db, u, m.id, "on_upload");
        else queueReceiptNotice(db,m.id);
        return { id: m.id, confirmed: auto, responsible: storeReceiptRoute({ unit_id: b.unit_id, receiving_bank: bank })?.name || null };
      })();
      res.status(201).json(result);
    }),
  );
  app.post(
    "/api/finance/store-receipts/:id/confirm",
    route((req, res) =>
      res.json(confirmStoreReceipt(db, req.financeUser, Number(req.params.id))),
    ),
  );
  app.get(
    "/api/finance/store-receipts/:id/evidence",
    route((req, res) => {
      const m = storeReceipts(db, req.financeUser).find(
        (r) => r.id === Number(req.params.id),
      );
      if (!m) fail("Comprobante no disponible", 404);
      const e = db
        .prepare("SELECT * FROM finance_evidence WHERE id=?")
        .get(m.evidence_id);
      if (!e) fail("Archivo no disponible", 404);
      res
        .type(e.mime)
        .set("Content-Security-Policy", "sandbox; default-src 'none'")
        .attachment(e.name)
        .send(decryptDocument(e.encrypted));
    }),
  );
}
