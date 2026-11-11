import crypto from 'node:crypto';
import {audit,cents,financeDay,validDay} from './finance-db.js';
import {fail,importBank,reconcile} from './finance-service.js';
import {recordedAccountBalance} from './finance-check-ledger.js';

// An explicit owner observation replaces the balance at this instant. A single
// receipt explaining the exact increase is recorded before the checkpoint, so
// future bank evidence can attach to its reference without adding money again.
export function updateConfirmedBalance(db,user,accountId,body){
  if(user.role!=='owner')fail('Solo el propietario puede actualizar este saldo',403);
  const balance=cents(body.balance_cents,{signed:true,zero:true}),day=validDay(body.day);
  const account=db.prepare('SELECT * FROM finance_accounts WHERE id=? AND active=1').get(accountId);
  if(!account)fail('Cuenta no encontrada',404);
  if(day<account.opening_date||day>financeDay())fail('Fecha de saldo fuera de rango');
  return db.transaction(()=>{
    const current=recordedAccountBalance(db,account);
    if(body.expected_balance_cents!==undefined&&body.expected_balance_cents!==current)fail('El saldo cambió. Abre de nuevo la cuenta antes de guardar',409);
    const at=day===financeDay()?new Date().toISOString():new Date(`${day}T23:59:59-05:00`).toISOString();
    if(db.prepare('SELECT 1 FROM finance_balance_checkpoints WHERE account_id=? AND as_of_at>?').get(account.id,at))fail('Ya existe un saldo más reciente. Actualiza el saldo de hoy',409);
    const before=recordedAccountBalance(db,account,day,at),delta=balance-before;
    const matches=delta>0?db.prepare(`SELECT m.* FROM finance_movements m WHERE m.account_id=? AND m.kind='income' AND m.amount_cents=?
      AND m.day BETWEEN date(?,'-1 day') AND ? AND m.evidence_id IS NOT NULL AND m.is_payment_request=0
      AND m.status IN ('pending','reported','approved') AND m.hidden_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM finance_allocations a WHERE a.movement_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM finance_closings c WHERE c.unit_id=m.unit_id AND c.day=m.day)
      AND NOT EXISTS(SELECT 1 FROM finance_bank_transactions b WHERE b.account_id=m.account_id AND b.amount_cents=m.amount_cents AND m.reference!='' AND b.reference=m.reference AND b.day BETWEEN date(m.day,'-1 day') AND date(m.day,'+1 day'))`).all(account.id,delta,day,day):[];
    let receiptId=null,bankId=null;
    if(matches.length===1){
      const receipt=matches[0];
      bankId=importBank(db,user,{source_system:'assistant',account_id:account.id,rows:[{day:receipt.day,occurred_at:at,amount_cents:receipt.amount_cents,reference:receipt.reference||'',description:`Ingreso confirmado por ${user.username} al actualizar el saldo: ${receipt.counterparty}. ${receipt.description||''}`,external_id:`balance-receipt:${receipt.id}`}]}).transaction_ids[0];
      reconcile(db,user,{movement_id:receipt.id,bank_transaction_id:bankId,amount_cents:receipt.amount_cents});receiptId=receipt.id;
      if(receipt.business_id==='marjorie'&&receipt.unit_id?.startsWith('marjorie-'))db.prepare("INSERT OR IGNORE INTO finance_store_confirmations(movement_id,actor,confirmed_at,mode) VALUES (?,?,?,'manual')").run(receipt.id,user.username,at);
      db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'").run(receipt.id);
      audit(db,user.username,'receipt.confirmed_with_balance','movement',receipt.id,null,{bank_transaction_id:bankId,account_id:account.id,confirmed_by_owner:true},receipt.business_id);
    }
    const source=crypto.randomUUID();
    db.prepare('INSERT INTO finance_balance_checkpoints(account_id,as_of_at,balance_cents,source_hash,created_by,created_at) VALUES (?,?,?,?,?,?)').run(account.id,at,balance,source,user.username,at);
    db.prepare('UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?').run(balance,at,account.id);
    const result={ok:true,balance_cents:recordedAccountBalance(db,account),observed_cents:balance,difference_cents:delta,movement_id:receiptId,bank_transaction_id:bankId,unexplained_difference_cents:receiptId?0:delta};
    audit(db,user.username,'account.balance_updated','account',account.id,{balance_cents:before},{...result,as_of_at:at,confirmed_by_owner:true},account.business_id);
    return result;
  })();
}
