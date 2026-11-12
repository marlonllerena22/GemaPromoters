import crypto from 'node:crypto';
import {decryptDocument} from './finance-ai.js';
import {parseBankMail} from './finance-gmail.js';
import {privateSetting,putPrivateSetting} from './finance-operations.js';
import {audit} from './finance-db.js';
import {recordedAccountBalance} from './finance-check-ledger.js';

// A bounded operator job, encrypted in the hosting secret store. No public route.
// Each row must still equal the reviewed snapshot and be corroborated by trusted
// bank mail and the uploaded proof before any ledger change is allowed.
export function repairIessPayments(db,job){
  if(job.kind!=='iess-payment-correction-v1'||!Array.isArray(job.entries)||job.entries.length<1||job.entries.length>10)throw new Error('Invalid IESS repair');
  const key='iess-repair:'+job.id;if(privateSetting(db,key))return {duplicate:true,...privateSetting(db,key).result};
  const registry=privateSetting(db,'own_account_registry')||{accounts:[]};
  return db.transaction(()=>{
    const prepared=job.entries.map(x=>{
      const payment=db.prepare('SELECT * FROM finance_payments WHERE id=? AND voided_at IS NULL').get(x.payment_id);
      const request=db.prepare('SELECT m.*,i.encrypted FROM finance_movements m JOIN finance_iess_requests i ON i.request_id=m.id WHERE m.id=? AND m.hidden_at IS NULL').get(x.request_id);
      const evidence=payment&&db.prepare('SELECT * FROM finance_evidence WHERE id=?').get(payment.evidence_id);
      const analysis=JSON.parse(evidence?.analysis||'null');
      const allocations=payment?db.prepare('SELECT * FROM finance_allocations WHERE movement_id=?').all(payment.movement_id):[];
      const bank=db.prepare('SELECT * FROM finance_bank_transactions WHERE id=?').get(x.bank_id);
      const mail=db.prepare('SELECT * FROM finance_mail_messages WHERE id=?').get(x.mail_id);
      const saved=mail&&JSON.parse(decryptDocument(mail.encrypted).toString());
      const parsed=saved&&parseBankMail({id:saved.id,internalDate:String(Date.parse(saved.received_at)),payload:{headers:[{name:'From',value:saved.from},{name:'Subject',value:saved.subject}],body:{content:saved.body}}},registry);
      const fields=request&&JSON.parse(decryptDocument(request.encrypted).toString());
      if(!payment||!request||!analysis||!bank||!saved?.trusted||!parsed||parsed.pending||parsed.rejected||request.status==='rejected'||payment.request_id!==x.expected_request_id||payment.amount_cents!==x.expected_amount_cents||payment.reference!==x.expected_reference||payment.evidence_id!==x.evidence_id||payment.account_id!==x.account_id||bank.account_id!==x.account_id||bank.import_source!=='assistant'||bank.amount_cents!==-x.expected_amount_cents||bank.reference!==x.expected_reference||allocations.length!==1||allocations[0].bank_transaction_id!==bank.id||allocations[0].amount_cents!==x.expected_amount_cents||analysis.amount_cents!==request.amount_cents||parsed.amount_cents!==request.amount_cents||parsed.account_id!==x.account_id||parsed.service_ruc!==fields.ruc||parsed.operation_day!==payment.paid_day||parsed.reference!==x.bank_reference||mail.bank_transaction_id)throw new Error('IESS repair snapshot or bank evidence does not match');
      if(db.prepare('SELECT 1 FROM finance_bank_transactions WHERE account_id=? AND reference=? AND id<>?').get(x.account_id,parsed.reference,bank.id))throw new Error('IESS bank debit already has another record');
      if(db.prepare('SELECT 1 FROM finance_balance_checkpoints WHERE account_id=? AND as_of_at>?').get(x.account_id,bank.created_at))throw new Error('IESS correction requires reviewing a newer balance checkpoint');
      return {x,payment,request,bank,analysis,parsed,allocation:allocations[0]};
    });
    if(new Set(prepared.map(p=>p.payment.id)).size!==prepared.length||new Set(prepared.map(p=>p.request.id)).size!==prepared.length)throw new Error('Duplicate correction targets');
    const pids=new Set(prepared.map(p=>p.payment.id));
    for(const p of prepared)if(db.prepare('SELECT id FROM finance_payments WHERE request_id=? AND voided_at IS NULL').all(p.request.id).some(r=>!pids.has(r.id)))throw new Error('Request has another payment');
    const accountIds=[...new Set(prepared.map(p=>p.bank.account_id))],balances=()=>accountIds.map(id=>{const a=db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(id);return {account_id:id,balance_cents:recordedAccountBalance(db,a)};});
    const before=balances();
    for(const {x,payment,request,bank,analysis,parsed,allocation} of prepared){
      const next={id:request.id,amount_cents:request.amount_cents,evidence_id:payment.evidence_id,account_id:payment.account_id,paid_day:payment.paid_day,reference:parsed.reference,destination_index:payment.destination_index};
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify(next)).digest('hex');
      db.prepare('UPDATE finance_payments SET request_id=?,amount_cents=?,reference=?,fingerprint=? WHERE id=?').run(request.id,request.amount_cents,parsed.reference,fingerprint,payment.id);
      db.prepare("UPDATE finance_movements SET amount_cents=?,description=?,counterparty=?,business_id=?,unit_id=?,space_id=?,reference=?,status='reconciled' WHERE id=?").run(request.amount_cents,`Pago de solicitud #${request.id}: ${request.description}`,request.counterparty,request.business_id,request.unit_id,request.space_id,parsed.reference,payment.movement_id);
      db.prepare('UPDATE finance_bank_transactions SET amount_cents=?,reference=? WHERE id=?').run(-request.amount_cents,parsed.reference,bank.id);
      db.prepare('UPDATE finance_allocations SET amount_cents=? WHERE id=?').run(request.amount_cents,allocation.id);
      db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({...analysis,reference:parsed.reference,service_ruc:parsed.service_ruc,reference_source:'bank_email',origin_bank:parsed.bank,origin_account_suffix:parsed.origin_suffix,destination_account_suffix:null}),payment.evidence_id);
      db.prepare("UPDATE finance_movements SET status='reported',updated_at=? WHERE id=?").run(new Date().toISOString(),request.id);
      audit(db,'operator:authorized-iess-correction','iess.payment_corrected','payment',payment.id,{request_id:payment.request_id,amount_cents:payment.amount_cents,reference:payment.reference,bank_amount_cents:bank.amount_cents},{request_id:request.id,amount_cents:request.amount_cents,reference:parsed.reference,bank_transaction_id:bank.id,mail_id:x.mail_id},request.business_id);
    }
    const result={corrected:prepared.length,before,after:balances()};
    putPrivateSetting(db,key,{completed_at:new Date().toISOString(),before:prepared.map(({x,payment,bank,allocation})=>({x,payment,bank,allocation})),result});
    return result;
  })();
}
export function applyPrivateIessRepair(db,payload=process.env.FINANCE_IESS_REPAIR_JOB){
  if(!payload)return null;
  try{
    const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString());
    if(!/^[a-f0-9-]{36}$/.test(job.id)||!Number.isFinite(Date.parse(job.expires_at))||Date.parse(job.expires_at)<Date.now()||Date.parse(job.expires_at)>Date.now()+2*3600000)throw new Error('Expired repair');
    const result=repairIessPayments(db,job);console.info('[finance] IESS correction '+JSON.stringify({job_id:job.id,corrected:result.corrected,duplicate:Boolean(result.duplicate)}));return result;
  }catch(e){console.error('[finance] IESS correction stopped: '+e.message);return {failed:true};}
}
