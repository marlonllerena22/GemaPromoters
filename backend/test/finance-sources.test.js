import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb } from "../src/finance-db.js";
import { initFinanceOperationsDb } from "../src/finance-operations-db.js";
import { putPrivateSetting } from "../src/finance-operations.js";
import { syncInternalSources } from "../src/finance-sources.js";
import { snapshot } from "../src/finance-service.js";

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
