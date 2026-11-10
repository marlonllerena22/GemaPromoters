import { audit, financeDay } from "./finance-db.js";

const availableNet = (receipt) => receipt.net_cents == null ? 0
  : receipt.state === "calculated" ? receipt.net_cents
    : Math.min(0, receipt.net_cents - receipt.gross_cents);

// ProTickets is the only payment source. This module never calls a payment API.
export function syncPayphoneReceipts(db, orders, observation, sourceTime, actor) {
  if (!observation?.account_id || !Number.isFinite(Date.parse(observation.as_of_at))) return 0;
  const account = db.prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1").get(observation.account_id);
  if (!account || account.kind !== "wallet" || !/payphone/i.test(account.bank) || account.business_id !== "gemashow") return 0;
  let changed = 0;
  for (const order of orders) {
    const previous = db.prepare("SELECT * FROM finance_provider_receipts WHERE source_system='protickets' AND external_id=?").get(String(order.id));
    const paidAt = sourceTime(order.paid_at);
    if (!previous && (order.payment_method !== "payphone" || order.payment_status !== "paid" || !Number.isFinite(paidAt) || paidAt <= Date.parse(observation.as_of_at) || paidAt > Date.now())) continue;
    const gross = Math.round(Number(order.total) * 100);
    if (!Number.isFinite(paidAt) || !Number.isSafeInteger(gross) || gross <= 0) continue;
    const rate = order.provider_fee_rate == null ? null : Number(order.provider_fee_rate);
    const usable = Number.isSafeInteger(gross) && gross > 0 && Number.isFinite(rate) && rate >= 0 && rate <= 100;
    const fee = usable ? Math.round(gross * rate / 100) : null;
    // A reversal or a changed confirmed amount needs review; never invent a returned fee.
    const changedPayment = previous && (previous.gross_cents !== gross || previous.occurred_at !== new Date(paidAt).toISOString() || previous.fee_rate !== rate);
    const state = order.payment_status === "paid" && order.payment_method === "payphone" && usable && !changedPayment ? "calculated" : "attention";
    if (previous && previous.state === state) continue;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO finance_provider_receipts
      (source_system,external_id,account_id,document_number,occurred_at,gross_cents,fee_rate,fee_cents,net_cents,state,created_at,updated_at)
      VALUES ('protickets',?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_system,external_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(
      String(order.id), account.id, order.order_number, new Date(paidAt).toISOString(),
      gross, rate, fee, fee === null ? null : gross - fee, state, now, now,
    );
    audit(db, actor, "provider.receipt_calculated", "provider_receipt", String(order.id), previous || null,
      { gross_cents: gross, fee_cents: fee, net_cents: fee === null ? null : gross - fee, state, fee_basis: "order-rate", platform_fee_owned: true }, "gemashow");
    changed++;
  }
  return changed;
}

export function providerReceiptDelta(db, account, throughDay, throughInstant = null, afterInstant = null) {
  if (account.kind !== "wallet" || !/payphone/i.test(account.bank)) return 0;
  return db.prepare("SELECT * FROM finance_provider_receipts WHERE account_id=? AND net_cents IS NOT NULL").all(account.id)
    .filter((r) => financeDay(r.occurred_at) <= throughDay && (!throughInstant || r.occurred_at <= throughInstant) && (!afterInstant || Date.parse(r.occurred_at) > Date.parse(afterInstant)))
    .reduce((sum, r) => sum + availableNet(r), 0);
}

export function payphoneReceiptStatus(db, accountId) {
  const rows = db.prepare("SELECT * FROM finance_provider_receipts WHERE account_id=? ORDER BY occurred_at DESC,external_id DESC").all(accountId);
  return {
    count: rows.length,
    review_count: rows.filter((r) => r.state === "attention").length,
    gross_cents: rows.reduce((sum, r) => sum + r.gross_cents, 0),
    fee_cents: rows.reduce((sum, r) => sum + (r.fee_cents || 0), 0),
    net_cents: rows.reduce((sum, r) => sum + availableNet(r), 0),
    last_updated: rows[0]?.updated_at || null,
    receipts: rows.slice(0, 30).map(({ document_number, occurred_at, gross_cents, fee_rate, fee_cents, net_cents, state }) => ({ document_number, occurred_at, gross_cents, fee_rate, fee_cents, net_cents, state })),
  };
}
