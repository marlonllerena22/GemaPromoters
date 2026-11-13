import {decryptDocument,encryptDocument} from './finance-ai.js';
import {audit,financeDay,passwordHash,validateFinancePassword} from './finance-db.js';
import {effectiveMember} from './finance-profile-access.js';
import {staffNames} from '../../shared/finance-access.mjs';
import {privateSetting,putPrivateSetting} from './finance-operations.js';

// Short-lived hosting job for an owner-requested staff credential recovery.
// No public endpoint, no owner recovery, no MFA bypass and no attendance writes.
export function recoverStaffAccess(db,job,now=new Date()){
 if(job.kind!=='staff-access-recovery-v1'||!/^[a-f0-9-]{36}$/.test(job.id)||!Number.isFinite(Date.parse(job.expires_at))||Date.parse(job.expires_at)<+now||Date.parse(job.expires_at)>+now+2*3600000||!staffNames[job.username])throw new Error('Invalid staff recovery job');
 const key='staff-access-recovery:'+job.id,previous=privateSetting(db,key);if(previous)return {...previous.result,duplicate:true};
 const password=validateFinancePassword(job.password);
 return db.transaction(()=>{
  const owner=db.prepare("SELECT * FROM finance_members WHERE username=? AND role='owner' AND active=1").get(job.owner);
  const member=db.prepare('SELECT * FROM finance_members WHERE username=?').get(job.username);
  if(!owner||!member||member.role!=='collector'||member.mfa_enabled||!JSON.parse(member.business_ids).includes('marjorie'))throw new Error('Staff recovery needs access review');
  db.prepare('UPDATE finance_members SET active=1,password_hash=?,password_policy_completed=NULL,password_changed_at=? WHERE id=?').run(passwordHash(password),now.toISOString(),member.id);
  db.prepare('DELETE FROM finance_sessions WHERE member_id=?').run(member.id);
  const updated=effectiveMember(db,db.prepare('SELECT * FROM finance_members WHERE id=?').get(member.id));
  const result={username:updated.username,active:updated.active,store_staff:updated.store_staff,request_payments:updated.request_payments,assigned_unit_ids:updated.assigned_unit_ids,password_change_required:updated.password_change_required};
  audit(db,owner.username,'member.staff_access_recovered','member',member.id,{active:member.active},{active:true,temporary_password:true,sessions_revoked:true},'marjorie');
  putPrivateSetting(db,key,{completed_at:now.toISOString(),before:{active:member.active,password_hash:member.password_hash,password_policy_completed:member.password_policy_completed,password_changed_at:member.password_changed_at},result});
  return result;
 })();
}
export function applyPrivateStaffRecovery(db,payload=process.env.FINANCE_STAFF_RECOVERY_JOB){
 if(!payload)return null;
 try{
  const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString()),result=recoverStaffAccess(db,job);
  const day=financeDay(),staff=db.prepare('SELECT * FROM finance_members').all().filter(m=>staffNames[m.username]).map(m=>{const u=effectiveMember(db,m);return {username:u.username,active:u.active,store_staff:u.store_staff,request_payments:u.request_payments,assigned_unit_ids:u.assigned_unit_ids,shift_off:u.shift_off,password_change_required:u.password_change_required};});
  const checks=db.prepare("SELECT c.* FROM finance_checks c WHERE number=? OR due_day=?").all('186','2026-11-08');
  const accounts=db.prepare("SELECT id,name,bank,last_four,opening_cents,opening_date,verified_at FROM finance_accounts WHERE bank LIKE '%Guayaquil%' AND lower(name) LIKE '%corriente%'").all();
  const attendance=db.prepare('SELECT day,employee,unit_id,data_json FROM finance_staff_clock WHERE day=?').all(day);
  const sealed=encryptDocument(Buffer.from(JSON.stringify({job_id:job.id,result,day,staff,checks,accounts,attendance}))).toString('base64');
  console.info('[finance] Staff recovery result '+job.id+'|'+sealed);
  return result;
 }catch{console.error('[finance] Staff recovery stopped: review encrypted job and staff access');return {failed:true};}
}
