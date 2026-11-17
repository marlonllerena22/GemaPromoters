import {audit,financeDay} from './finance-db.js';
import {fail,importBank,reconcile} from './finance-service.js';
import {recordedAccountBalance} from './finance-check-ledger.js';
import {bankPartyConflicts} from './finance-bank-evidence-person.js';
import {applyTransferFee,requestDestinationBank} from './finance-transfer-fees.js';
import {postOwnTransferFromProof} from './finance-own-transfers.js';

// Called inside the payment transaction, after the owner's confirmation and proof validation.
// One bank debit is shared by the proof, mail and Android notification.
export function settleRequestProof(db,user,request,payment){
 if(user.role!=='owner')fail('Solo el propietario confirma pagos realizados',403);
 const account=db.prepare('SELECT * FROM finance_accounts WHERE id=? AND active=1').get(payment.account_id);
 if(!account)fail('Cuenta de origen no disponible');
 if(account.kind==='card')return {state:'card',account_id:account.id,balance_delta_cents:0};
 if(!['bank','wallet'].includes(account.kind))fail('Cuenta de origen no válida');
 const before=recordedAccountBalance(db,account);
 const proof=db.prepare('SELECT analysis FROM finance_evidence WHERE id=?').get(payment.evidence_id);
 let analysis;try{analysis=JSON.parse(proof?.analysis||'null');}catch{}
 const linked=db.prepare('SELECT a.bank_transaction_id,a.amount_cents,b.account_id,b.amount_cents bank_amount FROM finance_allocations a JOIN finance_bank_transactions b ON b.id=a.bank_transaction_id WHERE a.movement_id=?').all(payment.movement_id);
 if(linked.length){
  if(linked.length!==1||linked[0].account_id!==account.id||linked[0].amount_cents!==payment.amount_cents||linked[0].bank_amount!==-payment.amount_cents)fail('El pago tiene una asociación bancaria diferente',409);
  const extra=finishTransfer(db,user,request,payment,analysis,linked[0].bank_transaction_id);
  return {state:'matched',account_id:account.id,bank_transaction_id:linked[0].bank_transaction_id,...extra,balance_delta_cents:recordedAccountBalance(db,account)-before};
 }
 const matches=db.prepare("SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND reference=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day')").all(account.id,-payment.amount_cents,payment.reference,payment.paid_day,payment.paid_day);
 if(matches.length>1)fail('Hay más de un débito con estos datos. Revisa antes de registrar otro',409);
 // Use the original declaration time, never the retry/repair time. This preserves balance checkpoints.
 const declaredAt=payment.created_at&&financeDay(payment.created_at)===payment.paid_day?payment.created_at:null;
 const bank=matches[0];
 if(bank&&bankPartyConflicts(db,bank.id,analysis?.counterparty))fail('El beneficiario del comprobante no coincide con el aviso del banco',409);
 const imported=bank?null:importBank(db,user,{account_id:account.id,source_system:'assistant',rows:[{day:payment.paid_day,occurred_at:declaredAt,amount_cents:-payment.amount_cents,reference:payment.reference,counterparty:analysis?.counterparty||request.counterparty,description:`Pago de solicitud #${request.id} confirmado por propietario`,external_id:`request-payment:${payment.id}`}]});
 const bankId=bank?.id||imported.transaction_ids[0];
 const allocated=db.prepare('SELECT m.*,a.id allocation_id,a.amount_cents allocated FROM finance_allocations a JOIN finance_movements m ON m.id=a.movement_id WHERE a.bank_transaction_id=?').all(bankId);
 if(allocated.length){
  const old=allocated[0];
  if(allocated.length!==1||old.source_system!=='bank-email'||old.evidence_id||old.kind!=='expense'||old.amount_cents!==payment.amount_cents||old.allocated!==payment.amount_cents||db.prepare('SELECT 1 FROM finance_payments WHERE movement_id=? AND voided_at IS NULL').get(old.id)||db.prepare('SELECT 1 FROM finance_iess_requests WHERE bank_transaction_id=?').get(bankId))fail('Este débito ya respalda otro pago. No se descontó otra vez',409);
  db.prepare('DELETE FROM finance_allocations WHERE id=?').run(old.allocation_id);
  db.prepare("UPDATE finance_movements SET status='rejected',review_note=? WHERE id=?").run('Asociado al pago de solicitud #'+request.id,old.id);
  audit(db,user.username,'payment.proof_associated','movement',old.id,{allocation_id:old.allocation_id},{canonical_movement_id:payment.movement_id,request_id:request.id},request.business_id);
 }
 reconcile(db,user,{movement_id:payment.movement_id,bank_transaction_id:bankId,amount_cents:payment.amount_cents});
 const delta=recordedAccountBalance(db,account)-before;
 const extra=finishTransfer(db,user,request,payment,analysis,bankId);
 const result={state:bank||imported?.duplicates?'matched':delta===0?'included':'debited',account_id:account.id,bank_transaction_id:bankId,balance_delta_cents:recordedAccountBalance(db,account)-before,...extra};
 audit(db,user.username,'payment.bank_settled','payment',payment.id,null,result,request.business_id);
 return result;
}
function finishTransfer(db,user,request,payment,analysis,bankId){
 const destinationBank=requestDestinationBank(db,request,payment,analysis);
 const ownTransfer=postOwnTransferFromProof(db,{...analysis,receiving_bank:destinationBank},bankId,payment);
 if(ownTransfer)db.prepare("UPDATE finance_movements SET kind='transfer',transfer_side='outgoing',transfer_group=? WHERE id=?").run(ownTransfer.id,payment.movement_id);
 const fee=applyTransferFee(db,user,bankId,{destination_bank:destinationBank,explicit_cents:analysis?.fee_total_cents,business_id:request.business_id,unit_id:request.unit_id});
 return {fee,own_transfer:ownTransfer||null};
}
