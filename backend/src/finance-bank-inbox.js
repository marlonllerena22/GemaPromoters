import {decryptDocument} from './finance-ai.js';
import {audit} from './finance-db.js';
import {fail} from './finance-service.js';
import {isBankPromotion} from '../../shared/finance-bank-promotions.mjs';

const tables={android:'finance_notification_events',mail:'finance_mail_messages'};
export function archiveBankNotice(db,user,source,id){
  if(user.role!=='owner')fail('Solo Marlon puede quitar avisos bancarios',403);
  const table=tables[source];if(!table)fail('Tipo de aviso inválido');
  return db.transaction(()=>{
    const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);if(!row)fail('Aviso no encontrado',404);
    if(row.archived_at||row.inbox_hidden_at)return {ok:true,already_archived:true};
    const at=new Date().toISOString();
    if(source==='android')db.prepare("UPDATE finance_notification_events SET archived_at=?,state=CASE WHEN state='review' THEN 'dismissed' ELSE state END,reason='Quitado de la bandeja por el propietario' WHERE id=?").run(at,id);
    else if(row.bank_transaction_id||row.movement_id||['applied','statement'].includes(row.state))db.prepare('UPDATE finance_mail_messages SET inbox_hidden_at=? WHERE id=?').run(at,id);
    else db.prepare('UPDATE finance_mail_messages SET archived_at=?,inbox_hidden_at=? WHERE id=?').run(at,at,id);
    audit(db,user.username,'bank_notice.archived',source,id,{state:row.state},{archived_at:at,bank_transaction_id:row.bank_transaction_id||null,financial_records_unchanged:true});
    return {ok:true,financial_records_unchanged:true};
  })();
}

export function archiveBankPromotions(db){
  const result={android:0,mail:0},at=new Date().toISOString();
  return db.transaction(()=>{
    for(const [source,table]of Object.entries(tables)){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      const condition=source==='android'?"state='review'":"state IN ('draft','pending') AND movement_id IS NULL";
      for(const row of db.prepare(`SELECT * FROM ${table} WHERE archived_at IS NULL AND bank_transaction_id IS NULL AND ${condition}`).all()){
        let p;try{p=JSON.parse(decryptDocument(row.encrypted).toString());}catch{continue;}
        if(!isBankPromotion(p.subject||'',p.body||''))continue;
        if(source==='android')db.prepare("UPDATE finance_notification_events SET archived_at=?,state='dismissed',reason='Publicidad bancaria filtrada automáticamente' WHERE id=?").run(at,row.id);
        else db.prepare('UPDATE finance_mail_messages SET archived_at=? WHERE id=?').run(at,row.id);
        audit(db,'system:bank-inbox','bank_notice.promotion_filtered',source,row.id,null,{financial_records_unchanged:true});result[source]++;
      }
    }
    if(result.android||result.mail)console.info('[finance] Bank promotions filtered '+JSON.stringify(result));
    return result;
  })();
}
