import crypto from "node:crypto";

export const FINANCE_BUSINESSES = [
  ["producalza", "Producalza", "Producción y pedidos", "#3f725e", "P"],
  ["marjorie", "Marjorie Botas", "Retail · cuatro locales", "#a97850", "M"],
  ["gemashow", "Gemashow", "Eventos y ticketera", "#7665a0", "G"],
  ["personal", "Personal", "Tu economía personal", "#527b9c", "A"],
];

export function financeDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw Object.assign(new Error("Fecha no válida"), { status: 400 });
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function validDay(value) {
  const text = String(value || "");
  const date = new Date(`${text}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw Object.assign(
      new Error("Usa una fecha válida en formato AAAA-MM-DD"),
      { status: 400 },
    );
  }
  return text;
}

export function cents(value, { signed = false, zero = false } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    Math.abs(value) > 100_000_000_000 ||
    (!signed && value < 0) ||
    (!zero && value === 0)
  ) {
    throw Object.assign(
      new Error("El monto debe expresarse en centavos enteros y ser válido"),
      { status: 400 },
    );
  }
  return value;
}

export function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw Object.assign(
      new Error("La contraseña debe tener entre 12 y 256 caracteres"),
      { status: 400 },
    );
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function passwordMatches(password, hash) {
  if (typeof password !== "string" || password.length > 256 || !hash)
    return false;
  const [salt, expected] = hash.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  const buffer = Buffer.from(expected || "", "hex");
  return (
    actual.length === buffer.length && crypto.timingSafeEqual(actual, buffer)
  );
}

export function initFinanceDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_businesses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, monogram TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_units (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'branch', source_id TEXT, UNIQUE(business_id, source_id)
    );
    CREATE TABLE IF NOT EXISTS finance_members (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','collector','viewer')), business_ids TEXT NOT NULL,
      unit_ids TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS finance_sessions (
      token_hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES finance_members(id),
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_accounts (
      id INTEGER PRIMARY KEY, business_id TEXT REFERENCES finance_businesses(id), name TEXT NOT NULL, bank TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('bank','cash','wallet','card','custody')), last_four TEXT NOT NULL DEFAULT '',
      custodian TEXT NOT NULL DEFAULT '', opening_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(opening_cents)='integer'),
      opening_date TEXT NOT NULL, verified_cents INTEGER, verified_at TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS finance_evidence (
      id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), unit_id TEXT REFERENCES finance_units(id), name TEXT NOT NULL,
      mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, encrypted BLOB NOT NULL,
      created_by TEXT NOT NULL, analysis TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(business_id, sha256)
    );
    CREATE TABLE IF NOT EXISTS finance_movements (
      id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), unit_id TEXT REFERENCES finance_units(id),
      account_id INTEGER REFERENCES finance_accounts(id), kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer','refund')),
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
      day TEXT NOT NULL, due_date TEXT, category TEXT NOT NULL, counterparty TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL DEFAULT 'transfer',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','reported','reconciled','rejected')),
      evidence_id INTEGER REFERENCES finance_evidence(id), order_id INTEGER, source_system TEXT, external_id TEXT,
      transfer_group TEXT, transfer_side TEXT CHECK(transfer_side IN ('incoming','outgoing')),
      created_by TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(source_system, business_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS finance_movements_period ON finance_movements(business_id, day, status);
    CREATE TABLE IF NOT EXISTS finance_bank_transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES finance_accounts(id), day TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents<>0), reference TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, batch_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'statement', created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(account_id, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS finance_allocations (
      id INTEGER PRIMARY KEY, bank_transaction_id INTEGER NOT NULL REFERENCES finance_bank_transactions(id),
      movement_id INTEGER NOT NULL REFERENCES finance_movements(id),
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(bank_transaction_id, movement_id)
    );
    CREATE TABLE IF NOT EXISTS finance_sales (
      id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), unit_id TEXT REFERENCES finance_units(id),
      source_system TEXT NOT NULL, external_id TEXT NOT NULL, document_number TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(typeof(total_cents)='integer' AND total_cents>=0),
      refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=total_cents),
      state TEXT NOT NULL CHECK(state IN ('active','cancelled','pending','refunded')),
      payments_json TEXT NOT NULL DEFAULT '[]', source_updated_at TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(source_system, business_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS finance_sales_period ON finance_sales(business_id, day);
    CREATE TABLE IF NOT EXISTS finance_recurring (
      id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), unit_id TEXT REFERENCES finance_units(id),
      name TEXT NOT NULL, category TEXT NOT NULL, counterparty TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
      due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28), active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_budgets (
      id INTEGER PRIMARY KEY, business_id TEXT NOT NULL REFERENCES finance_businesses(id), month TEXT NOT NULL,
      category TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
      UNIQUE(business_id, month, category)
    );
    CREATE TABLE IF NOT EXISTS finance_closings (
      id INTEGER PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES finance_units(id), day TEXT NOT NULL,
      opening_cents INTEGER NOT NULL, sales_cents INTEGER NOT NULL, expenses_cents INTEGER NOT NULL,
      deposits_cents INTEGER NOT NULL, counted_cents INTEGER NOT NULL, expected_cents INTEGER NOT NULL,
      difference_cents INTEGER NOT NULL, needs_review INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(unit_id, day)
    );
    CREATE TABLE IF NOT EXISTS finance_sync_log (
      source TEXT PRIMARY KEY, last_run TEXT, count INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS finance_audit (
      id INTEGER PRIMARY KEY, business_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
      entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, previous_hash TEXT NOT NULL, hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS finance_account_allocations (
    account_id INTEGER NOT NULL REFERENCES finance_accounts(id),business_id TEXT NOT NULL REFERENCES finance_businesses(id),
    amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer'),PRIMARY KEY(account_id,business_id)
  )`);
  if (
    !db
      .prepare("PRAGMA table_info(finance_closings)")
      .all()
      .some((c) => c.name === "needs_review")
  )
    db.exec(
      "ALTER TABLE finance_closings ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0",
    );
  for (const column of ["transfer_group", "transfer_side"])
    if (
      !db
        .prepare("PRAGMA table_info(finance_movements)")
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE finance_movements ADD COLUMN ${column} TEXT`);
  for (const [column, type] of [
    ["production_payment_id", "INTEGER"],
    ["production_payment_owned", "INTEGER NOT NULL DEFAULT 0"],
  ])
    if (
      !db
        .prepare("PRAGMA table_info(finance_movements)")
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE finance_movements ADD COLUMN ${column} ${type}`);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS finance_production_payment_link ON finance_movements(production_payment_id) WHERE production_payment_id IS NOT NULL",
  );
  for (const [column, type] of [
    ["mfa_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["mfa_secret", "BLOB"],
    ["mfa_pending_secret", "BLOB"],
    ["mfa_pending_at", "INTEGER"],
    ["last_totp_step", "INTEGER NOT NULL DEFAULT -1"],
  ]) {
    if (
      !db
        .prepare("PRAGMA table_info(finance_members)")
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE finance_members ADD COLUMN ${column} ${type}`);
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS finance_recovery_codes (member_id INTEGER NOT NULL REFERENCES finance_members(id),hash TEXT NOT NULL,used_at TEXT,PRIMARY KEY(member_id,hash))",
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO finance_businesses VALUES (?,?,?,?,?)",
  );
  for (const business of FINANCE_BUSINESSES) insert.run(...business);
  const unit = db.prepare(
    "INSERT OR IGNORE INTO finance_units (id,business_id,name,kind) VALUES (?,?,?,?)",
  );
  for (const name of ["Norte", "Valle", "Bosque", "Sur"])
    unit.run(`marjorie-${name.toLowerCase()}`, "marjorie", name, "branch");
  unit.run("producalza-fabrica", "producalza", "Fábrica", "factory");
  for (const source of ["alfabusiness", "payphone", "bank", "email"]) {
    db.prepare(
      "INSERT OR IGNORE INTO finance_sync_log (source,state,detail) VALUES (?,'pending','Pendiente de configuración')",
    ).run(source);
  }
  if (
    process.env.FINANCE_ADMIN_PASSWORD &&
    !db.prepare("SELECT id FROM finance_members WHERE role='owner'").get()
  ) {
    db.prepare(
      "INSERT INTO finance_members (name,username,password_hash,role,business_ids) VALUES (?,?,?,?,?)",
    ).run(
      process.env.FINANCE_ADMIN_NAME || "Administrador",
      process.env.FINANCE_ADMIN_USER || "finanzas",
      passwordHash(process.env.FINANCE_ADMIN_PASSWORD),
      "owner",
      JSON.stringify(FINANCE_BUSINESSES.map((x) => x[0])),
    );
  }
}

export function audit(
  db,
  actor,
  action,
  entity,
  id,
  before = null,
  after = null,
  business = null,
) {
  const previous =
    db.prepare("SELECT hash FROM finance_audit ORDER BY id DESC LIMIT 1").get()
      ?.hash || "GENESIS";
  const at = new Date().toISOString();
  const values = [
    business,
    actor,
    action,
    entity,
    String(id),
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    previous,
    at,
  ];
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex");
  db.prepare(
    "INSERT INTO finance_audit (business_id,actor,action,entity,entity_id,before_json,after_json,previous_hash,created_at,hash) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(...values, hash);
}

export function safeMember(member) {
  return {
    id: member.id,
    name: member.name,
    username: member.username,
    role: member.role,
    business_ids: JSON.parse(member.business_ids),
    unit_ids: JSON.parse(member.unit_ids || "[]"),
    active: Boolean(member.active),
    mfa_enabled: Boolean(member.mfa_enabled),
  };
}
