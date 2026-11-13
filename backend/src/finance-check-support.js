import {decryptDocument,encryptDocument} from './finance-ai.js';
import {effectiveMember} from './finance-profile-access.js';
import {privateSetting,putPrivateSetting} from './finance-operations.js';
import {saveCheck} from './finance-funding.js';
import {declareCheck,recordedAccountBalance} from './finance-check-ledger.js';

// An owner-approved registration through the same validated check workflow as the UI.
export function registerPaidCheck(db,job,now=new Date()){
 if(job.kind!=='paid-check-registration-v1'||!/^[a-f0-9-]{36}$/.test(job.id)||!Number.isFinite(Date.parse(job.expires_at))||Date.parse(job.expires_at)<+now||Date.parse(job.expires_at)>+now+2*3600000||job.debit_balance!==true)throw new Error('Invalid paid check job');
 const key='paid-check-registration:'+job.id,previous=privateSetting(db,key);if(previous)return {...previous,duplicate:true};
 return db.transaction(()=>{
  const owner=db.prepare("SELECT * FROM finance_members WHERE username=? AND role='owner' AND active=1").get(job.owner);if(!owner)throw new Error('Owner not found');
  const user=effectiveMember(db,owner),account=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1").get(job.account_id);
  if(!account||!/guayaquil/i.test(account.bank)||!/corriente/i.test(account.name)||account.last_four!==job.account_suffix)throw new Error('Check account mismatch');
  const before=recordedAccountBalance(db,account),existing=db.prepare('SELECT * FROM finance_checks WHERE account_id=? AND number=?').get(account.id,String(job.number));
  if(existing&&(existing.payee!==job.payee||existing.amount_cents!==job.amount_cents||existing.due_day!==job.due_day||existing.needs_review))throw new Error('Check already exists with different details');
  const check=existing||saveCheck(db,user,{account_id:account.id,number:job.number,payee:job.payee,amount_cents:job.amount_cents,due_day:job.due_day});
  if(check.status!=='cleared')declareCheck(db,user,check.id,{cleared:true,version:check.version,request_key:job.id});
  const updated=db.prepare('SELECT * FROM finance_checks WHERE id=?').get(check.id),after=recordedAccountBalance(db,account);
  const result={check:updated,balance_before_cents:before,balance_after_cents:after,delta_cents:after-before,existing:Boolean(existing)};
  putPrivateSetting(db,key,{...result,completed_at:now.toISOString()});return result;
 })();
}
export function applyPrivatePaidCheck(db,payload=process.env.FINANCE_PAID_CHECK_JOB){
 if(!payload)return null;
 try{const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString()),result=registerPaidCheck(db,job);console.info('[finance] Paid check result '+job.id+'|'+encryptDocument(Buffer.from(JSON.stringify(result))).toString('base64'));return result;}
 catch{console.error('[finance] Paid check registration stopped: review encrypted job and existing check');return {failed:true};}
}
