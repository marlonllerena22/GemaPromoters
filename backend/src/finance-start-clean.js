import { audit } from "./finance-db.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";
import { queueReceiptNotice } from "./finance-receipts.js";

export function repairKnownAccountNumbers(db){
  const key='known-guayaquil-pagos-number-2026-11-11-v1';if(privateSetting(db,key))return;
  return db.transaction(()=>{
    const registry=privateSetting(db,'own_account_registry');
    if(!registry)return;
    const entries=registry.accounts.filter(a=>a.key==='gyq-pagos');
    if(entries.length!==1)return;
    const entry=entries[0],account=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND bank='Guayaquil' AND name LIKE '%PAGOS%'").get(entry.account_id);
    if(!account||(account.last_four&&!['2719'].includes(account.last_four))||(entry.number&&entry.number!=='0013282719'))return;
    // Full number supplied by Marlon; confirmed again by the bank's named PAGOS transfer.
    entry.number='0013282719';entry.suffix='2719';
    putPrivateSetting(db,'own_account_registry',registry);
    putPrivateSetting(db,'mail_auto_replay_cursor',null);
    db.prepare("UPDATE finance_accounts SET last_four='2719' WHERE id=?").run(account.id);
    const result={account_id:account.id,last_four:'2719',balances_unchanged:true};
    putPrivateSetting(db,key,result);audit(db,'marlon','account.number_repaired','account',account.id,null,result);
    console.info('[finance] Known account number repaired '+JSON.stringify(result));
    return result;
  })();
}

export function clearCurrentActivity(db) {
  const key='owner-clear-activity-2026-11-11-v1';
  if(privateSetting(db,key))return;
  return db.transaction(()=>{
    const now=new Date().toISOString();
    const moneySnapshot=()=>JSON.stringify(['finance_accounts','finance_bank_transactions','finance_balance_checkpoints','finance_custody_balances','finance_provider_receipts','finance_checks','finance_loan_installments','finance_card_statements'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    const before=moneySnapshot();
    // Visibility reset only. No ledger, account balance, loan, check or card writes.
    const result={
      mail:db.prepare('UPDATE finance_mail_messages SET archived_at=? WHERE archived_at IS NULL').run(now).changes,
      notices:db.prepare('UPDATE finance_incoming_notices SET archived_at=? WHERE archived_at IS NULL').run(now).changes,
      movements:db.prepare(`UPDATE finance_movements SET hidden_at=?,updated_at=? WHERE hidden_at IS NULL
        AND status IN ('pending','approved','reported')
        AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.movement_id=finance_movements.id)
        AND NOT EXISTS(SELECT 1 FROM finance_payments p WHERE p.request_id=finance_movements.id AND p.voided_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM finance_store_confirmations c WHERE c.movement_id=finance_movements.id)`).run(now,now).changes,
      push:db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE state IN ('queued','failed')").run().changes,
      drafts:db.prepare('DELETE FROM finance_assistant_drafts WHERE result_json IS NULL').run().changes,
      notifications:0,
    };
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get()){
      if(!db.prepare('PRAGMA table_info(finance_notification_events)').all().some(c=>c.name==='archived_at'))db.exec('ALTER TABLE finance_notification_events ADD COLUMN archived_at TEXT');
      result.notifications=db.prepare("UPDATE finance_notification_events SET archived_at=?,state=CASE WHEN state='review' THEN 'dismissed' ELSE state END WHERE archived_at IS NULL").run(now).changes;
    }
    putPrivateSetting(db,'activity_restart_at',now);
    putPrivateSetting(db,'receipt_auto_confirm_from_notification',true);
    putPrivateSetting(db,'mail_auto_replay_cursor',null);
    if(before!==moneySnapshot())throw new Error('Activity reset attempted to change protected financial records');
    result.financial_records_unchanged=true;
    putPrivateSetting(db,key,{...result,at:now});
    audit(db,'marlon','workspace.activity_archived','workspace','2026-11-11',null,{...result,at:now});
    console.info('[finance] Current activity cleared '+JSON.stringify(result));
    return result;
  })();
}

// Explicit follow-up from Marlon: remove Norma's $1,243 trial, preserving bank money.
export function archiveNovemberTrialReceipt(db) {
  const key = "owner-remove-1243-trial-2026-11-11-v1";
  if (privateSetting(db, key)) return;
  return db.transaction(() => {
    const rows = db.prepare(`SELECT m.* FROM finance_movements m
      WHERE m.business_id='producalza' AND m.kind='income' AND m.amount_cents=124300
      AND m.is_payment_request=0 AND m.hidden_at IS NULL
      AND lower(m.created_by) IN ('norma','normita')
      AND julianday(m.created_at)<=julianday('2026-11-11T05:25:00.000Z')`).all();
    const archived = [], protectedRows = [];
    if (rows.length === 1) {
      const row = rows[0];
      const linked = db.prepare("SELECT 1 FROM finance_allocations WHERE movement_id=? UNION ALL SELECT 1 FROM finance_payments WHERE request_id=? AND voided_at IS NULL").get(row.id,row.id);
      if (linked) protectedRows.push(row.id);
      else {
        const now = new Date().toISOString();
        db.prepare("UPDATE finance_movements SET status='rejected',hidden_at=?,review_note='Prueba de $1.243 retirada por instrucción expresa de Marlon',reviewed_by='marlon',updated_at=? WHERE id=?").run(now,now,row.id);
        db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'").run(row.id);
        audit(db,'marlon','test.archived','movement',row.id,row,{reason:'Retirar prueba de $1.243; movimientos bancarios conservados'},row.business_id);
        archived.push(row.id);
      }
    }
    const existing = rows.length ? [] : db.prepare("SELECT id,business_id,kind,status,hidden_at IS NOT NULL AS hidden,lower(created_by) IN ('norma','normita') AS norma FROM finance_movements WHERE amount_cents=124300 AND julianday(created_at)<=julianday('2026-11-11T05:25:00.000Z') LIMIT 10").all();
    const result = {archived,protected:protectedRows,ambiguous:rows.length>1?rows.map(r=>r.id):[],found:rows.length,existing};
    putPrivateSetting(db,key,result);
    console.info('[finance] Requested 1243 trial cleanup '+JSON.stringify(result));
    return result;
  })();
}

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
