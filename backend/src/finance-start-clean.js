import { audit } from "./finance-db.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";
import { queueReceiptNotice } from "./finance-receipts.js";

// Owner's November 10 cleanup. Never changes accounts, bank entries, or posted money.
export function applyNovemberCleanup(db) {
  if (
    !db
      .prepare("PRAGMA table_info(finance_incoming_notices)")
      .all()
      .some((c) => c.name === "archived_at")
  )
    db.exec("ALTER TABLE finance_incoming_notices ADD COLUMN archived_at TEXT");
  const key = "owner-clean-start-2026-11-10-v1";
  if (privateSetting(db, key)) return;
  return db.transaction(() => {
    const people = db
      .prepare(
        "SELECT id,username FROM finance_members WHERE lower(username) IN ('norma','normita','morelia')"
      )
      .all();
    let memberships = 0;
    for (const person of people) {
      memberships += db
        .prepare(
          "DELETE FROM finance_space_members WHERE space_id='producalza-materiales' AND member_id=?"
        )
        .run(person.id).changes;
    }
    db.prepare(
      "UPDATE finance_spaces SET suggested_members=? WHERE id='producalza-materiales'"
    ).run(JSON.stringify(["Ana", "José", "Tú"]));
    const requests = db
      .prepare(
        `SELECT m.* FROM finance_movements m WHERE m.is_payment_request=1 AND m.amount_cents=4260
      AND m.hidden_at IS NULL AND m.status IN ('pending','approved','reported')
      AND m.created_at<='2026-11-11T05:00:00.000Z'
      AND NOT EXISTS(SELECT 1 FROM finance_payments p WHERE p.request_id=m.id AND p.voided_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.movement_id=m.id)`
      )
      .all();
    const canceled = [];
    if (requests.length === 1) {
      const row = requests[0],
        now = new Date().toISOString();
      db.prepare(
        "UPDATE finance_movements SET status='rejected',hidden_at=?,reviewed_by='marlon',review_note='Retirada por Marlon para el inicio limpio solicitado el 10 de noviembre',updated_at=? WHERE id=?"
      ).run(now, now, row.id);
      db.prepare(
        "UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'"
      ).run(row.id);
      audit(
        db,
        "marlon",
        "request.archived",
        "movement",
        row.id,
        row,
        { hidden_at: now, reason: "Anotaciones de preparación" },
        row.business_id
      );
      canceled.push(row.id);
    }
    const notices = db
      .prepare(
        "SELECT * FROM finance_incoming_notices WHERE lower(counterparty) LIKE '%tania%elizabeth%' AND archived_at IS NULL"
      )
      .all();
    for (const notice of notices) {
      db.prepare(
        "UPDATE finance_incoming_notices SET archived_at=? WHERE id=?"
      ).run(new Date().toISOString(), notice.id);
      audit(
        db,
        "marlon",
        "notice.archived",
        "incoming_notice",
        notice.id,
        null,
        {
          reason:
            "Retirar aviso de prueba de Tania; saldo y depósito real conservados",
        },
        notice.business_id
      );
    }
    const testRows = db
      .prepare(
        "SELECT * FROM finance_movements WHERE lower(counterparty) LIKE '%tania%elizabeth%' AND hidden_at IS NULL AND status='pending' AND lower(description) GLOB '*prueba*' AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.movement_id=finance_movements.id) AND NOT EXISTS(SELECT 1 FROM finance_payments p WHERE p.request_id=finance_movements.id)"
      )
      .all();
    for (const row of testRows) {
      db.prepare(
        "UPDATE finance_movements SET hidden_at=?,status='rejected',review_note='Prueba retirada por Marlon' WHERE id=?"
      ).run(new Date().toISOString(), row.id);
      audit(
        db,
        "marlon",
        "test.archived",
        "movement",
        row.id,
        row,
        { reason: "Prueba de Tania" },
        row.business_id
      );
    }
    const pendingReceipts = db
      .prepare(
        "SELECT id FROM finance_movements WHERE kind='income' AND evidence_id IS NOT NULL AND hidden_at IS NULL AND status IN ('pending','reported') AND created_at>='2026-11-10T05:00:00.000Z' AND NOT EXISTS(SELECT 1 FROM finance_store_confirmations c WHERE c.movement_id=finance_movements.id)"
      )
      .all();
    for (const receipt of pendingReceipts) queueReceiptNotice(db, receipt.id);
    const result = {
      memberships_removed: memberships,
      requests_4260: canceled,
      ambiguous_4260: requests.length > 1 ? requests.map((r) => r.id) : [],
      tania_notices_archived: notices.length,
      tania_tests_archived: testRows.length,
      receipt_notices_prepared: pendingReceipts.length,
    };
    putPrivateSetting(db, key, result);
    audit(
      db,
      "marlon",
      "workspace.cleaned",
      "workspace",
      "2026-11-10",
      null,
      result
    );
    console.info("[finance] Requested start cleanup " + JSON.stringify(result));
    return result;
  })();
}
