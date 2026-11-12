import {fail} from './finance-service.js';
import {decryptDocument} from './finance-ai.js';
import {parseBankMail} from './finance-gmail.js';
import {privateSetting} from './finance-operations.js';
import {audit} from './finance-db.js';

export function enrichServiceProof(db,evidence,analysis){
  const service=/pago de servicio|iess|biess|less/i.test(analysis.description||'');
  const ruc=/^\d{13}$/.test(analysis.service_ruc||'')?analysis.service_ruc:service&&/^\d{13}$/.test(analysis.reference||'')?analysis.reference:null;
  if(!service||!ruc||!analysis.day||!Number.isSafeInteger(analysis.amount_cents))return analysis;
  const registry=privateSetting(db,'own_account_registry')||{accounts:[]};
  const matches=[];
  for(const row of db.prepare("SELECT encrypted FROM finance_mail_messages WHERE received_at>=? AND received_at<? AND state NOT IN ('failed','historical')").all(analysis.day+'T05:00:00Z',new Date(Date.parse(analysis.day+'T05:00:00Z')+86400000).toISOString())){
    const saved=JSON.parse(decryptDocument(row.encrypted).toString());if(!saved.trusted)continue;
    const p=parseBankMail({id:saved.id,internalDate:String(Date.parse(saved.received_at)),payload:{headers:[{name:'From',value:saved.from},{name:'Subject',value:saved.subject}],body:{content:saved.body}}},registry);
    if(p&&!p.rejected&&!p.pending&&p.service_ruc===ruc&&p.amount_cents===analysis.amount_cents&&p.operation_day===analysis.day&&p.account_id&&p.reference)matches.push(p);
  }
  const unique=[...new Map(matches.map(p=>[`${p.account_id}:${p.reference}`,p])).values()];
  if(unique.length===1){const p=unique[0];return {...analysis,service_ruc:ruc,reference:p.reference,reference_source:'bank_email',origin_bank:p.bank,origin_account_suffix:p.origin_suffix,destination_account_suffix:null};}
  // The service code is never passed off as a bank operation number.
  return {...analysis,service_ruc:ruc,...(!analysis.reference||analysis.reference===ruc?{reference:`IESS-DOC-${evidence.id}`,reference_source:'internal'}:{})};
}

// Corroborate a previously declared IESS payment even if the phone receipt only
// showed the service RUC. Never match amount alone or two competing payments.
export function declaredIessBank(db,p,accountId,day){
  if(!p.trusted||p.pending||p.rejected||!p.service_ruc||!p.reference)return null;
  const candidates=db.prepare("SELECT b.*,i.encrypted,p.id payment_id,p.movement_id,p.reference payment_reference,e.analysis FROM finance_payments p JOIN finance_iess_requests i ON i.request_id=p.request_id JOIN finance_evidence e ON e.id=p.evidence_id JOIN finance_allocations a ON a.movement_id=p.movement_id JOIN finance_bank_transactions b ON b.id=a.bank_transaction_id WHERE p.voided_at IS NULL AND p.account_id=? AND p.amount_cents=? AND p.paid_day=? AND a.amount_cents=p.amount_cents AND b.amount_cents=-p.amount_cents AND b.account_id=p.account_id AND b.import_source='assistant'").all(accountId,p.amount_cents,day).filter(c=>JSON.parse(decryptDocument(c.encrypted).toString()).ruc===p.service_ruc&&JSON.parse(c.analysis||'null')?.amount_cents===p.amount_cents);
  if(candidates.length>1)fail('Hay varios pagos IESS declarados con estos datos. Revisa la asociación para no descontar dos veces',409);
  if(candidates.length!==1)return null;
  const candidate=candidates[0];
  db.prepare('UPDATE finance_payments SET reference=? WHERE id=?').run(p.reference,candidate.payment_id);
  db.prepare('UPDATE finance_movements SET reference=? WHERE id=?').run(p.reference,candidate.movement_id);
  audit(db,'system:iess','iess.reference_corroborated','payment',candidate.payment_id,{reference:candidate.payment_reference},{reference:p.reference,mail_id:p.id});
  return candidate;
}
