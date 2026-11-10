import { fail } from "./finance-service.js";

// Shared by email and Android ingestion. Equal amounts alone never prove identity.
export function notificationBankMatch(
  db,
  { account_id, day, amount_cents, reference = "" }
) {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'"
      )
      .get()
  )
    return null;
  const rows = db
    .prepare(
      `SELECT DISTINCT b.* FROM finance_notification_events n
    JOIN finance_bank_transactions b ON b.id=n.bank_transaction_id
    WHERE b.account_id=? AND b.amount_cents=? AND n.state IN ('applied','matched')
    AND ((?!='' AND b.reference=?) OR (b.day=? AND (b.reference='' OR ?='')))`
    )
    .all(account_id, amount_cents, reference, reference, day, reference);
  const exact = rows.filter((r) => reference && r.reference === reference);
  if (exact.length === 1 && rows.length === 1) return exact[0];
  if (rows.length)
    fail(
      "Hay un aviso Android con ese valor. Relaciónalo en Avisos de bancos para evitar registrarlo dos veces",
      409
    );
  return null;
}
