import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember } from "../src/finance-db.js";
import { encryptDocument } from "../src/finance-ai.js";
import {
  adjustCustody,
  confirmStoreReceipt,
  storeReceipts,
  putPrivateSetting,
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
} from "../src/finance-funding.js";
import { evaluateLoanAlerts } from "../src/finance-loans.js";
import {
  parseBankMail,
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
test("card cycles distinguish closing month from due month and hide personal statements", (t) => {
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
  assert.equal(fundingOverview(db, german).cards.length, 0);
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
