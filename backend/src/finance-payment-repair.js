import {audit,financeDay,safeMember} from './finance-db.js';
import {encryptDocument,decryptDocument} from './finance-ai.js';
import {privateSetting,putPrivateSetting} from './finance-operations.js';
import {settleRequestProof} from './finance-payment-ledger.js';

export function repairRequestPayments(db,job){
 if(job.kind!=='request-payment-debits-v1'||!/^[a-f0-9-]{36}$/.test(job.id)||job.day!==financeDay()||!Number.isFinite(Date.parse(job.expires_at))||Date.parse(job.expires_at)<=Date.now()||Date.parse(job.expires_at)>Date.now()+2*3600000||!Array.isArray(job.entries)||!job.entries.length||job.entries.length>10)throw new Error('Invalid payment repair');
 const owner=db.prepare("SELECT * FROM finance_members WHERE username=? AND role='owner' AND active=1").get(job.owner);if(!owner)throw new Error('Owner required');
 const key='request-payment-repair:'+job.id,previous=privateSetting(db,key);if(previous)return previous;
 return db.transaction(()=>{
  const results=job.entries.map(entry=>{
   const payment=db.prepare('SELECT * FROM finance_payments WHERE id=? AND voided_at IS NULL').get(entry.id);
   if(!payment||payment.created_by!==owner.username||payment.paid_day!==job.day||payment.amount_cents!==entry.amount_cents||payment.account_id!==entry.account_id||payment.reference!==entry.reference)throw new Error('Payment does not match authorized repair');
   const request=db.prepare('SELECT * FROM finance_movements WHERE id=? AND is_payment_request=1').get(payment.request_id);
   const movement=db.prepare('SELECT * FROM finance_movements WHERE id=?').get(payment.movement_id);
   const analysis=JSON.parse(db.prepare('SELECT analysis FROM finance_evidence WHERE id=?').get(payment.evidence_id)?.analysis||'null');
   if(!request||request.amount_cents!==payment.amount_cents||!movement||!['reported','reconciled'].includes(movement.status)||analysis?.amount_cents!==payment.amount_cents||movement.account_id!==payment.account_id)throw new Error('Proof or movement needs review');
   const ledger=settleRequestProof(db,safeMember(owner),request,payment);
   if(ledger.balance_delta_cents!==entry.expected_balance_delta_cents)throw new Error('Balance changed; review before repair');
   audit(db,owner.username,'payment.debit_repaired','payment',payment.id,null,{job_id:job.id,...ledger},request.business_id);
   return {payment_id:payment.id,...ledger};
  });
  const result={job_id:job.id,results};putPrivateSetting(db,key,result);return result;
 })();
}
export function applyPrivatePaymentRepair(db,payload=process.env.FINANCE_PAYMENT_REPAIR_JOB){
 if(!payload)return null;
 try{const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString());const result=repairRequestPayments(db,job);console.info('[finance] Private payment repair '+job.id+'|'+encryptDocument(Buffer.from(JSON.stringify(result))).toString('base64'));return {completed:true};}
 catch{console.warn('[finance] Payment repair rejected or expired');return {completed:false};}
}
