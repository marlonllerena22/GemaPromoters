import { sendFinancePush } from "./finance-native-push.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";
import { audit, financeDay } from "./finance-db.js";
import { fail } from "./finance-service.js";
import { decryptDocument } from "./finance-ai.js";
import { pushConfiguration, validatePushSubscription } from "./finance-push.js";
import { debitAlreadyUsed } from "./finance-funding.js";
const minusDay = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
export function loanOverview(db, user, now = new Date()) {
  if (user.role !== "owner") return { loans: [], alerts: [] };
  const today = financeDay(now);
  const loans = db
    .prepare(
      "SELECT l.*,a.name account_name,a.last_four,a.verified_at,a.opening_cents,a.opening_date FROM finance_loans l JOIN finance_accounts a ON a.id=l.account_id ORDER BY l.id",
    )
    .all()
    .map((l) => {
      const installments = db
          .prepare(
            "SELECT * FROM finance_loan_installments WHERE loan_id=? ORDER BY sequence",
          )
          .all(l.id),
        next = installments.find((i) => i.status === "expected");
      const balance = recordedAccountBalance(
        db,
        {
          id: l.account_id,
          opening_cents: l.opening_cents,
          opening_date: l.opening_date,
        },
        today,
      );
      return {
        ...l,
        installments,
        next,
        balance_cents: balance,
        shortfall_cents: next ? Math.max(0, next.total_cents - balance) : 0,
        remind_day: next ? minusDay(next.due_day) : null,
      };
    });
  // Funding is calculated per debit account/date, so simultaneous installments
  // cannot each claim the same cash independently.
  const groups = new Map();
  for (const l of loans) {
    if (!l.next) continue;
    const key = `${l.account_id}|${l.next.due_day}`,
      g = groups.get(key) || { needed: 0, loans: [] };
    g.needed += l.next.total_cents;
    g.loans.push(l);
    groups.set(key, g);
  }
  for (const g of groups.values())
    for (const l of g.loans)
      l.shortfall_cents = Math.max(0, g.needed - l.balance_cents);
  return {
    loans,
    alerts: db
      .prepare(
        "SELECT * FROM finance_loan_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC",
      )
      .all(),
  };
}
export function evaluateLoanAlerts(db, now = new Date()) {
  const today = financeDay(now),
    overview = loanOverview(db, { role: "owner" }, now),
    wanted = new Set();
  for (const l of overview.loans) {
    if (!l.next) continue;
    const n = l.next;
    for (const kind of [
      ...(l.shortfall_cents > 0 ? ["insufficient"] : []),
      ...(today === l.remind_day ? ["due_tomorrow"] : []),
      ...(n.due_day <= today ? ["debit_unconfirmed"] : []),
    ]) {
      const id = `${l.id}:${n.sequence}:${kind}`,
        day = kind === "due_tomorrow" ? l.remind_day : today;
      wanted.add(id);
      db.prepare(
        "INSERT INTO finance_loan_alerts (id,loan_id,sequence,kind,day,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=NULL",
      ).run(id, l.id, n.sequence, kind, day, now.toISOString());
    }
  }
  for (const row of db
    .prepare("SELECT id FROM finance_loan_alerts WHERE resolved_at IS NULL")
    .all())
    if (!wanted.has(row.id))
      db.prepare("UPDATE finance_loan_alerts SET resolved_at=? WHERE id=?").run(
        now.toISOString(),
        row.id,
      );
  return loanOverview(db, { role: "owner" }, now);
}
export async function flushLoanPush(
  db,
  {
    now = new Date(),
    send = sendFinancePush,
    config = pushConfiguration(),
  } = {},
) {
  const state = evaluateLoanAlerts(db, now);
  if (!config.enabled) return;
  const today = financeDay(now),
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Guayaquil",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
  const subscriptions = db
    .prepare(
      "SELECT s.* FROM finance_push_subscriptions s JOIN finance_members m ON m.id=s.member_id WHERE m.role='owner' AND m.active=1",
    )
    .all();
  if (!subscriptions.length) return;
  for (const alert of state.alerts) {
    if (alert.push_day === today || (alert.kind === "due_tomorrow" && hour < 9))
      continue;
    let ok = true;
    for (const sub of subscriptions) {
      try {
        await send(
          validatePushSubscription(
            JSON.parse(decryptDocument(sub.encrypted).toString()),
          ),
          JSON.stringify({
            title:
              alert.kind === "insufficient"
                ? "Revisa los fondos de un préstamo"
                : "Tienes un aviso de préstamo",
            body:
              alert.kind === "due_tomorrow"
                ? "Mañana vence una cuota. Revisa su cuenta de débito en Gema."
                : "Abre Gema para comprobar el saldo y el próximo cobro.",
            url: "/finanzas/prestamos",
            tag: "gema-loan-alerts",
          }),
          {
            vapidDetails: {
              subject: config.subject,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
            TTL: 86400,
            urgency: alert.kind === "insufficient" ? "high" : "normal",
            timeout: 8000,
          },
        );
      } catch (e) {
        ok = false;
        if ([404, 410].includes(e.statusCode))
          db.prepare(
            "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=?",
          ).run(sub.endpoint_hash);
      }
    }
    if (ok)
      db.prepare("UPDATE finance_loan_alerts SET push_day=? WHERE id=?").run(
        today,
        alert.id,
      );
  }
}
export function registerLoanRoutes(app, db, { route, owner }) {
  app.get(
    "/api/finance/loans",
    route((req, res) => {
      owner(req);
      res.json(evaluateLoanAlerts(db));
    }),
  );
  app.post(
    "/api/finance/loans/:id/installments/:sequence/confirm",
    route((req, res) => {
      owner(req);
      const i = db
        .prepare(
          "SELECT i.*,l.account_id,l.business_id FROM finance_loan_installments i JOIN finance_loans l ON l.id=i.loan_id WHERE i.loan_id=? AND i.sequence=?",
        )
        .get(req.params.id, Number(req.params.sequence));
      if (!i || i.status !== "expected") fail("Cuota no disponible", 409);
      const b = db
        .prepare("SELECT * FROM finance_bank_transactions WHERE id=?")
        .get(req.body.bank_transaction_id);
      if (
        !b ||
        b.account_id !== i.account_id ||
        b.amount_cents >= 0 ||
        Math.abs(b.amount_cents) !== i.total_cents
      )
        fail("Selecciona el débito real de esta cuota y esta cuenta");
      if (debitAlreadyUsed(db, b.id))
        fail("Este débito ya respalda otra cuota", 409);
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_loan_installments SET status='paid',bank_transaction_id=?,paid_at=? WHERE loan_id=? AND sequence=?",
        ).run(b.id, new Date().toISOString(), i.loan_id, i.sequence);
        audit(
          db,
          req.financeUser.username,
          "loan.installment_paid",
          "loan",
          i.loan_id,
          null,
          {
            sequence: i.sequence,
            bank_transaction_id: b.id,
            total_cents: i.total_cents,
          },
          i.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  if (process.env.FINANCE_DEMO !== "1") {
    let running = false;
    const timer = setInterval(async () => {
      if (running || !db.open) return;
      running = true;
      try {
        await flushLoanPush(db);
      } catch {
      } finally {
        running = false;
      }
    }, 60000);
    timer.unref();
  }
}
