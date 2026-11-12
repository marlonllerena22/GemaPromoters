import crypto from 'node:crypto';
import {decryptDocument} from './finance-ai.js';
import {audit,validDay} from './finance-db.js';
import {privateSetting,putPrivateSetting} from './finance-operations.js';
import {RETAIL_STAFF,RETAIL_STORES} from '../../shared/finance-retail.mjs';

// Administrative, encrypted one-time upload. No HTTP route and no attendance writes.
// The operator supplies the schedule through the hosting secret store, never source control.
export function importPlannedCalendar(db,payload=process.env.FINANCE_CALENDAR_IMPORT){
 if(!payload)return null;
 try{
  const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString());
  if(job.kind!=='planned-calendar-v1'||!/^[a-f0-9-]{36}$/.test(job.id)||!/^\d{4}-\d{2}$/.test(job.month))throw new Error('Invalid calendar job');
  const key='calendar-import:'+job.id,previous=privateSetting(db,key);if(previous)return {...previous,duplicate:true};
  const expiry=Date.parse(job.expires_at);if(!Number.isFinite(expiry)||expiry<Date.now()||expiry>Date.now()+2*3600000)throw new Error('Expired calendar job');
  const owner=db.prepare("SELECT username FROM finance_members WHERE username=? AND role='owner' AND active=1").get(job.owner);
  if(!owner||!Array.isArray(job.entries)||job.entries.length<1||job.entries.length>186)throw new Error('Invalid owner or entries');
  const entries=job.entries.map(e=>{const day=validDay(e.day);if(!day.startsWith(job.month+'-')||!RETAIL_STAFF.includes(e.employee)||(e.unit_id!==null&&!RETAIL_STORES[e.unit_id]))throw new Error('Invalid assignment');return {day,employee:e.employee,unit_id:e.unit_id};});
  if(new Set(entries.map(e=>e.day+e.employee)).size!==entries.length)throw new Error('Duplicate assignments');
  const fingerprint=rows=>crypto.createHash('sha256').update(JSON.stringify([...rows].sort((a,b)=>(a.day+a.employee).localeCompare(b.day+b.employee)))).digest('hex');
  const plannedHash=fingerprint(entries);
  const result=db.transaction(()=>{
   let assigned=0,rest=0,conflicts=0,preserved_worked=0;
   for(const row of entries){
    const old=db.prepare('SELECT * FROM finance_staff_schedule WHERE day=? AND employee=?').get(row.day,row.employee);
    const actual=db.prepare('SELECT unit_id FROM finance_retail_attendance WHERE day=? AND employee=?').all(row.day,row.employee);
    if((old?.worked&&old.unit_id!==row.unit_id)||actual.some(a=>a.unit_id!==row.unit_id)){conflicts++;continue;}
    if(old?.worked)preserved_worked++;
    db.prepare('INSERT INTO finance_staff_schedule(day,employee,unit_id,worked,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(day,employee) DO UPDATE SET unit_id=excluded.unit_id,updated_by=excluded.updated_by').run(row.day,row.employee,row.unit_id,old?.worked||0,'system:calendar-import');
    audit(db,'system:calendar-import','retail.schedule_import','staff_schedule',row.day+row.employee,old,{...row,requested_by:owner.username,job_id:job.id},'marjorie');
    if(row.unit_id)assigned++;else rest++;
   }
   const actual=entries.map(e=>db.prepare('SELECT day,employee,unit_id FROM finance_staff_schedule WHERE day=? AND employee=?').get(e.day,e.employee)).filter(Boolean);
   const savedHash=fingerprint(actual);
   const result={job_id:job.id,month:job.month,rows:entries.length,assigned,rest,conflicts,preserved_worked,planned_hash:plannedHash,saved_hash:savedHash,verified:conflicts===0&&plannedHash===savedHash,attendance_unchanged:true};
   putPrivateSetting(db,key,result);return result;
  })();
  console.info('[finance] Calendar import '+JSON.stringify(result));return result;
 }catch{console.warn('[finance] Calendar import rejected or expired');return {rejected:true};}
}
