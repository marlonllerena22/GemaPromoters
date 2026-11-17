import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {initFinanceDb,safeMember,financeDay} from '../src/finance-db.js';
import {encryptDocument} from '../src/finance-ai.js';
import {createIessRequest,matchIessPayments,iessDetails,analyzeIess} from '../src/finance-iess.js';
import {requireRequest,recordRequestPayment,workflowSource} from '../src/finance-workflow.js';
import {importBank,createMovement,reconcile} from '../src/finance-service.js';
import {parseBankMail,applyMailDraft} from '../src/finance-gmail.js';
import {putPrivateSetting} from '../src/finance-operations.js';
import {suggestOriginAccount} from '../src/finance-origin-account.js';
import {enrichServiceProof} from '../src/finance-service-payment-proof.js';
import {repairIessPayments} from '../src/finance-iess-repair.js';
import {recordedAccountBalance} from '../src/finance-check-ledger.js';
import {repairRequestPayments} from '../src/finance-payment-repair.js';
import {applyTransferFee} from '../src/finance-transfer-fees.js';
process.env.NODE_ENV='test';
function fixture(t){
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-12T23:00:00Z')});
 const db=new Database(':memory:');initFinanceDb(db);t.after(()=>db.close());
 const add=(username,role)=>{const id=db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES (?,?,'unused',?,'[\"producalza\",\"personal\"]')").run(username,username,role).lastInsertRowid;return safeMember(db.prepare('SELECT * FROM finance_members WHERE id=?').get(id));};
 const owner=add('marlon','owner'),norma=add('normita','collector'),staff=add('selena','collector');
 const evidence=()=>Number(db.prepare("INSERT INTO finance_evidence(business_id,name,mime,bytes,sha256,encrypted,analysis,created_by) VALUES ('producalza','fixture.pdf','application/pdf',10,?,?,?, 'normita')").run(crypto.randomUUID(),encryptDocument(Buffer.from('%PDF-test')),JSON.stringify({amount_cents:12345})).lastInsertRowid);
 const account=Number(db.prepare("INSERT INTO finance_accounts(business_id,bank,name,kind,last_four,opening_cents,opening_date) VALUES (NULL,'Pichincha','Fixture','bank','1234',100000,'2026-01-01')").run().lastInsertRowid);
 const body={request_id:crypto.randomUUID(),business_id:'producalza',amount_cents:12345,evidence_id:evidence(),comprobante:'000123456',ruc:'1802727196001',legal_name:'Empleador de prueba',concept:'Aportes octubre'};
 return {db,owner,norma,staff,evidence,account,body};
}

function ordinaryRequest(f){
 const r=createMovement(f.db,f.owner,{business_id:'producalza',kind:'expense',amount_cents:12345,day:financeDay(),category:'Otros',counterparty:'Proveedor de prueba',description:'Petición de transferencia'});
 f.db.prepare('UPDATE finance_movements SET is_payment_request=1 WHERE id=?').run(r.id);
 return {id:r.id,body:{request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:f.evidence(),account_id:f.account,amount_cents:12345,paid_day:financeDay(),reference:'TRANSFER-123'}};
}

for(const [destination,explicit,fee] of [['Banco Pichincha S.A.',null,0],['Banco del Pacífico',null,41],['Guayaquil',0,0],[null,null,0]])test(`payment fee only for a known different bank: ${destination}, explicit ${explicit}`,t=>{
 const f=fixture(t),r=ordinaryRequest(f),a=f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account);
 f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:12345,receiving_bank:destination,fee_total_cents:explicit}),r.body.evidence_id);
 const p=recordRequestPayment(f.db,f.owner,r.id,r.body);assert.equal(recordedAccountBalance(f.db,a),100000-12345-fee);
 assert.equal(p.ledger.fee?.amount_cents||0,fee);recordRequestPayment(f.db,f.owner,r.id,r.body);assert.equal(recordedAccountBalance(f.db,a),100000-12345-fee);
 assert.equal(requireRequest(f.db,f.owner,r.id).remaining_cents,0);
});

test('bank fee split into commission and IVA or combined is corroborated without a second charge',t=>{
 const f=fixture(t),r=ordinaryRequest(f),a=f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account);
 f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:12345,receiving_bank:'Guayaquil'}),r.body.evidence_id);
 const p=recordRequestPayment(f.db,f.owner,r.id,r.body);
 for(const [amount,description,ref] of [[-36,'Comisión transferencia interbancaria','TRANSFER-123'],[-5,'IVA cobrado','TRANSFER-123'],[-41,'Comisión con IVA','TRANSFER-123-FEE']]){
  importBank(f.db,f.owner,{account_id:f.account,source_system:'bank-email',rows:[{day:financeDay(),occurred_at:new Date().toISOString(),amount_cents:amount,description,reference:ref,external_id:'fee-'+amount}]});
 }
 assert.equal(recordedAccountBalance(f.db,a),87614);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,2);
 assert.equal(f.db.prepare('SELECT estimated FROM finance_transfer_fees').get().estimated,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,2);
});

test('a verified waiver reverses only the calculated fee, with original checkpoint timing',t=>{
 const f=fixture(t),r=ordinaryRequest(f),a=f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account);
 f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:12345,receiving_bank:'Guayaquil'}),r.body.evidence_id);
 const p=recordRequestPayment(f.db,f.owner,r.id,r.body);
 applyTransferFee(f.db,f.owner,p.ledger.bank_transaction_id,{destination_bank:'Guayaquil',explicit_cents:0});
 assert.equal(recordedAccountBalance(f.db,a),87655);
 applyTransferFee(f.db,f.owner,p.ledger.bank_transaction_id,{destination_bank:'Guayaquil'});assert.equal(recordedAccountBalance(f.db,a),87655);
});

test('own-account payment proof debits origin, credits destination, only fee is an expense and receiving notice cannot duplicate it',t=>{
 const f=fixture(t),r=ordinaryRequest(f);
 const to=Number(f.db.prepare("INSERT INTO finance_accounts(name,bank,kind,last_four,opening_cents,opening_date) VALUES ('Destino','Guayaquil','bank','6789',20000,'2026-01-01')").run().lastInsertRowid);
 putPrivateSetting(f.db,'own_account_registry',{owner_name:'Owner Fixture Full Name',accounts:[{account_id:f.account,bank:'Pichincha',number:'0011234'},{account_id:to,bank:'Guayaquil',number:'0016789'}]});
 f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:12345,receiving_bank:'Banco de Guayaquil S.A.',destination_account_suffix:'6789',origin_account_suffix:'1234'}),r.body.evidence_id);
 const p=recordRequestPayment(f.db,f.owner,r.id,r.body);assert.ok(p.ledger.own_transfer);
 assert.equal(recordedAccountBalance(f.db,f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account)),87614);
 assert.equal(recordedAccountBalance(f.db,f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(to)),32345);
 importBank(f.db,f.owner,{account_id:to,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:12345,reference:'TRANSFER-123',external_id:'receiver'}]});
 assert.equal(recordedAccountBalance(f.db,f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(to)),32345);
 assert.equal(f.db.prepare("SELECT SUM(amount_cents) n FROM finance_movements WHERE kind='expense' AND is_payment_request=0 AND status='reconciled'").get().n,41);
});
test('ordinary transfer proof immediately debits the selected account once and reconciles the request payment',t=>{
 const f=fixture(t),r=ordinaryRequest(f),account=f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account);
 const out=recordRequestPayment(f.db,f.owner,r.id,r.body);
 assert.equal(out.ledger.state,'debited');assert.equal(out.ledger.balance_delta_cents,-12345);
 assert.equal(recordedAccountBalance(f.db,account),87655);
 assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(out.payment.movement_id).status,'reconciled');
 assert.equal(requireRequest(f.db,f.owner,r.id).remaining_cents,0);
 assert.equal(recordRequestPayment(f.db,f.owner,r.id,r.body).ledger.state,'matched');
 for(const source of ['bank-email','bank-notification'])importBank(f.db,f.owner,{account_id:f.account,source_system:source,rows:[{day:financeDay(),amount_cents:-12345,reference:'TRANSFER-123',external_id:source+'-proof'}]});
 assert.equal(recordedAccountBalance(f.db,account),87655);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,1);
});
test('bank-first ordinary payment reuses its debit and merges the generic bank expense',t=>{
 const f=fixture(t),r=ordinaryRequest(f);
 const bank=importBank(f.db,f.owner,{account_id:f.account,source_system:'bank-email',rows:[{day:financeDay(),amount_cents:-12345,reference:'TRANSFER-123',external_id:'bank-first'}]}).transaction_ids[0];
 const old=createMovement(f.db,f.owner,{business_id:'personal',kind:'expense',amount_cents:12345,day:financeDay(),category:'Otros',counterparty:'Proveedor de prueba',description:'Aviso bancario',account_id:f.account,reference:'TRANSFER-123'});
 f.db.prepare("UPDATE finance_movements SET status='reported',source_system='bank-email' WHERE id=?").run(old.id);
 reconcile(f.db,f.owner,{movement_id:old.id,bank_transaction_id:bank,amount_cents:12345});
 const out=recordRequestPayment(f.db,f.owner,r.id,r.body);assert.equal(out.ledger.state,'matched');assert.equal(out.ledger.balance_delta_cents,0);
 assert.equal(f.db.prepare('SELECT movement_id FROM finance_allocations WHERE bank_transaction_id=?').get(bank).movement_id,out.payment.movement_id);
 assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(old.id).status,'rejected');
 const other=ordinaryRequest(f);assert.throws(()=>recordRequestPayment(f.db,f.owner,other.id,other.body),/ya respalda otro pago/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_payments').get().n,1);
});
test('proof debit after a same-day balance checkpoint uses declaration time and survives delayed mail',t=>{
 const f=fixture(t),r=ordinaryRequest(f),account=f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account);
 f.db.prepare("INSERT INTO finance_balance_checkpoints(account_id,as_of_at,balance_cents,created_by,source_hash,created_at) VALUES (?,?,?,?,'fixture-checkpoint','2026-11-12T22:00:00.000Z')").run(f.account,'2026-11-12T22:00:00.000Z',50000,'marlon');
 const out=recordRequestPayment(f.db,f.owner,r.id,r.body);
 assert.equal(out.ledger.balance_delta_cents,-12345);assert.equal(recordedAccountBalance(f.db,account),37655);
 const b=f.db.prepare('SELECT * FROM finance_bank_transactions WHERE id=?').get(out.ledger.bank_transaction_id);assert.equal(financeDay(b.occurred_at),financeDay());
});
test('ordinary payment rejects partial amounts, unconfirmed submissions and mismatching proof without changing balances',t=>{
 const f=fixture(t),r=ordinaryRequest(f);
 for(const override of [{confirm_paid:false},{amount_cents:12344},{account_id:999}])assert.throws(()=>recordRequestPayment(f.db,f.owner,r.id,{...r.body,...override}));
 f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:1000}),r.body.evidence_id);
 assert.throws(()=>recordRequestPayment(f.db,f.owner,r.id,r.body),/Comprobante incorrecto/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_payments').get().n,0);
});

test('repair of an explicitly selected legacy payment is atomic, once-only and bounded by the expected debit',t=>{
 const f=fixture(t),r=ordinaryRequest(f),out=recordRequestPayment(f.db,f.owner,r.id,r.body);
 f.db.prepare('DELETE FROM finance_allocations WHERE movement_id=?').run(out.payment.movement_id);
 f.db.prepare('DELETE FROM finance_bank_transactions WHERE id=?').run(out.ledger.bank_transaction_id);
 f.db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(out.payment.movement_id);
 const job={kind:'request-payment-debits-v1',id:crypto.randomUUID(),day:financeDay(),owner:'marlon',expires_at:new Date(Date.now()+60000).toISOString(),entries:[{id:out.payment.id,account_id:f.account,amount_cents:12345,reference:r.body.reference,expected_balance_delta_cents:-1}]};
 assert.throws(()=>repairRequestPayments(f.db,job),/Balance changed/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);
 job.entries[0].expected_balance_delta_cents=-12345;
 const result=repairRequestPayments(f.db,job);assert.equal(result.results[0].balance_delta_cents,-12345);
 assert.deepEqual(repairRequestPayments(f.db,job),result);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,1);
 assert.throws(()=>repairRequestPayments(f.db,{...job,id:crypto.randomUUID(),day:'2026-11-11'}));
});

test('legacy repair before a newer manual balance preserves that balance',t=>{
 const f=fixture(t),r=ordinaryRequest(f),out=recordRequestPayment(f.db,f.owner,r.id,r.body);
 f.db.prepare('DELETE FROM finance_allocations WHERE movement_id=?').run(out.payment.movement_id);f.db.prepare('DELETE FROM finance_bank_transactions WHERE id=?').run(out.ledger.bank_transaction_id);f.db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(out.payment.movement_id);
 f.db.prepare("UPDATE finance_payments SET created_at='2026-11-12T20:00:00.000Z' WHERE id=?").run(out.payment.id);
 f.db.prepare("INSERT INTO finance_balance_checkpoints(account_id,as_of_at,balance_cents,created_by,source_hash,created_at) VALUES (?,'2026-11-12T22:00:00.000Z',50000,'marlon','fixture-new-balance','2026-11-12T22:00:00.000Z')").run(f.account);
 const job={kind:'request-payment-debits-v1',id:crypto.randomUUID(),day:financeDay(),owner:'marlon',expires_at:new Date(Date.now()+60000).toISOString(),entries:[{id:out.payment.id,account_id:f.account,amount_cents:12345,reference:r.body.reference,expected_balance_delta_cents:0}]};
 const result=repairRequestPayments(f.db,job);assert.equal(result.results[0].state,'included');assert.equal(recordedAccountBalance(f.db,f.db.prepare('SELECT * FROM finance_accounts WHERE id=?').get(f.account)),50000);
});
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
function serviceMail(db,account,amount,reference,ruc){
 db.prepare("UPDATE finance_accounts SET bank='Produbanco' WHERE id=?").run(account);
 const registry={accounts:[{account_id:account,bank:'Produbanco',number:'2000001234'}]};putPrivateSetting(db,'own_account_registry',registry);
 const day=financeDay(),[year,month,date]=day.split('-'),months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
 const id='fixture-'+reference,p=parseBankMail({id,internalDate:String(Date.parse(day+'T22:05:00Z')),payload:{headers:[{name:'From',value:'bancaenlinea@produbanco.com'},{name:'Subject',value:'Pago de servicio por USD '+(amount/100).toFixed(2)},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=produbanco.com'}],body:{content:`Fecha y Hora: ${date}/${months[Number(month)-1]}/${year} 17:03 Transacción: Pago de Servicio PAGO IESS Te informamos que el siguiente pago se ha realizado. Suministro: ${ruc} Monto: USD ${(amount/100).toFixed(2)} Cuenta Débito: XXXXXX1234 Descripción: PAGO IESS Referencia: ${reference}`}}},registry);
 db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,created_at) VALUES (?,?,?,'draft',?,?)").run(id,p.received_at,encryptDocument(Buffer.from(JSON.stringify(p))),p.account_id,p.received_at);
 return p;
}
test('Produbanco service mail resolves debit account, RUC, real reference and operation time',t=>{
 const {db,account,owner}=fixture(t),p=serviceMail(db,account,12345,'77400123','1802727196001');
 assert.equal(p.account_id,account);assert.equal(p.event,'expense');assert.equal(p.service_ruc,'1802727196001');assert.equal(p.reference,'77400123');assert.equal(p.trusted,true);assert.equal(p.occurred_at,financeDay()+'T22:03:00.000Z');
 const analysis=enrichServiceProof(db,{id:99},{amount_cents:12345,day:financeDay(),description:'Pago de servicios IESS',bank:'Produbanco',reference:'1802727196001',origin_bank:null,origin_account_suffix:null,destination_account_suffix:'234'});
 assert.equal(analysis.reference,'77400123');assert.equal(analysis.origin_bank,'Produbanco');assert.equal(analysis.destination_account_suffix,null);assert.equal(suggestOriginAccount(db,owner,analysis).account_id,account);
 assert.equal(suggestOriginAccount(db,owner,{origin_bank:'Produbanco',origin_account_suffix:'2XXXXXX1234'}).account_id,account);
});
test('strict requests reject both wrong proof directions, unreadable amount, partial amount and wrong origin atomically',t=>{
 const {db,owner,norma,body,account,evidence}=fixture(t),request=createIessRequest(db,norma,body).movement,proof=evidence();
 const pay={request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:proof,account_id:account,amount_cents:12345,paid_day:financeDay(),reference:'REF-EXACT'};
 for(const amount of [1000,12344,12346,50000,null]){
   db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:amount}),proof);
   assert.throws(()=>recordRequestPayment(db,owner,request.id,pay),e=>e.status===409);
 }
 db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:12345,origin_bank:'Pichincha',origin_account_suffix:'1234'}),proof);
 assert.throws(()=>recordRequestPayment(db,owner,request.id,{...pay,amount_cents:1000}),/exactamente/);
 assert.throws(()=>recordRequestPayment(db,owner,request.id,{...pay,account_id:999}),/cuenta elegida/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_payments').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,0);
});
test('correction swaps proofs, fixes only the missing debit and survives replay and later bank mail',t=>{
 const {db,owner,norma,body,account,evidence}=fixture(t);
 const high=createIessRequest(db,norma,body).movement,low=createIessRequest(db,norma,{...body,request_id:crypto.randomUUID(),amount_cents:1000,comprobante:'000123457'}).movement;
 const proofHigh=evidence(),proofLow=evidence();db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({amount_cents:1000}),proofLow);
 const pay=(r,proof,ref)=>recordRequestPayment(db,owner,r.id,{request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:proof,account_id:account,amount_cents:r.amount_cents,paid_day:financeDay(),reference:ref}).payment;
 const ph=pay(high,proofHigh,'OLD-HIGH'),pl=pay(low,proofLow,'OLD-LOW');
 const allocation=id=>db.prepare('SELECT * FROM finance_allocations WHERE movement_id=?').get(id);
 const ah=allocation(ph.movement_id),al=allocation(pl.movement_id);
 // Reproduce the old defect: larger proof kept the smaller request value;
 // smaller proof was accepted as an advance against the larger request.
 db.prepare('UPDATE finance_payments SET request_id=?,amount_cents=1000 WHERE id=?').run(low.id,ph.id);
 db.prepare('UPDATE finance_payments SET request_id=? WHERE id=?').run(high.id,pl.id);
 db.prepare('UPDATE finance_movements SET amount_cents=1000 WHERE id=?').run(ph.movement_id);
 db.prepare('UPDATE finance_bank_transactions SET amount_cents=-1000 WHERE id=?').run(ah.bank_transaction_id);
 db.prepare('UPDATE finance_allocations SET amount_cents=1000 WHERE id=?').run(ah.id);
 const mh=serviceMail(db,account,12345,'77400123',body.ruc),ml=serviceMail(db,account,1000,'77400124',body.ruc);
 const job={kind:'iess-payment-correction-v1',id:crypto.randomUUID(),entries:[{payment_id:ph.id,request_id:high.id,expected_request_id:low.id,expected_amount_cents:1000,expected_reference:'OLD-HIGH',evidence_id:proofHigh,bank_id:ah.bank_transaction_id,account_id:account,mail_id:mh.id,bank_reference:mh.reference},{payment_id:pl.id,request_id:low.id,expected_request_id:high.id,expected_amount_cents:1000,expected_reference:'OLD-LOW',evidence_id:proofLow,bank_id:al.bank_transaction_id,account_id:account,mail_id:ml.id,bank_reference:ml.reference}]};
 const wrong=structuredClone(job);wrong.entries[0].expected_amount_cents=1001;assert.throws(()=>repairIessPayments(db,wrong),/does not match/);
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-2000);
 const result=repairIessPayments(db,job);assert.equal(result.corrected,2);assert.equal(result.after[0].balance_cents-result.before[0].balance_cents,-11345);
 assert.equal(repairIessPayments(db,job).duplicate,true);assert.equal(requireRequest(db,owner,high.id).remaining_cents,0);assert.equal(requireRequest(db,owner,low.id).remaining_cents,0);
 for(const m of [mh,ml])applyMailDraft(db,owner,m.id,{account_id:account,direction:'outgoing',business_id:'producalza'});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,2);assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-13345);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,2);
});
test('later IESS service mail replaces internal proof reference without a second debit',t=>{
 const {db,owner,norma,body,account,evidence}=fixture(t),request=createIessRequest(db,norma,body).movement;
 const proof=evidence(),payment=recordRequestPayment(db,owner,request.id,{request_key:crypto.randomUUID(),confirm_paid:true,evidence_id:proof,account_id:account,amount_cents:12345,paid_day:financeDay(),reference:'IESS-DOC-'+proof}).payment;
 const mail=serviceMail(db,account,12345,'77400456',body.ruc);
 applyMailDraft(db,owner,mail.id,{account_id:account,direction:'outgoing',business_id:'producalza'});
 assert.equal(db.prepare('SELECT reference FROM finance_payments WHERE id=?').get(payment.id).reference,'77400456');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_bank_transactions').get().n,1);
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM finance_bank_transactions').get().n,-12345);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_allocations').get().n,1);
});
