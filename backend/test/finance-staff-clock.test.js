import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initFinanceDb} from '../src/finance-db.js';
import {initProfileAccess} from '../src/finance-profile-access.js';
import {initRetail,retailReport,saveRetailSettings,retailAttendance} from '../src/finance-retail.js';
import {initStaffClock,defaultClockSettings,saveClockSettings,punchClock,myClock,reviewClock,clockRange,evaluateClockAlerts,flushClockPush} from '../src/finance-staff-clock.js';
import {saveStaffSchedule} from '../src/finance-staff-calendar.js';
import {defaultRetailSettings} from '../../shared/finance-retail.mjs';
import {encryptDocument} from '../src/finance-ai.js';

const owner={username:'marlon',role:'owner',business_ids:['marjorie'],unit_ids:[]},more={...owner,username:'morelia',role:'collector'},german={...owner,username:'german',role:'viewer'},staff={username:'selena',role:'collector',business_ids:['marjorie'],unit_ids:['marjorie-sur']};
const now=(d,h='18:30')=>new Date(d+'T'+h+':00-05:00');
function fixture(t){const db=new Database(':memory:');initFinanceDb(db);initProfileAccess(db,{seedAccounts:false});initRetail(db);initStaffClock(db,now('2026-10-31'));t.after(()=>db.close());return db;}
function schedule(db,day,employee='Selena',unit='marjorie-sur'){db.prepare('INSERT INTO finance_staff_schedule VALUES (?,?,?,0,?)').run(day,employee,unit,'fixture');}
function settings(db,day){const s={...defaultClockSettings(),tolerance_minutes:5,late_fine_cents:200,absence_day_cents:1500,absence_fine_cents:500};saveClockSettings(db,owner,{effective_day:day,settings:s},now(day,'08:00'));return s;}

test('clock uses server day/person/time, enforces shift, and retries do not change hours or double payroll',t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,day);settings(db,day);
 assert.throws(()=>punchClock(db,staff,{action:'out'},now(day,'10:00')),/Primero/);
 const r=punchClock(db,staff,{action:'in',employee:'Martha',day:'2020-01-01',in_at:'fake'},now(day,'10:08'));
 assert.equal(r.employee,'Selena');assert.equal(r.late_minutes,3);assert.equal(r.in_at,now(day,'10:08').toISOString());
 assert.equal(punchClock(db,staff,{action:'in'},now(day,'10:20')).in_at,r.in_at);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_retail_attendance').get().n,0);
 punchClock(db,staff,{action:'out'},now(day));punchClock(db,staff,{action:'out'},now(day,'18:50'));
 assert.equal(db.prepare('SELECT SUM(weight) n FROM finance_retail_attendance').get().n,1);
 assert.equal(myClock(db,staff,now(day)).out_at,now(day).toISOString());
 assert.throws(()=>punchClock(db,staff,{action:'in'},now('2026-11-03')),/asignado/);
 assert.throws(()=>punchClock(db,german,{action:'in'},now(day)),e=>e.status===403);
 assert.throws(()=>saveStaffSchedule(db,more,{day,employee:'Selena',unit_id:'marjorie-valle'}),e=>e.status===409);
 assert.throws(()=>retailAttendance(db,more,{day,employee:'Selena',unit_id:'marjorie-sur',weight:0}),e=>e.status===409);
});
test('rates remain pending and new configuration never rewrites a captured shift',t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,day);
 punchClock(db,staff,{action:'in'},now(day,'10:10'));
 let r=clockRange(db,day,day,now(day))[0];assert.equal(r.charges.amount_cents,0);assert.equal(r.charges.pending,1);
 settings(db,day);r=clockRange(db,day,day,now(day))[0];assert.equal(r.policy.late_fine_cents,null);assert.equal(r.charges.amount_cents,0);
 assert.throws(()=>saveClockSettings(db,german,{effective_day:day,settings:defaultClockSettings()},now(day)),e=>e.status===403);
 assert.throws(()=>saveClockSettings(db,owner,{effective_day:'2026-11-01',settings:defaultClockSettings()},now(day)),/desde hoy/);
});
test('absence needs management review; justification removes extra fine; no old or rest-day alerts',t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,'2026-10-30');schedule(db,day);schedule(db,day,'Martha',null);settings(db,day);
 assert.equal(evaluateClockAlerts(db,now(day,'11:00')).length,0);
 assert.throws(()=>reviewClock(db,more,{day,employee:'Selena',action:'unjustified',reason:'No llegó'},now(day,'11:00')),/final/);
 let pending=evaluateClockAlerts(db,now(day));assert.equal(pending.length,1);assert.equal(pending[0].employee,'Selena');
 assert.equal(pending[0].charges.amount_cents,0);
 assert.throws(()=>reviewClock(db,staff,{day,employee:'Selena',action:'justified',reason:'Permiso'},now(day)),e=>e.status===403);
 assert.throws(()=>reviewClock(db,german,{day,employee:'Selena',action:'justified',reason:'Permiso'},now(day)),e=>e.status===403);
 const review=action=>reviewClock(db,more,{day,employee:'Selena',action,reason:'Revisión de prueba'},now(day));
 assert.equal(review('unjustified').charges.amount_cents,2000);assert.equal(review('unjustified').charges.amount_cents,2000);
 assert.equal(review('justified').charges.amount_cents,1500);assert.equal(evaluateClockAlerts(db,now(day)).length,0);
 assert.equal(review('present').charges.amount_cents,0);assert.equal(db.prepare('SELECT SUM(weight) n FROM finance_retail_attendance').get().n,1);
 assert.equal(review('reopen').charges.amount_cents,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_retail_attendance').get().n,0);
});
test('missing exit is reviewed separately and late penalty can be waived',t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,day);settings(db,day);punchClock(db,staff,{action:'in'},now(day,'10:12'));
 assert.equal(evaluateClockAlerts(db,now(day))[0].in_at,now(day,'10:12').toISOString());
 assert.throws(()=>reviewClock(db,more,{day,employee:'Selena',action:'unjustified',reason:'Prueba'},now(day)),/llegada/);
 reviewClock(db,more,{day,employee:'Selena',action:'waive_late',reason:'Permiso'},now(day));
 assert.equal(clockRange(db,day,day,now(day))[0].charges.amount_cents,0);
 reviewClock(db,more,{day,employee:'Selena',action:'present',reason:'Olvidó marcar salida'},now(day));
 assert.equal(evaluateClockAlerts(db,now(day)).length,0);assert.equal(myClock(db,staff,now(day)).out_at,null);
});
test('automatic payroll deductions stay on assigned store and appear exactly once in net pay',t=>{
 const db=fixture(t),day='2026-11-02';settings(db,day);schedule(db,day);schedule(db,'2026-11-03');
 punchClock(db,staff,{action:'in'},now(day,'10:08'));punchClock(db,staff,{action:'out'},now(day));
 reviewClock(db,more,{day:'2026-11-03',employee:'Selena',action:'unjustified',reason:'Ausencia'},now('2026-11-03'));
 const cfg=defaultRetailSettings();cfg.staff=cfg.staff.map(s=>({...s,salary_cents:30000}));saveRetailSettings(db,owner,{month:'2026-11',settings:cfg});
 const report=()=>retailReport(db,owner,{day,mode:'month',unit_id:'marjorie-sur'}).stores[0].management;
 const m=report(),p=m.personnel.find(p=>p.name==='Selena');assert.equal(p.attendance_deductions_cents,2200);assert.equal(p.deductions_cents,2200);assert.equal(p.payable_cents,27800);assert.equal(m.attendance_deductions_cents,2200);assert.deepEqual(report(),m);
 assert.equal(retailReport(db,owner,{day,mode:'month',unit_id:'marjorie-valle'}).stores[0].management.attendance_deductions_cents,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);
});
test('push targets only Morelia and delivers each missing-day alert once per device',async t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,day);settings(db,day);
 const old=process.env.FINANCE_DOCUMENT_KEY;process.env.FINANCE_DOCUMENT_KEY='test-clock-document-key-1234567890';t.after(()=>{if(old===undefined)delete process.env.FINANCE_DOCUMENT_KEY;else process.env.FINANCE_DOCUMENT_KEY=old;});
 for(const name of ['morelia','german']){const id=db.prepare('INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES (?,?,?,?,?)').run(name,name,'fixture','collector','["marjorie"]').lastInsertRowid;
  const sub={provider:'fcm',token:name.repeat(30)};db.prepare('INSERT INTO finance_push_subscriptions(member_id,endpoint_hash,encrypted) VALUES (?,?,?)').run(id,name,encryptDocument(Buffer.from(JSON.stringify(sub))));}
 const sent=[];const opts={now:now(day),config:{enabled:true},send:async(s,p)=>sent.push({s,p:JSON.parse(p)})};await flushClockPush(db,opts);await flushClockPush(db,opts);
 assert.equal(sent.length,1);assert.match(sent[0].s.token,/morelia/);assert.equal(sent[0].p.url,'/finanzas/locales?asistencia=1&day='+day);
});
test('unknown store hours still allow punches and missing marks surface the following day',t=>{
 const db=fixture(t),day='2026-11-02';schedule(db,day,'Belén','marjorie-bosque');
 assert.equal(evaluateClockAlerts(db,now(day)).length,0);
 assert.equal(evaluateClockAlerts(db,now('2026-11-03','08:00')).length,1);
 const r=clockRange(db,day,day,now('2026-11-03'))[0];assert.equal(r.charges.amount_cents,0);assert.equal(r.policy.hours,null);
});
test('confirmed tolerance includes 10:03 and late minutes start at 10:04',t=>{
 const db=fixture(t);schedule(db,'2026-11-02');schedule(db,'2026-11-03');
 assert.equal(punchClock(db,staff,{action:'in'},new Date('2026-11-02T10:03:59-05:00')).late_minutes,0);
 assert.equal(punchClock(db,staff,{action:'in'},now('2026-11-03','10:04')).late_minutes,1);
 assert.equal(clockRange(db,'2026-11-03','2026-11-03',now('2026-11-03'))[0].charges.amount_cents,0);
});
