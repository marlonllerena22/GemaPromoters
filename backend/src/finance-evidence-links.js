import {decryptDocument} from './finance-ai.js';
import {audit,financeDay} from './finance-db.js';
import {matchOwnTransferCredit} from './finance-own-transfers.js';
import {matchingBankPerson} from './finance-bank-identity.js';

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
      if(!bank&&p.amount_cents){
        const signed=p.amount_cents*(p.direction==='outgoing'?-1:1);
        const candidates=db.prepare(`SELECT b.*,m.encrypted mail_payload FROM finance_mail_messages m JOIN finance_bank_transactions b ON b.id=m.bank_transaction_id
          WHERE m.state='applied' AND m.archived_at IS NULL AND b.amount_cents=? AND (? IS NULL OR b.account_id=?)
          AND NOT EXISTS(SELECT 1 FROM finance_notification_events n WHERE n.id!=? AND n.device_id=? AND n.package_name=? AND n.bank_transaction_id=b.id AND n.state IN ('matched','applied'))`).all(signed,row.account_id,row.account_id,row.id,row.device_id,row.package_name).filter(candidate=>{
          const mail=JSON.parse(decryptDocument(candidate.mail_payload).toString());
          if(!mail.trusted||mail.bank!==row.bank)return false;
          if(row.reference&&mail.reference&&row.reference!==mail.reference)return false;
          const difference=Math.abs(Date.parse(mail.occurred_at||mail.received_at)-Date.parse(row.posted_at));
          if(matchingBankPerson(p.counterparty,mail.counterparty))return difference<=5*60000;
          return p.direction==='outgoing'&&!p.counterparty&&!p.destination_suffix&&difference<=2*60000;
        });
        const unique=[...new Map(candidates.map(c=>[c.id,c])).values()];
        if(unique.length===1)bank=unique[0];
      }
      if(!bank&&p.direction==='outgoing'&&p.destination_suffix?.length>=4){
        const candidates=db.prepare("SELECT b.*,m.encrypted mail_payload FROM finance_mail_messages m JOIN finance_bank_transactions b ON b.id=m.bank_transaction_id WHERE m.state='applied' AND m.archived_at IS NULL AND b.amount_cents=?").all(-p.amount_cents).filter(m=>{
          const mail=JSON.parse(decryptDocument(m.mail_payload).toString());
          return mail.trusted&&mail.bank===row.bank&&mail.destination_suffix===p.destination_suffix&&Math.abs(Date.parse(mail.occurred_at||mail.received_at)-Date.parse(row.posted_at))<=5*60000;
        });
        const unique=[...new Map(candidates.map(c=>[c.id,c])).values()];
        if(unique.length===1)bank=unique[0];
      }
      if(!bank&&row.amount_cents>0){
        try{bank=matchOwnTransferCredit(db,{account_id:row.account_id,amount_cents:row.amount_cents,reference:row.reference,day:financeDay(row.posted_at),occurred_at:row.posted_at,counterparty:p.counterparty,external_id:`android:${row.device_id}:${row.event_key}`},'bank-notification');}
        catch(error){if(!error.status)throw error;}
      }
      if(!bank)continue;
      db.prepare("UPDATE finance_notification_events SET state='matched',bank_transaction_id=?,account_id=?,amount_cents=?,reason='Confirmado con el movimiento bancario; sin duplicar el importe' WHERE id=?").run(bank.id,bank.account_id,bank.amount_cents,row.id);
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
