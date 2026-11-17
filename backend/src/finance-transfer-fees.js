import crypto from 'node:crypto';
import {transferFeeQuote,transferBankKey} from '../../shared/finance-fees.mjs';
import {audit} from './finance-db.js';
import {createMovement,reconcile,fail} from './finance-service.js';
import {decryptDocument} from './finance-ai.js';

export function requestDestinationBank(db,request,payment,analysis){
 const row=db.prepare('SELECT encrypted FROM finance_request_payees WHERE request_id=?').get(request.id);
 const payee=row?JSON.parse(decryptDocument(row.encrypted).toString()):null;
 const selected=payee?.accounts?.[payment.destination_index]?.bank;
 const detected=analysis?.receiving_bank;
 if(selected&&detected&&transferBankKey(selected)!==transferBankKey(detected))return null;
 return detected||selected||null;
}

// One separate expense per principal debit; retries and later bank evidence reuse it.
export function applyTransferFee(db,user,parentId,{destination_bank,explicit_cents=null,business_id=null,unit_id=null}={}){
 const parent=db.prepare('SELECT b.*,a.bank,a.kind FROM finance_bank_transactions b JOIN finance_accounts a ON a.id=b.account_id WHERE b.id=?').get(parentId);
 if(!parent||parent.amount_cents>=0||!['bank','wallet'].includes(parent.kind))return null;
 const from=transferBankKey(parent.bank),to=transferBankKey(destination_bank);
 if(!from||!to||to==='otro'||from===to)return {amount_cents:0,estimated:false};
 const explicit=Number.isSafeInteger(explicit_cents)&&explicit_cents>=0&&explicit_cents<=100000;
 const quote=transferFeeQuote(parent.bank,destination_bank),amount=explicit?explicit_cents:quote.cents;
 if(amount===null)return null;
 return db.transaction(()=>{
  const previous=db.prepare('SELECT * FROM finance_transfer_fees WHERE principal_bank_id=?').get(parentId);
  if(previous){
   if(explicit&&previous.estimated){
    // Preserve the original timestamp so a later verification cannot cross a balance checkpoint.
    if(previous.bank_transaction_id){
     if(amount)db.prepare('UPDATE finance_bank_transactions SET amount_cents=?,description=? WHERE id=?').run(-amount,'Comisión interbancaria con IVA · confirmada por el banco',previous.bank_transaction_id);
     else{
      const key='transfer-fee-waiver:'+parentId;
      db.prepare('INSERT OR IGNORE INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by,import_source,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(parent.account_id,parent.day,previous.amount_cents,parent.reference+'-FEE-WAIVER','Exoneración de comisión confirmada',crypto.createHash('sha256').update(key).digest('hex'),key,user.username,'transfer-fee',parent.occurred_at);
     }
     const allocations=db.prepare('SELECT * FROM finance_allocations WHERE bank_transaction_id=?').all(previous.bank_transaction_id);
     for(const a of allocations){
      if(amount){db.prepare('UPDATE finance_movements SET amount_cents=? WHERE id=?').run(amount,a.movement_id);db.prepare('UPDATE finance_allocations SET amount_cents=? WHERE id=?').run(amount,a.id);}
      else{db.prepare('DELETE FROM finance_allocations WHERE id=?').run(a.id);db.prepare("UPDATE finance_movements SET status='rejected',review_note='Comisión exonerada por el banco' WHERE id=?").run(a.movement_id);}
     }
    }
    db.prepare('UPDATE finance_transfer_fees SET amount_cents=?,estimated=0 WHERE principal_bank_id=?').run(amount,parentId);
    audit(db,user.username,'transfer.fee_verified','bank_transaction',parentId,previous,{amount_cents:amount});
   }
   return db.prepare('SELECT * FROM finance_transfer_fees WHERE principal_bank_id=?').get(parentId);
  }
  let bankId=null;
  if(amount){
   const reference=parent.reference?parent.reference+'-FEE':'';
   const existing=reference?db.prepare('SELECT * FROM finance_bank_transactions WHERE account_id=? AND reference=? AND day=? AND amount_cents=?').all(parent.account_id,reference,parent.day,-amount):[];
   if(existing.length>1)fail('Hay varias comisiones con la misma referencia',409);
   if(existing.length)bankId=existing[0].id;
   else{
    const key='transfer-fee:'+parentId;
    bankId=Number(db.prepare("INSERT INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by,import_source,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(parent.account_id,parent.day,-amount,reference,`Comisión interbancaria con IVA · ${explicit?'confirmada':'calculada'}`,crypto.createHash('sha256').update(key).digest('hex'),key,user.username,'transfer-fee',parent.occurred_at).lastInsertRowid);
   }
   if(business_id&&!db.prepare('SELECT 1 FROM finance_allocations WHERE bank_transaction_id=?').get(bankId)){
    const m=createMovement(db,user,{business_id,unit_id,kind:'expense',amount_cents:amount,day:parent.day,category:'Comisiones bancarias',counterparty:parent.bank,description:`Comisión con IVA del traslado ${parent.reference||parentId}${explicit?'':' · calculada'}`,account_id:parent.account_id,allow_cross_account:true,reference,payment_method:'transfer'});
    db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(m.id);
    reconcile(db,user,{movement_id:m.id,bank_transaction_id:bankId,amount_cents:amount});
   }
  }
  db.prepare('INSERT INTO finance_transfer_fees VALUES (?,?,?,?,?,?,?)').run(parentId,bankId,amount,explicit?0:1,destination_bank,quote.source||'comprobante',new Date().toISOString());
  audit(db,user.username,'transfer.fee_recorded','bank_transaction',parentId,null,{amount_cents:amount,estimated:!explicit,destination_bank,bank_transaction_id:bankId},business_id);
  return db.prepare('SELECT * FROM finance_transfer_fees WHERE principal_bank_id=?').get(parentId);
 })();
}

// A statement can show the same 41-cent charge as 36 cents + 5 cents IVA.
// Keep one ledger expense and attach those bank lines as corroborating evidence.
export function matchTransferFeeEvidence(db,row,source){
 if(row.amount_cents>=0||source==='assistant')return null;
 const desc=String(row.description||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const ref=String(row.reference||''),component=/iva/.test(desc)?'tax':/comision/.test(desc)&&! /con iva/.test(desc)?'base':'total';
 if(!/comision|iva cobrado/.test(desc)&&!/-FEE$/.test(ref))return null;
 const candidates=db.prepare('SELECT f.*,b.reference,p.reference parent_reference,p.occurred_at parent_time FROM finance_transfer_fees f JOIN finance_bank_transactions b ON b.id=f.bank_transaction_id JOIN finance_bank_transactions p ON p.id=f.principal_bank_id WHERE b.account_id=? AND b.day=? AND f.amount_cents>0').all(row.account_id,row.day).filter(f=>{
  const value=-row.amount_cents,expected=component==='total'?f.amount_cents:component==='base'?Math.round(f.amount_cents/1.15):f.amount_cents-Math.round(f.amount_cents/1.15);
  if(value!==expected)return false;
  if(ref&&(ref===f.reference||ref===f.parent_reference))return true;
  return row.occurred_at&&f.parent_time&&Math.abs(Date.parse(row.occurred_at)-Date.parse(f.parent_time))<=120000;
 });
 if(candidates.length>1)fail('Hay varias comisiones posibles; falta la referencia del traslado',409);
 if(!candidates.length)return null;
 const fee=candidates[0],identity=source+':'+(row.external_id||JSON.stringify([row.day,ref,row.amount_cents,desc]));
 db.prepare('INSERT OR IGNORE INTO finance_transfer_fee_evidence VALUES (?,?,?,?)').run(fee.principal_bank_id,identity,component,-row.amount_cents);
 const parts=db.prepare('SELECT DISTINCT component FROM finance_transfer_fee_evidence WHERE fee_id=?').all(fee.principal_bank_id).map(x=>x.component);
 if(parts.includes('total')||(parts.includes('base')&&parts.includes('tax')))db.prepare('UPDATE finance_transfer_fees SET estimated=0 WHERE principal_bank_id=?').run(fee.principal_bank_id);
 return db.prepare('SELECT * FROM finance_bank_transactions WHERE id=?').get(fee.bank_transaction_id);
}
