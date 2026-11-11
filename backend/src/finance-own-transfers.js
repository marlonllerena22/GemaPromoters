import crypto from 'node:crypto';
import {audit,financeDay} from './finance-db.js';
import {importBank,fail} from './finance-service.js';
import {privateSetting} from './finance-operations.js';

const words=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]{3,}/g)||[];
function ownSender(db,value){
  const owner=words(privateSetting(db,'own_account_registry')?.owner_name);
  const sender=words(value);
  return owner.length>=3&&sender.length>=2&&sender.every(w=>owner.includes(w));
}

export function matchOwnTransferCredit(db,row,source) {
  if(row.amount_cents<=0)return null;
  if(String(row.external_id||'').startsWith('own-transfer:'))return null;
  const alias=db.prepare(`SELECT t.* FROM finance_own_transfer_evidence e JOIN finance_own_transfers t ON t.id=e.transfer_id
    WHERE e.source_system=? AND e.external_id=? AND e.account_id=?`).get(source,row.external_id||'',row.account_id);
  if(alias){
    if(alias.amount_cents!==row.amount_cents)fail('El aviso reenviado cambió de importe',409);
    return db.prepare('SELECT * FROM finance_bank_transactions WHERE id=?').get(alias.destination_bank_id);
  }
  const candidates=db.prepare(`SELECT t.* FROM finance_own_transfers t WHERE t.destination_account_id=? AND t.amount_cents=?
    AND t.destination_bank_id IS NOT NULL AND date(t.started_at,'-5 hours') BETWEEN date(?,'-1 day') AND date(?,'+1 day')`).all(row.account_id,row.amount_cents,row.day,row.day);
  if(!candidates.length)return null;
  const referenceAliases=new Set(row.reference?db.prepare('SELECT transfer_id FROM finance_own_transfer_evidence WHERE account_id=? AND reference=?').all(row.account_id,row.reference).map(e=>e.transfer_id):[]);
  const exact=candidates.filter(t=>row.reference&&(row.reference===t.reference||referenceAliases.has(t.id)));
  const matches=exact.length?exact:candidates.filter(t=>(t.state==='origin_confirmed'||!db.prepare('SELECT 1 FROM finance_own_transfer_evidence WHERE transfer_id=? AND source_system=?').get(t.id,source))&&((row.origin_account_id===t.origin_account_id) || (ownSender(db,row.counterparty)&&Number.isFinite(Date.parse(row.occurred_at))&&Math.abs(Date.parse(row.occurred_at)-Date.parse(t.started_at))<=48*3600000)));
  if(matches.length!==1){
    // Do not add a second credit while a known own transfer may explain it.
    if(candidates.some(t=>t.state==='origin_confirmed')||ownSender(db,row.counterparty))fail('Este abono puede corresponder a un traslado propio ya registrado. Esperando una referencia o remitente coincidente',409);
    return null;
  }
  const transfer=matches[0];
  if(row.external_id)db.prepare('INSERT OR IGNORE INTO finance_own_transfer_evidence VALUES (?,?,?,?,?,?)').run(source,row.external_id,transfer.id,row.account_id,row.reference||'',new Date().toISOString());
  db.prepare("UPDATE finance_own_transfers SET state='destination_confirmed' WHERE id=?").run(transfer.id);
  audit(db,'system:bank-mail','transfer.destination_corrobated','own_transfer',transfer.id,null,{source,reference:row.reference||'',bank_transaction_id:transfer.destination_bank_id});
  return db.prepare('SELECT * FROM finance_bank_transactions WHERE id=?').get(transfer.destination_bank_id);
}

export function postOwnTransferDestination(db,p,originBankId) {
  if(p.event!=='internal_transfer'||!p.origin_account_id||!p.destination_account_id||p.origin_account_id===p.destination_account_id||!p.reference)return null;
  if(p.account_id!==p.origin_account_id)return null;
  const registry=privateSetting(db,'own_account_registry')?.accounts||[];
  if(!registry.some(a=>a.account_id===p.origin_account_id)||!registry.some(a=>a.account_id===p.destination_account_id))return null;
  const previous=db.prepare('SELECT * FROM finance_own_transfers WHERE origin_bank_id=?').get(originBankId);
  if(previous?.destination_bank_id)return previous;
  const at=p.occurred_at||p.received_at,day=financeDay(at);
  const id=previous?.id||crypto.createHash('sha256').update(JSON.stringify([p.origin_account_id,p.destination_account_id,p.reference,p.amount_cents])).digest('hex');
  db.prepare("INSERT OR IGNORE INTO finance_own_transfers(id,origin_account_id,destination_account_id,amount_cents,reference,started_at,origin_bank_id,source_mail_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id,p.origin_account_id,p.destination_account_id,p.amount_cents,p.reference,at,originBankId,p.id,new Date().toISOString());
  const owner={role:'owner',username:'system:own-transfer',business_ids:['producalza','marjorie','gemashow','personal'],unit_ids:[]};
  const receiver=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1 AND kind='bank'").get(p.destination_account_id);
  if(!receiver)return null;
  const already=db.prepare("SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND reference=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day')").all(receiver.id,p.amount_cents,p.reference,day,day);
  if(already.length>1)fail('Hay varios abonos con la referencia del traslado propio',409);
  const imported=already.length?{transaction_ids:[already[0].id]}:importBank(db,owner,{source_system:'bank-email',account_id:receiver.id,rows:[{day,occurred_at:at,amount_cents:p.amount_cents,reference:p.reference,description:`Traslado propio desde ${p.bank} · cuenta ${p.origin_suffix}`,external_id:`own-transfer:${id}:destination`,counterparty:privateSetting(db,'own_account_registry')?.owner_name||''}]});
  db.prepare('UPDATE finance_own_transfers SET destination_bank_id=? WHERE id=?').run(imported.transaction_ids[0],id);
  audit(db,owner.username,'transfer.own_posted','own_transfer',id,null,{origin_account_id:p.origin_account_id,destination_account_id:p.destination_account_id,amount_cents:p.amount_cents,origin_bank_id:originBankId,destination_bank_id:imported.transaction_ids[0],confirmation_source:'origin-bank-notice'});
  console.info('[finance] Own transfer posted '+JSON.stringify({id,from:p.origin_account_id,to:p.destination_account_id,amount_cents:p.amount_cents,origin_bank_id:originBankId,destination_bank_id:imported.transaction_ids[0]}));
  return db.prepare('SELECT * FROM finance_own_transfers WHERE id=?').get(id);
}
