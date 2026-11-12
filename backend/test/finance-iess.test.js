import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {initFinanceDb,safeMember,financeDay} from '../src/finance-db.js';
import {encryptDocument} from '../src/finance-ai.js';
import {createIessRequest,matchIessPayments,iessDetails,analyzeIess} from '../src/finance-iess.js';
import {requireRequest,recordRequestPayment,workflowSource} from '../src/finance-workflow.js';
import {importBank,createMovement,reconcile} from '../src/finance-service.js';
process.env.NODE_ENV='test';
function fixture(t){
 const db=new Database(':memory:');initFinanceDb(db);t.after(()=>db.close());
 const add=(username,role)=>{const id=db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES (?,?,'unused',?,'[\"producalza\",\"personal\"]')").run(username,username,role).lastInsertRowid;return safeMember(db.prepare('SELECT * FROM finance_members WHERE id=?').get(id));};
 const owner=add('marlon','owner'),norma=add('normita','collector'),staff=add('selena','collector');
 const evidence=()=>Number(db.prepare("INSERT INTO finance_evidence(business_id,name,mime,bytes,sha256,encrypted,created_by) VALUES ('producalza','fixture.pdf','application/pdf',10,?,?,'normita')").run(crypto.randomUUID(),encryptDocument(Buffer.from('%PDF-test'))).lastInsertRowid);
 const account=Number(db.prepare("INSERT INTO finance_accounts(business_id,bank,name,kind,last_four,opening_cents,opening_date) VALUES (NULL,'Pichincha','Fixture','bank','1234',100000,'2026-01-01')").run().lastInsertRowid);
 const body={request_id:crypto.randomUUID(),business_id:'producalza',amount_cents:12345,evidence_id:evidence(),comprobante:'000123456',ruc:'1802727196001',legal_name:'Empleador de prueba',concept:'Aportes octubre'};
 return {db,owner,norma,staff,evidence,account,body};
}
test('IESS request preserves identifiers, requires evidence, permission and all data, and does not debit',t=>{
 const f=fixture(t),{db,norma,staff,owner,body}=f;
 assert.throws(()=>createIessRequest(db,staff,body),e=>e.status===403);
 assert.throws(()=>createIessRequest(db,norma,{...body,ruc:body.ruc+'001'}),/13/);
 assert.throws(()=>createIessRequest(db,norma,{...body,evidence_id:999}),/planilla/);
 const r=createIessRequest(db,norma,body);assert.equal(r.movement.is_payment_request,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);
 assert.equal(iessDetails(db,r.movement.id).comprobante,'000123456');
 assert.equal(createIessRequest(db,norma,{...body,request_id:crypto.randomUUID()}).duplicate,true);
 assert.throws(()=>createIessRequest(db,norma,{...body,amount_cents:20}),e=>e.status===409);
 assert.equal(requireRequest(db,owner,r.movement.id).remaining_cents,12345);
 assert.equal(workflowSource(db).requests.find(x=>x.id===r.movement.id).request_kind,'iess');
});
test('automatic IESS match uses bank debit plus identity, never amount alone; repeat does not debit twice',t=>{
 const {db,owner,norma,body,account}=fixture(t),r=createIessRequest(db,norma,body).movement;
 const result=importBank(db,owner,{account_id:account,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:-12345,reference:'bank-001',description:'Pago servicio',external_id:'fixture-iess'}]});
 assert.equal(matchIessPayments(db),0);
 db.prepare('UPDATE finance_bank_transactions SET description=? WHERE id=?').run('IESS comprobante 000123456',result.transaction_ids[0]);
 assert.equal(matchIessPayments(db),1);assert.equal(matchIessPayments(db),0);
 assert.equal(requireRequest(db,owner,r.id).remaining_cents,0);
 assert.equal(requireRequest(db,owner,r.id).paid_cents,12345);
 assert.equal(iessDetails(db,r.id).payment.bank,'Pichincha');
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-12345);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,1);
});
test('ambiguous RUC with two equal planillas never auto-matches',t=>{
 const {db,owner,norma,body,account}=fixture(t);createIessRequest(db,norma,body);
 createIessRequest(db,norma,{...body,request_id:crypto.randomUUID(),comprobante:'000123457'});
 importBank(db,owner,{account_id:account,rows:[{day:financeDay(),amount_cents:-12345,reference:'bank-002',description:'IESS RUC '+body.ruc}]});
 assert.equal(matchIessPayments(db),0);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,0);
});
test('owner proof debits the selected bank once; planilla itself cannot be proof; later mail deduplicates',t=>{
 const {db,owner,norma,body,account,evidence}=fixture(t),r=createIessRequest(db,norma,body).movement;
 const pay={request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:body.evidence_id,account_id:account,amount_cents:12345,paid_day:financeDay(),reference:'BANK-12345'};
 assert.throws(()=>recordRequestPayment(db,owner,r.id,pay),/planilla IESS/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_payments').get().n,0);
 pay.evidence_id=evidence();recordRequestPayment(db,owner,r.id,pay);assert.equal(recordRequestPayment(db,owner,r.id,pay).duplicate,true);
 assert.equal(requireRequest(db,owner,r.id).remaining_cents,0);
 importBank(db,owner,{account_id:account,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:-12345,reference:'BANK-12345',description:'Pago IESS 000123456',external_id:'later-mail'}]});
 assert.equal(matchIessPayments(db),0);assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-12345);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,1);
});
test('IESS extractor separates RUC, payable total and planilla reference without implying paid',async t=>{
 const old=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture';t.after(()=>{globalThis.fetch=old;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;});
 globalThis.fetch=async(url,options)=>{const p=JSON.parse(options.body);assert.match(p.instructions,/13 dígitos/);assert.match(p.instructions,/no acredita pago/);assert.equal(p.store,false);return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({is_iess:true,amount_cents:12345,comprobante:'000123456',ruc:'1802727196001',legal_name:'Fixture',concept:'Aportes octubre',warnings:[]})}]}]}));};
 const r=await analyzeIess({mime:'application/pdf',encrypted:encryptDocument(Buffer.from('%PDF-test'))});assert.equal(r.amount_cents,12345);assert.equal(r.comprobante,'000123456');
});
test('bank-first generic expense is reused and classified without another debit or expense',t=>{
 const {db,owner,norma,body,account}=fixture(t),request=createIessRequest(db,norma,body).movement;
 const bank=importBank(db,owner,{account_id:account,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:-12345,reference:'BANK-77',description:'IESS planilla 000123456'}]}).transaction_ids[0];
 const expense=createMovement(db,owner,{business_id:'personal',kind:'expense',amount_cents:12345,day:financeDay(),category:'Otros',counterparty:'IESS',description:'Pago recibido por correo',account_id:account,reference:'BANK-77'});
 db.prepare("UPDATE finance_movements SET status='reported',source_system='bank-email' WHERE id=?").run(expense.id);
 reconcile(db,owner,{movement_id:expense.id,bank_transaction_id:bank,amount_cents:12345});
 assert.equal(matchIessPayments(db),1);assert.equal(db.prepare('SELECT business_id FROM finance_movements WHERE id=?').get(expense.id).business_id,'producalza');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_movements WHERE is_payment_request=0 AND status<>'rejected'").get().n,1);
 assert.equal(requireRequest(db,owner,request.id).remaining_cents,0);
});
test('owner proof associates an already debited generic expense using the bank reference',t=>{
 const {db,owner,norma,body,account,evidence}=fixture(t),request=createIessRequest(db,norma,body).movement;
 const bank=importBank(db,owner,{account_id:account,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:-12345,reference:'BANK-88',description:'Pago de servicios'}]}).transaction_ids[0];
 const expense=createMovement(db,owner,{business_id:'personal',kind:'expense',amount_cents:12345,day:financeDay(),category:'Otros',counterparty:'Servicio',description:'Pago de servicios',account_id:account,reference:'BANK-88'});
 db.prepare("UPDATE finance_movements SET status='reported',source_system='bank-email' WHERE id=?").run(expense.id);
 reconcile(db,owner,{movement_id:expense.id,bank_transaction_id:bank,amount_cents:12345});
 const r=recordRequestPayment(db,owner,request.id,{request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:evidence(),account_id:account,amount_cents:12345,paid_day:financeDay(),reference:'BANK-88'});
 assert.equal(db.prepare('SELECT movement_id FROM finance_allocations WHERE bank_transaction_id=?').get(bank).movement_id,r.payment.movement_id);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_movements WHERE is_payment_request=0 AND status<>'rejected'").get().n,1);
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-12345);
});
