import { audit, cents, validDay, financeDay } from "./finance-db.js";
import { fail, scoped, text, reconcile,importBank } from "./finance-service.js";
import { privateSetting,putPrivateSetting } from "./finance-operations.js";
import {acceptsBankNotification} from '../../shared/finance-notification-accounts.mjs';
import {decryptDocument} from './finance-ai.js';
import {matchingBankPerson} from './finance-bank-identity.js';
import {recordedAccountBalance} from './finance-check-ledger.js';
import {linkRecordedBankEvidence} from './finance-evidence-links.js';
import {matchKnownBankReceipt} from './finance-declared-bank.js';

export function activateReceiptCredits(db){
  const key='receipt_confirmation_credits_v1';let policy=privateSetting(db,key);
  if(!policy){policy={activated_at:new Date().toISOString(),legacy_through_id:db.prepare('SELECT COALESCE(MAX(id),0) id FROM finance_movements').get().id,balances_at_activation:db.prepare('SELECT * FROM finance_accounts WHERE active=1').all().map(a=>({account_id:a.id,balance_cents:recordedAccountBalance(db,a)}))};putPrivateSetting(db,key,policy);console.info('[finance] Receipt confirmation credits activated '+JSON.stringify({activated_at:policy.activated_at,legacy_through_id:policy.legacy_through_id,account_balances_unchanged:policy.balances_at_activation.every(a=>recordedAccountBalance(db,db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(a.account_id))===a.balance_cents)}));}
  return policy;
}
export function resolveReceiptAccount(db,row,selected){
  const accounts=receiptAccounts(db,{role:'owner'});
  let id=selected===undefined?row.account_id:Number(selected);
  if(!id){let analysis;try{analysis=JSON.parse(db.prepare('SELECT analysis FROM finance_evidence WHERE id=?').get(row.evidence_id)?.analysis||'null');}catch{}
    if(analysis)id=suggestReceivingAccount(db,{role:'owner'},analysis).account_id;
  }
  return accounts.find(a=>a.id===id)||null;
}
export function confirmReceiptDeposit(db,user,id,body={}){
  if(user.role!=='owner')fail('No puedes confirmar este depósito',403);
  if(body.already_in_balance!==undefined&&typeof body.already_in_balance!=='boolean')fail('Revisa el tipo de confirmación');
  return db.transaction(()=>{
    const row=db.prepare("SELECT * FROM finance_movements WHERE id=? AND kind='income' AND evidence_id IS NOT NULL AND is_payment_request=0 AND hidden_at IS NULL").get(id);
    if(!row||!scoped(user,row))fail('Comprobante no disponible',404);
    const saved=db.prepare('SELECT * FROM finance_receipt_confirmations WHERE movement_id=?').get(row.id);
    if(saved)return {ok:true,duplicate:true,disposition:saved.disposition,bank_transaction_id:saved.bank_transaction_id};
    if(row.status==='reconciled')return {ok:true,duplicate:true,disposition:'bank_linked'};
    if(!['pending','reported','approved'].includes(row.status))fail('Este comprobante no se puede confirmar',409);
    if(row.unit_id&&db.prepare('SELECT 1 FROM finance_closings WHERE unit_id=? AND day=?').get(row.unit_id,row.day))fail('Reabre el cierre antes de confirmar este comprobante',409);
    if(db.prepare('SELECT 1 FROM finance_allocations WHERE movement_id=?').get(row.id))fail('Revisa las asignaciones parciales antes de confirmar',409);
    const account=resolveReceiptAccount(db,row,body.account_id);if(!account)fail('No pude identificar una cuenta única. Selecciona la cuenta que recibió el dinero');
    const full=db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(account.id),before=recordedAccountBalance(db,full),now=new Date().toISOString();
    const policy=privateSetting(db,'receipt_confirmation_credits_v1');
    const included=body.already_in_balance===true||!policy||row.id<=policy.legacy_through_id;
    db.prepare('UPDATE finance_movements SET account_id=?,receiving_bank=?,cross_account=? WHERE id=?').run(account.id,account.bank,account.business_id&&account.business_id!==row.business_id?1:0,row.id);
    let disposition='bank_linked',bankId;
    if(reconcileRecordedReceipt(db,row.id))bankId=db.prepare('SELECT bank_transaction_id FROM finance_allocations WHERE movement_id=?').get(row.id).bank_transaction_id;
    else if(!included&&(bankId=matchKnownBankReceipt(db,{account_id:account.id,day:row.day,amount_cents:row.amount_cents,counterparty:row.counterparty})?.id))reconcile(db,user,{movement_id:row.id,bank_transaction_id:bankId,amount_cents:row.amount_cents});
    else{
      if(row.reference){const known=db.prepare("SELECT b.id FROM finance_bank_transactions b WHERE b.account_id=? AND b.reference=? AND b.amount_cents=? AND b.day BETWEEN date(?,'-1 day') AND date(?,'+1 day')").all(account.id,row.reference,row.amount_cents,row.day,row.day);if(known.length)fail('Ese abono ya tiene una asociación o coincidencias por revisar. No se sumó otra vez',409);}
      const imported=importBank(db,user,{source_system:'assistant',account_id:account.id,rows:[{day:financeDay(now),occurred_at:now,amount_cents:row.amount_cents,reference:row.reference||'',description:`Depósito confirmado por ${user.username}: ${row.counterparty}. ${included?'Ya contemplado en el saldo.':'Confirmado al revisar el comprobante.'}`,external_id:`receipt-confirmation:${row.id}`} ]});bankId=imported.transaction_ids[0];
      if(!imported.imported)fail('El depósito ya tiene un registro. Revisa su asociación antes de confirmar',409);
      disposition=included?'included':'credited';
      db.prepare('INSERT INTO finance_receipt_confirmations VALUES (?,?,?,?,?,?)').run(row.id,account.id,bankId,disposition,user.username,now);
      reconcile(db,user,{movement_id:row.id,bank_transaction_id:bankId,amount_cents:row.amount_cents});
    }
    db.prepare('INSERT OR IGNORE INTO finance_receipt_confirmations VALUES (?,?,?,?,?,?)').run(row.id,account.id,bankId,disposition,user.username,now);
    db.prepare('UPDATE finance_movements SET reviewed_by=?,reviewed_at=?,review_note=?,updated_at=? WHERE id=?').run(user.username,now,included?'Ya está contemplado en el saldo':'Depósito confirmado al revisar el comprobante',now,row.id);
    db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'").run(row.id);
    linkRecordedBankEvidence(db);
    const after=recordedAccountBalance(db,full);audit(db,user.username,'receipt.deposit_confirmed','movement',row.id,{balance_cents:before},{account_id:account.id,bank_transaction_id:bankId,disposition,balance_cents:after,delta_cents:after-before},row.business_id);
    return {ok:true,account_id:account.id,bank_transaction_id:bankId,disposition,balance_cents:after,delta_cents:after-before};
  })();
}

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
      "SELECT id,name,bank,kind,last_four,business_id,holder_key FROM finance_accounts WHERE active=1 AND kind IN ('bank','wallet') ORDER BY bank,name"
    )
    .all().filter(a=>a.kind==='bank'||acceptsBankNotification(a,'Deuna'));
}
export function suggestReceivingAccount(db, user, analysis) {
  const suffix = String(analysis.destination_account_suffix || "").replace(
    /\s|-/g,
    ""
  );
  if (!/^\d{2,20}$/.test(suffix)||suffix.length<3&&!analysis.receiving_bank)
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
    e.name evidence_name,c.confirmed_at,rc.disposition receipt_disposition FROM finance_movements m
    LEFT JOIN finance_members u ON u.username=m.created_by LEFT JOIN finance_accounts a ON a.id=m.account_id
    LEFT JOIN finance_evidence e ON e.id=m.evidence_id LEFT JOIN finance_store_confirmations c ON c.movement_id=m.id LEFT JOIN finance_receipt_confirmations rc ON rc.movement_id=m.id
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
    if(account){
      db.prepare('UPDATE finance_movements SET receiving_bank=? WHERE id=?').run(account.bank,row.id);
      updated.receiving_bank=account.bank;
      if(row.unit_id==='marjorie-sur'&&row.receiving_bank!==account.bank)db.prepare("UPDATE finance_push_outbox SET state='queued',attempts=0,next_attempt=0 WHERE event_key=?").run('receipt-review:'+row.id);
    }
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
    reconcileRecordedReceipt(db,updated.id);
    return { ok: true };
  })();
}
export function queueReceiptNotice(db, id) {
  if(db.prepare("SELECT 1 FROM finance_movements WHERE id=? AND (hidden_at IS NOT NULL OR status IN ('reconciled','rejected'))").get(id))return;
  db.prepare(
    "INSERT OR IGNORE INTO finance_push_outbox(event_key,request_id) VALUES (?,?)"
  ).run("receipt-review:" + id, id);
}
function nativeReceiptBank(db,row){
  if(privateSetting(db,'receipt_auto_confirm_from_notification')!==true||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get())return null;
  const peers=db.prepare("SELECT id,counterparty FROM finance_movements WHERE kind='income' AND account_id=? AND amount_cents=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day') AND evidence_id IS NOT NULL AND hidden_at IS NULL AND status IN ('pending','reported','approved')").all(row.account_id,row.amount_cents,row.day,row.day).filter(p=>matchingBankPerson(p.counterparty,row.counterparty));
  if(peers.length!==1)return null;
  const candidates=new Map();
  for(const n of db.prepare(`SELECT n.* FROM finance_notification_events n JOIN finance_bank_transactions b ON b.id=n.bank_transaction_id
    WHERE n.state IN ('applied','matched') AND b.account_id=? AND b.amount_cents=? AND b.day BETWEEN date(?,'-1 day') AND date(?,'+1 day')
    AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.bank_transaction_id=b.id)`).all(row.account_id,row.amount_cents,row.day,row.day)){
    let p;try{p=JSON.parse(decryptDocument(n.encrypted).toString());}catch{continue;}
    if(p.blocked||p.credit||p.direction!=='incoming'||!matchingBankPerson(p.counterparty,row.counterparty)||(p.reference&&row.reference&&p.reference!==row.reference))continue;
    candidates.set(n.bank_transaction_id,{id:n.bank_transaction_id,notification_id:n.id});
  }
  return candidates.size===1?[...candidates.values()][0]:null;
}
export function reconcileRecordedReceipt(db,id) {
  const row=db.prepare("SELECT * FROM finance_movements WHERE id=? AND kind='income' AND evidence_id IS NOT NULL AND hidden_at IS NULL AND status IN ('pending','reported','approved')").get(id);
  if(!row?.account_id)return false;
  const peers=db.prepare("SELECT id FROM finance_movements WHERE kind='income' AND account_id=? AND reference=? AND amount_cents=? AND hidden_at IS NULL AND status!='rejected'").all(row.account_id,row.reference,row.amount_cents);
  if(peers.length!==1)return false;
  const banks=row.reference?db.prepare("SELECT * FROM finance_bank_transactions b WHERE account_id=? AND reference=? AND amount_cents=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day') AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.bank_transaction_id=b.id)").all(row.account_id,row.reference,row.amount_cents,row.day,row.day):[];
  const native=banks.length===0?nativeReceiptBank(db,row):null;
  if(native)banks.push(native);
  if(banks.length!==1)return false;
  reconcile(db,{role:'owner',username:'system:bank-evidence',business_ids:['producalza','marjorie','gemashow','personal'],unit_ids:[]},{movement_id:row.id,bank_transaction_id:banks[0].id,amount_cents:row.amount_cents});
  if(row.business_id==='marjorie'&&row.unit_id?.startsWith('marjorie-'))db.prepare("INSERT OR IGNORE INTO finance_store_confirmations(movement_id,actor,confirmed_at,mode) VALUES (?,'system:bank-evidence',?,'bank_verified')").run(row.id,new Date().toISOString());
  db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'").run(row.id);
  if(native)audit(db,'system:bank-evidence','receipt.confirmed_with_notification','movement',row.id,null,{bank_transaction_id:native.id,notification_id:native.notification_id,bank_balance_unchanged:true},row.business_id);
  return true;
}
export function repairReceiptAccounts(db){
  const owner={role:'owner'},result={assigned:0,reconciled:0};
  return db.transaction(()=>{
    const receipts=db.prepare(`SELECT m.*,e.analysis FROM finance_movements m JOIN finance_evidence e ON e.id=m.evidence_id
      WHERE m.kind='income' AND m.is_payment_request=0 AND m.hidden_at IS NULL AND m.status IN ('pending','reported','approved')
      AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.movement_id=m.id)`).all();
    for(const row of receipts){
      if(!row.account_id){
        let analysis;try{analysis=JSON.parse(row.analysis||'null');}catch{continue;}
        if(!analysis||row.receiving_bank&&analysis.receiving_bank&&bankCode(row.receiving_bank)!==bankCode(analysis.receiving_bank))continue;
        const suggestion=suggestReceivingAccount(db,owner,analysis);if(suggestion.state!=='matched')continue;
        const account=receiptAccounts(db,owner).find(a=>a.id===suggestion.account_id);
        if(row.unit_id&&db.prepare('SELECT 1 FROM finance_closings WHERE unit_id=? AND day=?').get(row.unit_id,row.day))continue;
        db.prepare('UPDATE finance_movements SET account_id=?,receiving_bank=?,cross_account=?,updated_at=? WHERE id=?').run(account.id,account.bank,account.business_id&&account.business_id!==row.business_id?1:0,new Date().toISOString(),row.id);
        audit(db,'system:bank-evidence','receipt.account_detected','movement',row.id,{account_id:null},{account_id:account.id,suffix:suggestion.suffix,bank_balance_unchanged:true},row.business_id);result.assigned++;
      }
      try{if(reconcileRecordedReceipt(db,row.id))result.reconciled++;}catch(error){if(!error.status)throw error;}
    }
    if(result.assigned||result.reconciled)console.info('[finance] Receipt accounts recovered '+JSON.stringify(result));
    return result;
  })();
}
export function registerReceiptRoutes(app, db, { route }) {
  db.prepare("UPDATE finance_movements SET receiving_bank=(SELECT bank FROM finance_accounts WHERE id=finance_movements.account_id) WHERE kind='income' AND evidence_id IS NOT NULL AND account_id IS NOT NULL AND COALESCE(receiving_bank,'')=''").run();
  app.post(
    '/api/finance/receipts/:id/confirm',
    route((req,res)=>res.json(confirmReceiptDeposit(db,req.financeUser,Number(req.params.id),req.body)))
  );
  app.post(
    "/api/finance/receipts/:id/edit",
    route((req, res) =>
      res.json(editReceipt(db, req.financeUser, req.params.id, req.body))
    )
  );
}
