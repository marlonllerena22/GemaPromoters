import { applyBankReview } from "../src/finance-bank-review.js";
import { assistantFilters, sourcedAnswer } from "../src/finance-assistant.js";
import { recordMailStatement } from "../src/finance-gmail.js";
import { initFinanceOperationsDb } from "../src/finance-operations-db.js";
import { declareCheck } from "../src/finance-check-ledger.js";
import {
  accountPresentation,
  liquidityView,
} from "../src/finance-liquidity.js";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { encryptDocument } from "../src/finance-ai.js";
import {
  adjustCustody,
  confirmStoreReceipt,
  storeReceipts,
  putPrivateSetting,
  privateSetting,
  custodyFunds,
} from "../src/finance-operations.js";
import { savePayee, listPayees, getPayee } from "../src/finance-payees.js";
import {
  createMovement,
  importBank,
  reconcile,
  snapshot,
} from "../src/finance-service.js";
import {
  fundingOverview,
  saveCheck,
  ensureCardCycles,
  evaluateFundingAlerts,
  debitAlreadyUsed,
  accountCash,
} from "../src/finance-funding.js";
import { evaluateLoanAlerts } from "../src/finance-loans.js";
import {
  parseBankMail,
  mailAutoPostingAllowed,
  replayAutomaticBankMail,
  syncGmail,
  ingestBankMessages,
  mailDrafts,
  applyMailDraft,
} from "../src/finance-gmail.js";
import { applyFinanceBootstrap } from "../src/finance-onboarding.js";
import { transferFeeQuote } from "../../shared/finance-fees.mjs";
process.env.NODE_ENV = "test";
process.env.FINANCE_DOCUMENT_KEY =
  "fixture-secret-for-operations-only-000000000";
function fixture(t) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  initFinanceDb(db);
  t.after(() => db.close());
  const add = (name, role, business, units = [], flags = {}) => {
    const r = db
      .prepare(
        "INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,review_unit_ids,auto_confirm_unit_ids,checks_manage,custody_adjust,work_view,request_payments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        name,
        name,
        "unused",
        role,
        JSON.stringify(business),
        JSON.stringify(units),
        JSON.stringify(flags.review || []),
        JSON.stringify(flags.auto || []),
        flags.checks ? 1 : 0,
        flags.custody ? 1 : 0,
        flags.work ? 1 : 0,
        flags.request ? 1 : 0,
      );
    if (name === "german")
      db.prepare(
        "UPDATE finance_members SET checks_clear=1 WHERE username=?",
      ).run(name);
    return safeMember(
      db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(r.lastInsertRowid),
    );
  };
  const owner = add("owner", "owner", [
      "producalza",
      "gemashow",
      "marjorie",
      "personal",
    ]),
    german = add(
      "german",
      "viewer",
      ["producalza", "gemashow", "marjorie"],
      [],
      { checks: true, custody: true, work: true, request: true },
    ),
    morelia = add(
      "morelia",
      "collector",
      ["producalza", "gemashow", "marjorie"],
      [],
      { review: ["marjorie-sur"], checks: true },
    ),
    lili = add("lili", "collector", ["marjorie"], ["marjorie-norte"], {
      auto: ["marjorie-norte"],
    }),
    martha = add(
      "martha",
      "collector",
      ["marjorie"],
      ["marjorie-norte", "marjorie-bosque"],
    );
  const account = Number(
    db
      .prepare(
        "INSERT INTO finance_accounts (name,bank,kind,opening_cents,opening_date,last_four) VALUES ('Guayaquil corriente','Guayaquil','bank',195645,'2026-11-09','9999')",
      )
      .run().lastInsertRowid,
  );
  return { db, owner, german, morelia, lili, martha, account, add };
}
test("contacts are separate even when two collaborators save the same destination", (t) => {
  const { db, lili, martha } = fixture(t);
  const body = {
    business_id: "marjorie",
    name: "Fixture supplier",
    accounts: [
      {
        bank: "Pichincha",
        type: "savings",
        number: "0012345678",
        holder: "Fixture supplier",
      },
    ],
  };
  const a = savePayee(db, lili, body).contact,
    b = savePayee(db, martha, body).contact;
  assert.notEqual(a.id, b.id);
  assert.equal(listPayees(db, lili, "marjorie", null).length, 1);
  assert.throws(
    () => getPayee(db, martha, a.id),
    (e) => e.status === 404,
  );
});
test("custody adjustments preserve actor, delta, concurrency and replay without spending", (t) => {
  const { db, german, lili } = fixture(t),
    b = {
      balance_cents: 30000,
      version: 0,
      reason: "Confirmed funds",
      request_key: "fixture-adjustment-00001",
    };
  assert.equal(
    adjustCustody(db, german, "henry", b).adjustment.delta_cents,
    30000,
  );
  assert.equal(adjustCustody(db, german, "henry", b).duplicate, true);
  assert.throws(
    () =>
      adjustCustody(db, german, "henry", {
        ...b,
        request_key: "fixture-adjustment-00002",
      }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => adjustCustody(db, lili, "henry", b),
    (e) => e.status === 403,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    0,
  );
});
test("Lili confirms only her uploaded Norte income; Morelia reviews only Sur", (t) => {
  const { db, owner, lili, morelia, martha } = fixture(t);
  function receipt(user, unit) {
    const e = db
      .prepare(
        "INSERT INTO finance_evidence (business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        "marjorie",
        unit,
        "fixture.png",
        "image/png",
        1,
        crypto.randomUUID(),
        encryptDocument(Buffer.from("fixture")),
        user.username,
      );
    return createMovement(db, user, {
      business_id: "marjorie",
      unit_id: unit,
      kind: "income",
      amount_cents: 5000,
      day: "2026-11-09",
      category: "Ventas",
      counterparty: "Fixture",
      evidence_id: Number(e.lastInsertRowid),
    });
  }
  const norte = receipt(lili, "marjorie-norte");
  confirmStoreReceipt(db, lili, norte.id, "on_upload");
  assert.equal(
    db.prepare("SELECT status FROM finance_movements WHERE id=?").get(norte.id)
      .status,
    "approved",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0,
  );
  const other = receipt(martha, "marjorie-norte");
  assert.throws(
    () => confirmStoreReceipt(db, lili, other.id, "on_upload"),
    (e) => e.status === 403,
  );
  assert.throws(
    () => confirmStoreReceipt(db, morelia, other.id),
    (e) => e.status === 403,
  );
  const sur = receipt(owner, "marjorie-sur");
  confirmStoreReceipt(db, morelia, sur.id);
  assert.equal(
    storeReceipts(db, lili).some((r) => r.id === sur.id),
    false,
  );
});
test("cheque funding uses cumulative pending amounts and the same balance only once", (t) => {
  const { db, german, morelia, lili, account } = fixture(t);
  saveCheck(db, german, {
    account_id: account,
    number: "101",
    payee: "Fixture one",
    amount_cents: 327413,
    due_day: "2026-11-08",
  });
  saveCheck(db, morelia, {
    account_id: account,
    number: "102",
    payee: "Fixture two",
    amount_cents: 305135,
    due_day: "2026-11-15",
  });
  const f = fundingOverview(db, german, new Date("2026-11-09T20:00:00Z"));
  assert.equal(f.accounts[0].shortfall_now_cents, 131768);
  assert.equal(f.accounts[0].groups[1].fund_day, "2026-11-13");
  assert.equal(f.accounts[0].groups[1].shortfall_cents, 436903);
  assert.equal(fundingOverview(db, lili).checks.length, 0);
  assert.throws(
    () => saveCheck(db, lili, {}),
    (e) => e.status === 403,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM finance_checks WHERE status='pending'")
      .get().n,
    2,
  );
});
test("cheque numbers cannot duplicate and stale edits cannot overwrite corrections", (t) => {
  const { db, german, account } = fixture(t),
    b = {
      account_id: account,
      number: "162",
      payee: "Fixture",
      amount_cents: 125000,
      due_day: "2026-12-31",
    },
    c = saveCheck(db, german, b);
  assert.equal(c.fund_day, "2026-12-29");
  assert.throws(
    () => saveCheck(db, german, b),
    (e) => e.status === 409,
  );
  saveCheck(db, german, { ...b, reason: "Checked notebook", version: 0 }, c.id);
  assert.throws(
    () => saveCheck(db, german, { ...b, reason: "Stale", version: 0 }, c.id),
    (e) => e.status === 409,
  );
});
test("card cycles distinguish closing month and expose only payment totals to German", (t) => {
  const { db, owner, german } = fixture(t);
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('fixture-card','Pichincha','Pichincha',NULL,24,9)",
  ).run();
  ensureCardCycles(db, new Date("2026-11-24T15:00:00Z"));
  ensureCardCycles(db, new Date("2026-11-24T15:00:00Z"));
  const s = db
    .prepare(
      "SELECT * FROM finance_card_statements WHERE cut_date='2026-11-24'",
    )
    .get();
  assert.equal(s.due_date, "2026-12-09");
  assert.equal(s.total_cents, null);
  assert.equal(fundingOverview(db, german).cards.length, 1);
  assert.equal(
    fundingOverview(db, german).cards[0].statements[0].source_mail_id,
    undefined,
  );
  assert.equal(
    fundingOverview(db, german).cards[0].debit_account_id,
    undefined,
  );
  assert.equal(fundingOverview(db, owner).cards.length, 1);
});
test("loan alerts use Ecuador calendar day and never infer a debit from a deadline", (t) => {
  const { db, owner, account } = fixture(t);
  db.prepare(
    "INSERT INTO finance_loans VALUES ('fixture','Loan','Guayaquil',NULL,?,'9999',200000,'2026-11-09','hash',0)",
  ).run(account);
  db.prepare(
    "INSERT INTO finance_loan_installments (loan_id,sequence,due_day,principal_cents,interest_cents,insurance_cents,other_cents,total_cents,remaining_principal_cents) VALUES ('fixture',1,'2026-11-12',200000,0,0,0,200000,0)",
  ).run();
  let f = evaluateLoanAlerts(db, new Date("2026-11-12T02:00:00Z"));
  assert.ok(f.alerts.some((a) => a.kind === "due_tomorrow"));
  assert.equal(f.loans[0].shortfall_cents, 4355);
  f = evaluateLoanAlerts(db, new Date("2026-11-13T15:00:00Z"));
  assert.equal(f.loans[0].next.status, "expected");
  assert.ok(f.alerts.some((a) => a.kind === "debit_unconfirmed"));
  assert.equal(debitAlreadyUsed(db, 999), false);
});
const mail = (id, body, time = "2026-11-09T21:00:00Z") => ({
  id,
  internalDate: String(Date.parse(time)),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "avisos@pichincha.com" },
      { name: "Subject", value: "Transferencia enviada" },
      {
        name: "Authentication-Results",
        value: "mx.google.com; dmarc=pass header.from=pichincha.com",
      },
    ],
    body: { content: body },
  },
});
test("mail recognises failed debits and never maps a debit-card suffix to a bank account", () => {
  const p = parseBankMail(
    mail(
      "failed",
      "No se pudo procesar pago con tu tarjeta de débito. Número de tarjeta ****9999. Fondos insuficientes. Monto $40.00",
    ),
    { accounts: [{ number: "0019999", account_id: 1 }] },
  );
  assert.equal(p.event, "failed");
  assert.equal(p.amount_cents, null);
  assert.equal(p.account_id, null);
});
test("mail ignores historical operations, deduplicates Gmail IDs, and stores encrypted bodies", (t) => {
  const { db } = fixture(t);
  putPrivateSetting(db, "opening_cutoff", "2026-11-09T19:50:10Z");
  const m = mail(
    "old",
    "Transferencia enviada. Monto $50.00.",
    "2026-11-09T18:00:00Z",
  );
  assert.equal(ingestBankMessages(db, [m, m]).imported, 1);
  assert.equal(mailDrafts(db)[0].state, "historical");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0,
  );
  assert.ok(
    !db
      .prepare("SELECT encrypted FROM finance_mail_messages")
      .get()
      .encrypted.toString()
      .includes("Transferencia enviada"),
  );
});
test("reviewed inter-account mail records principal and explicit total fee separately without sales", (t) => {
  const { db, owner, account } = fixture(t);
  putPrivateSetting(db, "opening_cutoff", "2026-11-09T19:50:10Z");
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ number: "0019999", account_id: account }],
    owner_name: "Fixture Owner Name",
  });
  const m = mail(
    "new",
    "Realizaste una transferencia. Cuenta de origen 0019999 Cuenta destino: 0019999 Monto $50.00 Referencia: ABC123456. La transacción tiene un costo de $0.41",
  );
  ingestBankMessages(db, [m]);
  assert.equal(mailDrafts(db)[0].fee_cents, 41);
  applyMailDraft(db, owner, "new", {
    account_id: account,
    direction: "outgoing",
    occurred_at: "2026-11-09T20:00:00Z",
  });
  assert.equal(
    db
      .prepare("SELECT SUM(amount_cents) n FROM finance_bank_transactions")
      .get().n,
    -5041,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    0,
  );
  assert.equal(applyMailDraft(db, owner, "new", {}).duplicate, true);
});
test("opening-day bank imports require actual time after the snapshot cutoff", (t) => {
  const { db, owner, account } = fixture(t);
  db.prepare(
    "UPDATE finance_accounts SET opening_at='2026-11-09T19:50:10Z' WHERE id=?",
  ).run(account);
  assert.throws(
    () =>
      importBank(db, owner, {
        account_id: account,
        rows: [{ day: "2026-11-09", amount_cents: 1000, external_id: "old" }],
      }),
    /hora/,
  );
  assert.equal(
    importBank(db, owner, {
      account_id: account,
      rows: [
        {
          day: "2026-11-09",
          occurred_at: "2026-11-09T20:00:00Z",
          amount_cents: 1000,
          external_id: "new",
        },
      ],
    }).imported,
    1,
  );
});
test("private setup is transactional, idempotent and does not overwrite the main application", (t) => {
  const { db } = fixture(t);
  const old = process.env.FINANCE_BOOTSTRAP_PAYLOAD;
  t.after(() => {
    if (old === undefined) delete process.env.FINANCE_BOOTSTRAP_PAYLOAD;
    else process.env.FINANCE_BOOTSTRAP_PAYLOAD = old;
  });
  db.prepare("DELETE FROM finance_accounts").run();
  db.exec(
    "CREATE TABLE existing_app (name TEXT); INSERT INTO existing_app VALUES ('keep')",
  );
  process.env.FINANCE_BOOTSTRAP_PAYLOAD = encryptDocument(
    Buffer.from(
      JSON.stringify({
        id: "fixture",
        email: "fixture@example.invalid",
        owner_name: "Fixture",
        cutoff: "2026-11-09T19:50:10Z",
        members: [],
        accounts: [
          { key: "a", name: "Fixture", bank: "Test", balance_cents: 1000 },
        ],
        loans: [],
      }),
    ),
  ).toString("base64");
  assert.equal(applyFinanceBootstrap(db).applied, true);
  assert.equal(applyFinanceBootstrap(db).applied, false);
  assert.equal(db.prepare("SELECT name FROM existing_app").get().name, "keep");
});
test("transfer quotes distinguish same-bank routes, other banks, unknown channels and VAT totals", () => {
  assert.equal(transferFeeQuote("Banco Pichincha", "Pichincha").cents, 0);
  assert.equal(transferFeeQuote("Solidario", "Guayaquil").cents, 41);
  assert.equal(transferFeeQuote("Deuna", "Pichincha").cents, 41);
  assert.equal(transferFeeQuote("Unknown", "Pichincha").cents, null);
  assert.equal(
    transferFeeQuote("Pichincha", "Guayaquil", "office").cents,
    null,
  );
});
test("a trusted statement fills the total for its exact cycle and never substitutes the minimum", (t) => {
  const { db } = fixture(t);
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('fixture-card','Pichincha','Pichincha',NULL,24,9)",
  ).run();
  const m = mail(
    "statement",
    "Estado de cuenta. Fecha de corte 24/10/2026 Fecha máxima de pago 09/11/2026 Pago mínimo $15.00 Pago total $180.00",
  );
  m.payload.headers.find((h) => h.name === "Subject").value =
    "Tu estado de cuenta";
  ingestBankMessages(db, [m]);
  const s = db.prepare("SELECT * FROM finance_card_statements").get();
  assert.equal(s.total_cents, 18000);
  assert.equal(s.due_date, "2026-11-09");
  assert.equal(s.state, "recorded");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0,
  );
  assert.equal(mailDrafts(db)[0].state, "statement");
});
test("a statement cannot overwrite a manually checked amount", (t) => {
  const { db, owner } = fixture(t);
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('fixture-card','Pichincha','Pichincha',NULL,24,9)",
  ).run();
  db.prepare(
    "INSERT INTO finance_card_statements (id,card_id,cut_date,due_date,total_cents,state) VALUES ('fixture-card:2026-10-24','fixture-card','2026-10-24','2026-11-09',22200,'recorded')",
  ).run();
  const m = mail(
    "statement-new",
    "Fecha de corte 24/10/2026 Fecha máxima de pago 09/11/2026 Pago total $180.00",
  );
  m.payload.headers.find((h) => h.name === "Subject").value =
    "Tu estado de cuenta";
  ingestBankMessages(db, [m]);
  assert.equal(
    fundingOverview(db, owner).cards[0].statements[0].total_cents,
    22200,
  );
});
test("owner can classify a personal expense paid from a work account without revealing its details to work readers", (t) => {
  const { db, owner, german, morelia, account } = fixture(t);
  db.prepare(
    "UPDATE finance_accounts SET business_id='gemashow' WHERE id=?",
  ).run(account);
  const body = {
    business_id: "personal",
    account_id: account,
    kind: "expense",
    amount_cents: 7475,
    day: "2026-11-09",
    category: "Mascotas",
    counterparty: "SECRET-PERSONAL-PET",
    description: "SECRET-PET-FOOD",
    allow_cross_account: true,
  };
  assert.throws(
    () => createMovement(db, morelia, body),
    (e) => e.status === 403 || e.status === 400,
  );
  const m = createMovement(db, owner, body);
  assert.equal(m.cross_account, 1);
  db.prepare("UPDATE finance_movements SET status='reported' WHERE id=?").run(
    m.id,
  );
  importBank(db, owner, {
    account_id: account,
    rows: [
      {
        day: "2026-11-09",
        amount_cents: -7475,
        external_id: "personal-from-work",
      },
    ],
  });
  const b = db.prepare("SELECT * FROM finance_bank_transactions").get();
  reconcile(db, owner, {
    movement_id: m.id,
    bank_transaction_id: b.id,
    amount_cents: 7475,
  });
  const view = snapshot(db, german);
  assert.equal(
    view.accounts.find((a) => a.id === account).balance_cents,
    188170,
  );
  assert.ok(!JSON.stringify(view).includes("SECRET-PET"));
  assert.ok(!view.movements.some((r) => r.id === m.id));
  assert.equal(view.bank_transactions.length, 0);
});

test("reported cheque clearing is authorized, versioned, reversible and replay-safe", (t) => {
  const { db, owner, german, morelia, account } = fixture(t),
    day = financeDay();
  const c = saveCheck(db, owner, {
    account_id: account,
    number: "501",
    payee: "Proveedor Ejemplo",
    amount_cents: 50000,
    due_day: day,
  });
  const body = {
    cleared: true,
    version: 0,
    request_key: "fixture-clear-key-0001",
  };
  assert.throws(
    () => declareCheck(db, morelia, c.id, body),
    (e) => e.status === 403,
  );
  declareCheck(db, german, c.id, body);
  declareCheck(db, german, c.id, body);
  assert.equal(accountCash(db, account), 145645);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,
    0,
  );
  assert.throws(
    () =>
      declareCheck(db, owner, c.id, {
        ...body,
        request_key: "fixture-clear-key-0002",
      }),
    (e) => e.status === 409,
  );
  let g = fundingOverview(db, german).accounts[0].groups[0];
  assert.equal(g.checks.length, 1);
  assert.equal(g.total_cents, 50000);
  assert.equal(g.amount_cents, 0);
  assert.equal(g.cleared_count, 1);
  declareCheck(db, german, c.id, {
    cleared: false,
    version: 1,
    request_key: "fixture-clear-key-0003",
  });
  assert.equal(accountCash(db, account), 195645);
  assert.equal(
    db.prepare("SELECT status FROM finance_checks WHERE id=?").get(c.id).status,
    "pending",
  );
});

test("a later bank debit replaces reported cheque clearing without a second deduction", (t) => {
  const { db, owner, german, account } = fixture(t),
    day = financeDay();
  const c = saveCheck(db, owner, {
    account_id: account,
    number: "502",
    payee: "Proveedor Ejemplo",
    amount_cents: 50000,
    due_day: day,
  });
  declareCheck(db, german, c.id, {
    cleared: true,
    version: 0,
    request_key: "fixture-cleared-00001",
  });
  importBank(db, owner, {
    account_id: account,
    rows: [
      {
        day,
        amount_cents: -50000,
        reference: "Cheque 000502",
        description: "Débito cheque",
        external_id: "bank-check-502",
      },
    ],
  });
  assert.equal(accountCash(db, account), 145645);
  const actual = db
    .prepare("SELECT * FROM finance_checks WHERE id=?")
    .get(c.id);
  assert.equal(actual.clearing_source, "bank");
  assert.ok(actual.cleared_bank_id);
  assert.throws(
    () =>
      declareCheck(db, german, c.id, {
        cleared: false,
        version: actual.version,
        request_key: "fixture-cleared-00002",
      }),
    (e) => e.status === 409,
  );
  declareCheck(db, german, c.id, {
    cleared: true,
    version: actual.version,
    request_key: "fixture-cleared-00003",
  });
  assert.equal(
    db
      .prepare("SELECT clearing_source FROM finance_checks WHERE id=?")
      .get(c.id).clearing_source,
    "bank",
  );
});

test("automatic cheque confirmation requires its number, beneficiary, account, value and a unique debit", (t) => {
  const { db, owner, account } = fixture(t),
    day = financeDay();
  const c = saveCheck(db, owner, {
    account_id: account,
    number: "503",
    payee: "Cristóbal Ejemplo",
    amount_cents: 10000,
    due_day: day,
  });
  importBank(db, owner, {
    account_id: account,
    rows: [
      {
        day,
        amount_cents: -10000,
        reference: "Cheque 503",
        description: "Débito sin beneficiario",
        external_id: "no-beneficiary",
      },
    ],
  });
  assert.equal(
    db.prepare("SELECT status FROM finance_checks WHERE id=?").get(c.id).status,
    "pending",
  );
  importBank(db, owner, {
    account_id: account,
    rows: [
      {
        day,
        amount_cents: -10000,
        reference: "Cheque 503",
        description: "Pago a CRISTOBAL",
        external_id: "actual-beneficiary",
      },
    ],
  });
  assert.equal(
    db
      .prepare("SELECT clearing_source FROM finance_checks WHERE id=?")
      .get(c.id).clearing_source,
    "bank",
  );
  const d = saveCheck(db, owner, {
    account_id: account,
    number: "504",
    payee: "Cristóbal Ejemplo",
    amount_cents: 20000,
    due_day: day,
  });
  importBank(db, owner, {
    account_id: account,
    rows: [1, 2].map((n) => ({
      day,
      amount_cents: -20000,
      reference: "Cheque 504",
      description: "Pago a Cristobal",
      external_id: "ambiguous-" + n,
    })),
  });
  assert.equal(
    db.prepare("SELECT status FROM finance_checks WHERE id=?").get(d.id).status,
    "pending",
  );
});

test("family bank groups include authorized personal balances without exposing account numbers or details", (t) => {
  const { db, owner, german, account } = fixture(t);
  const add = (name, bank, business, amount) =>
    Number(
      db
        .prepare(
          "INSERT INTO finance_accounts(name,bank,kind,business_id,opening_cents,opening_date,last_four) VALUES (?,?,'bank',?,?,'2026-11-01','0123')",
        )
        .run(name, bank, business, amount).lastInsertRowid,
    );
  const personal = add("Personal", "Pichincha", "personal", 5000),
    work = add("Trabajo", "Pichincha", "producalza", 6000),
    savings = add("Ahorros", "Guayaquil", null, 7000);
  const registry = {
    accounts: [account, personal, work, savings].map((account_id, i) => ({
      account_id,
      number: "000000012" + i,
    })),
  };
  const data = snapshot(db, german, {});
  accountPresentation(db, german, data, registry);
  const p = data.accounts.find((a) => a.id === "group:pichincha"),
    g = data.accounts.find((a) => a.id === "group:guayaquil");
  assert.equal(p.balance_cents, 11000);
  assert.equal(g.balance_cents, 202645);
  assert.equal(g.reserved_cents, 195645);
  assert.equal(p.account_number, undefined);
  assert.deepEqual(p.positions, {});
  assert.equal(
    data.accounts.some(
      (a) => a.id === personal || a.id === work || a.id === account,
    ),
    false,
  );
  const own = snapshot(db, owner, {});
  accountPresentation(db, owner, own, registry);
  assert.equal(
    own.accounts.find((a) => a.id === personal).account_number,
    "0000000121",
  );
});

test("liquidity excludes checking once and reserves only the top-up plus near-term payments", (t) => {
  const { db, owner, account } = fixture(t);
  db.prepare(
    "INSERT INTO finance_accounts(name,bank,kind,business_id,opening_cents,opening_date) VALUES ('Ahorros','Pichincha','bank','producalza',100000,'2026-11-01')",
  ).run();
  saveCheck(db, owner, {
    account_id: account,
    number: "505",
    payee: "Proveedor Ejemplo",
    amount_cents: 250000,
    due_day: "2026-11-11",
  });
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('liq-card','Tarjeta','Pichincha',NULL,24,9)",
  ).run();
  db.prepare(
    "INSERT INTO finance_card_statements (id,card_id,cut_date,due_date,total_cents) VALUES ('liq-statement','liq-card','2026-10-24','2026-11-09',10000)",
  ).run();
  const data = snapshot(db, owner, {});
  data.funding_overview = fundingOverview(
    db,
    owner,
    new Date("2026-11-09T20:00:00Z"),
  );
  data.custody_funds = [];
  data.settlement_funds = [];
  let plan = liquidityView(
    db,
    owner,
    data,
    { accounts: [] },
    new Date("2026-11-09T20:00:00Z"),
  );
  assert.equal(plan.cash_cents, 100000);
  assert.equal(plan.checking_reserved_cents, 195645);
  assert.equal(plan.commitments_cents, 64355);
  assert.equal(plan.after_known_payments_cents, 35645);
  db.prepare(
    "UPDATE finance_card_statements SET total_cents=NULL WHERE id='liq-statement'",
  ).run();
  data.funding_overview = fundingOverview(
    db,
    owner,
    new Date("2026-11-09T20:00:00Z"),
  );
  plan = liquidityView(
    db,
    owner,
    data,
    { accounts: [] },
    new Date("2026-11-09T20:00:00Z"),
  );
  assert.equal(plan.unknown_commitments, 1);
  assert.equal(plan.commitments_cents, 54355);
});

test("existing installations grant cheque clearing only to German and keep the upgrade idempotent", (t) => {
  const { db } = fixture(t);
  db.exec("ALTER TABLE finance_members DROP COLUMN checks_clear");
  initFinanceOperationsDb(db);
  initFinanceOperationsDb(db);
  assert.equal(
    db
      .prepare(
        "SELECT checks_clear FROM finance_members WHERE username='german'",
      )
      .get().checks_clear,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT checks_clear FROM finance_members WHERE username='morelia'",
      )
      .get().checks_clear,
    0,
  );
});

test("trusted card payment and statement close the cycle once, including CSV overlap", (t) => {
  const { db, owner } = fixture(t);
  const id = Number(
    db
      .prepare(
        "INSERT INTO finance_accounts (name,bank,kind,opening_cents,opening_date) VALUES ('Fixture savings','Pacífico','bank',50000,'2026-11-01')",
      )
      .run().lastInsertRowid,
  );
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: id, bank: "Pacífico", number: "1022222263" }],
  });
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('mail-card','Fixture card','Pacífico',?,23,9)",
  ).run(id);
  recordMailStatement(db, {
    id: "bill-fixture",
    trusted: true,
    bank: "Pacífico",
    statement: {
      total_cents: 10000,
      cut_date: "2026-10-23",
      due_date: "2026-11-09",
    },
  });
  const m = mail(
    "payment-fixture",
    "Pago de tarjeta de cr&#233;dito exitosamente. Desde la cuenta : 10XXXXXX63 Tarjeta : 542258XXXXXXX353 Valor: $100.00 N&#250;mero de comprobante : 3701999 Fecha y hora: 09-11-2026 a las 15:59.",
  );
  m.payload.headers = [
    { name: "From", value: "avisos@bancopacifico.ec" },
    { name: "Subject", value: "Pago de tarjeta de crédito" },
    {
      name: "Authentication-Results",
      value: "mx.google.com; dmarc=pass header.from=bancopacifico.ec",
    },
  ];
  const parsed = parseBankMail(m, {
    accounts: [{ account_id: id, bank: "Pacífico", number: "1022222263" }],
  });
  assert.equal(parsed.account_id, id);
  assert.equal(parsed.amount_cents, 10000);
  assert.equal(parsed.event, "card_settlement");
  ingestBankMessages(db, [m, m]);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_card_payments").get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT state FROM finance_card_statements").get().state,
    "paid",
  );
  assert.equal(accountCash(db, id), 40000);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_movements").get().n,
    0,
  );
  const imported = importBank(db, owner, {
    account_id: id,
    rows: [
      {
        day: "2026-11-09",
        amount_cents: -10000,
        reference: "3701999",
        external_id: "csv-bank-id",
      },
    ],
  });
  assert.equal(imported.imported, 0);
  assert.equal(accountCash(db, id), 40000);
});

test("a historical card payment resolves its cycle without debiting the opening balance", (t) => {
  const { db, account } = fixture(t);
  db.prepare(
    "UPDATE finance_accounts SET bank='Pichincha',opening_at='2026-11-09T19:00:00Z' WHERE id=?",
  ).run(account);
  putPrivateSetting(db, "opening_cutoff", "2026-11-09T19:00:00Z");
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: account, bank: "Pichincha", number: "000009999" }],
  });
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('old-card','Fixture card','Pichincha',NULL,24,9)",
  ).run();
  recordMailStatement(db, {
    id: "fixture-bill",
    trusted: true,
    bank: "Pichincha",
    statement: {
      total_cents: 10000,
      cut_date: "2026-10-24",
      due_date: "2026-11-09",
    },
  });
  ingestBankMessages(db, [
    mail(
      "old-payment",
      "Pago de la tarjeta de cr&eacute;dito No. 5189XXXX1451. Cuenta de d&eacute;bito: XXXXXX9999 Monto: &#36;100.00 Fecha: 09/11/2026 a la(s) 11:08",
      "2026-11-09T16:08:25Z",
    ),
  ]);
  assert.equal(
    db.prepare("SELECT state FROM finance_card_statements").get().state,
    "paid_before_start",
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,
    0,
  );
  assert.equal(accountCash(db, account), 195645);
});

test("card installments stay partial and unmatched debit cards never select an account by suffix alone", (t) => {
  const { db, account, owner } = fixture(t);
  db.prepare("UPDATE finance_accounts SET bank='Pichincha' WHERE id=?").run(
    account,
  );
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: account, bank: "Pichincha", number: "000009999" }],
  });
  db.prepare(
    "INSERT INTO finance_credit_cards VALUES ('partial-card','Fixture card','Pichincha',NULL,24,9)",
  ).run();
  recordMailStatement(db, {
    id: "partial-bill",
    trusted: true,
    bank: "Pichincha",
    statement: {
      total_cents: 10000,
      cut_date: "2026-10-24",
      due_date: "2026-11-09",
    },
  });
  ingestBankMessages(db, [
    mail(
      "partial-payment",
      "Pago de la tarjeta de crédito. Cuenta de débito: XXXXXX9999 Monto: $40.00 Fecha 09/11/2026 a la(s) 15:59 Referencia: PARTIAL01",
    ),
  ]);
  const s = fundingOverview(db, owner).cards[0].statements[0];
  assert.equal(s.state, "partial");
  assert.equal(s.paid_cents, 4000);
  assert.equal(s.remaining_cents, 6000);
  const debit = parseBankMail(
    mail(
      "unknown-debit",
      "Pago exitoso con tu tarjeta de débito. Monto $10.00 Número de tarjeta ********9999 Fecha 09/11/2026 a la(s) 16:00",
    ),
    {
      accounts: [
        { account_id: account, bank: "Pichincha", number: "000009999" },
      ],
    },
  );
  assert.equal(debit.account_id, null);
});

test("promised transfers remain pending even when both own accounts are recognised", (t) => {
  const { db, account } = fixture(t);
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: account, bank: "Pichincha", number: "000009999" }],
  });
  ingestBankMessages(db, [
    mail(
      "promised",
      "La transferencia solicitada será debitada de su cuenta, y acreditada en la cuenta destino en 1 hora. Cuenta de origen: XXXXXX9999 Cuenta acreditada: XXXXXX9999 Monto: USD 25.00 Número de documento: PENDING01 Fecha 09/11/2026",
    ),
  ]);
  assert.equal(
    db.prepare("SELECT state FROM finance_mail_messages").get().state,
    "pending",
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,
    0,
  );
});

test("observed balances cover late-arriving older debits and retain later activity", (t) => {
  const { db, owner, account } = fixture(t);
  db.prepare("UPDATE finance_accounts SET bank='Pichincha' WHERE id=?").run(
    account,
  );
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: account, bank: "Pichincha", number: "000009999" }],
  });
  const config = {
    kind: "bank-review-v1",
    id: "checkpoint-fixture",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    messages: [],
    balances: [
      {
        bank: "Pichincha",
        account_suffix: "9999",
        balance_cents: 90000,
        as_of_at: "2026-11-09T18:00:00Z",
        source_hash: "a".repeat(64),
      },
    ],
  };
  applyBankReview(db, config);
  assert.equal(accountCash(db, account), 90000);
  importBank(db, owner, {
    account_id: account,
    rows: [
      {
        day: "2026-11-09",
        occurred_at: "2026-11-09T17:00:00Z",
        amount_cents: -10000,
        reference: "OLDNOTICE",
        external_id: "old-notice",
      },
      {
        day: "2026-11-09",
        occurred_at: "2026-11-09T19:00:00Z",
        amount_cents: -5000,
        reference: "LATERNOTICE",
        external_id: "later-notice",
      },
    ],
  });
  assert.equal(accountCash(db, account), 85000);
  assert.equal(applyBankReview(db, config).applied, false);
  assert.equal(accountCash(db, account), 85000);
});

test("a sales follow-up retains the sales source instead of interpreting the total as a cheque number", () => {
  const data = {
    period: { from: "2026-11-09", to: "2026-11-09" },
    sales: [
      {
        id: 4,
        state: "active",
        unit_id: "event",
        business_id: "gemashow",
        total_cents: 16800,
        refunded_cents: 0,
        payments: [{ amount_cents: 16800 }],
        document_number: "TICKET-EXAMPLE",
      },
    ],
    units: [{ id: "event", name: "Evento de ejemplo" }],
    businesses: [],
    summary: { income_cents: 0 },
    integrations: [],
  };
  const first = sourcedAnswer("¿Qué tal nos ha ido hoy en ventas?", data);
  assert.equal(first.topic, "sales");
  assert.equal(first.references[0].id, 4);
  const follow = sourcedAnswer("¿De qué son esos 168?", data, [
    { role: "assistant", text: first.answer, topic: first.topic },
  ]);
  assert.equal(follow.topic, "sales");
  assert.match(follow.answer, /Evento de ejemplo/);
  assert.doesNotMatch(follow.answer, /cheque/i);
  assert.match(follow.answer, /0,00/);
  assert.equal(
    sourcedAnswer("Dime del cheque 168", data, [
      { role: "assistant", text: first.answer, topic: "sales" },
    ]),
    null,
  );
  assert.equal(
    assistantFilters("hoy", {}, new Date("2026-11-10T02:00:00Z")).from,
    "2026-11-09",
  );
});

test("authorized test-request removal is exact, auditable, idempotent and rolls back mismatches", (t) => {
  const { db, owner } = fixture(t);
  const m = createMovement(db, owner, {
    business_id: "producalza",
    kind: "expense",
    amount_cents: 15000,
    day: "2026-11-09",
    category: "Otros",
    counterparty: "Proveedor de prueba",
    description: "Prueba",
  });
  db.prepare(
    "UPDATE finance_movements SET is_payment_request=1,created_by=? WHERE id=?",
  ).run("norma", m.id);
  const removal = {
      id: m.id,
      created_by: "norma",
      amount_cents: 15000,
      counterparty: "Proveedor de prueba",
      description: "Prueba",
    },
    config = {
      kind: "bank-review-v1",
      id: "remove-fixture",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      messages: [],
      remove_test_requests: [removal],
    };
  assert.throws(
    () =>
      applyBankReview(db, {
        ...config,
        remove_test_requests: [{ ...removal, amount_cents: 15001 }],
      }),
    /changed/,
  );
  assert.equal(
    db.prepare("SELECT hidden_at FROM finance_movements WHERE id=?").get(m.id)
      .hidden_at,
    null,
  );
  assert.equal(applyBankReview(db, config).removed, 1);
  assert.ok(
    db.prepare("SELECT hidden_at FROM finance_movements WHERE id=?").get(m.id)
      .hidden_at,
  );
  assert.equal(
    snapshot(db, owner, {}).movements.some((x) => x.id === m.id),
    false,
  );
  assert.equal(applyBankReview(db, config).applied, false);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM finance_audit WHERE action='request.test_removed'",
      )
      .get().n,
    1,
  );
});

test("a reported PayPhone balance is kept whole without subtracting the owned platform fee", (t) => {
  const { db, owner } = fixture(t),
    config = {
      kind: "bank-review-v1",
      id: "wallet-fixture",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      messages: [],
      wallet_balances: [
        {
          provider: "payphone",
          balance_cents: 120000,
          as_of_at: new Date().toISOString(),
          source_hash: "c".repeat(64),
        },
      ],
    };
  assert.equal(applyBankReview(db, config).wallets, 1);
  assert.equal(applyBankReview(db, config).applied, false);
  const a = db
    .prepare("SELECT * FROM finance_accounts WHERE bank='PayPhone'")
    .get();
  assert.equal(a.business_id, "gemashow");
  assert.equal(accountCash(db, a.id), 120000);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_movements").get().n,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM finance_accounts WHERE bank='PayPhone'")
      .get().n,
    1,
  );
  assert.equal(
    privateSetting(db, "payphone_balance_observation").platform_fee_owned,
    true,
  );
});

test("a forged foreign authentication result cannot authorize a banking debit", (t) => {
  const { db, account } = fixture(t);
  putPrivateSetting(db, "own_account_registry", {
    accounts: [{ account_id: account, bank: "Pichincha", number: "000009999" }],
  });
  const m = mail(
    "forged-auth",
    "Realizaste una transferencia. Cuenta de origen: XXXXXX9999 Monto: $25.00 Referencia: FORGED99 Fecha 09/11/2026 a la(s) 16:00",
  );
  m.payload.headers = m.payload.headers.filter(
    (h) => h.name !== "Authentication-Results",
  );
  m.payload.headers.push(
    {
      name: "Authentication-Results",
      value: "mx.google.com; dmarc=fail header.from=pichincha.com",
    },
    {
      name: "Authentication-Results",
      value: "attacker.invalid; dmarc=pass header.from=pichincha.com",
    },
  );
  assert.equal(parseBankMail(m).trusted, false);
  ingestBankMessages(db, [m]);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n,
    0,
  );
});

test("physical cash is adjustable only by the owner and German and has no bank account number", (t) => {
  const { db, owner, german, morelia, add } = fixture(t),
    other = add("another-custodian", "viewer", ["gemashow"], [], {
      custody: true,
    });
  assert.equal(
    custodyFunds(db, owner).find((f) => f.id === "morelia").balance_cents,
    null,
  );
  assert.equal(
    custodyFunds(db, owner).find((f) => f.id === "xavi-ahorros").bank,
    "Guayaquil",
  );
  assert.equal(
    custodyFunds(db, other).some((f) => f.id === "efectivo"),
    false,
  );
  assert.equal(
    custodyFunds(db, owner, ["gemashow"]).some((f) => f.id === "efectivo"),
    false,
  );
  const body = {
    balance_cents: 5000,
    version: 0,
    reason: "Saldo de prueba",
    request_key: "cash-fixture-key-0001",
  };
  for (const u of [morelia, other])
    assert.throws(
      () => adjustCustody(db, u, "efectivo", body),
      (e) => e.status === 403,
    );
  adjustCustody(db, owner, "efectivo", body);
  adjustCustody(db, german, "efectivo", {
    ...body,
    balance_cents: 3000,
    version: 1,
    request_key: "cash-fixture-key-0002",
  });
  const cash = custodyFunds(db, owner).find((f) => f.id === "efectivo");
  assert.equal(cash.balance_cents, 3000);
  assert.equal(cash.kind, "cash");
  assert.equal(cash.account_number, null);
  assert.equal(
    db
      .prepare(
        "SELECT delta_cents FROM finance_custody_adjustments WHERE custody_id='efectivo' ORDER BY id DESC",
      )
      .get().delta_cents,
    -2000,
  );
});

test("private custody opening observations are guarded and never create sales or income", (t) => {
  const { db } = fixture(t),
    config = {
      kind: "bank-review-v1",
      id: "custody-start-fixture",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      messages: [],
      custody_balances: ["morelia", "efectivo", "xavi-ahorros"].map((id) => ({
        id,
        balance_cents: 1000,
        expected_version: 0,
        source_hash: "d".repeat(64),
      })),
    };
  assert.equal(applyBankReview(db, config).custodies, 3);
  assert.equal(applyBankReview(db, config).applied, false);
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_movements").get().n,
    0,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM finance_sales").get().n, 0);
  assert.throws(
    () => applyBankReview(db, { ...config, id: "changed-fixture" }),
    /changed/,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM finance_custody_adjustments").get().n,
    3,
  );
});

test("bank posting starts at 03:00 Ecuador and excludes older or uncertain first-day notices", (t) => {
  const previous = [
    process.env.FINANCE_GMAIL_AUTO_APPLY,
    process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER,
  ];
  t.after(() => {
    for (const [i, key] of [
      "FINANCE_GMAIL_AUTO_APPLY",
      "FINANCE_GMAIL_AUTO_APPLY_AFTER",
    ].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  });
  process.env.FINANCE_GMAIL_AUTO_APPLY = "1";
  process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER = "2026-11-10T03:00:00-05:00";
  const notice = {
    occurred_at: "2026-11-10T08:00:00Z",
    received_at: "2026-11-10T08:00:05Z",
  };
  assert.equal(
    mailAutoPostingAllowed(notice, Date.parse("2026-11-10T07:59:59Z")),
    false,
  );
  assert.equal(
    mailAutoPostingAllowed(notice, Date.parse("2026-11-10T08:00:00Z")),
    true,
  );
  assert.equal(
    mailAutoPostingAllowed(
      { ...notice, occurred_at: "2026-11-10T07:59:00Z" },
      Date.parse("2026-11-10T08:10:00Z"),
    ),
    false,
  );
  assert.equal(
    mailAutoPostingAllowed(
      { received_at: notice.received_at, operation_day: "2026-11-10" },
      Date.parse("2026-11-10T08:10:00Z"),
    ),
    false,
  );
  process.env.FINANCE_GMAIL_AUTO_APPLY = "0";
  assert.equal(
    mailAutoPostingAllowed(notice, Date.parse("2026-11-10T08:10:00Z")),
    false,
  );
});

test("automatic bank mail catches up after the agreed start, applies fees once and ignores uncertain notices", (t) => {
  const { db, account } = fixture(t);
  const previous = [process.env.FINANCE_GMAIL_AUTO_APPLY, process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER];
  t.after(() => { for (const [i, key] of ["FINANCE_GMAIL_AUTO_APPLY", "FINANCE_GMAIL_AUTO_APPLY_AFTER"].entries()) { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; } });
  db.prepare("UPDATE finance_accounts SET bank='Pichincha',opening_cents=100000 WHERE id=?").run(account);
  putPrivateSetting(db, "opening_cutoff", "2026-11-09T19:50:10Z");
  putPrivateSetting(db, "own_account_registry", { accounts: [{ number: "0019999", account_id: account, bank: "Pichincha" }] });
  process.env.FINANCE_GMAIL_AUTO_APPLY = "0";
  process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER = "2026-11-10T03:00:00-05:00";
  const make = (id, hour, amount, extra = "") => mail(id, `Realizaste una transferencia. Cuenta de origen 0019999. Monto $${amount}. Referencia: ${id}. El día 10/11/2026 a la(s) ${hour} ${extra}`, "2026-11-10T13:00:00Z");
  const untrusted = make("UNTRUSTED1", "06:20", "80.00");
  untrusted.payload.headers = untrusted.payload.headers.filter((h) => h.name !== "Authentication-Results");
  ingestBankMessages(db, [make("BEFORESTART1", "02:59", "35.00"), make("NEWREF12345", "06:15", "10.00", "La transacción tiene un costo de $0.41"), make("NEWREF67890", "06:16", "5.00"), make("PENDING1", "06:18", "70.00", "En proceso"), untrusted]);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 0);
  process.env.FINANCE_GMAIL_AUTO_APPLY = "1";
  const replay = replayAutomaticBankMail(db);
  assert.equal(replay.applied, 2, JSON.stringify({ replay, drafts: mailDrafts(db).map(({id,state,account_id,trusted,event,occurred_at}) => ({id,state,account_id,trusted,event,occurred_at})) }));
  assert.equal(db.prepare("SELECT sum(amount_cents) n FROM finance_bank_transactions").get().n, -1541);
  assert.equal(replayAutomaticBankMail(db).applied, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 3);
  assert.equal(mailDrafts(db).find((m) => m.id === "BEFORESTART1").state, "draft");
  assert.equal(mailDrafts(db).find((m) => m.id === "UNTRUSTED1").state, "draft");
});

test("Gmail polling uses bounded pages and shares simultaneous sync requests", async (t) => {
  const { db } = fixture(t);
  const keys = ["FINANCE_GMAIL_CLIENT_ID", "FINANCE_GMAIL_CLIENT_SECRET", "FINANCE_GMAIL_AUTO_APPLY"];
  const previous = keys.map((k) => process.env[k]);
  t.after(() => keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }));
  process.env.FINANCE_GMAIL_CLIENT_ID = "fixture.apps.example.invalid";
  process.env.FINANCE_GMAIL_CLIENT_SECRET = "fixture-not-a-real-secret";
  process.env.FINANCE_GMAIL_AUTO_APPLY = "0";
  db.prepare("INSERT INTO finance_mail_oauth(id,encrypted,updated_at) VALUES ('gmail',?,?)").run(encryptDocument(Buffer.from(JSON.stringify({ refresh_token: "fixture-refresh" }))), new Date().toISOString());
  let lists = 0, reads = 0, tokens = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const uri = String(url);
    if (uri === "https://oauth2.googleapis.com/token") { tokens++; return Response.json({ access_token: "fixture-access" }); }
    const path = new URL(uri);
    if (path.pathname.endsWith("/messages")) {
      lists++; assert.equal(path.searchParams.get("maxResults"), "40");
      return Response.json({ messages: Array.from({ length: 40 }, (_, i) => ({ id: `MOCK${i}` })), nextPageToken: "fixture-next-page" });
    }
    reads++;
    return Response.json(mail(path.pathname.split("/").at(-1), "Transferencia enviada. Monto $1.00"));
  });
  const results = await Promise.all([syncGmail(db), syncGmail(db)]);
  assert.equal(tokens, 1); assert.equal(lists, 1); assert.equal(reads, 40);
  assert.equal(results[0].has_more, true);
  assert.equal(privateSetting(db, "mail_poll_cursor").page, "fixture-next-page");
  assert.deepEqual(results[0], results[1]);
});
