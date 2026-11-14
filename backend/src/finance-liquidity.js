import {canSeeAllBalances} from '../../shared/finance-access.mjs';
import { financeDay } from "./finance-db.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";
import { shiftDay } from "./finance-funding.js";
export const isFamilyView = (user) =>
  user.work_view && user.username === "german";
const bankKey = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/banco|\s/g, "");
export function accountPresentation(db, user, data, registry, {separateChecking=false}={}) {
  const own = new Map((registry?.accounts || []).map((a) => [a.account_id, a]));
  if (user.role === "owner")
    data.accounts = data.accounts.map((a) => ({
      ...a,
      account_number: own.get(a.id)?.number || null,
      checking_reserved:
        /corriente/i.test(a.name) && bankKey(a.bank).includes("guayaquil"),
    }));
  if (!isFamilyView(user)) return;
  const eligible = db
    .prepare(
      "SELECT * FROM finance_accounts WHERE active=1 AND kind IN ('bank','wallet')",
    )
    .all()
    .filter(
      (a) =>
        own.has(a.id) && (!separateChecking||!a.holder_key||['owner','marlon'].includes(a.holder_key)) && ["pichincha", "guayaquil"].includes(bankKey(a.bank)),
    );
  const ids = new Set(eligible.map((a) => a.id)),
    result = data.accounts.filter((a) => !ids.has(a.id));
  for (const bank of ["pichincha", "guayaquil"]) for(const checking of separateChecking&&bank==='guayaquil'?[false,true]:[false]) {
    const rows = eligible.filter((a) => bankKey(a.bank) === bank&&(!separateChecking||bank!=='guayaquil'||/corriente/i.test(a.name)===checking));
    if (!rows.length) continue;
    const balance = rows.reduce(
        (n, a) => n + recordedAccountBalance(db, a, data.period.today),
        0,
      ),
      reserved = rows
        .filter((a) => /corriente/i.test(a.name))
        .reduce(
          (n, a) =>
            n + Math.max(0, recordedAccountBalance(db, a, data.period.today)),
          0,
        );
    result.push({
      id: `group:${bank}${checking?'-checking':''}`,
      name: checking?'Guayaquil · Corriente':"Cuentas de Marlon",
      checking_reserved:checking,
      bank: bank === "pichincha" ? "Pichincha" : "Guayaquil",
      kind: "bank",
      business_id: null,
      grouped: true,
      account_count: rows.length,
      balance_cents: balance,
      reserved_cents: reserved,
      available_cents: balance - reserved,
      personal_details_private: true,
      positions: {},
      opening_allocations: [],
      unassigned_cents: 0,
      verified_at: null,
      discrepancy_cents: null,
    });
  }
  data.accounts = result;
}
export function liquidityView(db, user, data, registry, now = new Date()) {
  if (!canSeeAllBalances(user) || user.unit_ids.length) return null;
  const day = financeDay(now),
    horizon = shiftDay(day, 3),
    own = new Map((registry?.accounts || []).map((a) => [a.account_id, a]));
  const allowed = db
    .prepare("SELECT * FROM finance_accounts WHERE active=1")
    .all()
    .filter(
      (a) =>
        user.role === "owner" ||
        data.businesses.some((b) => b.id === a.business_id) ||
        (!a.business_id && user.work_view) ||
        (isFamilyView(user) &&
          own.has(a.id) &&
          ["pichincha", "guayaquil"].includes(bankKey(a.bank))),
    );
  const ids = new Set(allowed.map((a) => a.id));
  let cash = 0,
    reserved = 0;
  for (const a of allowed.filter((a) =>
    ["bank", "wallet", "cash", "custody"].includes(a.kind),
  )) {
    const n = recordedAccountBalance(db, a, day);
    if (/corriente/i.test(a.name) && bankKey(a.bank) === "guayaquil")
      reserved += Math.max(0, n);
    else cash += n;
  }
  const custody = data.custody_funds || [];
  cash += custody.reduce((n, f) => n + (f.balance_cents || 0), 0);
  cash += (data.settlement_funds || []).reduce(
    (n, f) => n + (f.available_cents || 0),
    0,
  );
  const obligations = [];
  for (const a of data.funding_overview.accounts) {
    let accumulated = 0,
      previousGap = 0;
    for (const g of a.groups) {
      accumulated += g.amount_cents;
      const gap = Math.max(0, accumulated - a.balance_cents),
        increment = gap - previousGap;
      previousGap = gap;
      if (increment > 0)
        obligations.push({
          id: `checks:${a.id}:${g.due_day}`,
          kind: "checks",
          title: "Completar fondos para cheques",
          day: g.fund_day,
          amount_cents: increment,
          gross_cents: g.amount_cents,
        });
    }
  }
  for (const l of db
    .prepare("SELECT * FROM finance_loans")
    .all()
    .filter((l) => ids.has(l.account_id))) {
    for (const i of db
      .prepare(
        "SELECT * FROM finance_loan_installments WHERE loan_id=? AND status='expected' AND due_day<=?",
      )
      .all(l.id, horizon))
      obligations.push({
        id: `loan:${l.id}:${i.sequence}`,
        kind: "loan",
        title: `Cuota de préstamo · ${l.bank}`,
        day: i.due_day,
        amount_cents: i.total_cents,
      });
  }
  for (const c of data.funding_overview.cards)
    for (const s of c.statements.filter(
      (s) => !["paid", "paid_before_start"].includes(s.state),
    ))
      obligations.push({
        id: `card:${s.id}`,
        kind: "card",
        title: `Pago ${c.name}`,
        day: s.due_date,
        amount_cents:
          s.remaining_cents === undefined ? s.total_cents : s.remaining_cents,
      });
  for (const r of data.workflow?.queue || [])
    obligations.push({
      id: `request:${r.id}`,
      kind: "request",
      title:
        user.role === "owner" ? r.counterparty : "Pago de trabajo pendiente",
      day: r.due_date || day,
      amount_cents: r.remaining_cents,
    });
  const paidPending = db
    .prepare(
      "SELECT m.*,COALESCE((SELECT SUM(x.amount_cents) FROM finance_allocations x WHERE x.movement_id=m.id),0) allocated FROM finance_movements m WHERE m.kind='expense' AND m.is_payment_request=0 AND m.hidden_at IS NULL AND m.status='reported' AND m.day<=? AND (m.source_system IN ('quick','bank-email') OR EXISTS(SELECT 1 FROM finance_payments p WHERE p.movement_id=m.id AND p.voided_at IS NULL))",
    )
    .all(day)
    .filter(
      (m) =>
        ids.has(m.account_id) &&
        (user.role === "owner" ||
          user.business_ids.includes(m.business_id) ||
          isFamilyView(user)),
    );
  const pendingTotal = paidPending.reduce(
    (n, m) => n + Math.max(0, m.amount_cents - m.allocated),
    0,
  );
  if (pendingTotal)
    obligations.push({
      id: "reported:total",
      kind: "reported",
      title: "Pagos realizados pendientes de comprobar en banco",
      day,
      amount_cents: pendingTotal,
    });
  const near = obligations.filter((o) => o.day <= horizon),
    committed = near.reduce((n, o) => n + (o.amount_cents || 0), 0),
    unknown = near.filter((o) => o.amount_cents === null).length;
  return {
    as_of: day,
    horizon_day: horizon,
    cash_cents: cash,
    checking_reserved_cents: reserved,
    commitments_cents: committed,
    after_known_payments_cents: cash - committed,
    shortfall_cents: Math.max(0, committed - cash),
    unknown_commitments: unknown,
    unknown_balances: custody.filter((f) => f.balance_cents === null).length,
    obligations: near.sort((a, b) => a.day.localeCompare(b.day)),
    checking_excluded: true,
  };
}
