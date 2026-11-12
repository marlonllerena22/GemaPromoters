import {audit,financeDay,validDay,cents} from './finance-db.js';
import {fail,text} from './finance-service.js';
import {staffNames,isStoreStaff} from '../../shared/finance-access.mjs';
import {RETAIL_STAFF,RETAIL_STORES,retailManagement,retailEditor} from '../../shared/finance-retail.mjs';
import {decryptDocument} from './finance-ai.js';
import {pushConfiguration,validatePushSubscription} from './finance-push.js';
import {sendFinancePush} from './finance-native-push.js';

const nextDay=d=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const at=(day,time)=>Date.parse(`${day}T${time}:00-05:00`);
const table=(db,name)=>!!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name);
const stamp=now=>now.toISOString();
export function defaultClockSettings(){
 const hours=Object.fromEntries(Object.keys(RETAIL_STORES).map(id=>[id,Array.from({length:7},(_,i)=>id==='marjorie-bosque'?null:{start:'10:00',end:i===0?'15:00':i===6?'17:00':'18:00'})]));
 return {hours,tolerance_minutes:3,late_fine_cents:null,absence_day_cents:null,absence_fine_cents:null};
}
export function initStaffClock(db,now=new Date()){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_staff_clock_settings(effective_day TEXT PRIMARY KEY,data_json TEXT NOT NULL,updated_by TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_staff_clock_meta(id INTEGER PRIMARY KEY CHECK(id=1),active_from TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_staff_clock(day TEXT NOT NULL,employee TEXT NOT NULL,unit_id TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(day,employee));
 CREATE TABLE IF NOT EXISTS finance_staff_clock_alerts(day TEXT NOT NULL,employee TEXT NOT NULL,kind TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,employee,kind));
 CREATE TABLE IF NOT EXISTS finance_staff_clock_deliveries(day TEXT NOT NULL,employee TEXT NOT NULL,kind TEXT NOT NULL,endpoint_hash TEXT NOT NULL,PRIMARY KEY(day,employee,kind,endpoint_hash));`);
 // Start absence detection the next day; no retroactive absences during rollout.
 db.prepare('INSERT OR IGNORE INTO finance_staff_clock_meta VALUES (1,?)').run(nextDay(financeDay(now)));
 db.prepare('INSERT OR IGNORE INTO finance_staff_clock_settings VALUES (?,?,?)').run('0001-01-01',JSON.stringify(defaultClockSettings()),'system:initial-hours');
}
export function clockSettings(db,day=financeDay()){
 const row=db.prepare('SELECT * FROM finance_staff_clock_settings WHERE effective_day<=? ORDER BY effective_day DESC LIMIT 1').get(day);
 return {...JSON.parse(row.data_json),effective_day:row.effective_day};
}
export function saveClockSettings(db,user,body,now=new Date()){
 if(!retailEditor(user))fail('Solo Marlon y Morelia configuran la asistencia',403);
 const day=validDay(body.effective_day||financeDay(now));if(day<financeDay(now))fail('Los cambios se aplican desde hoy o una fecha futura');
 const s=body.settings;if(!s?.hours)fail('Completa los horarios');
 const value={hours:{}};
 for(const id of Object.keys(RETAIL_STORES)){
  if(!Array.isArray(s.hours[id])||s.hours[id].length!==7)fail('Completa los siete días de cada local');
  value.hours[id]=s.hours[id].map(h=>{if(h===null)return null;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(h?.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(h?.end)||h.end<=h.start)fail('Revisa entrada y salida del local');return {start:h.start,end:h.end};});
 }
 for(const key of ['late_fine_cents','absence_day_cents','absence_fine_cents'])value[key]=s[key]===null?null:cents(s[key],{zero:true});
 value.tolerance_minutes=s.tolerance_minutes;
 if(value.tolerance_minutes!==null&&(!Number.isInteger(value.tolerance_minutes)||value.tolerance_minutes<0||value.tolerance_minutes>120))fail('Indica una tolerancia de 0 a 120 minutos o déjala pendiente');
 db.transaction(()=>{const old=clockSettings(db,day);db.prepare('INSERT INTO finance_staff_clock_settings VALUES (?,?,?) ON CONFLICT(effective_day) DO UPDATE SET data_json=excluded.data_json,updated_by=excluded.updated_by').run(day,JSON.stringify(value),user.username);audit(db,user.username,'staff.clock.settings','staff_clock_settings',day,old,value,'marjorie');})();
 return clockSettings(db,day);
}
function readClock(db,day,employee){const r=db.prepare('SELECT * FROM finance_staff_clock WHERE day=? AND employee=?').get(day,employee);return r?{day:r.day,employee:r.employee,unit_id:r.unit_id,...JSON.parse(r.data_json)}:null;}
function writeClock(db,r){const {day,employee,unit_id,...data}=r;db.prepare('INSERT INTO finance_staff_clock VALUES (?,?,?,?) ON CONFLICT(day,employee) DO UPDATE SET unit_id=excluded.unit_id,data_json=excluded.data_json').run(day,employee,unit_id,JSON.stringify(data));}
function baseClock(db,s){const cfg=clockSettings(db,s.day),hours=cfg.hours[s.unit_id]?.[new Date(s.day+'T12:00:00Z').getUTCDay()]||null;return {day:s.day,employee:s.employee,unit_id:s.unit_id,in_at:null,out_at:null,late_minutes:null,review:null,reason:'',late_waived:false,policy:{...cfg,hours},reviewed_by:null};}
function present(db,r,yes){
 const other=db.prepare('SELECT 1 FROM finance_retail_attendance WHERE day=? AND employee=? AND unit_id<>?').get(r.day,r.employee,r.unit_id);
 if(yes&&other)fail('Ya hay asistencia en otro local; revisa esa jornada antes de continuar',409);
 if(yes)db.prepare('INSERT INTO finance_retail_attendance VALUES (?,?,?,1) ON CONFLICT(day,unit_id,employee) DO UPDATE SET weight=1').run(r.day,r.unit_id,r.employee);
 else db.prepare('DELETE FROM finance_retail_attendance WHERE day=? AND employee=? AND unit_id=?').run(r.day,r.employee,r.unit_id);
 db.prepare('UPDATE finance_staff_schedule SET worked=? WHERE day=? AND employee=?').run(yes?1:0,r.day,r.employee);
}
export function clockCharges(r){
 let amount=0,pending=0;const items=[];const add=(label,value)=>{items.push({label,amount_cents:value});if(value===null)pending++;else amount+=value;};
 if(r?.review==='justified'||r?.review==='unjustified'){add('Día no trabajado',r.policy.absence_day_cents);if(r.review==='unjustified')add('Multa por falta injustificada',r.policy.absence_fine_cents);}
 else if(r?.in_at&&!r.late_waived){if(r.late_minutes===null){pending++;}else if(r.late_minutes>0)add('Multa por atraso',r.policy.late_fine_cents);}
 return {amount_cents:amount,pending,items};
}
export function clockState(db,s,now=new Date()){
 const r=readClock(db,s.day,s.employee),base=r||(s.unit_id?baseClock(db,s):{}),active=db.prepare('SELECT active_from FROM finance_staff_clock_meta WHERE id=1').get().active_from;
 let status=!s.unit_id?'rest':s.worked?'worked':s.day<active?'legacy':'scheduled';
 if(base.review==='justified')status='justified';else if(base.review==='unjustified')status='unjustified';else if(base.out_at||base.review==='present')status='worked';else if(base.in_at)status=base.late_minutes>0?'late':'present';
 else if(s.unit_id&&s.day>=active&&!s.worked&&(base.policy?.hours?now.getTime()>=at(s.day,base.policy.hours.end):s.day<financeDay(now)))status='missing';
 const charges=clockCharges(r);return {...s,...base,status,charges,needs_review:status==='missing'||!!(base.in_at&&!base.out_at&&base.review!=='present'&&(base.policy?.hours?now.getTime()>=at(s.day,base.policy.hours.end):s.day<financeDay(now))),active_from:active};
}
export function myClock(db,user,now=new Date()){
 if(!isStoreStaff(user)||!staffNames[user.username])fail('Marcación solo para las colaboradoras de locales',403);
 const day=financeDay(now),employee=staffNames[user.username],s=db.prepare('SELECT * FROM finance_staff_schedule WHERE day=? AND employee=?').get(day,employee);
 // Require an explicit schedule, including for permanent staff.
 const row=clockState(db,s||{day,employee,unit_id:null,worked:0},now);
 return {day,employee,unit_id:row.unit_id,local:RETAIL_STORES[row.unit_id]||null,in_at:row.in_at||null,out_at:row.out_at||null,status:row.status,hours:row.policy?.hours||null,late_minutes:row.late_minutes??null,can_in:!!s?.unit_id&&!s.worked&&!row.in_at&&!row.review,can_out:!!row.in_at&&!row.out_at&&!['justified','unjustified','present'].includes(row.review),server_time:stamp(now)};
}
export function punchClock(db,user,body,now=new Date()){
 if(!['in','out'].includes(body.action))fail('Selecciona Llegué o Salí');
 return db.transaction(()=>{
  const mine=myClock(db,user,now);if(!mine.unit_id)fail('No tienes un local asignado hoy. Morelia puede organizar tu turno.');
  const old=readClock(db,mine.day,mine.employee),r=old||baseClock(db,mine);
  if(r.review)fail('Morelia ya revisó esta jornada; pídele que la reabra para corregirla',409);
  if(body.action==='in'){
   if(r.in_at)return mine;
   r.in_at=stamp(now);const h=r.policy.hours,t=r.policy.tolerance_minutes;
   r.late_minutes=h&&t!==null?Math.max(0,Math.floor((now-at(r.day,h.start))/60000)-t):null;
  }else{
   if(!r.in_at)fail('Primero registra tu llegada');if(r.out_at)return mine;
   if(now<=new Date(r.in_at))fail('La salida debe ser posterior a la llegada');
   r.out_at=stamp(now);present(db,r,true);
  }
  writeClock(db,r);audit(db,user.username,'staff.clock.'+body.action,'staff_clock',r.day+r.employee,old,r,'marjorie');
  db.prepare('UPDATE finance_staff_clock_alerts SET resolved=1 WHERE day=? AND employee=?').run(r.day,r.employee);
  return myClock(db,user,now);
 })();
}
export function reviewClock(db,user,body,now=new Date()){
 if(!retailEditor(user))fail('Solo Marlon y Morelia revisan la asistencia',403);
 const day=validDay(body.day),employee=body.employee,reason=text(body.reason,500),action=body.action;
 if(!RETAIL_STAFF.includes(employee)||!reason)fail('Selecciona a la empleada y escribe el motivo');
 if(day>financeDay(now))fail('Revisa una jornada ya iniciada');
 if(!['justified','unjustified','present','waive_late','reopen'].includes(action))fail('Revisión no válida');
 return db.transaction(()=>{
  const s=db.prepare('SELECT * FROM finance_staff_schedule WHERE day=? AND employee=?').get(day,employee);if(!s?.unit_id)fail('No hay un turno asignado');
  const old=readClock(db,day,employee),r=old||baseClock(db,s);
  if(['justified','unjustified'].includes(action)&&r.in_at)fail('Hay una llegada registrada: revisa el atraso o confirma la jornada');
  if(action==='unjustified'&&(!r.policy.hours?day===financeDay(now):now<at(day,r.policy.hours.end)))fail('Espera al final del turno para confirmar una falta injustificada');
  if(action==='waive_late'&&!r.in_at)fail('No hay llegada registrada');
  if(action==='waive_late')r.late_waived=true;
  else {r.review=action==='reopen'?null:action;present(db,r,action==='present'||(action==='reopen'&&!!r.out_at));if(action==='reopen')r.late_waived=false;}
  r.reason=reason;r.reviewed_by=user.username;r.reviewed_at=stamp(now);writeClock(db,r);
  db.prepare('UPDATE finance_staff_clock_alerts SET resolved=1 WHERE day=? AND employee=?').run(day,employee);
  audit(db,user.username,'staff.clock.review','staff_clock',day+employee,old,r,'marjorie');return clockState(db,{...s,worked:action==='present'?1:0},now);
 })();
}
export function clockRange(db,from,to,now=new Date()){
 if(!table(db,'finance_staff_clock'))return [];
 return db.prepare('SELECT * FROM finance_staff_schedule WHERE day BETWEEN ? AND ? ORDER BY day,employee').all(from,to).map(s=>clockState(db,s,now));
}
export function evaluateClockAlerts(db,now=new Date()){
 const active=db.prepare('SELECT active_from FROM finance_staff_clock_meta WHERE id=1').get().active_from;
 const rows=clockRange(db,active,financeDay(now),now);
 for(const r of rows){
  const kind=r.needs_review?(r.in_at?'missing_out':'missing_in'):null;
  db.prepare('UPDATE finance_staff_clock_alerts SET resolved=1 WHERE day=? AND employee=? AND kind!=?').run(r.day,r.employee,kind||'');
  if(kind){if(!readClock(db,r.day,r.employee))writeClock(db,baseClock(db,r));db.prepare('INSERT INTO finance_staff_clock_alerts(day,employee,kind) VALUES (?,?,?) ON CONFLICT(day,employee,kind) DO UPDATE SET resolved=0').run(r.day,r.employee,kind);}
 }
 // A corrected schedule/rest resolves old warnings as well.
 db.exec('UPDATE finance_staff_clock_alerts SET resolved=1 WHERE NOT EXISTS (SELECT 1 FROM finance_staff_schedule s WHERE s.day=finance_staff_clock_alerts.day AND s.employee=finance_staff_clock_alerts.employee AND s.unit_id IS NOT NULL)');
 return rows.filter(r=>r.needs_review);
}
export async function flushClockPush(db,{now=new Date(),send=sendFinancePush,config=pushConfiguration()}={}){
 const pending=evaluateClockAlerts(db,now);if(!config.enabled)return;
 const subscriptions=db.prepare("SELECT s.* FROM finance_push_subscriptions s JOIN finance_members m ON m.id=s.member_id WHERE m.active=1 AND m.username='morelia'").all();
 for(const r of pending){const kind=r.in_at?'missing_out':'missing_in';for(const s of subscriptions){
  if(!db.open)return;if(db.prepare('SELECT 1 FROM finance_staff_clock_deliveries WHERE day=? AND employee=? AND kind=? AND endpoint_hash=?').get(r.day,r.employee,kind,s.endpoint_hash))continue;
  try{await send(validatePushSubscription(JSON.parse(decryptDocument(s.encrypted).toString())),JSON.stringify({title:'Asistencia por revisar',body:`${r.employee} · ${RETAIL_STORES[r.unit_id]} · ${r.day}: falta marcar ${r.in_at?'salida':'llegada'}. Revisa o justifica la jornada.`,url:'/finanzas/locales?asistencia=1&day='+r.day,tag:`attendance-${r.day}-${r.employee}`}),{vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},TTL:86400,timeout:8000});
   if(db.open)db.prepare('INSERT OR IGNORE INTO finance_staff_clock_deliveries VALUES (?,?,?,?)').run(r.day,r.employee,kind,s.endpoint_hash);
  }catch(e){if(db.open&&[404,410].includes(e.statusCode))db.prepare('DELETE FROM finance_push_subscriptions WHERE endpoint_hash=?').run(s.endpoint_hash);}
 }}
}
export function registerStaffClock(app,db,{route}){
 initStaffClock(db);
 app.get('/api/finance/retail/clock/me',route((req,res)=>res.json(myClock(db,req.financeUser))));
 app.post('/api/finance/retail/clock/punch',route((req,res)=>res.json(punchClock(db,req.financeUser,req.body))));
 app.get('/api/finance/retail/clock/settings',route((req,res)=>{if(!retailManagement(req.financeUser))fail('Acceso de gerencia',403);res.json(clockSettings(db,validDay(req.query.day||financeDay())));}));
 app.post('/api/finance/retail/clock/settings',route((req,res)=>res.json(saveClockSettings(db,req.financeUser,req.body))));
 app.post('/api/finance/retail/clock/review',route((req,res)=>res.json(reviewClock(db,req.financeUser,req.body))));
 if(process.env.FINANCE_DEMO!=='1'){let running=false;const timer=setInterval(async()=>{if(running||!db.open)return;running=true;try{await flushClockPush(db);}catch(e){console.error('Attendance review scan failed');}finally{running=false;}},60000);timer.unref();}
}
