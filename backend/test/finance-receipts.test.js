import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { encryptDocument,decryptDocument } from "../src/finance-ai.js";
import { registerQuickEntry } from "../src/finance-quick.js";
import {
  receiptInbox,
  receiptAccounts,
  suggestReceivingAccount,
  editReceipt,
  repairReceiptAccounts,
  activateReceiptCredits,confirmReceiptDeposit,
} from "../src/finance-receipts.js";
import { applyNovemberCleanup, archiveNovemberTrialReceipt, clearCurrentActivity } from "../src/finance-start-clean.js";
import {ingestBankMessages,mailDrafts,applyMailDraft,replayAutomaticBankMail} from '../src/finance-gmail.js';
import {initBankNotifications,ingestBankNotifications,applyBankNotification} from '../src/finance-bank-notifications.js';
import {receivedWithoutAccount} from '../src/finance-bank-identity.js';
import { putPrivateSetting } from "../src/finance-operations.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";
import { flushPaymentPush } from "../src/finance-push.js";
import {updateConfirmedBalance} from '../src/finance-balance-updates.js';
import {applyBankReview} from '../src/finance-bank-review.js';
import { requireRow } from "../src/finance-service.js";
process.env.FINANCE_DOCUMENT_KEY = "test-only-receipts-private-key-20261110";
function fixture(t) {
  const db = new Database(":memory:");
  initFinanceDb(db);
  db.pragma("foreign_keys=ON");
  t.after(() => db.close());
  const add = (username, role = "collector") => {
    const id = db
      .prepare(
        "INSERT INTO finance_members(name,username,password_hash,role,business_ids,unit_ids) VALUES (?,?,'unused',?,'[\"producalza\",\"personal\"]',?)"
      )
      .run(
        username,
        username,
        role,
        role === "owner" ? "[]" : '["producalza-fabrica"]'
      ).lastInsertRowid;
    return safeMember(
      db.prepare("SELECT * FROM finance_members WHERE id=?").get(id)
    );
  };
  const owner = add("marlon", "owner"),
    norma = add("norma"),
    morelia = add("morelia");
  const account = Number(
    db
      .prepare(
        "INSERT INTO finance_accounts(name,bank,kind,business_id,opening_cents,opening_date,last_four) VALUES ('Personal','Pichincha','bank','personal',10000,?,'0043')"
      )
      .run(financeDay()).lastInsertRowid
  );
  const evidence = Number(
    db
      .prepare(
        "INSERT INTO finance_evidence(business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by) VALUES ('producalza','producalza-fabrica','receipt.png','image/png',4,'fixture',?,'norma')"
      )
      .run(encryptDocument(Buffer.from("test"))).lastInsertRowid
  );
  const payload = {
    request_id: crypto.randomUUID(),
    text: "Abono de cliente Ana",
    evidence_id: evidence,
    request: false,
    overrides: {
      business_id: "producalza",
      unit_id: "producalza-fabrica",
      kind: "income",
      amount_cents: 124300,
      day: financeDay(),
      counterparty: "Ana",
      account_id: account,
      reference: "RECEIPT1243",
      category: "Abono de pedido",
      payment_method: "transfer",
    },
  };
  const balance = () =>
    recordedAccountBalance(
      db,
      db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(account)
    );
  return { db, owner, norma, morelia, account, evidence, payload, balance };
}
test("Norma submits a pending receipt to a receiving account and sees it immediately without changing the bank balance", (t) => {
  const f = fixture(t),
    result = registerQuickEntry(f.db, f.norma, f.payload);
  assert.equal(result.movement.status, "pending");
  assert.equal(result.movement.account_id, f.account);
  assert.equal(f.balance(), 10000);
  assert.equal(receiptInbox(f.db, f.norma)[0].amount_cents, 124300);
  assert.equal(receiptInbox(f.db, f.owner).length, 1);
  assert.equal(receiptInbox(f.db, f.morelia).length, 0);
  assert.equal(
    f.db.prepare("SELECT event_key FROM finance_push_outbox").get().event_key,
    "receipt-review:" + result.movement.id
  );
  registerQuickEntry(f.db, f.norma, f.payload);
  registerQuickEntry(f.db, f.norma, {
    ...f.payload,
    request_id: crypto.randomUUID(),
  });
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    1
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_push_outbox").get().n,
    1
  );
  const options = receiptAccounts(f.db, f.norma);
  assert.equal(options[0].balance_cents, undefined);
  assert.equal(options[0].opening_cents, undefined);
});
test("receipt corrections are private, version checked and locked after confirmation", (t) => {
  const f = fixture(t);
  registerQuickEntry(f.db, f.norma, f.payload);
  const row = receiptInbox(f.db, f.norma)[0],
    body = {
      expected_updated_at: row.updated_at,
      counterparty: "Ana Corregida",
      amount_cents: 124300,
      day: row.day,
      account_id: f.account,
      reference: row.reference,
    };
  assert.throws(
    () => editReceipt(f.db, f.morelia, row.id, body),
    (e) => e.status === 404
  );
  editReceipt(f.db, f.norma, row.id, body);
  assert.equal(receiptInbox(f.db, f.norma)[0].counterparty, "Ana Corregida");
  assert.equal(f.balance(), 10000);
  assert.throws(
    () =>
      editReceipt(f.db, f.norma, row.id, {
        ...body,
        expected_updated_at: "old",
      }),
    (e) => e.status === 409
  );
  f.db
    .prepare("UPDATE finance_movements SET status='approved' WHERE id=?")
    .run(row.id);
  assert.throws(
    () => editReceipt(f.db, f.norma, row.id, body),
    (e) => e.status === 409
  );
});
test("a receipt uploaded before unit assignment remains visible to its creator and the owner", (t) => {
  const f = fixture(t);
  const result = registerQuickEntry(f.db, f.norma, f.payload);
  f.db
    .prepare("UPDATE finance_movements SET unit_id=NULL WHERE id=?")
    .run(result.movement.id);
  f.db
    .prepare("UPDATE finance_evidence SET unit_id=NULL WHERE id=?")
    .run(f.evidence);
  assert.equal(receiptInbox(f.db, f.norma).length, 1);
  assert.equal(
    requireRow(f.db, "finance_evidence", f.evidence, f.norma).id,
    f.evidence
  );
  assert.throws(
    () => requireRow(f.db, "finance_evidence", f.evidence, f.morelia),
    (e) => e.status === 404
  );
});
test("destination matching preserves zeros and requires a unique account in the receiving bank", (t) => {
  const f = fixture(t);
  putPrivateSetting(f.db, "own_account_registry", {
    accounts: [
      { account_id: f.account, number: "2200000043", bank: "Pichincha" },
    ],
  });
  assert.equal(
    suggestReceivingAccount(f.db, f.norma, {
      receiving_bank: "Banco Pichincha",
      destination_account_suffix: "0043",
    }).account_id,
    f.account
  );
  assert.equal(
    suggestReceivingAccount(f.db, f.norma, {
      receiving_bank: "Guayaquil",
      destination_account_suffix: "0043",
    }).account_id,
    null
  );
  assert.equal(
    suggestReceivingAccount(f.db, f.norma, { origin_account_suffix: "0043" })
      .account_id,
    null
  );
});
test("a receipt notification opens the exact receipt and resolved receipts are skipped", async (t) => {
  const f = fixture(t),
    r = registerQuickEntry(f.db, f.norma, f.payload);
  const sub = { provider: "fcm", token: "x".repeat(140) };
  f.db
    .prepare(
      "INSERT INTO finance_push_subscriptions(endpoint_hash,member_id,encrypted) VALUES (?,?,?)"
    )
    .run(
      "owner-device",
      f.owner.id,
      encryptDocument(Buffer.from(JSON.stringify(sub)))
    );
  const sent = [];
  await flushPaymentPush(f.db, {
    config: { enabled: true },
    send: async (_s, p) => {
      sent.push(JSON.parse(p));
      return { statusCode: 200 };
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].receipt_id, String(r.movement.id));
  assert.equal(sent[0].url, "/finanzas/confirmaciones");
  assert.equal(sent[0].body.includes("1243"), false);
  f.db
    .prepare("UPDATE finance_movements SET status='approved' WHERE id=?")
    .run(r.movement.id);
  f.db
    .prepare("UPDATE finance_push_outbox SET state='queued',next_attempt=0")
    .run();
  await flushPaymentPush(f.db, {
    config: { enabled: true },
    send: async () => assert.fail("resolved receipt should not send"),
  });
  assert.equal(
    f.db.prepare("SELECT state FROM finance_push_outbox").get().state,
    "skipped"
  );
});
test("cleanup removes the specified unpaid request and group access while preserving real money and contacts", (t) => {
  const f = fixture(t);
  for (const person of [f.norma, f.morelia])
    f.db
      .prepare(
        "INSERT INTO finance_space_members(space_id,member_id,role) VALUES ('producalza-materiales',?,'requester')"
      )
      .run(person.id);
  f.db
    .prepare(
      "INSERT INTO finance_movements(business_id,kind,amount_cents,day,category,counterparty,description,is_payment_request,status,created_by) VALUES ('producalza','expense',4260,?,'Otros','Prueba proveedor','Solicitud de prueba',1,'pending','norma')"
    )
    .run(financeDay());
  f.db
    .prepare(
      "INSERT INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by) VALUES (?,?,2000,'REAL20','Tania real','real20','real','marlon')"
    )
    .run(f.account, financeDay());
  f.db
    .prepare(
      "INSERT INTO finance_incoming_notices(id,business_id,account_id,amount_cents,counterparty,day,source_hash,created_by,created_at) VALUES ('tania-notice','producalza',?,2000,'Tania Elizabeth',?,'test','marlon',?)"
    )
    .run(f.account, financeDay(), new Date().toISOString());
  f.db
    .prepare(
      "UPDATE finance_movements SET created_at='2026-11-10T20:00:00.000Z' WHERE amount_cents=4260"
    )
    .run();
  const before = f.balance();
  const result = applyNovemberCleanup(f.db);
  assert.equal(result.requests_4260.length, 1);
  assert.equal(result.memberships_removed, 2);
  assert.equal(result.tania_notices_archived, 1);
  assert.equal(f.balance(), before);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    1
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT hidden_at FROM finance_movements WHERE amount_cents=4260"
      )
      .get().hidden_at !== null,
    true
  );
  assert.equal(applyNovemberCleanup(f.db), undefined);
});

test("explicit 1243 trial removal is scoped, audited, idempotent and leaves bank balances intact",(t)=>{
  const f=fixture(t),receipt=registerQuickEntry(f.db,f.norma,f.payload).movement;
  f.db.prepare("UPDATE finance_movements SET created_at='2026-11-10T20:00:00.000Z' WHERE id=?").run(receipt.id);
  f.db.prepare("INSERT INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by) VALUES (?,?,124300,'REAL1243','Real bank credit','real1243','real','marlon')").run(f.account,financeDay());
  const before=f.balance();
  assert.deepEqual(archiveNovemberTrialReceipt(f.db).archived,[receipt.id]);
  assert.equal(receiptInbox(f.db,f.norma).length,0);
  assert.equal(f.balance(),before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,1);
  assert.equal(archiveNovemberTrialReceipt(f.db),undefined);
});

test("1243 cleanup refuses ambiguous receipts and leaves future receipts untouched",(t)=>{
  const f=fixture(t),first=registerQuickEntry(f.db,f.norma,f.payload).movement;
  f.db.prepare("UPDATE finance_movements SET created_at='2026-11-10T20:00:00.000Z' WHERE id=?").run(first.id);
  f.db.prepare("INSERT INTO finance_movements(business_id,kind,amount_cents,day,category,counterparty,description,created_by,created_at) VALUES ('producalza','income',124300,?,'Abono','Otro cliente','Segundo comprobante','norma','2026-11-10T21:00:00.000Z')").run(financeDay());
  const second=f.db.prepare("SELECT max(id) id FROM finance_movements").get().id;
  f.db.prepare("INSERT INTO finance_movements(business_id,kind,amount_cents,day,category,counterparty,description,created_by,created_at) VALUES ('producalza','income',124300,?,'Abono','Cliente futuro','Comprobante futuro','norma','2026-11-11T06:00:00.000Z')").run(financeDay());
  const result=archiveNovemberTrialReceipt(f.db);
  assert.deepEqual(result.ambiguous,[first.id,second]);
  assert.equal(result.archived.length,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_movements WHERE hidden_at IS NOT NULL").get().n,0);
});

test('activity reset clears old inboxes, survives resync and preserves balances, checks, loans and card bills',(t)=>{
  const f=fixture(t);
  registerQuickEntry(f.db,f.norma,f.payload);
  f.db.prepare("INSERT INTO finance_checks(id,account_id,number,payee,amount_cents,due_day,fund_day,created_by,created_at,updated_at) VALUES ('keep-check',?,'900','Proveedor',2000,'2026-12-15','2026-12-13','marlon','now','now')").run(f.account);
  f.db.prepare("INSERT INTO finance_loans(id,name,bank,account_id,principal_cents,as_of,source_hash) VALUES ('keep-loan','Préstamo','Pichincha',?,10000,'2026-11-10','keep')").run(f.account);
  f.db.prepare("INSERT INTO finance_credit_cards VALUES ('keep-card','Tarjeta','Pichincha',?,24,9)").run(f.account);
  f.db.prepare("INSERT INTO finance_card_statements(id,card_id,cut_date,due_date,total_cents) VALUES ('keep-bill','keep-card','2026-11-24','2026-12-09',5500)").run();
  const snapshot=()=>['finance_accounts','finance_bank_transactions','finance_checks','finance_loans','finance_card_statements'].map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
  const old={id:'old-notice',internalDate:String(Date.now()-60000),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'La transferencia solicitada será debitada de su cuenta y acreditada en 1 hora. Cuenta de origen: ****0043 Cuenta acreditada: ****0052 Monto: USD 64.00 Número de documento: 29384633'}}};
  putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  ingestBankMessages(f.db,[old]);
  const before=f.balance(),preserved=snapshot();
  assert.equal(mailDrafts(f.db).length,1);
  assert.equal(clearCurrentActivity(f.db).mail,1);
  assert.equal(f.balance(),before);
  assert.deepEqual(snapshot(),preserved);
  assert.equal(mailDrafts(f.db).length,0);
  assert.equal(receiptInbox(f.db,f.norma).length,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_push_outbox WHERE state='queued'").get().n,0);
  ingestBankMessages(f.db,[old],{reprocess:true});
  ingestBankMessages(f.db,[{...old,id:'late-old-notice'}]);
  replayAutomaticBankMail(f.db);
  assert.equal(mailDrafts(f.db).length,0);
  assert.equal(f.balance(),before);
  assert.throws(()=>applyMailDraft(f.db,f.owner,old.id,{account_id:f.account,direction:'outgoing'}),e=>e.status===404);
  assert.equal(clearCurrentActivity(f.db),undefined);
});

test('a newly uploaded receipt with an already recorded exact bank reference confirms without another credit',(t)=>{
  const f=fixture(t);
  f.db.prepare("INSERT INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by) VALUES (?,?,124300,'RECEIPT1243','Bank payment','confirmed1243','real','marlon')").run(f.account,financeDay());
  const before=f.balance(),registered=registerQuickEntry(f.db,f.norma,f.payload);
  assert.equal(registered.movement.status,'reconciled');
  assert.equal(receiptInbox(f.db,f.norma)[0].can_edit,false);
  assert.equal(f.balance(),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_allocations').get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_push_outbox WHERE state='queued'").get().n,0);
});

for(const notificationFirst of [true,false])test(`a received-money phone notification auto-confirms the matching receipt, notification first: ${notificationFirst}`,(t)=>{
  const f=fixture(t);initBankNotifications(f.db);
  putPrivateSetting(f.db,'receipt_auto_confirm_from_notification',true);
  putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  const device={id:'test-phone',created_at:new Date(Date.now()-3600000).toISOString(),apps_json:JSON.stringify([{package_name:'bank.test',bank:'Pichincha',account_id:null,automatic:false}])};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?, 'fixture',?,'test','token',?,?,?)").run(device.id,f.owner.id,device.apps_json,device.created_at,Date.now()+3600000);
  const event={id:'receive-1243',package_name:'bank.test',posted_at:new Date(Date.now()-1000).toISOString(),text:'💰¡Recibiste 1243.00!\nAna Perez te envió 1243.00.'};
  const upload=()=>registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,counterparty:'Ana Perez',reference:null}});
  let registered;
  if(notificationFirst){ingestBankNotifications(f.db,device,[event]);assert.equal(f.balance(),10000);registered=upload();}
  else {registered=upload();assert.equal(f.balance(),10000);ingestBankNotifications(f.db,device,[event]);}
  assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(registered.movement.id).status,'reconciled');
  assert.equal(f.balance(),134300);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_allocations').get().n,1);
  ingestBankNotifications(f.db,device,[event]);
  assert.equal(f.balance(),134300);
  ingestBankMessages(f.db,[{id:'corroborating-mail',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Te confirmamos que Ana Perez ha realizado una transferencia. Transferencia recibida. Cuenta destino: ****0043 Monto: USD 1243.00 Número de documento: 123456789'}}}]);
  assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'applied');
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
  assert.equal(f.balance(),134300);
  for(let i=0;i<2;i++)f.db.prepare("INSERT INTO finance_movements(business_id,unit_id,account_id,kind,amount_cents,day,category,counterparty,description,evidence_id,created_by) VALUES ('producalza','producalza-fabrica',?,'income',100,?,'Abono','Ana Perez','Comprobante parecido',?,'norma')").run(f.account,financeDay(),f.evidence);
  ingestBankNotifications(f.db,device,[{...event,id:'ambiguous-small-receipt',text:'Recibiste $1,00 de Ana Perez. Cuenta destino: ****0043'}]);
  // The bank credit is certain; only the choice between two receipts stays pending.
  assert.equal(f.balance(),134400);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_movements WHERE amount_cents=100 AND status='pending'").get().n,2);
});

for(const [amount,legal,client]of [[5000,'PEREZ ANDRADE LUCIA ISABEL','Lucia Perez'],[26361,'Gomez del Valle Rafael Antonio','Rafael Gomez']])test(`received money ${amount} waits for account evidence, then confirms automatically from the collaborator receipt`,(t)=>{
  const f=fixture(t);initBankNotifications(f.db);putPrivateSetting(f.db,'receipt_auto_confirm_from_notification',true);
  const device={id:'morning-phone',created_at:new Date(Date.now()-3600000).toISOString(),apps_json:JSON.stringify([{package_name:'bank.test',bank:'Pichincha',account_id:null,automatic:true}])};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,'morning-client',?,'test','morning-token',?,?,?)").run(device.id,f.owner.id,device.apps_json,device.created_at,Date.now()+3600000);
  ingestBankNotifications(f.db,device,[{id:'received-morning',package_name:'bank.test',posted_at:new Date(Date.now()-1000).toISOString(),title:`Recibiste ${(amount/100).toFixed(2)}!`,text:`${legal} te envió ${(amount/100).toFixed(2)}.`}]);
  const before=f.db.prepare('SELECT * FROM finance_notification_events').get();
  assert.equal(receivedWithoutAccount(before,JSON.parse(decryptDocument(before.encrypted).toString())),true);
  assert.equal(f.balance(),10000);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,0);
  const submitted=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,amount_cents:amount,counterparty:client,reference:'PROOF'+amount}});
  assert.equal(submitted.movement.status,'reconciled');assert.equal(f.balance(),10000+amount);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
});

test('two visible destination digits plus the destination bank select a unique account without crediting a historical receipt',t=>{
  const f=fixture(t);f.db.prepare("UPDATE finance_accounts SET bank='Produbanco',last_four='2542' WHERE id=?").run(f.account);putPrivateSetting(f.db,'own_account_registry',{accounts:[{bank:'Produbanco',number:'20008832542',account_id:f.account}]});
  const analysis={receiving_bank:'Banco Produbanco',origin_bank:'Banco del Austro',destination_account_suffix:'42',amount_cents:79852,reference:'46919'};
  assert.equal(suggestReceivingAccount(f.db,f.owner,analysis).account_id,f.account);assert.equal(suggestReceivingAccount(f.db,f.owner,{destination_account_suffix:'42'}).state,'unreadable');
  f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify(analysis),f.evidence);
  const created=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,account_id:null,amount_cents:79852,reference:'46919'}});
  f.db.prepare("UPDATE finance_movements SET status='approved' WHERE id=?").run(created.movement.id);
  assert.deepEqual(repairReceiptAccounts(f.db),{assigned:1,reconciled:0});assert.equal(f.db.prepare('SELECT account_id FROM finance_movements WHERE id=?').get(created.movement.id).account_id,f.account);assert.equal(f.balance(),10000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,0);
  f.db.prepare("INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date,last_four) VALUES ('Otra cuenta','Produbanco','bank',0,?,'9942')").run(financeDay());
  assert.equal(suggestReceivingAccount(f.db,f.owner,analysis).state,'ambiguous');
});

test('a receipt arriving after an already-recorded reference-free notification reconciles by unique payer, account, date and amount',t=>{
  const f=fixture(t);initBankNotifications(f.db);putPrivateSetting(f.db,'receipt_auto_confirm_from_notification',true);
  const device={id:'recorded-phone',created_at:new Date(Date.now()-3600000).toISOString(),apps_json:JSON.stringify([{package_name:'bank.test',bank:'Pichincha',account_id:f.account,automatic:false}])};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,'recorded-client',?,'test','recorded-token',?,?,?)").run(device.id,f.owner.id,device.apps_json,device.created_at,Date.now()+3600000);
  ingestBankNotifications(f.db,device,[{id:'received-26361',package_name:'bank.test',posted_at:new Date().toISOString(),title:'Recibiste $263.61',text:'Gomez del Valle Rafael Antonio te envió 263.61.'}]);
  const event=f.db.prepare('SELECT id FROM finance_notification_events').get();applyBankNotification(f.db,f.owner,event.id,{account_id:f.account});assert.equal(f.balance(),36361);
  const submitted=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,amount_cents:26361,counterparty:'Rafael Gomez',reference:'PROOF26361'}});
  assert.equal(submitted.movement.status,'reconciled');assert.equal(f.balance(),36361);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
  assert.deepEqual(repairReceiptAccounts(f.db),{assigned:0,reconciled:0});assert.equal(f.balance(),36361);
});

test('saving the real balance confirms the unique pending deposit explaining its increase and later mail does not add it again',t=>{
  const f=fixture(t);putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  const receipt=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,amount_cents:25500,reference:'123456789',counterparty:'Diego Sandoval'}}).movement;
  const otherEvidence=Number(f.db.prepare("INSERT INTO finance_evidence(business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by) VALUES ('producalza','producalza-fabrica','other.png','image/png',4,'other',?,'norma')").run(encryptDocument(Buffer.from('other'))).lastInsertRowid);
  const other=registerQuickEntry(f.db,f.norma,{...f.payload,evidence_id:otherEvidence,request_id:crypto.randomUUID(),overrides:{...f.payload.overrides,amount_cents:79852,reference:'46919',counterparty:'Maria Albornoz'}}).movement;
  const result=updateConfirmedBalance(f.db,f.owner,f.account,{balance_cents:35500,expected_balance_cents:10000,day:financeDay()});
  assert.equal(result.movement_id,receipt.id);assert.equal(result.unexplained_difference_cents,0);assert.equal(f.balance(),35500);
  assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(receipt.id).status,'reconciled');
  assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(other.id).status,'pending');
  const checkpoint=f.db.prepare('SELECT * FROM finance_balance_checkpoints').get();assert.ok(Date.parse(checkpoint.as_of_at)<=Date.now());
  assert.equal(updateConfirmedBalance(f.db,f.owner,f.account,{balance_cents:35500,expected_balance_cents:35500,day:financeDay()}).movement_id,null);
  ingestBankMessages(f.db,[{id:'owner-confirmed-deposit-mail',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Te confirmamos que Diego Sandoval ha realizado una transferencia. Transferencia recibida. Cuenta destino: ****0043 Monto: USD 255.00 Número de documento: 123456789'}}}]);
  assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'applied');assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);assert.equal(f.balance(),35500);
  const at=new Date(Date.parse(checkpoint.as_of_at)+1000).toISOString();
  f.db.prepare("INSERT INTO finance_bank_transactions(account_id,day,occurred_at,amount_cents,reference,description,fingerprint,batch_id,created_by) VALUES (?,?,?,100,'later','Real later deposit','later-deposit','real','system')").run(f.account,financeDay(),at);assert.equal(f.balance(),35600);
});

test('a balance update with two equal pending receipts saves funds but leaves both receipts for review',t=>{
  const f=fixture(t);for(const reference of ['one','two']){
    const evidence=Number(f.db.prepare("INSERT INTO finance_evidence(business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by) VALUES ('producalza','producalza-fabrica','receipt.png','image/png',4,?,?,'norma')").run(reference,encryptDocument(Buffer.from(reference))).lastInsertRowid);
    registerQuickEntry(f.db,f.norma,{...f.payload,evidence_id:evidence,request_id:crypto.randomUUID(),overrides:{...f.payload.overrides,amount_cents:25500,reference}});
  }
  const result=updateConfirmedBalance(f.db,f.owner,f.account,{balance_cents:35500,day:financeDay(),expected_balance_cents:10000});assert.equal(result.movement_id,null);assert.equal(f.balance(),35500);assert.equal(result.unexplained_difference_cents,25500);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_movements WHERE status='pending'").get().n,2);
});

test('balance updates reject collaborators and stale amounts without altering funds',t=>{
  const f=fixture(t);assert.throws(()=>updateConfirmedBalance(f.db,f.norma,f.account,{balance_cents:35500,day:financeDay()}),e=>e.status===403);
  assert.throws(()=>updateConfirmedBalance(f.db,f.owner,f.account,{balance_cents:35500,day:financeDay(),expected_balance_cents:0}),e=>e.status===409);assert.equal(f.balance(),10000);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_balance_checkpoints').get().n,0);
});

test('recovering a previously saved balance is guarded and applies only once',t=>{
  const f=fixture(t);putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  f.db.prepare('UPDATE finance_accounts SET verified_cents=35500 WHERE id=?').run(f.account);
  const receipt=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,amount_cents:25500}}).movement;
  const config={kind:'bank-review-v1',id:'recover-owner-confirmed-balance',messages:[],expires_at:new Date(Date.now()+60000).toISOString(),confirmed_balance_updates:[{bank:'Pichincha',account_suffix:'0043',confirmed:true,balance_cents:35500,expected_verified_cents:35500,expected_balance_cents:10000,expected_receipt_id:receipt.id,day:financeDay()}]};
  const result=applyBankReview(f.db,config);assert.equal(result.confirmedBalances[0].movement_id,receipt.id);assert.equal(f.balance(),35500);
  assert.deepEqual(applyBankReview(f.db,config),{applied:false});assert.equal(f.balance(),35500);
  assert.throws(()=>applyBankReview(f.db,{...config,id:'wrong-saved-value',confirmed_balance_updates:[{...config.confirmed_balance_updates[0],expected_verified_cents:99999}]}),/Saved balance confirmation changed/);assert.equal(f.balance(),35500);
});

test('new receipt confirmation detects its account, credits once, and a different receiving-bank email reference links without another credit',t=>{
  const f=fixture(t);activateReceiptCredits(f.db);putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  f.db.prepare('UPDATE finance_evidence SET analysis=? WHERE id=?').run(JSON.stringify({receiving_bank:'Banco Pichincha',destination_account_suffix:'0043'}),f.evidence);
  const r=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,account_id:null,amount_cents:25500,counterparty:'Diego Sandoval',reference:'ORIGIN255'}}).movement;
  const result=confirmReceiptDeposit(f.db,f.owner,r.id);assert.equal(result.disposition,'credited');assert.equal(result.account_id,f.account);assert.equal(f.balance(),35500);
  assert.equal(f.db.prepare('SELECT status FROM finance_movements WHERE id=?').get(r.id).status,'reconciled');
  assert.equal(confirmReceiptDeposit(f.db,f.owner,r.id).duplicate,true);assert.equal(f.balance(),35500);
  ingestBankMessages(f.db,[{id:'late-receiving-mail',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Te confirmamos que Diego Sandoval ha realizado una transferencia. Transferencia recibida. Cuenta destino: ****0043 Monto: USD 255.00 Número de documento: 987654321'}}}]);
  assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'applied');assert.equal(f.balance(),35500);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
});

for(const legacy of [false,true])test(`already-included confirmation keeps the current balance and late notices cannot add it, legacy: ${legacy}`,t=>{
  const f=fixture(t);if(!legacy)activateReceiptCredits(f.db);initBankNotifications(f.db);
  const r=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,amount_cents:25500,counterparty:'Diego Sandoval',reference:'123456789'}}).movement;
  if(legacy)activateReceiptCredits(f.db);
  const result=confirmReceiptDeposit(f.db,f.owner,r.id,legacy?{}:{already_in_balance:true});assert.equal(result.disposition,'included');assert.equal(f.balance(),10000);assert.equal(confirmReceiptDeposit(f.db,f.owner,r.id).duplicate,true);assert.equal(f.balance(),10000);
  const device={id:'included-phone',created_at:new Date(Date.now()-60000).toISOString(),apps_json:JSON.stringify([{package_name:'bank.test',bank:'Pichincha',account_id:null,automatic:true}])};
  f.db.prepare("INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,'included-client',?,'test','included-token',?,?,?)").run(device.id,f.owner.id,device.apps_json,device.created_at,Date.now()+3600000);
  ingestBankNotifications(f.db,device,[{id:'included-late-push',package_name:'bank.test',posted_at:new Date().toISOString(),title:'Recibiste $255',text:'Sandoval Perez Diego Andres te envió $255.'}]);
  assert.equal(f.db.prepare('SELECT state FROM finance_notification_events').get().state,'matched');assert.equal(f.balance(),10000);
  putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  ingestBankMessages(f.db,[{id:'late-included-mail',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Te confirmamos que Diego Sandoval ha realizado una transferencia. Transferencia recibida. Cuenta destino: ****0043 Monto: USD 255.00 Número de documento: 123456789'}}}]);
  assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'applied');assert.equal(f.balance(),10000);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
});

test('activating the new confirmation flow does not change existing receipts or account balances',t=>{
  const f=fixture(t);const r=registerQuickEntry(f.db,f.norma,f.payload).movement;const before=f.balance(),row=f.db.prepare('SELECT * FROM finance_movements WHERE id=?').get(r.id);
  const policy=activateReceiptCredits(f.db);assert.ok(policy.legacy_through_id>=r.id);assert.equal(f.balance(),before);assert.deepEqual(f.db.prepare('SELECT * FROM finance_movements WHERE id=?').get(r.id),row);assert.deepEqual(activateReceiptCredits(f.db),policy);
});

test('confirming with an unreadable destination requires an account and collaborators cannot confirm their own deposit',t=>{
  const f=fixture(t);activateReceiptCredits(f.db);const r=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,account_id:null}}).movement;
  assert.throws(()=>confirmReceiptDeposit(f.db,f.owner,r.id),/Selecciona la cuenta/);assert.throws(()=>confirmReceiptDeposit(f.db,f.norma,r.id,{account_id:f.account}),e=>e.status===403);assert.equal(f.balance(),10000);
  assert.equal(confirmReceiptDeposit(f.db,f.owner,r.id,{account_id:f.account}).disposition,'credited');assert.equal(f.balance(),134300);
});

test('confirming after the bank email links the existing deposit even when the sender receipt has a different reference',t=>{
  const f=fixture(t);activateReceiptCredits(f.db);putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200000043'}]});
  ingestBankMessages(f.db,[{id:'first-bank-mail',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'avisos@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Te confirmamos que Diego Sandoval ha realizado una transferencia. Transferencia recibida. Cuenta destino: ****0043 Monto: USD 255.00 Número de documento: 987654321'}}}]);
  const before=f.balance(),receipt=registerQuickEntry(f.db,f.norma,{...f.payload,overrides:{...f.payload.overrides,counterparty:'Diego Sandoval',amount_cents:25500,reference:'ORIGIN255'}}).movement;
  assert.equal(confirmReceiptDeposit(f.db,f.owner,receipt.id).disposition,'bank_linked');assert.equal(f.balance(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM finance_bank_transactions').get().n,1);
});
