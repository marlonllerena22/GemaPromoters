import { decryptDocument, encryptDocument } from "./finance-ai.js";
import { financeDay } from "./finance-db.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";

// Operator-only, read-only support check. Requires a short-lived encrypted job
// in the hosting secret store; it exposes no route and logs no plaintext data.
export function financeSupportCheck(db, payload = process.env.FINANCE_SUPPORT_CHECK) {
  if (!payload) return null;
  try {
    const job = JSON.parse(decryptDocument(Buffer.from(payload, "base64")).toString());
    if (job.kind !== "conversation-and-push-v1" || !/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at)<Date.now() || Date.parse(job.expires_at)>Date.now()+2*3600000) throw new Error("invalid support job");
    const key=`support-check:${job.id}`;
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
    const bankAccounts=db.prepare("SELECT * FROM finance_accounts WHERE kind='bank' AND active=1").all().map(a=>({id:a.id,name:a.name,bank:a.bank,last_four:a.last_four,opening_at:a.opening_at,verified_at:a.verified_at,balance_cents:recordedAccountBalance(db,a)}));
    const result={job_id:job.id,drafts,accounts,movements,push,ownerMovements,evidence,recentMail,notifications,notificationDevices,bankAccounts,registry:privateSetting(db,'own_account_registry'),auto_after:process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER,auto_enabled:process.env.FINANCE_GMAIL_AUTO_APPLY!=='0',restart_at:privateSetting(db,'activity_restart_at')};
    const cipher=encryptDocument(Buffer.from(JSON.stringify(result))).toString("base64"), chunks=cipher.match(/.{1,3500}/g);
    chunks.forEach((chunk,index)=>console.info(`[finance] Private support check ${job.id}|${index}|${chunks.length}|${chunk}`));
    putPrivateSetting(db,key,{completed_at:new Date().toISOString()});
    return {completed:true};
  } catch { console.warn("[finance] Support check rejected or expired"); return {completed:false}; }
}
