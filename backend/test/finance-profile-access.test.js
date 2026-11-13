import crypto from 'node:crypto';
import {encryptDocument} from '../src/finance-ai.js';
import {importPlannedCalendar} from '../src/finance-calendar-import.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initFinanceDb,financeDay} from '../src/finance-db.js';
import {initProfileAccess,profileForDay,restrictProfileRoute} from '../src/finance-profile-access.js';
import {profilePermissions,canRequestPayments,canSeeAccountBalance} from '../../shared/finance-access.mjs';
import {initRetail,retailReport,retailEntry} from '../src/finance-retail.js';
import {saveStaffSchedule} from '../src/finance-staff-calendar.js';
import {visibleAccounts} from '../src/finance-service.js';
import {storeReceiptRoute} from '../../shared/finance-store-receipts.mjs';
import {canSeePaymentRequest} from '../../shared/finance-workflow.mjs';
import {canConfirmStore} from '../src/finance-operations.js';
import {registerQuickEntry} from '../src/finance-quick.js';

const user=(username,unit_ids=[],role='collector')=>profilePermissions({id:1,username,name:username,role,business_ids:['marjorie','producalza','gemashow'],unit_ids,work_view:username==='german'});
const owner=user('marlon',[],'owner');
function fixture(t){const db=new Database(':memory:');initFinanceDb(db);initProfileAccess(db,{seedAccounts:true});initRetail(db);t.after(()=>db.close());return db;}
test('explicit profile matrix: only named requesters, checks for Norma, balance exceptions only',()=>{
 for(const name of ['ana','jose','norma','normita','morelia','german'])assert.equal(canRequestPayments(user(name)),true,name);
 for(const name of ['lili','martha','belen','nayeli','yamileth','selena','stranger','marlon'])assert.equal(canRequestPayments(user(name)),false,name);
 assert.equal(user('norma').checks_manage,true);assert.equal(user('norma').checks_clear,false);
 for(const name of ['lili','selena','norma','ana','manager'])assert.equal(canSeeAccountBalance(user(name),{holder_key:'lili'}),false);
 assert.equal(canSeeAccountBalance(user('morelia'),{holder_key:'lili'}),true);assert.equal(canSeeAccountBalance(user('morelia'),{holder_key:'more-sur'}),true);assert.equal(canSeeAccountBalance(user('morelia'),{}),false);
});
test('calendar changes replacement scope immediately; future assignments do not add worked payroll days',t=>{
 const db=fixture(t),martha=user('martha',['marjorie-norte','marjorie-bosque']),day=financeDay();
 assert.deepEqual(profileForDay(db,martha).assigned_unit_ids,[]);
 saveStaffSchedule(db,user('morelia'),{day,employee:'Martha',unit_id:'marjorie-bosque',worked:false});
 assert.deepEqual(profileForDay(db,martha).assigned_unit_ids,['marjorie-bosque']);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_retail_attendance').get().n,0);
 saveStaffSchedule(db,user('morelia'),{day,employee:'Martha',unit_id:'marjorie-bosque',worked:true});assert.equal(db.prepare('SELECT weight FROM finance_retail_attendance').get().weight,1);
 saveStaffSchedule(db,user('morelia'),{day,employee:'Martha',unit_id:null,worked:false});assert.equal(profileForDay(db,martha).shift_off,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_retail_attendance').get().n,0);
 assert.throws(()=>saveStaffSchedule(db,martha,{day,employee:'Martha',unit_id:'marjorie-bosque'}),e=>e.status===403);
 assert.throws(()=>saveStaffSchedule(db,owner,{day:'2099-01-01',employee:'Martha',unit_id:'marjorie-bosque',worked:true}));
});
test('staff cannot retrieve cash through reports or bank balances; Morelia sees only dedicated accounts',t=>{
 const db=fixture(t),day=financeDay();retailEntry(db,owner,{request_id:'opening-test',unit_id:'marjorie-sur',kind:'opening',day,amount_cents:987654,description:'Fondo'});
 const staff=user('selena',['marjorie-sur']);const r=retailReport(db,staff,{day,mode:'day',unit_id:'marjorie-sur'});
 assert.equal(r.stores[0].cash.hidden,true);assert.equal(r.stores[0].cash.balance_cents,null);assert.deepEqual(r.stores[0].cash.entries,[]);assert.equal(r.total.cash_cents,null);assert.equal('management' in r.stores[0],false);
 assert.deepEqual(visibleAccounts(db,staff),[]);assert.equal(visibleAccounts(db,user('morelia')).length,4);assert.ok(visibleAccounts(db,user('morelia')).every(a=>['lili','more-sur'].includes(a.holder_key)));
 assert.equal(retailReport(db,owner,{day,mode:'day',unit_id:'marjorie-sur'}).stores[0].cash.balance_cents,987654);
 assert.throws(()=>retailEntry(db,staff,{request_id:'count-test',unit_id:'marjorie-sur',kind:'count',day,amount_cents:100,description:'Conteo'}),e=>e.status===403);
});
test('warehouse sees only own requests and staff cannot bypass request restrictions',t=>{
 const db=fixture(t),ana=user('ana');assert.equal(canSeePaymentRequest({business_id:'producalza',created_by:'jose'},ana),false);assert.equal(canSeePaymentRequest({business_id:'producalza',created_by:'ana'},ana),true);
 assert.equal(restrictProfileRoute(ana,'/retail/report','GET'),false);assert.equal(restrictProfileRoute(ana,'/orders','GET'),false);assert.equal(restrictProfileRoute(ana,'/payment-requests/1','GET'),true);
 assert.throws(()=>registerQuickEntry(db,user('selena',['marjorie-sur']),{request_id:'request-test-123456',text:'Solicito pagar $80',request:true}),e=>e.status===403);
});
test('receipt routes and reviewers distinguish Norte, Sur exceptions and the new More account',()=>{
 const receipt=(unit,bank,holder)=>({business_id:'marjorie',kind:'income',unit_id:unit,receiving_bank:bank,account_holder:holder});
 for(const unit of ['marjorie-valle','marjorie-bosque'])assert.equal(storeReceiptRoute(receipt(unit,'Pichincha')).name,'Marlon');
 assert.equal(storeReceiptRoute(receipt('marjorie-norte','Pichincha')).name,'Liliana');
 assert.equal(storeReceiptRoute(receipt('marjorie-sur','Guayaquil')).name,'Marlon');
 assert.equal(storeReceiptRoute(receipt('marjorie-sur','Produbanco')).name,'Morelia');
 const sur=receipt('marjorie-sur','Pichincha','more-sur');assert.equal(canConfirmStore(user('morelia'),sur),true);assert.equal(canConfirmStore(user('lili'),sur),false);assert.equal(canConfirmStore(user('morelia'),receipt('marjorie-sur','Guayaquil','owner')),false);
 assert.equal(canConfirmStore(user('lili'),receipt('marjorie-norte','Pichincha','lili')),true);
});


test('profile upgrade preserves existing balances and seeds unknown accounts only once',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());initFinanceDb(db);
 db.prepare("INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date) VALUES ('Existing','Pichincha','bank',12345,?)").run(financeDay());
 db.exec('ALTER TABLE finance_accounts DROP COLUMN holder_key');
 initProfileAccess(db,{seedAccounts:true});initProfileAccess(db,{seedAccounts:true});
 assert.equal(db.prepare("SELECT opening_cents FROM finance_accounts WHERE name='Existing'").get().opening_cents,12345);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_accounts').get().n,5);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_accounts WHERE holder_key IS NOT NULL AND verified_at IS NULL AND last_four='' ").get().n,4);
});


test('encrypted calendar import preserves attendance, future payroll and later user edits on replay',t=>{
 const oldKey=process.env.FINANCE_DOCUMENT_KEY;process.env.FINANCE_DOCUMENT_KEY='calendar-test-fixture-key-thirty-two-characters';t.after(()=>{if(oldKey===undefined)delete process.env.FINANCE_DOCUMENT_KEY;else process.env.FINANCE_DOCUMENT_KEY=oldKey;});
 const db=fixture(t);db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES ('Marlon','marlon','unused','owner','[\"marjorie\"]')").run();
 const day=financeDay(),month=day.slice(0,7);saveStaffSchedule(db,owner,{day,employee:'Martha',unit_id:'marjorie-bosque',worked:true});
 const job={kind:'planned-calendar-v1',id:crypto.randomUUID(),owner:'marlon',month,expires_at:new Date(Date.now()+60000).toISOString(),entries:[{day,employee:'Martha',unit_id:'marjorie-bosque'},{day,employee:'Belén',unit_id:'marjorie-bosque'},{day,employee:'Yamileth',unit_id:null}]};
 const cipher=j=>encryptDocument(Buffer.from(JSON.stringify(j))).toString('base64'),payload=cipher(job),before=db.prepare('SELECT * FROM finance_retail_attendance').all();
 const result=importPlannedCalendar(db,payload);assert.equal(result.verified,true);assert.equal(result.assigned,2);assert.equal(result.rest,1);assert.equal(result.preserved_worked,1);assert.deepEqual(db.prepare('SELECT * FROM finance_retail_attendance').all(),before);
 saveStaffSchedule(db,owner,{day,employee:'Belén',unit_id:'marjorie-norte'});assert.equal(importPlannedCalendar(db,payload).duplicate,true);assert.equal(db.prepare("SELECT unit_id FROM finance_staff_schedule WHERE employee='Belén'").get().unit_id,'marjorie-norte');
 const conflict=importPlannedCalendar(db,cipher({...job,id:crypto.randomUUID(),entries:[{day,employee:'Martha',unit_id:null}]}));assert.equal(conflict.conflicts,1);assert.equal(conflict.verified,false);assert.deepEqual(db.prepare('SELECT * FROM finance_retail_attendance').all(),before);
 assert.equal(importPlannedCalendar(db,cipher({...job,id:crypto.randomUUID(),expires_at:'2000-01-01'})).rejected,true);
 assert.equal(importPlannedCalendar(db,cipher({...job,id:crypto.randomUUID(),entries:[job.entries[0],job.entries[0]]})).rejected,true);
});
