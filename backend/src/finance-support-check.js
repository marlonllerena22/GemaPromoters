import { decryptDocument, encryptDocument } from "./finance-ai.js";
import { financeDay } from "./finance-db.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";
import { retailReport,validateRetailDetails } from "./finance-retail.js";

// Operator-only, read-only support check. Requires a short-lived encrypted job
// in the hosting secret store; it exposes no route and logs no plaintext data.
export function financeSupportCheck(db, payload = process.env.FINANCE_SUPPORT_CHECK) {
  if (!payload) return null;
  try {
    const job = JSON.parse(decryptDocument(Buffer.from(payload, "base64")).toString());
    if (!["conversation-and-push-v1","retail-commissions-v1","request-payments-v1"].includes(job.kind) || !/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at)<Date.now() || Date.parse(job.expires_at)>Date.now()+2*3600000) throw new Error("invalid support job");
    if(job.kind==='request-payments-v1'){
      const key=`support-check:${job.id}:request-payments-v1`;if(privateSetting(db,key))return null;
      const payments=db.prepare("SELECT p.*,a.name account_name,a.bank,a.last_four,m.status FROM finance_payments p JOIN finance_accounts a ON a.id=p.account_id JOIN finance_movements m ON m.id=p.movement_id WHERE p.paid_day>=date(?,'-1 day') AND p.voided_at IS NULL ORDER BY p.id DESC LIMIT 30").all(financeDay()).map(p=>{
        const account=db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(p.account_id);
        let proof;try{proof=JSON.parse(db.prepare('SELECT analysis FROM finance_evidence WHERE id=?').get(p.evidence_id)?.analysis||'null');}catch{}
        return {...p,proof:proof?{amount_cents:proof.amount_cents,reference:proof.reference,day:proof.day,origin_bank:proof.origin_bank,origin_account_suffix:proof.origin_account_suffix}:null,balance_cents:recordedAccountBalance(db,account),opening_at:account.opening_at,checkpoint:db.prepare('SELECT as_of_at,balance_cents FROM finance_balance_checkpoints WHERE account_id=? ORDER BY as_of_at DESC LIMIT 1').get(p.account_id),allocations:db.prepare('SELECT * FROM finance_allocations WHERE movement_id=?').all(p.movement_id),bank_matches:db.prepare("SELECT id,day,amount_cents,reference,occurred_at,import_source FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND day BETWEEN date(?,'-1 day') AND date(?,'+1 day')").all(p.account_id,-p.amount_cents,p.paid_day,p.paid_day)};
      });
      const cipher=encryptDocument(Buffer.from(JSON.stringify({job_id:job.id,payments}))).toString('base64'),chunks=cipher.match(/.{1,3500}/g);
      chunks.forEach((chunk,index)=>console.info(`[finance] Private support check ${job.id}|${index}|${chunks.length}|${chunk}`));
      putPrivateSetting(db,key,{completed_at:new Date().toISOString()});return {completed:true};
    }
    if(job.kind==='retail-commissions-v1'){
      const key=`support-check:${job.id}:retail-commissions-v1`;
      if(privateSetting(db,key))return null;
      const owner=db.prepare("SELECT username,name,role,business_ids FROM finance_members WHERE role='owner' AND active=1 LIMIT 1").get();
      if(!owner)throw new Error('owner missing');
      const report=retailReport(db,{...owner,business_ids:JSON.parse(owner.business_ids),unit_ids:[]},{mode:'month',day:job.day||financeDay(),unit_id:'all'});
      const missingDetail=x=>{
        const sale=db.prepare('SELECT * FROM finance_sales WHERE id=?').get(x.id),source=JSON.parse(sale.payload_json).retail;
        const manual=db.prepare('SELECT * FROM finance_retail_details WHERE sale_id=?').get(x.id);
        const value=manual?.source_version===sale.source_updated_at?JSON.parse(manual.data_json):source;
        let reason=null;try{validateRetailDetails(value,sale);}catch(e){reason=e.message;}
        return {external_id:x.external_id,day:x.day,source_has_items:!!source?.items?.length,reason};
      };
      const result={job_id:job.id,period:report.period,stores:report.stores.map(s=>({unit_id:s.unit_id,count:s.sales.count,pairs:s.sales.pairs,thresholds:s.sales.thresholds,commissions:s.notebook.commissions,calculated_cents:s.notebook.totals.calculated_commission_cents,earned_cents:s.notebook.totals.commission_cents,missing_details:s.sales.entries.filter(x=>!x.items).map(missingDetail),warnings:s.warnings}))};
      const cipher=encryptDocument(Buffer.from(JSON.stringify(result))).toString('base64'),chunks=cipher.match(/.{1,3500}/g);
      chunks.forEach((chunk,index)=>console.info(`[finance] Private support check ${job.id}|${index}|${chunks.length}|${chunk}`));
      putPrivateSetting(db,key,{completed_at:new Date().toISOString()});
      return {completed:true};
    }
    const key=`support-check:${job.id}:bank-signals-v13`;
    if(privateSetting(db,key)) return null;
    const drafts=db.prepare("SELECT d.* FROM finance_assistant_drafts d JOIN finance_members m ON m.id=d.member_id WHERE m.role='owner' AND d.result_json IS NOT NULL ORDER BY d.created_at DESC LIMIT 5").all().map(({encrypted,...r})=>{
      const p=JSON.parse(decryptDocument(encrypted).toString());
      return {id:r.id,created_at:r.created_at,action:p.action,data:p.data,items:p.items?.map(({action,data})=>({action,data})),result:JSON.parse(r.result_json)};
    });
    const ids=[...new Set([...drafts.flatMap(d=>[d.data?.account_id,...(d.items||[]).map(i=>i.data.account_id)]).filter(Boolean), ...db.prepare("SELECT id FROM finance_accounts WHERE bank LIKE '%Pichincha%'").all().map(a=>a.id)])];
    const accounts=ids.map(id=>{const a=db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(id);return a?{id:a.id,name:a.name,bank:a.bank,balance_cents:recordedAccountBalance(db,a),recent:db.prepare("SELECT id,day,amount_cents,reference,import_source,description FROM finance_bank_transactions WHERE account_id=? AND day=? ORDER BY id DESC LIMIT 12").all(id,financeDay())}:null;});
    const movements=drafts.map(d=>d.result.movement_id).filter(Boolean).map(id=>db.prepare("SELECT id,account_id,kind,amount_cents,description,status,counterparty,reference FROM finance_movements WHERE id=?").get(id));
    const push={devices:db.prepare("SELECT COUNT(*) n FROM finance_push_subscriptions").get().n,owner_devices:db.prepare("SELECT COUNT(*) n FROM finance_push_subscriptions p JOIN finance_members m ON m.id=p.member_id WHERE m.role='owner'").get().n};
    const ownerMovements=db.prepare("SELECT id,account_id,kind,amount_cents,description,status,counterparty,reference,evidence_id,created_at,source_system FROM finance_movements WHERE created_by IN (SELECT username FROM finance_members WHERE role='owner') AND created_at>=? ORDER BY id DESC LIMIT 20").all(`${financeDay()}T05:00:00.000Z`);
    const evidence=db.prepare("SELECT id,name,business_id,analysis,created_at FROM finance_evidence WHERE created_by IN (SELECT username FROM finance_members WHERE role='owner') AND created_at>=? ORDER BY id DESC LIMIT 10").all(`${financeDay()}T05:00:00.000Z`);
    const recentMail=db.prepare('SELECT id,state,account_id,bank_transaction_id,archived_at,encrypted FROM finance_mail_messages WHERE received_at>=? ORDER BY received_at DESC LIMIT 12').all(`${financeDay()}T05:00:00.000Z`).map(({encrypted,...row})=>({...row,parsed:JSON.parse(decryptDocument(encrypted).toString())}));
    const notificationTable=db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get();
    const notifications=notificationTable?db.prepare('SELECT * FROM finance_notification_events ORDER BY id DESC LIMIT 12').all().map(({encrypted,...row})=>({...row,parsed:JSON.parse(decryptDocument(encrypted).toString())})):[];
    const notificationDevices=notificationTable?db.prepare('SELECT id,member_id,apps_json,last_seen,expires_at,revoked FROM finance_notification_devices').all():[];
    const bankAccounts=db.prepare("SELECT * FROM finance_accounts WHERE kind IN ('bank','wallet') AND active=1").all().map(a=>({id:a.id,name:a.name,bank:a.bank,kind:a.kind,last_four:a.last_four,opening_at:a.opening_at,verified_at:a.verified_at,verified_cents:a.verified_cents,balance_cents:recordedAccountBalance(db,a)}));
    const pendingReceipts=db.prepare("SELECT m.id,m.kind,m.day,m.business_id,m.unit_id,m.account_id,m.amount_cents,m.counterparty,m.reference,m.status,m.created_by,m.created_at,m.evidence_id,e.analysis FROM finance_movements m JOIN finance_evidence e ON e.id=m.evidence_id WHERE m.kind='income' AND m.hidden_at IS NULL AND m.status IN ('pending','reported','approved') ORDER BY m.id DESC LIMIT 25").all();
    const requestMembers=db.prepare("SELECT id,username,role,active,business_ids,unit_ids,request_payments FROM finance_members WHERE lower(username) IN ('norma','normita')").all().map(m=>({...m,spaces:db.prepare('SELECT s.id,s.name,s.business_ids,sm.role FROM finance_space_members sm JOIN finance_spaces s ON s.id=sm.space_id WHERE sm.member_id=? AND s.active=1').all(m.id)}));
    const receipt_policy=privateSetting(db,'receipt_confirmation_credits_v1');
    const iessRequests=db.prepare("SELECT m.*,i.encrypted,i.bank_transaction_id,i.movement_id AS matched_movement FROM finance_iess_requests i JOIN finance_movements m ON m.id=i.request_id WHERE m.day>=date(?,'-2 days') ORDER BY m.id DESC LIMIT 20").all(financeDay()).map(({encrypted,...r})=>({...r,planilla:JSON.parse(decryptDocument(encrypted).toString()),payments:db.prepare('SELECT p.*,e.analysis FROM finance_payments p LEFT JOIN finance_evidence e ON e.id=p.evidence_id WHERE p.request_id=?').all(r.id),allocations:db.prepare('SELECT a.*,b.amount_cents AS bank_amount,b.reference AS bank_reference,b.import_source FROM finance_allocations a JOIN finance_bank_transactions b ON b.id=a.bank_transaction_id WHERE a.movement_id IN (SELECT movement_id FROM finance_payments WHERE request_id=?)').all(r.id)}));
    const iessBank=db.prepare("SELECT b.* FROM finance_bank_transactions b JOIN finance_accounts a ON a.id=b.account_id WHERE a.bank LIKE '%Produ%' AND b.day=? ORDER BY b.id DESC LIMIT 30").all(financeDay());
    const result={job_id:job.id,iessRequests,iessBank,drafts,accounts,movements,push,ownerMovements,evidence,recentMail,notifications,notificationDevices,bankAccounts,pendingReceipts,requestMembers,receipt_policy,registry:privateSetting(db,'own_account_registry'),auto_after:process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER,auto_enabled:process.env.FINANCE_GMAIL_AUTO_APPLY!=='0',restart_at:privateSetting(db,'activity_restart_at')};
    const cipher=encryptDocument(Buffer.from(JSON.stringify(result))).toString("base64"), chunks=cipher.match(/.{1,3500}/g);
    chunks.forEach((chunk,index)=>console.info(`[finance] Private support check ${job.id}|${index}|${chunks.length}|${chunk}`));
    putPrivateSetting(db,key,{completed_at:new Date().toISOString()});
    return {completed:true};
  } catch { console.warn("[finance] Support check rejected or expired"); return {completed:false}; }
}
