import {decryptDocument} from './finance-ai.js';
import {audit,financeDay} from './finance-db.js';
import {matchOwnTransferCredit} from './finance-own-transfers.js';

// Attach corroborating evidence to the existing ledger entry, without moving money.
export function linkRecordedBankEvidence(db) {
  let notifications=0,mail=0;
  const find=(account,amount,reference,day)=>{
    if(!account||!amount||!reference)return null;
    const rows=db.prepare("SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND reference=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day')").all(account,amount,reference,day,day);
    return rows.length===1?rows[0]:null;
  };
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get()){
    for(const row of db.prepare("SELECT * FROM finance_notification_events WHERE state='review' AND archived_at IS NULL").all()){
      const p=JSON.parse(decryptDocument(row.encrypted).toString());
      if(p.blocked||p.credit||!p.direction)continue;
      let bank=find(row.account_id,row.amount_cents,row.reference,financeDay(row.posted_at));
      if(!bank&&row.amount_cents>0){
        try{bank=matchOwnTransferCredit(db,{account_id:row.account_id,amount_cents:row.amount_cents,reference:row.reference,day:financeDay(row.posted_at),occurred_at:row.posted_at,counterparty:p.counterparty,external_id:`android:${row.device_id}:${row.event_key}`},'bank-notification');}
        catch(error){if(!error.status)throw error;}
      }
      if(!bank)continue;
      db.prepare("UPDATE finance_notification_events SET state='matched',bank_transaction_id=?,reason='Confirmado con el movimiento bancario; sin duplicar el importe' WHERE id=?").run(bank.id,row.id);
      audit(db,'system:bank-evidence','bank.evidence_linked','notification',row.id,null,{bank_transaction_id:bank.id});
      notifications++;
    }
  }
  for(const row of db.prepare("SELECT * FROM finance_mail_messages WHERE state='pending' AND archived_at IS NULL").all()){
    const p=JSON.parse(decryptDocument(row.encrypted).toString());
    if(!p.trusted||p.rejected)continue;
    const direction=p.origin_account_id===p.account_id?'outgoing':p.destination_account_id===p.account_id?'incoming':null;
    if(!direction)continue;
    const bank=find(p.account_id,p.amount_cents*(direction==='outgoing'?-1:1),p.reference,p.operation_day||financeDay(p.received_at));
    if(!bank)continue;
    db.prepare("UPDATE finance_mail_messages SET state='applied',bank_transaction_id=?,account_id=? WHERE id=?").run(bank.id,bank.account_id,row.id);
    audit(db,'system:bank-evidence','bank.evidence_linked','mail',row.id,null,{bank_transaction_id:bank.id});
    mail++;
  }
  return {notifications,mail};
}
