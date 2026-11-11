import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initFinanceDb,financeDay} from '../src/finance-db.js';
import {putPrivateSetting,privateSetting} from '../src/finance-operations.js';
import {repairKnownAccountNumbers} from '../src/finance-start-clean.js';
import {ingestBankMessages,replayAutomaticBankMail} from '../src/finance-gmail.js';
import {encryptDocument} from '../src/finance-ai.js';
import {recordedAccountBalance} from '../src/finance-check-ledger.js';
import {initBankNotifications,ingestBankNotifications,reprocessBankNotifications} from '../src/finance-bank-notifications.js';
process.env.FINANCE_DOCUMENT_KEY='test-only-own-transfer-encryption-key-123456';
function fixture(t){
  const db=new Database(':memory:');initFinanceDb(db);t.after(()=>db.close());
  const keys=['FINANCE_GMAIL_AUTO_APPLY','FINANCE_GMAIL_AUTO_APPLY_AFTER'],old=keys.map(k=>process.env[k]);
  t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));
  process.env.FINANCE_GMAIL_AUTO_APPLY='1';process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER='2026-11-10T08:00:00Z';
  const from=Number(db.prepare("INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date,last_four) VALUES ('Origen','Pichincha','bank',100000,'2026-11-09','2186')").run().lastInsertRowid);
  const to=Number(db.prepare("INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date,last_four) VALUES ('Préstamo','Guayaquil','bank',10619,'2026-11-09','6207')").run().lastInsertRowid);
  putPrivateSetting(db,'own_account_registry',{owner_name:'Fixture Owner Full Name',accounts:[{account_id:from,bank:'Pichincha',number:'2200002186'},{account_id:to,bank:'Guayaquil',number:'0010006207'}]});
  const make=(id,reference='TEST901785612')=>({id,internalDate:String(Date.now()-30000),payload:{headers:[{name:'From',value:'banco@pichincha.com'},{name:'Subject',value:'NOTIFICACION BANCO PICHINCHA'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:`La transferencia solicitada será debitada de su cuenta, y acreditada en la cuenta destino en 1 hora. Cuenta de origen: ******2186 Banco destino: BANCO DE GUAYAQUIL S.A Cuenta acreditada: ******6207 Fecha: ${financeDay().split('-').reverse().join('/')} Nombre del beneficiario: Fixture Owner Full Name Identificación beneficiario: 0000000000 Monto: USD 113.03 Número de documento: ${reference}`}}});
  const balance=id=>recordedAccountBalance(db,db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(id));
  return {db,from,to,make,balance};
}
test('accepted Pichincha notice records both own-transfer legs immediately; retries and a second notice preserve cents',(t)=>{
  const f=fixture(t),m=f.make('pich-first');
  ingestBankMessages(f.db,[m]);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),21922);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_movements').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_own_transfers').get().n,1);
  ingestBankMessages(f.db,[m,{...m,id:'same-bank-operation-again'}]);replayAutomaticBankMail(f.db);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),21922);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,2);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_mail_messages WHERE state!='applied'").get().n,0);
});
test('a later receiving-bank email with another bank reference corroborates, never credits the transfer twice',(t)=>{
  const f=fixture(t);ingestBankMessages(f.db,[f.make('pich-first')]);
  initBankNotifications(f.db);
  const member=f.db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES ('Owner','owner','unused','owner','[]')").run().lastInsertRowid;
  const device={id:'own-phone',apps_json:JSON.stringify([{package_name:'guay.test',bank:'Guayaquil',account_id:f.to,automatic:true}]),created_at:new Date(Date.now()-3600000).toISOString()};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,'own-client',?,'fixture','fixturetoken',?,?,?)").run(device.id,member,device.apps_json,device.created_at,Date.now()+3600000);
  ingestBankNotifications(f.db,device,[{id:'guay-app-credit',package_name:'guay.test',posted_at:new Date(Date.now()-1000).toISOString(),text:'Recibiste $113,03 de Fixture Owner Full Name. Cuenta destino: ****6207'}]);
  assert.equal(f.balance(f.to),21922);
  assert.equal(f.db.prepare('SELECT state FROM finance_notification_events').get().state,'matched');
  const received={id:'guay-received',internalDate:String(Date.now()-1000),payload:{headers:[{name:'From',value:'avisos@bancoguayaquil.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=bancoguayaquil.com'}],body:{content:'Te confirmamos que Fixture Owner Full Name ha realizado una transferencia recibida. Cuenta destino: ****6207 Monto: USD 113.03 Referencia GUAY999999'}}};
  ingestBankMessages(f.db,[received]);replayAutomaticBankMail(f.db);
  assert.equal(f.balance(f.to),21922);assert.equal(f.balance(f.from),88697);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,2);
  assert.equal(f.db.prepare("SELECT state FROM finance_own_transfers").get().state,'destination_confirmed');
  assert.equal(f.db.prepare("SELECT state FROM finance_mail_messages WHERE id='guay-received'").get().state,'applied');
});
test('equal own transfers with different bank references remain two separate transfers',(t)=>{
  const f=fixture(t);ingestBankMessages(f.db,[f.make('transfer-one','OWNREF111'),f.make('transfer-two','OWNREF222')]);
  assert.equal(f.balance(f.from),77394);assert.equal(f.balance(f.to),33225);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_own_transfers').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,4);
});
test('a destination in another bank never matches an own account just because the final digits coincide',(t)=>{
  const f=fixture(t),m=f.make('external-destination');
  m.payload.body.content=m.payload.body.content.replace('BANCO DE GUAYAQUIL S.A','BANCO PROCREDIT S.A');
  ingestBankMessages(f.db,[m]);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),10619);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_own_transfers').get().n,0);
});
test('untrusted or rejected scheduled-transfer messages never post money',(t)=>{
  const f=fixture(t),untrusted=f.make('untrusted');
  untrusted.payload.headers=untrusted.payload.headers.filter(h=>h.name!=='Authentication-Results');
  const rejected=f.make('rejected');rejected.payload.body.content+=' Transferencia rechazada por fondos insuficientes.';
  ingestBankMessages(f.db,[untrusted,rejected]);
  assert.equal(f.balance(f.from),100000);assert.equal(f.balance(f.to),10619);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,0);
});
test('repairing the supplied PAGOS number reclassifies an already debited transfer and adds only its missing credit',(t)=>{
  const f=fixture(t),registry=privateSetting(f.db,'own_account_registry');
  const target=registry.accounts.find(a=>a.account_id===f.to);target.key='gyq-pagos';delete target.number;delete target.suffix;
  f.db.prepare("UPDATE finance_accounts SET name='Guayaquil · PAGOS · Ahorros',last_four='' WHERE id=?").run(f.to);
  putPrivateSetting(f.db,'own_account_registry',registry);
  const m=f.make('pagos-missing-number');m.payload.body.content=m.payload.body.content.replace('6207','2719');
  ingestBankMessages(f.db,[m]);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),10619);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
  assert.equal(repairKnownAccountNumbers(f.db).last_four,'2719');
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),10619);
  replayAutomaticBankMail(f.db);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),21922);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,2);
  replayAutomaticBankMail(f.db);assert.equal(f.balance(f.to),21922);
});
for(const phoneFirst of [true,false])test(`the real Pichincha successful-transfer notification links to the sending account; phone first: ${phoneFirst}`,(t)=>{
  const f=fixture(t);initBankNotifications(f.db);
  const member=f.db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES ('Owner','owner','unused','owner','[]')").run().lastInsertRowid;
  const device={id:'pich-phone',created_at:new Date(Date.now()-3600000).toISOString(),apps_json:JSON.stringify([{package_name:'pich.test',bank:'Pichincha',account_id:null,automatic:true}])};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,'pich-client',?,'fixture','pichtoken',?,?,?)").run(device.id,member,device.apps_json,device.created_at,Date.now()+3600000);
  const event={id:'pich-exitosa',package_name:'pich.test',posted_at:new Date(Date.now()-30000).toISOString(),title:'💵 ¡Transferencia exitosa!',text:'La transferencia interbancaria por $113.03 a la cuenta ******6207 fue exitosa.'};
  if(phoneFirst){
    ingestBankNotifications(f.db,device,[event]);
    assert.equal(f.balance(f.from),100000);assert.equal(f.balance(f.to),10619);
    const old={body:event.title+'\n'+event.text,bank:'Pichincha',amount_cents:11303,direction:null,account_id:null,reference:'',blocked:false};
    f.db.prepare('UPDATE finance_notification_events SET encrypted=?').run(encryptDocument(Buffer.from(JSON.stringify(old))));
    ingestBankMessages(f.db,[f.make('pich-source')]);
    reprocessBankNotifications(f.db);
  }else{
    ingestBankMessages(f.db,[f.make('pich-source')]);
    ingestBankNotifications(f.db,device,[event]);
  }
  const notice=f.db.prepare('SELECT * FROM finance_notification_events').get();
  assert.equal(notice.state,'matched');assert.equal(notice.account_id,f.from);
  assert.equal(notice.amount_cents,-11303);
  assert.equal(f.balance(f.from),88697);assert.equal(f.balance(f.to),21922);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,2);
});
test('an existing pending notice is upgraded by automatic replay, without reviving archived old mail',(t)=>{
  const f=fixture(t),m=f.make('stored-pending');
  const old={id:m.id,from:'banco@pichincha.com',subject:'NOTIFICACION BANCO PICHINCHA',body:m.payload.body.content,trusted:true,pending:true,event:'pending',received_at:new Date(Number(m.internalDate)).toISOString(),amount_cents:11303,origin_account_id:f.from,destination_account_id:f.to,account_id:f.from,reference:'TEST901785612',bank:'Pichincha'};
  const save=f.db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,transaction_key,created_at,archived_at) VALUES (?,?,?,'pending',?,'Pichincha|TEST901785612|11303',?,?)");
  save.run(m.id,old.received_at,encryptDocument(Buffer.from(JSON.stringify(old))),f.from,old.received_at,null);
  save.run('archived-old',old.received_at,encryptDocument(Buffer.from(JSON.stringify({...old,id:'archived-old'}))),f.from,old.received_at,old.received_at);
  assert.equal(replayAutomaticBankMail(f.db).applied,1);
  assert.equal(f.balance(f.to),21922);assert.equal(f.balance(f.from),88697);
  assert.equal(f.db.prepare("SELECT state FROM finance_mail_messages WHERE id='archived-old'").get().state,'pending');
});
