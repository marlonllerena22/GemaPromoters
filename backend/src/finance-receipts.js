import { audit, cents, validDay, financeDay } from "./finance-db.js";
import { fail, scoped, text } from "./finance-service.js";
import { privateSetting } from "./finance-operations.js";

const bankCode = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/banco|del|[^a-z]/g, "");
export function receiptAccounts(db, user) {
  if (!["owner", "manager", "collector"].includes(user.role)) return [];
  return db
    .prepare(
      "SELECT id,name,bank,kind,last_four,business_id FROM finance_accounts WHERE active=1 AND kind='bank' ORDER BY bank,name"
    )
    .all();
}
export function suggestReceivingAccount(db, user, analysis) {
  const suffix = String(analysis.destination_account_suffix || "").replace(
    /\s|-/g,
    ""
  );
  if (!/^\d{3,20}$/.test(suffix))
    return { state: "unreadable", account_id: null };
  const registry = privateSetting(db, "own_account_registry") || {
    accounts: [],
  };
  const matches = receiptAccounts(db, user)
    .filter(
      (a) =>
        !analysis.receiving_bank ||
        bankCode(a.bank) === bankCode(analysis.receiving_bank)
    )
    .filter((a) => {
      const saved = registry.accounts.find((r) => r.account_id === a.id),
        number = String(saved?.number || saved?.suffix || a.last_four || "");
      return number.length >= suffix.length && number.endsWith(suffix);
    });
  return {
    state:
      matches.length === 1
        ? "matched"
        : matches.length
        ? "ambiguous"
        : "not_found",
    account_id: matches.length === 1 ? matches[0].id : null,
    suffix,
  };
}
export function receiptInbox(db, user) {
  return db
    .prepare(
      `SELECT m.*,u.name creator_name,a.name account_name,a.bank,a.last_four,
    e.name evidence_name,c.confirmed_at FROM finance_movements m
    LEFT JOIN finance_members u ON u.username=m.created_by LEFT JOIN finance_accounts a ON a.id=m.account_id
    LEFT JOIN finance_evidence e ON e.id=m.evidence_id LEFT JOIN finance_store_confirmations c ON c.movement_id=m.id
    WHERE m.kind='income' AND m.is_payment_request=0 AND m.evidence_id IS NOT NULL AND m.hidden_at IS NULL
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1000`
    )
    .all()
    .filter(
      (m) =>
        (scoped(user, m) ||
          (m.unit_id === null &&
            m.created_by === user.username &&
            user.business_ids.includes(m.business_id))) &&
        (user.role === "owner" || m.created_by === user.username)
    )
    .map((m) => ({
      ...m,
      can_edit:
        ["pending", "reported"].includes(m.status) &&
        !m.confirmed_at &&
        !db
          .prepare("SELECT 1 FROM finance_allocations WHERE movement_id=?")
          .get(m.id),
    }));
}
export function editReceipt(db, user, id, body) {
  return db.transaction(() => {
    const row = receiptInbox(db, user).find((m) => m.id === Number(id));
    if (!row) fail("Comprobante no disponible", 404);
    if (!row.can_edit)
      fail("Este comprobante ya fue confirmado. Conserva su historial", 409);
    if (body.expected_updated_at !== row.updated_at)
      fail("El comprobante cambió. Ábrelo nuevamente", 409);
    const amount = cents(body.amount_cents),
      day = validDay(body.day),
      counterparty = text(body.counterparty),
      reference = text(body.reference);
    if (day > financeDay() || !counterparty)
      fail("Revisa cliente, monto y fecha");
    const account = body.account_id
      ? receiptAccounts(db, user).find((a) => a.id === Number(body.account_id))
      : null;
    if (body.account_id && !account)
      fail("Selecciona la cuenta que recibió el dinero");
    if (
      row.unit_id &&
      db
        .prepare(
          "SELECT 1 FROM finance_closings WHERE unit_id=? AND day IN (?,?)"
        )
        .get(row.unit_id, row.day, day)
    )
      fail("Reabre el cierre antes de corregir el comprobante", 409);
    const now = new Date(
      Math.max(Date.now(), Date.parse(row.updated_at) + 1)
    ).toISOString();
    db.prepare(
      "UPDATE finance_movements SET counterparty=?,amount_cents=?,day=?,account_id=?,reference=?,cross_account=?,updated_at=? WHERE id=?"
    ).run(
      counterparty,
      amount,
      day,
      account?.id || null,
      reference,
      account?.business_id && account.business_id !== row.business_id ? 1 : 0,
      now,
      row.id
    );
    const updated = db
      .prepare("SELECT * FROM finance_movements WHERE id=?")
      .get(row.id);
    audit(
      db,
      user.username,
      "receipt.corrected",
      "movement",
      row.id,
      row,
      updated,
      row.business_id
    );
    return { ok: true };
  })();
}
export function queueReceiptNotice(db, id) {
  db.prepare(
    "INSERT OR IGNORE INTO finance_push_outbox(event_key,request_id) VALUES (?,?)"
  ).run("receipt-review:" + id, id);
}
export function registerReceiptRoutes(app, db, { route }) {
  app.post(
    "/api/finance/receipts/:id/edit",
    route((req, res) =>
      res.json(editReceipt(db, req.financeUser, req.params.id, req.body))
    )
  );
}
