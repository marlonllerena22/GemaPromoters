import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { prepareConversation, confirmConversation } from "../src/finance-conversation.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";
import { encryptDocument } from "../src/finance-ai.js";
import { applyMailDraft } from "../src/finance-gmail.js";
import { financeSupportCheck } from "../src/finance-support-check.js";
import { importStatementImage } from "../src/finance-statement-images.js";
import { createMovement } from "../src/finance-service.js";
import { applyBankReview } from "../src/finance-bank-review.js";
process.env.FINANCE_DOCUMENT_KEY ||= "test-only-conversation-document-key-123456";

function fixture(t) {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-conversation-key";
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; });
  const db = new Database(":memory:"); initFinanceDb(db); t.after(() => db.close());
  const member = (name, role, businesses, flags = {}) => {
    const id = db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids,work_view,custody_adjust) VALUES (?,?,'unused',?,?,?,?)").run(name, name, role, JSON.stringify(businesses), flags.work ? 1 : 0, flags.custody ? 1 : 0).lastInsertRowid;
    return safeMember(db.prepare("SELECT * FROM finance_members WHERE id=?").get(id));
  };
  const owner = member("owner", "owner", ["producalza", "marjorie", "gemashow", "personal"]);
  const german = member("german", "viewer", ["producalza", "marjorie", "gemashow"], { work: true, custody: true });
  const norma = member("norma", "collector", ["producalza"]);
  const accountId = Number(db.prepare("INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date) VALUES ('Guayaquil corriente','Guayaquil','bank',10000,?)").run(financeDay()).lastInsertRowid);
  db.prepare("UPDATE finance_custody_balances SET balance_cents=10000 WHERE id='henry'").run();
  db.prepare("UPDATE finance_custody_balances SET balance_cents=50000 WHERE id='efectivo'").run();
  const data = { business_id: "gemashow", unit_id: null, account_id: accountId, amount_cents: 2500, day: financeDay(), category: "Traslado interno", counterparty: "Henry", description: "Entrega de fondos custodiados para cheques", reference: "AI-BANK-ONE", custody_id: "henry", space_id: null, kind: "transfer", direction: "incoming", payment_method: "transfer" };
  let next = { action: "bank_entry", message: "Preparé el traslado. ¿Confirmas este resumen?", data };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => { requests++; const body = JSON.parse(options.body); assert.equal(body.store, false); return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(next) }] }] }); });
  return { db, owner, german, norma, accountId, data, setResponse: (r) => { next = r; }, requests: () => requests };
}
const chat = (content) => ({ messages: [{ role: "user", content }] });

test("a user-declared debit expense uses the named account and replay does not deduct twice",t=>{
  const f=fixture(t);
  f.db.prepare("UPDATE finance_accounts SET name='Guayaquil PAGOS Ahorros' WHERE id=?").run(f.accountId);
  const config={kind:"bank-review-v1",id:"declared-test-only",expires_at:new Date(Date.now()+60000).toISOString(),messages:[],owner_declared_expenses:[{id:"test-receipt",confirmed:true,bank:"Guayaquil",account_name:"PAGOS",card_suffix:"2004",business_id:"personal",day:financeDay(),amount_cents:5000,category:"Internet",counterparty:"Proveedor internet",description:"Pago personal confirmado por el titular"}]};
  const result=applyBankReview(f.db,config);
  assert.equal(result.declarations[0].balance_cents,5000);
  assert.equal(applyBankReview(f.db,config).applied,false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,1);
});

test("statement image reconciles uploaded payments and actual charges atomically, with a running balance guard",(t)=>{
  const f=fixture(t),day=financeDay();
  const expense=createMovement(f.db,f.owner,{business_id:"producalza",account_id:f.accountId,kind:"expense",amount_cents:2000,day,category:"Materiales",counterparty:"Proveedor",description:"Pago con comprobante",reference:"IMAGE-EXPENSE"});
  f.db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(expense.id);
  const image={source_hash:"a".repeat(64),observed_at:new Date().toISOString(),expected_before_cents:10000,expected_after_cents:12959,rows:[
    {amount_cents:5000,description:"Depósito recibido por identificar"},
    {amount_cents:-2000,reference:"IMAGE-EXPENSE",description:"Pago proveedor",movement_id:expense.id},
    {amount_cents:-36,reference:"IMAGE-EXPENSE-COMMISSION",description:"Comisión real en extracto",fee_business_id:"producalza"},
    {amount_cents:-5,reference:"IMAGE-EXPENSE-VAT",description:"IVA real en extracto",fee_business_id:"producalza",tax:true}
  ]};
  const account=f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(f.accountId);
  assert.throws(()=>importStatementImage(f.db,account,{...image,expected_after_cents:99999}),/running balance/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,0);
  assert.equal(f.db.prepare("SELECT status FROM finance_movements WHERE id=?").get(expense.id).status,"reported");
  assert.equal(importStatementImage(f.db,account,image).balance_cents,12959);
  assert.equal(f.db.prepare("SELECT status FROM finance_movements WHERE id=?").get(expense.id).status,"reconciled");
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,4);
  assert.throws(()=>importStatementImage(f.db,account,image),/Account changed/);
});

test("a short-lived operator support check logs only ciphertext and never changes bank balances",async(t)=>{
  const f=fixture(t), logs=[];
  t.mock.method(console,"info",(value)=>logs.push(value));
  const job=encryptDocument(Buffer.from(JSON.stringify({kind:"conversation-and-push-v1",id:"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",expires_at:new Date(Date.now()+60000).toISOString()}))).toString("base64");
  assert.equal(financeSupportCheck(f.db,job).completed,true);
  assert.equal(financeSupportCheck(f.db,job),null);
  assert.equal(logs.length,1);assert.equal(logs[0].includes("Guayaquil"),false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,0);
});

test("conversation asks missing details, then prepares an immutable preview without changing money", async (t) => {
  const f = fixture(t);
  f.setResponse({ action: "question", message: "¿Es dinero de Gemashow que Henry ya tenía?", data: f.data });
  assert.equal((await prepareConversation(f.db, f.owner, chat("Henry me depositó 25 en la corriente Guayaquil"))).draft, null);
  f.setResponse({ action: "bank_entry", message: "Revisa el traslado antes de confirmar.", data: f.data });
  const prepared = await prepareConversation(f.db, f.owner, chat("Sí, era dinero de Gemashow. Referencia AI-BANK-ONE"));
  assert.equal(prepared.draft.before_cents, 10000); assert.equal(prepared.draft.after_cents, 12500);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 0);
  assert.throws(() => confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id }), (e) => e.status === 400);
  assert.throws(() => confirmConversation(f.db, f.german, { draft_id: prepared.draft.id, confirmed: true }), (e) => e.status === 404);
  const result = confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true });
  assert.equal(confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true }).duplicate, true);
  assert.equal(recordedAccountBalance(f.db, f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(f.accountId)), 12500);
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='henry'").get().balance_cents, 7500);
  assert.equal(f.db.prepare("SELECT kind FROM finance_movements WHERE id=?").get(result.movement_id).kind, "transfer");
});

test("an example never creates a draft and the assistant cannot expand account permissions", async (t) => {
  const f = fixture(t);
  assert.equal((await prepareConversation(f.db, f.owner, chat("Es un ejemplo: Henry depositó 25"))).draft, null);
  assert.equal(f.requests(), 0);
  await assert.rejects(prepareConversation(f.db, f.norma, chat("Registra un depósito en una cuenta")), (e) => e.status === 403);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_assistant_drafts").get().n, 0);
});

test("a later bank email matches the manually confirmed record without adding money again", async (t) => {
  const f = fixture(t);
  const prepared = await prepareConversation(f.db, f.owner, chat("Registra este traslado real con referencia"));
  const committed = confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true });
  const instant = new Date(Date.now() - 1000).toISOString();
  const notice = { id: "ACTUAL-NOTICE", trusted: true, event: "income", amount_cents: 2500, account_id: f.accountId, reference: f.data.reference, occurred_at: instant, received_at: instant, bank: "Guayaquil", counterparty: "Henry" };
  f.db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,created_at) VALUES (?,?,?,'draft',?,?)").run(notice.id, instant, encryptDocument(Buffer.from(JSON.stringify(notice))), f.accountId, instant);
  applyMailDraft(f.db, f.owner, notice.id, { account_id: f.accountId, direction: "incoming" });
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 1);
  assert.equal(f.db.prepare("SELECT import_source FROM finance_bank_transactions WHERE id=?").get(committed.bank_transaction_id).import_source, "bank-email");
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='henry'").get().balance_cents, 7500);
});

test("cash expenses update EFECTIVO only after confirmation and unreferenced deposits are declared explicitly", async (t) => {
  const f = fixture(t);
  f.setResponse({ action: "bank_entry", message: "Preparando", data: { ...f.data, reference: null } });
  const pending = await prepareConversation(f.db, f.owner, chat("Registra el depósito, no sé la referencia"));
  assert.equal(pending.draft.declared_without_reference, true);
  assert.equal(pending.draft.after_cents, 12500);
  f.setResponse({ action: "movement", message: "Registraré gasolina personal en efectivo.", data: { ...f.data, business_id: "personal", account_id: null, amount_cents: 8000, category: "Gasolina", counterparty: "Gasolinera", description: "Gasolina personal pagada en efectivo", reference: null, custody_id: "efectivo", kind: "expense", direction: "outgoing", payment_method: "cash" } });
  const prepared = await prepareConversation(f.db, f.owner, chat("Gasolina personal, 80 en efectivo"));
  assert.equal(prepared.draft.after_cents, 42000);
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='efectivo'").get().balance_cents, 50000);
  confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true });
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='efectivo'").get().balance_cents, 42000);
});

test("multiple deposits keep their separate references and atomically change the requested account once", async (t) => {
  const f = fixture(t);
  const first = { action: "bank_entry", data: { ...f.data, kind:"income", custody_id:null, counterparty:"Cliente Uno", reference:"BATCH-1", amount_cents: 2000 } };
  const second = { action: "bank_entry", data: { ...first.data, counterparty:"Cliente Dos", reference:"BATCH-2", amount_cents:3000 } };
  f.setResponse({action:"batch",message:"Dos depósitos separados",data:first.data,items:[first,second]});
  const prepared = await prepareConversation(f.db,f.owner,chat("Cliente Uno depositó 20 y Cliente Dos 30, ambos a corriente Guayaquil"));
  assert.equal(prepared.draft.items.length,2);
  assert.equal(prepared.draft.accounts[0].after_cents,15000);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,0);
  const result=confirmConversation(f.db,f.owner,{draft_id:prepared.draft.id,confirmed:true});
  assert.equal(result.results.length,2);
  assert.equal(recordedAccountBalance(f.db,f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(f.accountId)),15000);
  assert.equal(confirmConversation(f.db,f.owner,{draft_id:prepared.draft.id,confirmed:true}).duplicate,true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,2);
  // A later unrelated balance change must roll back the whole batch, never post a subset.
  f.setResponse({action:"batch",message:"Dos depósitos más",data:first.data,items:[{...first,data:{...first.data,reference:"NEXT-1"}},{...second,data:{...second.data,reference:"NEXT-2"}}]});
  const stale=await prepareConversation(f.db,f.owner,chat("Otros dos depósitos: 20 y 30"));
  f.db.prepare("UPDATE finance_accounts SET opening_cents=opening_cents+1 WHERE id=?").run(f.accountId);
  assert.throws(()=>confirmConversation(f.db,f.owner,{draft_id:stale.draft.id,confirmed:true}),(e)=>e.status===409);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,2);
});

test("a bank deposit cannot silently become a balance-neutral movement; later mail matches a declaration without its reference",async(t)=>{
  const f=fixture(t);
  const data={...f.data,kind:"income",custody_id:null,reference:null,counterparty:"Cliente Real"};
  f.setResponse({action:"movement",message:"Depósito recibido",data});
  const prepared=await prepareConversation(f.db,f.owner,chat("Cliente Real depositó 25 a Guayaquil, ya está recibido"));
  assert.equal(prepared.draft.changes_bank_balance,true);
  const committed=confirmConversation(f.db,f.owner,{draft_id:prepared.draft.id,confirmed:true});
  const instant=new Date(Date.now()-1000).toISOString();
  const notice={id:"WITHOUT-REF-MAIL",trusted:true,event:"income",amount_cents:2500,account_id:f.accountId,reference:"REAL-BANK-REF",occurred_at:instant,received_at:instant,bank:"Guayaquil",counterparty:"Cliente Real"};
  f.db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,created_at) VALUES (?,?,?,'draft',?,?)").run(notice.id,instant,encryptDocument(Buffer.from(JSON.stringify(notice))),f.accountId,instant);
  applyMailDraft(f.db,f.owner,notice.id,{account_id:f.accountId,direction:"incoming"});
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,1);
  assert.equal(f.db.prepare("SELECT reference FROM finance_bank_transactions WHERE id=?").get(committed.bank_transaction_id).reference,"REAL-BANK-REF");
  assert.equal(recordedAccountBalance(f.db,f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(f.accountId)),12500);
});

test("a similar bank email with a different sender stays for review instead of adding a possible duplicate",async(t)=>{
  const f=fixture(t);
  f.setResponse({action:"bank_entry",message:"Registrar",data:{...f.data,kind:"income",custody_id:null,reference:null,counterparty:"Una Persona"}});
  const prepared=await prepareConversation(f.db,f.owner,chat("Una Persona depositó 25 a Guayaquil"));
  confirmConversation(f.db,f.owner,{draft_id:prepared.draft.id,confirmed:true});
  const instant=new Date(Date.now()-1000).toISOString();
  const notice={id:"AMBIGUOUS-REF",trusted:true,event:"income",amount_cents:2500,account_id:f.accountId,reference:"BANK-NEW",occurred_at:instant,received_at:instant,bank:"Guayaquil",counterparty:"Otro nombre bancario"};
  f.db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,created_at) VALUES (?,?,?,'draft',?,?)").run(notice.id,instant,encryptDocument(Buffer.from(JSON.stringify(notice))),f.accountId,instant);
  assert.throws(()=>applyMailDraft(f.db,f.owner,notice.id,{account_id:f.accountId,direction:"incoming"}),(e)=>e.status===409);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,1);
  assert.equal(f.db.prepare("SELECT state FROM finance_mail_messages WHERE id=?").get(notice.id).state,"draft");
});

test("a deposit already imported from email is reused even when the user does not dictate its reference",async(t)=>{
  const f=fixture(t), instant=new Date(Date.now()-1000).toISOString();
  const notice={id:"ALREADY-IMPORTED",trusted:true,event:"income",amount_cents:2500,account_id:f.accountId,reference:"KNOWN-REF",occurred_at:instant,received_at:instant,bank:"Guayaquil",counterparty:"Cliente Uno"};
  f.db.prepare("INSERT INTO finance_mail_messages(id,received_at,encrypted,state,account_id,created_at) VALUES (?,?,?,'draft',?,?)").run(notice.id,instant,encryptDocument(Buffer.from(JSON.stringify(notice))),f.accountId,instant);
  applyMailDraft(f.db,f.owner,notice.id,{account_id:f.accountId,direction:"incoming"});
  f.setResponse({action:"movement",message:"Depósito recibido",data:{...f.data,kind:"income",custody_id:null,reference:null,counterparty:"Cliente Uno"}});
  const prepared=await prepareConversation(f.db,f.owner,chat("Cliente Uno depositó 25 a Guayaquil"));
  assert.equal(prepared.draft.already_in_bank,true);
  confirmConversation(f.db,f.owner,{draft_id:prepared.draft.id,confirmed:true});
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,1);
  assert.equal(recordedAccountBalance(f.db,f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(f.accountId)),12500);
});

test("an existing reference cannot be registered again using a total that includes taxes", async (t) => {
  const f = fixture(t);
  const prepared = await prepareConversation(f.db, f.owner, chat("Registra este traslado con su referencia"));
  confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true });
  f.setResponse({ action: "bank_entry", message: "Voy a preparar el total.", data: { ...f.data, amount_cents: 3000 } });
  const different = await prepareConversation(f.db, f.owner, chat("El total con impuestos fue 30"));
  assert.equal(different.draft, null); assert.match(different.message, /otro importe/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 1);
});
