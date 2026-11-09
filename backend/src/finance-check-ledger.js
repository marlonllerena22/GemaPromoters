import crypto from "node:crypto";
import { audit, financeDay } from "./finance-db.js";
const error = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const canDeclareCheck = (user) =>
  user.role === "owner" || Boolean(user.checks_clear);
export function reportedCheckDebits(
  db,
  accountId,
  throughDay = financeDay(),
  throughInstant = null,
) {
  return db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_checks WHERE account_id=? AND status='cleared' AND cleared_bank_id IS NULL AND manual_cleared_day<=? AND (? IS NULL OR cleared_at<=?)",
    )
    .get(accountId, throughDay, throughInstant, throughInstant).n;
}
export function recordedAccountBalance(
  db,
  account,
  throughDay = financeDay(),
  throughInstant = null,
) {
  return (
    account.opening_cents +
    db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_bank_transactions WHERE account_id=? AND day>=? AND day<=?",
      )
      .get(account.id, account.opening_date, throughDay).n -
    reportedCheckDebits(db, account.id, throughDay, throughInstant)
  );
}
function used(db, id) {
  return db
    .prepare(
      "SELECT 1 FROM finance_checks WHERE cleared_bank_id=? UNION ALL SELECT 1 FROM finance_loan_installments WHERE bank_transaction_id=? UNION ALL SELECT 1 FROM finance_card_statements WHERE paid_bank_id=?",
    )
    .get(id, id, id);
}
function identifiesCheck(bank, number) {
  const text = `${bank.reference || ""} ${bank.description || ""}`;
  const matches = [
    ...text.matchAll(
      /(?:cheque|chq|ch\.?)(?:\s*(?:nro\.?|no\.?|n[úu]mero|#))?[\s:#.-]*0*(\d{1,20})\b/gi,
    ),
  ];
  const numbers = [...new Set(matches.map((m) => m[1].replace(/^0+/, "")))];
  return (
    numbers.length === 1 && numbers[0] === String(number).replace(/^0+/, "")
  );
}
export function matchReportedChecks(db, actor = "system:check-match") {
  let matched = 0;
  for (const c of db
    .prepare(
      "SELECT * FROM finance_checks WHERE status IN ('cleared','pending') AND cleared_bank_id IS NULL AND needs_review=0",
    )
    .all()) {
    const reported = c.status === "cleared",
      day = c.manual_cleared_day || c.due_day;
    const normalize = (t) =>
      String(t)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const names =
      normalize(c.payee)
        .match(/[a-z]{4,}/g)
        ?.filter(
          (w) =>
            !["calzado", "sociedad", "compania", "general", "banco"].includes(
              w,
            ),
        ) || [];
    const candidates = db
      .prepare(
        "SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND day BETWEEN date(?,'-5 days') AND date(?,'+5 days')",
      )
      .all(c.account_id, -c.amount_cents, day, day)
      .filter(
        (b) =>
          !used(db, b.id) &&
          identifiesCheck(b, c.number) &&
          (reported ||
            names.some((n) =>
              new RegExp("(?:^|[^a-z])" + n + "(?:$|[^a-z])").test(
                normalize(b.description),
              ),
            )),
      );
    if (candidates.length !== 1) continue;
    const b = candidates[0];
    db.prepare(
      "UPDATE finance_checks SET cleared_bank_id=?,status='cleared',clearing_source='bank',cleared_by=COALESCE(cleared_by,'system:bank-match'),cleared_at=COALESCE(cleared_at,?),updated_at=?,version=version+1 WHERE id=?",
    ).run(b.id, new Date().toISOString(), new Date().toISOString(), c.id);
    audit(
      db,
      actor,
      "check.bank_matched",
      "check",
      c.id,
      { cleared_bank_id: null },
      { bank_transaction_id: b.id, amount_cents: c.amount_cents },
    );
    matched++;
  }
  return matched;
}
export function declareCheck(db, user, id, body) {
  if (!canDeclareCheck(user))
    error("Solo Marlon y Germán pueden marcar cheques cobrados", 403);
  if (
    typeof body.cleared !== "boolean" ||
    !Number.isSafeInteger(body.version) ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(body.request_key || "")
  )
    error("Actualiza el cheque antes de marcarlo");
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify([id, body.cleared, body.version]))
    .digest("hex");
  return db.transaction(() => {
    const previous = db
      .prepare(
        "SELECT fingerprint FROM finance_check_actions WHERE actor=? AND request_key=?",
      )
      .get(user.username, body.request_key);
    if (previous) {
      if (previous.fingerprint !== hash)
        error("Este envío ya tiene otros datos", 409);
      return { ok: true, duplicate: true };
    }
    const c = db.prepare("SELECT * FROM finance_checks WHERE id=?").get(id);
    if (!c) error("Cheque no encontrado", 404);
    if (c.version !== body.version)
      error("Otra persona actualizó el cheque. Revisa su estado actual", 409);
    if (c.needs_review)
      error("Resuelve los datos por revisar antes de marcarlo", 409);
    if (c.cleared_bank_id && body.cleared) return { ok: true, duplicate: true };
    if (c.cleared_bank_id && !body.cleared)
      error(
        "Este cheque ya tiene un débito bancario vinculado. El propietario debe revisar esa asociación",
        409,
      );
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE finance_checks SET status=?,manual_cleared_day=?,cleared_by=?,cleared_at=?,clearing_source=?,updated_at=?,version=version+1 WHERE id=?",
    ).run(
      body.cleared ? "cleared" : "pending",
      body.cleared ? financeDay() : null,
      body.cleared ? user.username : null,
      body.cleared ? now : null,
      body.cleared ? "reported" : null,
      now,
      id,
    );
    db.prepare(
      "INSERT INTO finance_check_actions (check_id,actor,request_key,fingerprint,created_at) VALUES (?,?,?,?,?)",
    ).run(id, user.username, body.request_key, hash, now);
    audit(
      db,
      user.username,
      body.cleared ? "check.reported_cleared" : "check.reopened",
      "check",
      id,
      c,
      {
        status: body.cleared ? "cleared" : "pending",
        manual_cleared_day: body.cleared ? financeDay() : null,
      },
    );
    if (body.cleared) matchReportedChecks(db, user.username);
    return { ok: true, duplicate: false };
  })();
}
