import {financeDay} from './finance-db.js';
import {importBank,reconcile,fail} from './finance-service.js';
import {applyTransferFee} from './finance-transfer-fees.js';

export function settleManualTransfer(db,user,{group,from,to,amount_cents,day,reference='',movement_ids,explicit_fee_cents=null}){
 const at=day===financeDay()?new Date().toISOString():day+'T17:00:00.000Z';
 const bankIds={};
 for(const id of movement_ids){
  const m=db.prepare('SELECT * FROM finance_movements WHERE id=?').get(id),account=m.transfer_side==='outgoing'?from:to;
  if(!['bank','wallet'].includes(account.kind))continue;
  const amount=m.transfer_side==='outgoing'?-amount_cents:amount_cents;
  const matches=reference?db.prepare('SELECT * FROM finance_bank_transactions WHERE account_id=? AND reference=? AND amount_cents=? AND day=?').all(account.id,reference,amount,day):[];
  if(matches.length>1)fail('Hay varios movimientos para este traslado',409);
  const bankId=matches[0]?.id||importBank(db,user,{account_id:account.id,source_system:'assistant',rows:[{day,occurred_at:at,amount_cents:amount,reference,description:'Traslado propio confirmado',external_id:`manual-transfer:${group}:${m.transfer_side}`}]}).transaction_ids[0];
  db.prepare('UPDATE finance_movements SET reference=?,cross_account=1 WHERE id=?').run(reference,id);
  reconcile(db,user,{movement_id:id,bank_transaction_id:bankId,amount_cents});bankIds[m.transfer_side]=bankId;
 }
 if(bankIds.outgoing&&bankIds.incoming){
  const prior=db.prepare('SELECT * FROM finance_own_transfers WHERE origin_bank_id=?').get(bankIds.outgoing);
  if(prior&&(prior.destination_account_id!==to.id||prior.destination_bank_id!==bankIds.incoming))fail('El traslado ya tiene otro destino',409);
  db.prepare("INSERT OR IGNORE INTO finance_own_transfers(id,origin_account_id,destination_account_id,amount_cents,reference,started_at,origin_bank_id,destination_bank_id,source_mail_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(group,from.id,to.id,amount_cents,reference,at,bankIds.outgoing,bankIds.incoming,'manual:'+group,new Date().toISOString());
 }
 const fee=bankIds.outgoing&&['bank','wallet'].includes(to.kind)?applyTransferFee(db,user,bankIds.outgoing,{destination_bank:to.bank,explicit_cents:explicit_fee_cents,business_id:db.prepare('SELECT business_id FROM finance_movements WHERE id=?').get(movement_ids[0]).business_id}):null;
 return {bank_transaction_ids:bankIds,fee};
}
