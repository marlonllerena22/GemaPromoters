import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initFinanceDb} from '../src/finance-db.js';
import {createBankMailCorroborator} from '../src/finance-bank-mail-corroboration.js';
function fixture(t){
  const db=new Database(':memory:');initFinanceDb(db);t.after(()=>db.close());
  db.exec("CREATE TABLE finance_notification_events(id INTEGER PRIMARY KEY,state TEXT,archived_at TEXT)");
  db.prepare("INSERT INTO finance_mail_oauth VALUES ('gmail',X'00','fixture')").run();
  db.prepare("INSERT INTO finance_notification_events VALUES (1,'review',NULL)").run();
  const queue=[],schedule=(fn,delay)=>{queue.push({fn,delay});return {unref(){}};};
  return {db,queue,schedule};
}
test('phone notice triggers immediate mail lookup, coalesces repeated requests and stops after matching',(t)=>{
  const f=fixture(t);let syncs=0;
  const request=createBankMailCorroborator(f.db,{schedule:f.schedule,syncMail:async()=>{syncs++;f.db.prepare("UPDATE finance_notification_events SET state='matched'").run();},matchNotifications:()=>{}});
  assert.equal(request(),true);assert.equal(f.queue.length,1);assert.equal(f.queue[0].delay,0);
  assert.equal(request(),false);
  return f.queue.shift().fn().then(()=>{assert.equal(syncs,1);assert.equal(f.queue.length,0);assert.equal(request(),false);});
});
test('brief mail-delivery delay is retried automatically and no new request is required',async(t)=>{
  const f=fixture(t);let syncs=0;
  const request=createBankMailCorroborator(f.db,{schedule:f.schedule,syncMail:async()=>{syncs++;if(syncs===2)f.db.prepare("UPDATE finance_notification_events SET state='matched'").run();},matchNotifications:()=>{}});
  request();await f.queue.shift().fn();
  assert.equal(f.queue[0].delay,4000);await f.queue.shift().fn();
  assert.equal(syncs,2);assert.equal(f.queue.length,0);
});
test('unresolved notices have bounded retries, archived notices and disconnected mail do not start work',async(t)=>{
  const f=fixture(t);let syncs=0;
  const request=createBankMailCorroborator(f.db,{schedule:f.schedule,syncMail:async()=>{syncs++;},matchNotifications:()=>{}});
  request();for(let i=0;i<3;i++)await f.queue.shift().fn();
  assert.equal(syncs,3);assert.equal(f.queue.length,0);assert.equal(request(),false);
  f.db.prepare("INSERT INTO finance_notification_events VALUES (2,'review','archived')").run();assert.equal(request(),false);
  f.db.prepare("INSERT INTO finance_notification_events VALUES (3,'review',NULL)").run();f.db.prepare('DELETE FROM finance_mail_oauth').run();assert.equal(request(),false);
});
