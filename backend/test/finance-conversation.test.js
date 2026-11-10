import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { prepareConversation, confirmConversation } from "../src/finance-conversation.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";
import { encryptDocument } from "../src/finance-ai.js";
import { applyMailDraft } from "../src/finance-gmail.js";
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

test("cash expenses update EFECTIVO only after confirmation and missing references stay conversational", async (t) => {
  const f = fixture(t);
  f.setResponse({ action: "bank_entry", message: "Preparando", data: { ...f.data, reference: null } });
  const pending = await prepareConversation(f.db, f.owner, chat("Registra el depósito, no sé la referencia"));
  assert.equal(pending.draft, null); assert.match(pending.message, /referencia/i);
  f.setResponse({ action: "movement", message: "Registraré gasolina personal en efectivo.", data: { ...f.data, business_id: "personal", account_id: null, amount_cents: 8000, category: "Gasolina", counterparty: "Gasolinera", description: "Gasolina personal pagada en efectivo", reference: null, custody_id: "efectivo", kind: "expense", direction: "outgoing", payment_method: "cash" } });
  const prepared = await prepareConversation(f.db, f.owner, chat("Gasolina personal, 80 en efectivo"));
  assert.equal(prepared.draft.after_cents, 42000);
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='efectivo'").get().balance_cents, 50000);
  confirmConversation(f.db, f.owner, { draft_id: prepared.draft.id, confirmed: true });
  assert.equal(f.db.prepare("SELECT balance_cents FROM finance_custody_balances WHERE id='efectivo'").get().balance_cents, 42000);
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
