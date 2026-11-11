export function initFinanceOperationsDb(db) {
  for (const [table, column, type] of [
    ["finance_members", "request_payments", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_members", "password_policy_completed", "TEXT"],
    ["finance_members", "password_changed_at", "TEXT"],
    ["finance_sessions", "remembered", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_members", "review_unit_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["finance_members", "auto_confirm_unit_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ["finance_members", "custody_adjust", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_members", "checks_manage", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_accounts", "opening_at", "TEXT"],
    ["finance_movements", "cross_account", "INTEGER NOT NULL DEFAULT 0"],
    ["finance_movements", "receiving_bank", "TEXT NOT NULL DEFAULT ''"],
    [
      "finance_bank_transactions",
      "import_source",
      "TEXT NOT NULL DEFAULT 'csv'",
    ],
    ["finance_bank_transactions", "occurred_at", "TEXT"],
    ["finance_movements", "hidden_at", "TEXT"],
  ]) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  if (
    !db
      .prepare("PRAGMA table_info(finance_members)")
      .all()
      .some((c) => c.name === "checks_clear")
  ) {
    db.exec(
      "ALTER TABLE finance_members ADD COLUMN checks_clear INTEGER NOT NULL DEFAULT 0",
    );
    db.prepare(
      "UPDATE finance_members SET checks_clear=1 WHERE username='german' AND checks_manage=1 AND work_view=1",
    ).run();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_assistant_photos (id TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES finance_members(id),mime TEXT NOT NULL,name TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,encrypted BLOB NOT NULL,uploaded_at TEXT NOT NULL,UNIQUE(member_id,sha256));
    CREATE TABLE IF NOT EXISTS finance_assistant_draft_photos (draft_id TEXT NOT NULL REFERENCES finance_assistant_drafts(id) ON DELETE CASCADE,photo_id TEXT NOT NULL REFERENCES finance_assistant_photos(id),PRIMARY KEY(draft_id,photo_id));
    CREATE TABLE IF NOT EXISTS finance_assistant_photo_applications (photo_id TEXT NOT NULL REFERENCES finance_assistant_photos(id),target TEXT NOT NULL,draft_id TEXT NOT NULL REFERENCES finance_assistant_drafts(id),PRIMARY KEY(photo_id,target));
    CREATE TABLE IF NOT EXISTS finance_push_tests (id TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES finance_members(id),endpoint_hash TEXT NOT NULL,created_at TEXT NOT NULL,accepted_at TEXT,displayed_at TEXT,status_code INTEGER);
    CREATE TABLE IF NOT EXISTS finance_digital_taxes (principal_bank_id INTEGER NOT NULL REFERENCES finance_bank_transactions(id),tax_code TEXT NOT NULL,merchant TEXT NOT NULL,rate REAL NOT NULL,amount_cents INTEGER NOT NULL,bank_transaction_id INTEGER NOT NULL UNIQUE REFERENCES finance_bank_transactions(id),created_at TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(principal_bank_id,tax_code));
    CREATE TABLE IF NOT EXISTS finance_assistant_drafts (id TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES finance_members(id),encrypted BLOB NOT NULL,expires_at INTEGER NOT NULL,result_json TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_provider_receipts (source_system TEXT NOT NULL,external_id TEXT NOT NULL,account_id INTEGER NOT NULL REFERENCES finance_accounts(id),document_number TEXT NOT NULL,occurred_at TEXT NOT NULL,gross_cents INTEGER NOT NULL,fee_rate REAL,fee_cents INTEGER,net_cents INTEGER,state TEXT NOT NULL CHECK(state IN ('calculated','attention')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(source_system,external_id));
    CREATE INDEX IF NOT EXISTS finance_provider_receipts_account ON finance_provider_receipts(account_id,occurred_at);
    CREATE TABLE IF NOT EXISTS finance_balance_checkpoints (id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES finance_accounts(id),as_of_at TEXT NOT NULL,balance_cents INTEGER NOT NULL,source_hash TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(account_id,source_hash));
    CREATE TABLE IF NOT EXISTS finance_incoming_notices (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,account_id INTEGER NOT NULL REFERENCES finance_accounts(id),amount_cents INTEGER NOT NULL,counterparty TEXT NOT NULL,day TEXT NOT NULL,source_hash TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_runtime_settings (key TEXT PRIMARY KEY,encrypted BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_member_invites (token_hash TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES finance_members(id),expires_at INTEGER NOT NULL,used_at TEXT,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_custody_balances (id TEXT PRIMARY KEY,name TEXT NOT NULL,business_id TEXT NOT NULL,balance_cents INTEGER,version INTEGER NOT NULL DEFAULT 0,updated_at TEXT,updated_by TEXT);
    CREATE TABLE IF NOT EXISTS finance_custody_adjustments (id INTEGER PRIMARY KEY,custody_id TEXT NOT NULL REFERENCES finance_custody_balances(id),before_cents INTEGER,after_cents INTEGER NOT NULL,delta_cents INTEGER NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(actor,request_key));
    CREATE TABLE IF NOT EXISTS finance_store_confirmations (movement_id INTEGER PRIMARY KEY REFERENCES finance_movements(id),actor TEXT NOT NULL,confirmed_at TEXT NOT NULL,mode TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_mail_messages (id TEXT PRIMARY KEY,received_at TEXT NOT NULL,encrypted BLOB NOT NULL,state TEXT NOT NULL,account_id INTEGER REFERENCES finance_accounts(id),movement_id INTEGER REFERENCES finance_movements(id),bank_transaction_id INTEGER REFERENCES finance_bank_transactions(id),transaction_key TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS finance_mail_transaction_key ON finance_mail_messages(transaction_key);
    CREATE TABLE IF NOT EXISTS finance_loans (id TEXT PRIMARY KEY,name TEXT NOT NULL,bank TEXT NOT NULL,business_id TEXT,account_id INTEGER NOT NULL REFERENCES finance_accounts(id),operation_suffix TEXT NOT NULL DEFAULT '',principal_cents INTEGER NOT NULL,as_of TEXT NOT NULL,source_hash TEXT NOT NULL,variable_rate INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS finance_loan_installments (loan_id TEXT NOT NULL REFERENCES finance_loans(id),sequence INTEGER NOT NULL,due_day TEXT NOT NULL,principal_cents INTEGER NOT NULL,interest_cents INTEGER NOT NULL,insurance_cents INTEGER NOT NULL,other_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,remaining_principal_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'expected',bank_transaction_id INTEGER REFERENCES finance_bank_transactions(id),paid_at TEXT,PRIMARY KEY(loan_id,sequence));
    CREATE TABLE IF NOT EXISTS finance_loan_alerts (id TEXT PRIMARY KEY,loan_id TEXT NOT NULL REFERENCES finance_loans(id),sequence INTEGER NOT NULL,kind TEXT NOT NULL,day TEXT NOT NULL,push_day TEXT NOT NULL DEFAULT '',resolved_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_checks (id TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES finance_accounts(id),number TEXT NOT NULL,payee TEXT NOT NULL,amount_cents INTEGER NOT NULL,due_day TEXT NOT NULL,fund_day TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',needs_review INTEGER NOT NULL DEFAULT 0,review_note TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,cleared_bank_id INTEGER UNIQUE REFERENCES finance_bank_transactions(id),UNIQUE(account_id,number));
    CREATE TABLE IF NOT EXISTS finance_check_actions (id INTEGER PRIMARY KEY,check_id TEXT NOT NULL REFERENCES finance_checks(id),actor TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(actor,request_key));
    CREATE TABLE IF NOT EXISTS finance_credit_cards (id TEXT PRIMARY KEY,name TEXT NOT NULL,bank TEXT NOT NULL,debit_account_id INTEGER REFERENCES finance_accounts(id),cut_day INTEGER NOT NULL,due_day INTEGER NOT NULL DEFAULT 9);
    CREATE TABLE IF NOT EXISTS finance_card_statements (id TEXT PRIMARY KEY,card_id TEXT NOT NULL REFERENCES finance_credit_cards(id),cut_date TEXT NOT NULL,due_date TEXT NOT NULL,total_cents INTEGER,min_cents INTEGER,state TEXT NOT NULL DEFAULT 'awaiting',source_mail_id TEXT,updated_by TEXT,updated_at TEXT,paid_bank_id INTEGER UNIQUE REFERENCES finance_bank_transactions(id));
    CREATE TABLE IF NOT EXISTS finance_card_payments (id TEXT PRIMARY KEY,card_id TEXT NOT NULL REFERENCES finance_credit_cards(id),statement_id TEXT REFERENCES finance_card_statements(id),amount_cents INTEGER NOT NULL,day TEXT NOT NULL,account_id INTEGER REFERENCES finance_accounts(id),bank_transaction_id INTEGER UNIQUE REFERENCES finance_bank_transactions(id),source_mail_id TEXT UNIQUE,historical INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_funding_alerts (id TEXT PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT NOT NULL,day TEXT NOT NULL,push_day TEXT NOT NULL DEFAULT '',resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_mail_oauth (id TEXT PRIMARY KEY,encrypted BLOB NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS finance_oauth_states (hash TEXT PRIMARY KEY,member_id INTEGER NOT NULL,verifier BLOB NOT NULL,expires_at INTEGER NOT NULL);
  `);
  for (const table of ['finance_mail_messages','finance_incoming_notices'])
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='archived_at'))
      db.exec(`ALTER TABLE ${table} ADD COLUMN archived_at TEXT`);
  for (const name of [
    "manual_cleared_day",
    "cleared_by",
    "cleared_at",
    "clearing_source",
  ])
    if (
      !db
        .prepare("PRAGMA table_info(finance_checks)")
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE finance_checks ADD COLUMN ${name} TEXT`);
  for (const [id, name] of [
    ["marcela", "Marcela"],
    ["henry", "Henry"],
    ["paty", "Ñaña Paty"],
    ["anita", "Anita"],
    ["morelia", "More"],
  ])
    db.prepare(
      "INSERT OR IGNORE INTO finance_custody_balances (id,name,business_id) VALUES (?,?,'gemashow')",
    ).run(id, name);
  db.prepare(
    "INSERT OR IGNORE INTO finance_custody_balances (id,name,business_id) VALUES ('efectivo','EFECTIVO','shared')",
  ).run();
  if (
    !db
      .prepare("PRAGMA table_info(finance_custody_balances)")
      .all()
      .some((c) => c.name === "bank")
  )
    db.exec(
      "ALTER TABLE finance_custody_balances ADD COLUMN bank TEXT NOT NULL DEFAULT 'Pichincha'",
    );
  db.prepare(
    "UPDATE finance_custody_balances SET bank='Efectivo' WHERE id='efectivo'",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO finance_custody_balances (id,name,business_id,bank) VALUES ('xavi-ahorros','Xavi Ahorros','gemashow','Guayaquil')",
  ).run();
  // Upgrade old shared contact fingerprints to each original submitter's address book.
  db.prepare(
    "UPDATE finance_payee_accounts SET scope=scope||'|user:'||(SELECT created_by FROM finance_payees WHERE id=payee_id) WHERE instr(scope,'|user:')=0",
  ).run();
}
