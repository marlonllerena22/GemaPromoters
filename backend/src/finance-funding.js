import crypto from "node:crypto";
import * as webpush from "web-push";
import { audit, financeDay, validDay } from "./finance-db.js";
import { fail, text } from "./finance-service.js";
import { decryptDocument } from "./finance-ai.js";
import { pushConfiguration, validatePushSubscription } from "./finance-push.js";

export function shiftDay(day, days) {
  if (!validDay(day)) fail("Fecha no válida");
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export const canManageChecks = (user) =>
  user.role === "owner" || Boolean(user.checks_manage);
export function accountCash(db, id, now = new Date()) {
  const a = db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(id);
  if (!a) fail("Cuenta no encontrada", 404);
  return (
    a.opening_cents +
    db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_bank_transactions WHERE account_id=? AND day>=? AND day<=?",
      )
      .get(id, a.opening_date, financeDay(now)).n
  );
}
export function fundingOverview(db, user, now = new Date()) {
  const today = financeDay(now),
    checks = canManageChecks(user)
      ? db
          .prepare(
            "SELECT c.*,a.name account_name,a.last_four FROM finance_checks c JOIN finance_accounts a ON a.id=c.account_id ORDER BY due_day,CAST(number AS INTEGER)",
          )
          .all()
      : [];
  const accounts = [];
  for (const id of new Set(checks.map((c) => c.account_id))) {
    const balance = accountCash(db, id, now),
      groups = [];
    let cumulative = 0;
    for (const day of [
      ...new Set(
        checks
          .filter((c) => c.account_id === id && c.status === "pending")
          .map((c) => c.due_day),
      ),
    ]) {
      const group = checks.filter(
          (c) =>
            c.account_id === id && c.status === "pending" && c.due_day === day,
        ),
        amount = group.reduce((n, c) => n + c.amount_cents, 0);
      cumulative += amount;
      groups.push({
        due_day: day,
        fund_day: shiftDay(day, -2),
        amount_cents: amount,
        cumulative_cents: cumulative,
        shortfall_cents: Math.max(0, cumulative - balance),
        count: group.length,
        needs_review: group.some((c) => c.needs_review),
      });
    }
    const due = groups.filter((g) => g.fund_day <= today),
      needed = due.reduce((n, g) => n + g.amount_cents, 0),
      a = checks.find((c) => c.account_id === id);
    accounts.push({
      id,
      name: a.account_name,
      last_four: a.last_four,
      balance_cents: balance,
      needed_now_cents: needed,
      shortfall_now_cents: Math.max(0, needed - balance),
      groups,
    });
  }
  const cards =
    user.role === "owner"
      ? db
          .prepare(
            "SELECT c.*,a.name account_name,a.last_four FROM finance_credit_cards c LEFT JOIN finance_accounts a ON a.id=c.debit_account_id ORDER BY c.id",
          )
          .all()
          .map((c) => ({
            ...c,
            statements: db
              .prepare(
                "SELECT * FROM finance_card_statements WHERE card_id=? ORDER BY due_date DESC",
              )
              .all(c.id),
          }))
      : [];
  return { today, checks, accounts, cards };
}
export function ensureCardCycles(db, now = new Date()) {
  const today = financeDay(now),
    [year, month] = today.split("-").map(Number);
  for (const c of db.prepare("SELECT * FROM finance_credit_cards").all()) {
    // Include the last closing cycle and the current month once it closes.
    for (const offset of [-1, 0]) {
      const cut = new Date(Date.UTC(year, month - 1 + offset, c.cut_day, 12)),
        cutDate = cut.toISOString().slice(0, 10);
      if (cutDate > today) continue;
      const due = new Date(
        Date.UTC(cut.getUTCFullYear(), cut.getUTCMonth() + 1, c.due_day, 12),
      )
        .toISOString()
        .slice(0, 10);
      db.prepare(
        "INSERT OR IGNORE INTO finance_card_statements (id,card_id,cut_date,due_date,state) VALUES (?,?,?,?,'awaiting')",
      ).run(`${c.id}:${cutDate}`, c.id, cutDate, due);
    }
  }
}
export function saveCheck(db, user, body, id = null) {
  if (!canManageChecks(user))
    fail("Solo los responsables de cheques pueden acceder", 403);
  const old = id
    ? db.prepare("SELECT * FROM finance_checks WHERE id=?").get(id)
    : null;
  if (id && !old) fail("Cheque no encontrado", 404);
  if (old && (old.status !== "pending" || old.version !== body.version))
    fail("El cheque cambió. Actualiza antes de editar", 409);
  const account = old?.account_id || Number(body.account_id),
    a = db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(account);
  if (!a || !/guayaquil/i.test(a.bank) || !/corriente/i.test(a.name))
    fail("Selecciona la cuenta corriente de Guayaquil");
  if (
    !/^\d{1,20}$/.test(String(body.number || "")) ||
    !text(body.payee, 200) ||
    !Number.isSafeInteger(body.amount_cents) ||
    body.amount_cents <= 0 ||
    !validDay(body.due_day)
  )
    fail("Completa número, beneficiario, valor y fecha");
  if (old && !text(body.reason, 500)) fail("Indica por qué cambias el cheque");
  const now = new Date().toISOString(),
    key = id || crypto.randomUUID();
  return db.transaction(() => {
    if (
      db
        .prepare(
          "SELECT id FROM finance_checks WHERE account_id=? AND number=? AND id!=?",
        )
        .get(account, String(body.number), key)
    )
      fail("Ese número de cheque ya está registrado", 409);
    if (old)
      db.prepare(
        "UPDATE finance_checks SET number=?,payee=?,amount_cents=?,due_day=?,fund_day=?,needs_review=0,review_note=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(
        String(body.number),
        text(body.payee, 200),
        body.amount_cents,
        body.due_day,
        shiftDay(body.due_day, -2),
        text(body.reason, 500),
        now,
        key,
      );
    else
      db.prepare(
        "INSERT INTO finance_checks (id,account_id,number,payee,amount_cents,due_day,fund_day,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        key,
        account,
        String(body.number),
        text(body.payee, 200),
        body.amount_cents,
        body.due_day,
        shiftDay(body.due_day, -2),
        user.username,
        now,
        now,
      );
    const result = db
      .prepare("SELECT * FROM finance_checks WHERE id=?")
      .get(key);
    audit(
      db,
      user.username,
      old ? "check.updated" : "check.created",
      "check",
      key,
      old,
      { ...result, reason: text(body.reason, 500) },
    );
    return result;
  })();
}
export function debitAlreadyUsed(db, id) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM finance_loan_installments WHERE bank_transaction_id=? UNION ALL SELECT 1 FROM finance_checks WHERE cleared_bank_id=? UNION ALL SELECT 1 FROM finance_card_statements WHERE paid_bank_id=?",
      )
      .get(id, id, id),
  );
}
export function evaluateFundingAlerts(db, now = new Date()) {
  ensureCardCycles(db, now);
  const overview = fundingOverview(db, { role: "owner" }, now),
    wanted = [];
  for (const a of overview.accounts) {
    if (a.shortfall_now_cents > 0)
      wanted.push({
        id: `check-shortfall:${a.id}`,
        kind: "check_shortfall",
        source_id: String(a.id),
      });
    for (const g of a.groups)
      if (g.fund_day === overview.today)
        wanted.push({
          id: `check-funding:${a.id}:${g.due_day}`,
          kind: "check_funding",
          source_id: String(a.id),
        });
  }
  for (const c of overview.cards)
    for (const s of c.statements.filter(
      (s) => !["paid", "paid_before_start"].includes(s.state),
    )) {
      if (s.total_cents === null)
        wanted.push({
          id: `card-amount:${s.id}`,
          kind: "card_amount",
          source_id: s.id,
        });
      if (shiftDay(s.due_date, -1) <= overview.today)
        wanted.push({
          id: `card-pay:${s.id}`,
          kind: "card_payment",
          source_id: s.id,
        });
    }
  for (const a of wanted)
    db.prepare(
      "INSERT INTO finance_funding_alerts (id,kind,source_id,day) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=NULL",
    ).run(a.id, a.kind, a.source_id, overview.today);
  for (const a of db
    .prepare("SELECT id FROM finance_funding_alerts WHERE resolved_at IS NULL")
    .all())
    if (!wanted.some((w) => w.id === a.id))
      db.prepare(
        "UPDATE finance_funding_alerts SET resolved_at=? WHERE id=?",
      ).run(now.toISOString(), a.id);
  return overview;
}
export async function flushFundingPush(
  db,
  {
    now = new Date(),
    send = webpush.sendNotification.bind(webpush),
    config = pushConfiguration(),
  } = {},
) {
  evaluateFundingAlerts(db, now);
  if (!config.enabled) return;
  const day = financeDay(now),
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Guayaquil",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
  const subscriptions = db
    .prepare(
      "SELECT s.* FROM finance_push_subscriptions s JOIN finance_members m ON m.id=s.member_id WHERE m.active=1 AND (m.role='owner' OR m.checks_manage=1)",
    )
    .all();
  for (const a of db
    .prepare(
      "SELECT * FROM finance_funding_alerts WHERE resolved_at IS NULL AND push_day!=?",
    )
    .all(day)) {
    if (hour < 9 && a.kind !== "check_shortfall") continue;
    const targets = subscriptions.filter(
      (s) =>
        a.kind.startsWith("check_") ||
        db
          .prepare("SELECT role FROM finance_members WHERE id=?")
          .get(s.member_id)?.role === "owner",
    );
    if (!targets.length) continue;
    let ok = true;
    for (const s of targets)
      try {
        await send(
          validatePushSubscription(
            JSON.parse(decryptDocument(s.encrypted).toString()),
          ),
          JSON.stringify({
            title: a.kind.startsWith("check_")
              ? "Revisa los cheques por cubrir"
              : "Tienes un aviso de tarjeta",
            body: "Abre Gema para revisar fechas, valores y fondos necesarios.",
            url: a.kind.startsWith("check_")
              ? "/finanzas/cheques"
              : "/finanzas/tarjetas",
            tag: `gema-${a.kind}`,
          }),
          {
            vapidDetails: {
              subject: config.subject,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
            TTL: 86400,
            urgency: a.kind === "check_shortfall" ? "high" : "normal",
            timeout: 8000,
          },
        );
      } catch (e) {
        ok = false;
        if ([404, 410].includes(e.statusCode))
          db.prepare(
            "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=?",
          ).run(s.endpoint_hash);
      }
    if (ok)
      db.prepare("UPDATE finance_funding_alerts SET push_day=? WHERE id=?").run(
        day,
        a.id,
      );
  }
}
export function registerFundingRoutes(app, db, { route, owner }) {
  ensureCardCycles(db);
  app.get(
    "/api/finance/funding",
    route((req, res) => {
      if (!canManageChecks(req.financeUser)) fail("Acceso restringido", 403);
      ensureCardCycles(db);
      res.json(fundingOverview(db, req.financeUser));
    }),
  );
  app.post(
    "/api/finance/checks",
    route((req, res) =>
      res.status(201).json(saveCheck(db, req.financeUser, req.body)),
    ),
  );
  app.post(
    "/api/finance/checks/:id",
    route((req, res) =>
      res.json(saveCheck(db, req.financeUser, req.body, req.params.id)),
    ),
  );
  app.post(
    "/api/finance/checks/:id/clear",
    route((req, res) => {
      owner(req);
      const c = db
          .prepare("SELECT * FROM finance_checks WHERE id=?")
          .get(req.params.id),
        b = db
          .prepare("SELECT * FROM finance_bank_transactions WHERE id=?")
          .get(req.body.bank_transaction_id);
      if (
        !c ||
        c.status !== "pending" ||
        c.needs_review ||
        !b ||
        b.account_id !== c.account_id ||
        b.amount_cents !== -c.amount_cents ||
        debitAlreadyUsed(db, b.id)
      )
        fail(
          "Selecciona un débito real sin usar y resuelve los datos por revisar",
          409,
        );
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_checks SET status='cleared',cleared_bank_id=?,updated_at=?,version=version+1 WHERE id=?",
        ).run(b.id, new Date().toISOString(), c.id);
        audit(db, req.financeUser.username, "check.cleared", "check", c.id, c, {
          bank_transaction_id: b.id,
        });
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/card-statements/:id",
    route((req, res) => {
      owner(req);
      const s = db
          .prepare("SELECT * FROM finance_card_statements WHERE id=?")
          .get(req.params.id),
        amount = req.body.total_cents;
      if (
        !s ||
        s.state === "paid" ||
        !Number.isSafeInteger(amount) ||
        amount < 0
      )
        fail("Indica el pago total del estado de cuenta");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_card_statements SET total_cents=?,state='recorded',updated_by=?,updated_at=? WHERE id=?",
        ).run(amount, req.financeUser.username, new Date().toISOString(), s.id);
        audit(
          db,
          req.financeUser.username,
          "card.statement_recorded",
          "card_statement",
          s.id,
          s,
          { total_cents: amount },
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/card-statements/:id/paid",
    route((req, res) => {
      owner(req);
      const s = db
          .prepare(
            "SELECT s.*,c.debit_account_id FROM finance_card_statements s JOIN finance_credit_cards c ON c.id=s.card_id WHERE s.id=?",
          )
          .get(req.params.id),
        b = db
          .prepare("SELECT * FROM finance_bank_transactions WHERE id=?")
          .get(req.body.bank_transaction_id);
      if (
        !s ||
        s.state === "paid" ||
        s.total_cents === null ||
        !b ||
        (s.debit_account_id && s.debit_account_id !== b.account_id) ||
        b.amount_cents !== -s.total_cents ||
        debitAlreadyUsed(db, b.id)
      )
        fail(
          "Selecciona el pago bancario real por el total del estado de cuenta",
          409,
        );
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_card_statements SET state='paid',paid_bank_id=?,updated_by=?,updated_at=? WHERE id=?",
        ).run(b.id, req.financeUser.username, new Date().toISOString(), s.id);
        audit(
          db,
          req.financeUser.username,
          "card.statement_paid",
          "card_statement",
          s.id,
          null,
          { bank_transaction_id: b.id, expense_created: false },
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
        await flushFundingPush(db);
      } catch {
      } finally {
        running = false;
      }
    }, 60000);
    timer.unref();
  }
}
