import { decryptDocument } from "./finance-ai.js";
import { audit, safeMember, financeDay } from "./finance-db.js";
import { importBank, reconcile, createMovement } from "./finance-service.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";

export function importStatementImage(db, account, image) {
  return db.transaction(() => {
  if(!/^[a-f0-9]{64}$/.test(image.source_hash||"") || !Number.isFinite(Date.parse(image.observed_at)) || Date.parse(image.observed_at)>Date.now() || !Array.isArray(image.rows) || !image.rows.length || image.rows.length>100) throw new Error("Invalid statement image");
  const owner=safeMember(db.prepare("SELECT * FROM finance_members WHERE active=1 AND role='owner' ORDER BY id LIMIT 1").get());
  if(!owner) throw new Error("Owner unavailable");
  if(recordedAccountBalance(db,account)!==image.expected_before_cents) throw new Error("Account changed since statement review");
  const before=recordedAccountBalance(db,account),ids=[];
  let linked=0;
  for(let index=0;index<image.rows.length;index++) {
    const row=image.rows[index];
    const imported=importBank(db,owner,{source_system:"statement-image",account_id:account.id,rows:[{...row,day:financeDay(image.observed_at),occurred_at:row.occurred_at||image.observed_at,external_id:`image:${image.source_hash}:${index}`} ]});
    const id=imported.transaction_ids[0];ids.push(id);
    const bank=db.prepare("SELECT * FROM finance_bank_transactions WHERE id=?").get(id);
    if(row.movement_id) {
      const m=db.prepare("SELECT * FROM finance_movements WHERE id=?").get(row.movement_id);
      if(!m || m.account_id!==account.id || m.is_payment_request || m.amount_cents!==Math.abs(row.amount_cents) || (m.kind==='income'?1:-1)!==Math.sign(row.amount_cents) || (row.reference && m.reference!==row.reference)) throw new Error("Statement and uploaded receipt do not match");
      const allocation=db.prepare("SELECT * FROM finance_allocations WHERE movement_id=? AND bank_transaction_id=?").get(m.id,id);
      if(!allocation) reconcile(db,owner,{movement_id:m.id,bank_transaction_id:id,amount_cents:m.amount_cents});
      linked++;
      if(row.reference) for(const mail of db.prepare("SELECT * FROM finance_mail_messages WHERE state='draft' AND bank_transaction_id IS NULL AND (account_id=? OR account_id IS NULL) ORDER BY created_at DESC LIMIT 100").all(account.id)) {
        const draft=JSON.parse(decryptDocument(mail.encrypted).toString());
        if(draft.reference===row.reference && draft.amount_cents===m.amount_cents && (draft.origin_account_id===account.id || draft.account_id===account.id)) db.prepare("UPDATE finance_mail_messages SET state='applied',account_id=?,bank_transaction_id=?,movement_id=? WHERE id=?").run(account.id,id,m.id,mail.id);
      }
    } else if(row.fee_business_id && !db.prepare("SELECT 1 FROM finance_allocations WHERE bank_transaction_id=?").get(id)) {
      const fee=createMovement(db,owner,{business_id:row.fee_business_id,account_id:account.id,allow_cross_account:true,kind:"expense",amount_cents:Math.abs(row.amount_cents),day:bank.day,category:row.tax?"IVA de comisión bancaria":"Comisión bancaria",counterparty:account.bank,description:row.description,reference:row.reference,payment_method:"transfer"});
      db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(fee.id);
      reconcile(db,owner,{movement_id:fee.id,bank_transaction_id:id,amount_cents:fee.amount_cents});
    }
  }
  const after=recordedAccountBalance(db,account);
  if(after!==image.expected_after_cents) throw new Error("Statement running balance does not reconcile");
  db.prepare("UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?").run(after,image.observed_at,account.id);
  audit(db,"system:authorized-bank-review","bank.statement_image_reconciled","account",account.id,{balance_cents:before},{balance_cents:after,source_hash:image.source_hash,observed_at:image.observed_at,bank_transaction_ids:ids,linked_movements:linked});
  return {rows:ids.length,linked,balance_cents:after};
  })();
}
