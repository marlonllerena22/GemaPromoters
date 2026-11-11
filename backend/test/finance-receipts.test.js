import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { encryptDocument } from "../src/finance-ai.js";
import { registerQuickEntry } from "../src/finance-quick.js";
import {
  receiptInbox,
  receiptAccounts,
  suggestReceivingAccount,
  editReceipt,
} from "../src/finance-receipts.js";
import { applyNovemberCleanup } from "../src/finance-start-clean.js";
import { putPrivateSetting } from "../src/finance-operations.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";
import { flushPaymentPush } from "../src/finance-push.js";
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
