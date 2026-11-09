import { SPACE_TEMPLATES } from "../../shared/finance-workflow.mjs";
import {initFinanceOperationsDb} from './finance-operations-db.js';
export function initFinanceWorkflowDb(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_spaces (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,business_ids TEXT NOT NULL,unit_id TEXT,
    description TEXT NOT NULL DEFAULT '',suggested_members TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,
    share_type TEXT NOT NULL DEFAULT 'group',share_label TEXT NOT NULL DEFAULT '',share_phone TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS finance_space_members (
    space_id TEXT NOT NULL REFERENCES finance_spaces(id),member_id INTEGER NOT NULL REFERENCES finance_members(id),
    role TEXT NOT NULL CHECK(role IN ('observer','requester','coordinator')),PRIMARY KEY(space_id,member_id)
  );
  CREATE TABLE IF NOT EXISTS finance_payments (
    id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES finance_movements(id),movement_id INTEGER NOT NULL UNIQUE REFERENCES finance_movements(id),
    amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),evidence_id INTEGER NOT NULL REFERENCES finance_evidence(id),
    account_id INTEGER NOT NULL REFERENCES finance_accounts(id),paid_day TEXT NOT NULL,reference TEXT NOT NULL,
    created_by TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,voided_at TEXT,voided_by TEXT,void_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(created_by,request_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_evidence_once ON finance_payments(evidence_id) WHERE voided_at IS NULL;
  CREATE INDEX IF NOT EXISTS finance_payments_request ON finance_payments(request_id,voided_at);
  CREATE TABLE IF NOT EXISTS finance_space_notes (
    id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES finance_movements(id),actor TEXT NOT NULL,body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS finance_payees (
    id TEXT PRIMARY KEY,business_id TEXT NOT NULL,space_id TEXT REFERENCES finance_spaces(id),
    encrypted BLOB NOT NULL,created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS finance_settlement_balances (
    provider TEXT PRIMARY KEY,business_id TEXT NOT NULL,available_cents INTEGER NOT NULL CHECK(typeof(available_cents)='integer' AND available_cents>=0),
    pending_cents INTEGER NOT NULL CHECK(typeof(pending_cents)='integer' AND pending_cents>=0),as_of TEXT NOT NULL,
    updated_by TEXT NOT NULL,updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_payee_accounts (
    payee_id TEXT NOT NULL REFERENCES finance_payees(id),scope TEXT NOT NULL,fingerprint TEXT NOT NULL,
    PRIMARY KEY(scope,fingerprint)
  );
  CREATE TABLE IF NOT EXISTS finance_request_payees (
    request_id INTEGER PRIMARY KEY REFERENCES finance_movements(id),payee_id TEXT NOT NULL REFERENCES finance_payees(id),
    encrypted BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_push_subscriptions (
    endpoint_hash TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES finance_members(id),encrypted BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS finance_push_outbox (
    id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,request_id INTEGER NOT NULL REFERENCES finance_movements(id),
    state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  for (const [table, column, declaration] of [
    ["finance_movements", "is_payment_request", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_movements", "space_id", "TEXT REFERENCES finance_spaces(id)"],
    ["finance_members", "work_view", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_payments", "destination_index", "INTEGER"],
  ])
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO finance_spaces (id,name,kind,business_ids,unit_id,description,suggested_members,share_label,created_by) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  for (const s of SPACE_TEMPLATES)
    insert.run(
      s.id,
      s.name,
      s.kind,
      JSON.stringify(s.business_ids),
      s.unit_id,
      s.description,
      JSON.stringify(s.suggested_members),
      s.name,
      "system"
    );
  initFinanceOperationsDb(db);
}
