import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb } from "../src/finance-db.js";
import { initFinanceOperationsDb } from "../src/finance-operations-db.js";
import { putPrivateSetting } from "../src/finance-operations.js";
import { syncInternalSources } from "../src/finance-sources.js";
import { snapshot } from "../src/finance-service.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";
import { payphoneReceiptStatus } from "../src/finance-payphone.js";

process.env.FINANCE_DOCUMENT_KEY ||= "test-only-document-key-at-least-32-characters";
const owner = { username: "test-owner", role: "owner", business_ids: ["gemashow"], unit_ids: [] };
const period = { from: "2026-11-10", to: "2026-11-10" };

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  initFinanceDb(db);
  initFinanceOperationsDb(db);
  // The adapter's source contract; no payment gateway or real credentials are used.
  db.exec(`
    CREATE TABLE ticketing_events (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE ticketing_orders (
      id INTEGER PRIMARY KEY, event_id INTEGER, order_number TEXT,
      total REAL, payment_status TEXT, payment_method TEXT,
      created_at TEXT, updated_at TEXT, paid_at TEXT
    );
    INSERT INTO ticketing_events VALUES (1,'Evento de prueba');
  `);
  putPrivateSetting(db, "opening_cutoff", "2026-11-10T08:00:00Z");
  const add = (id, status, method = "payphone", total = 105, at = "2026-11-10T08:15:00Z") =>
    db.prepare("INSERT INTO ticketing_orders VALUES (?,1,?,?,?,?,?,?,?)").run(
      id, `TEST-${id}`, total, status, method, at, at, status === "paid" ? at : null,
    );
  return { db, add };
}

test("ProTickets imports confirmed gross receipts once without altering wallets or inventing expenses", (t) => {
  const { db, add } = fixture(t);
  add(1, "paid"); // Gross includes the owner's ProTickets share.
  add(2, "paid", "transfer", 50);
  add(3, "pending");
  add(4, "rejected");
  add(5, "expired");
  add(6, "paid", "payphone", 300, "2026-11-10T07:59:59Z");
  const first = syncInternalSources(db, owner);
  assert.equal(first.sales, 5);
  assert.equal(syncInternalSources(db, owner).sales, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_sales").get().n, 5);
  const result = snapshot(db, owner, period);
  assert.deepEqual(result.ticketing_receipts, {
    paid_orders: 2, pending_orders: 1, refunded_orders: 0,
    payphone_cents: 10500, transfer_cents: 5000,
    provider_fees_verified: false, wallet_auto_updated: false,
  });
  assert.equal(result.integrations.find((s) => s.source === "protickets").state, "ready");
  assert.equal(db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_movements").get().n, 0);
});

test("pending, paid and refunded ProTickets updates preserve identity even with equal source timestamps", (t) => {
  const { db, add } = fixture(t);
  add(1, "pending");
  syncInternalSources(db, owner);
  const id = db.prepare("SELECT id FROM finance_sales").get().id;
  assert.equal(snapshot(db, owner, period).ticketing_receipts.payphone_cents, 0);
  db.prepare("UPDATE ticketing_orders SET payment_status='paid',paid_at=created_at WHERE id=1").run();
  syncInternalSources(db, owner);
  assert.equal(snapshot(db, owner, period).ticketing_receipts.payphone_cents, 10500);
  db.prepare("UPDATE ticketing_orders SET payment_status='refunded' WHERE id=1").run();
  syncInternalSources(db, owner);
  const result = snapshot(db, owner, period).ticketing_receipts;
  assert.equal(result.payphone_cents, 0);
  assert.equal(result.paid_orders, 0);
  assert.equal(result.refunded_orders, 1);
  assert.equal(db.prepare("SELECT id FROM finance_sales").get().id, id);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_sales").get().n, 1);
});

test("ticketing receipt totals respect business, event and collaborator permissions", (t) => {
  const { db, add } = fixture(t);
  add(1, "paid");
  syncInternalSources(db, owner);
  const other = { ...owner, role: "viewer", business_ids: ["marjorie"] };
  assert.equal(snapshot(db, other, period).ticketing_receipts, null);
  assert.equal(snapshot(db, { ...owner, role: "collector" }, period).ticketing_receipts, null);
  const restricted = { ...owner, role: "viewer", unit_ids: ["another-event"] };
  assert.equal(snapshot(db, restricted, period).ticketing_receipts.payphone_cents, 0);
});

function walletFixture(t) {
  const f = fixture(t);
  f.db.exec("ALTER TABLE ticketing_orders ADD COLUMN provider_fee_rate REAL");
  const id = Number(f.db.prepare("INSERT INTO finance_accounts(business_id,name,bank,kind,opening_cents,opening_date,opening_at) VALUES ('gemashow','Fixture wallet','PayPhone','wallet',100000,'2026-11-10','2026-11-10T08:00:00Z')").run().lastInsertRowid);
  putPrivateSetting(f.db, "payphone_balance_observation", { account_id: id, as_of_at: "2026-11-10T08:00:00Z" });
  // add() predates the extra source field; insert explicit columns for these cases.
  f.add = (n, { status = "paid", method = "payphone", total = 22, rate = 5.75, at = "2026-11-10T08:15:00Z", paidAt = at } = {}) => f.db.prepare("INSERT INTO ticketing_orders(id,event_id,order_number,total,payment_status,payment_method,created_at,updated_at,paid_at,provider_fee_rate) VALUES (?,1,?,?,?,?,?,?,?,?)").run(n, `WALLET-${n}`, total, status, method, at, at, paidAt, rate);
  return { ...f, account: f.db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(id) };
}

test("PayPhone wallet automatically adds gross less its order fee once, retaining the ProTickets share", (t) => {
  const { db, add, account } = walletFixture(t);
  add(1); // $22 gross = ticket price plus the owner's platform share.
  add(2, { method: "transfer" });
  add(3, { status: "pending", paidAt: null });
  add(4, { at: "2026-11-10T07:59:59Z" }); // Already included in the opening balance.
  syncInternalSources(db, owner);
  assert.equal(recordedAccountBalance(db, account, "2026-11-10"), 102073);
  syncInternalSources(db, owner);
  assert.equal(recordedAccountBalance(db, account, "2026-11-10"), 102073);
  const state = payphoneReceiptStatus(db, account.id);
  assert.equal(state.count, 1);
  assert.equal(state.fee_cents, 127);
  assert.equal(state.net_cents, 2073);
  assert.equal(state.receipts[0].fee_rate, 5.75);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 0);
});

test("a later wallet checkpoint absorbs previous sales and only new net receipts increase it", (t) => {
  const { db, add, account } = walletFixture(t);
  add(1);
  syncInternalSources(db, owner);
  db.prepare("INSERT INTO finance_balance_checkpoints(account_id,as_of_at,balance_cents,source_hash,created_by,created_at) VALUES (?,'2026-11-10T08:20:00Z',102073,'fixture-observation','owner','2026-11-10T08:20:00Z')").run(account.id);
  add(2, { total: 10, at: "2026-11-10T08:25:00Z" });
  syncInternalSources(db, owner);
  assert.equal(recordedAccountBalance(db, account, "2026-11-10"), 103015);
  assert.equal(recordedAccountBalance(db, account, "2026-11-10", "2026-11-10T08:20:00Z"), 102073);
});

test("missing fees and reversed payments require review instead of inventing wallet money", (t) => {
  const { db, add, account } = walletFixture(t);
  add(1, { rate: null });
  add(2);
  syncInternalSources(db, owner);
  assert.equal(recordedAccountBalance(db, account, "2026-11-10"), 102073);
  assert.equal(payphoneReceiptStatus(db, account.id).review_count, 1);
  db.prepare("UPDATE ticketing_orders SET payment_status='refunded' WHERE id=2").run();
  syncInternalSources(db, owner);
  assert.equal(payphoneReceiptStatus(db, account.id).review_count, 2);
  // Reserve the reversed gross and retain its fee until reviewed, without inventing a returned fee.
  assert.equal(recordedAccountBalance(db, account, "2026-11-10"), 99873);
});
