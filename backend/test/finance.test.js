import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import express from "express";
import {
  initFinanceDb,
  passwordHash,
  passwordMatches,
  validateFinancePassword,
  financeDay,
  validDay,
} from "../src/finance-db.js";
import { registerFinanceRoutes } from "../src/finance-routes.js";
import {passwordChangePolicy} from '../src/finance-password-policy.js';
import { importSale, csvExport } from "../src/finance-service.js";
import { encryptDocument, decryptDocument } from "../src/finance-ai.js";
import { encodeBase32, totp, validTotpStep } from "../src/finance-security.js";
import { initProducalzaDb } from "../src/producalza-db.js";
import { registerProducalzaRoutes } from "../src/producalza-routes.js";
import { syncInternalSources } from "../src/finance-sources.js";

const password = "Fixture8";
test('eight-character passwords work while existing longer passwords still verify',()=>{
  assert.equal(validateFinancePassword('NewPass8'),'NewPass8');
  for(const value of ['short77','longer999','twelve-chars',null])assert.throws(()=>validateFinancePassword(value),e=>e.status===400);
  const legacy='previous-financial-passphrase-123';assert.equal(passwordMatches(legacy,passwordHash(legacy)),true);
});
test('activation accepts exactly eight characters and consumes the invitation only after success',async t=>{
  const f=await fixture(t);await f.login();
  const owner=f.db.prepare("SELECT id FROM finance_members WHERE username='owner'").get();
  const invite=await f.req(`/members/${owner.id}/invite`,'owner',{});assert.equal(invite.status,200);
  const token=invite.body.token;
  for(const invalid of ['seven77','nine99999'])assert.equal((await f.req('/access/activate','owner',{token,password:invalid})).status,400);
  const activated=await f.req('/access/activate','owner',{token,password:'NewPass8'});assert.equal(activated.status,200);assert.equal(activated.body.user.username,'owner');
  assert.equal((await f.req('/access/activate','owner',{token,password:'NewPass8'})).status,404);
  assert.equal((await f.req('/login','owner',{username:'owner',password:'NewPass8'})).status,200);
  assert.equal((await f.req('/login','owner',{username:'owner',password})).status,401);
});
test("manual Diners balances separate available and pending funds without creating bank income", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("reader");
  await f.login("normita");
  const before = (await f.req("/snapshot")).body.summary.balance_cents;
  const body = { available_cents: 123456, pending_cents: 65432, as_of: f.day };
  assert.equal(
    (await f.req("/settlement-funds/diners", "owner", body)).status,
    200
  );
  assert.equal(
    (await f.req("/settlement-funds/diners", "reader", body)).status,
    403
  );
  assert.equal(
    (
      await f.req("/settlement-funds/diners", "owner", {
        ...body,
        available_cents: -1,
      })
    ).status,
    400
  );
  const snapshot = (await f.req("/snapshot")).body;
  assert.equal(snapshot.summary.balance_cents, before);
  assert.equal(snapshot.settlement_funds[0].pending_cents, 65432);
  assert.equal(
    (await f.req("/snapshot", "reader")).body.settlement_funds[0]
      .available_cents,
    123456
  );
  assert.equal(
    (await f.req("/snapshot", "normita")).body.settlement_funds.length,
    0
  );
  assert.equal(
    (await f.req("/snapshot?business_id=personal")).body.settlement_funds
      .length,
    0
  );
  await f.req("/settlement-funds/diners", "owner", {
    ...body,
    available_cents: 0,
    pending_cents: 0,
  });
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_settlement_balances").get().n,
    1
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    0
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM finance_audit WHERE action='settlement.balance_updated'"
      )
      .get().n,
    2
  );
});
test("saved payees preserve leading zeroes, alternatives and encrypted historical destinations", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("normita");
  await f.login("peer");
  const member = f.db
    .prepare("SELECT id FROM finance_members WHERE username='normita'")
    .get();
  await f.req("/spaces/producalza-materiales/settings", "owner", {
    members: [{ member_id: member.id, role: "requester" }],
  });
  const body = {
    business_id: "producalza",
    space_id: "producalza-materiales",
    name: "Contacto de prueba",
    document: "0012345678",
    email: "pagos@example.invalid",
    accounts: [
      {
        bank: "Pichincha",
        type: "savings",
        number: "001234567890",
        holder: "Titular de prueba",
      },
      {
        bank: "Produbanco",
        type: "checking",
        number: "009876543210",
        holder: "Titular de prueba",
      },
    ],
  };
  const saved = await f.req("/payees", "normita", body);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.contact.accounts[0].number, "001234567890");
  const duplicate = await f.req("/payees", "normita", body);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.contact.id, saved.body.contact.id);
  assert.equal(
    (
      await f.req(
        "/payees?business_id=producalza&space_id=producalza-materiales",
        "peer"
      )
    ).status,
    403
  );
  const stored = f.db.prepare("SELECT encrypted FROM finance_payees").get();
  assert.equal(
    stored.encrypted.includes(Buffer.from(body.accounts[0].number)),
    false
  );
  const reqBody = {
    request_id: crypto.randomUUID(),
    contact_id: saved.body.contact.id,
    business_id: "producalza",
    space_id: "producalza-materiales",
    unit_id: "producalza-fabrica",
    amount_cents: 50000,
    description: "Pago de transporte",
  };
  const created = await f.req("/payment-requests", "normita", reqBody);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.movement.id,
    detail = await f.req(`/payment-requests/${id}`, "owner");
  assert.equal(detail.body.beneficiary.accounts.length, 2);
  assert.equal(detail.body.beneficiary.document, "0012345678");
  assert.equal(
    (await f.req("/payment-requests", "normita", reqBody)).body.duplicate,
    true
  );
  const encryptedSnapshot = f.db
    .prepare("SELECT encrypted FROM finance_request_payees WHERE request_id=?")
    .get(id);
  assert.equal(
    encryptedSnapshot.encrypted.includes(Buffer.from(body.accounts[1].number)),
    false
  );
  const account = await f.account("producalza"),
    proof = await workflowReceipt(f, "payee-choice");
  const pay = {
    request_key: crypto.randomUUID(),
    amount_cents: 50000,
    account_id: account,
    evidence_id: proof,
    paid_day: f.day,
    reference: "TEST-DESTINATION",
    confirm_paid: true,
  };
  assert.equal(
    (await f.req(`/payment-requests/${id}/payments`, "owner", pay)).status,
    400
  );
  const paid = await f.req(`/payment-requests/${id}/payments`, "owner", {
    ...pay,
    destination_index: 1,
  });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.payment.destination_index, 1);
  assert.equal(
    (
      await f.req(`/payment-requests/${id}/payments`, "owner", {
        ...pay,
        destination_index: 0,
      })
    ).status,
    409
  );
  assert.equal(
    (await f.req("/payees", "normita", { ...body, document: "9999999999" }))
      .status,
    409
  );
  assert.equal((await f.req(`/payment-requests/${id}`, "peer")).status, 404);
  assert.equal(
    JSON.stringify((await f.req("/snapshot", "normita")).body).includes(
      body.accounts[0].number
    ),
    false
  );
});
test("contacts reject masked accounts and cannot move personal beneficiaries into work requests", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("reader");
  const body = {
    business_id: "personal",
    name: "Private beneficiary",
    accounts: [{ bank: "Pichincha", type: "savings", number: "0012345678" }],
  };
  assert.equal(
    (
      await f.req("/payees", "owner", {
        ...body,
        accounts: [{ ...body.accounts[0], number: "***5678" }],
      })
    ).status,
    400
  );
  const contact = await f.req("/payees", "owner", body);
  assert.equal(contact.status, 201);
  assert.equal(
    (await f.req("/payees?business_id=personal", "reader")).status,
    403
  );
  assert.equal(
    (
      await f.req("/payment-requests", "owner", {
        contact_id: contact.body.contact.id,
        request_id: crypto.randomUUID(),
        business_id: "producalza",
        amount_cents: 10000,
      })
    ).status,
    403
  );
  assert.equal(
    (await f.req("/payees", "reader", { ...body, business_id: "marjorie" }))
      .status,
    403
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    0
  );
});
async function workflowReceipt(f, tag = "one", business = "producalza") {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII=";
  const r = await f.req("/evidence", "owner", {
    business_id: business,
    name: `comprobante-${tag}.png`,
    mime: "image/png",
    data: Buffer.concat([
      Buffer.from(png, "base64"),
      Buffer.from(tag),
    ]).toString("base64"),
  });
  assert.ok([200, 201].includes(r.status));
  return r.body.id;
}
test("workspaces authorize named participants without exposing peer financial accounts", async (t) => {
  const f = await fixture(t);
  for (const u of ["owner", "normita", "peer"]) await f.login(u);
  const member = f.db
    .prepare("SELECT id FROM finance_members WHERE username='normita'")
    .get();
  assert.equal(
    (
      await f.req("/spaces/producalza-materiales/settings", "owner", {
        members: [{ member_id: member.id, role: "requester" }],
      })
    ).status,
    200
  );
  const r = await f.req("/quick/register", "normita", {
    request_id: crypto.randomUUID(),
    text: "Solicito pagar $300 en materiales",
    space_id: "producalza-materiales",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.movement.is_payment_request, 1);
  assert.equal(
    (await f.req(`/payment-requests/${r.body.movement.id}`, "normita")).status,
    200
  );
  assert.equal(
    (await f.req(`/payment-requests/${r.body.movement.id}`, "peer")).status,
    404
  );
  assert.equal(
    (await f.req("/spaces/producalza-materiales", "peer")).status,
    403
  );
  assert.equal(
    (
      await f.req("/quick/register", "peer", {
        request_id: crypto.randomUUID(),
        text: "Solicito pagar Producalza $80",
        space_id: "producalza-materiales",
      })
    ).status,
    403
  );
  const view = (await f.req("/snapshot", "normita")).body;
  assert.equal(view.accounts.length, 0);
  assert.equal(view.workflow.spaces.length, 1);
  assert.equal(view.workflow.summary.pending_cents, 30000);
});
test("payable reminders survive reads and approval, resolve on evidenced payments and reopen on correction", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account("producalza");
  const created = await f.req("/quick/register", "owner", {
    request_id: crypto.randomUUID(),
    text: "Solicito pagar Producalza $300 de materiales",
  });
  const id = created.body.movement.id;
  assert.equal(
    (await f.req("/snapshot")).body.workflow.summary.pending_count,
    1
  );
  assert.equal(
    (await f.req(`/movements/${id}/review`, "owner", { status: "approved" }))
      .status,
    409
  );
  const firstReceipt = await workflowReceipt(f, "partial");
  const first = {
    request_key: crypto.randomUUID(),
    amount_cents: 10000,
    evidence_id: firstReceipt,
    account_id: account,
    paid_day: f.day,
    reference: "TEST-PAGO-1",
    confirm_paid: true,
  };
  assert.equal(
    (
      await f.req(`/payment-requests/${id}/payments`, "owner", {
        ...first,
        confirm_paid: false,
      })
    ).status,
    400
  );
  const paid = await f.req(`/payment-requests/${id}/payments`, "owner", first);
  assert.equal(paid.status, 201);
  assert.equal(
    (await f.req(`/payment-requests/${id}/payments`, "owner", first)).body
      .duplicate,
    true
  );
  assert.equal(
    (await f.req("/snapshot")).body.workflow.summary.pending_cents,
    20000
  );
  assert.equal(
    (
      await f.req(`/payment-requests/${id}/payments`, "owner", {
        ...first,
        request_key: crypto.randomUUID(),
        amount_cents: 25000,
      })
    ).status,
    409
  );
  const secondReceipt = await workflowReceipt(f, "final");
  assert.equal(
    (
      await f.req(`/payment-requests/${id}/payments`, "owner", {
        ...first,
        request_key: crypto.randomUUID(),
        amount_cents: 20000,
        evidence_id: secondReceipt,
        reference: "TEST-PAGO-2",
      })
    ).status,
    201
  );
  const complete = (await f.req("/snapshot")).body;
  assert.equal(complete.workflow.summary.pending_count, 0);
  assert.equal(complete.summary.expense_cents, 30000);
  assert.equal(complete.summary.pending_cents, 0);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0
  );
  assert.equal(
    (
      await f.req(`/payments/${paid.body.payment.id}/void`, "owner", {
        reason: "Comprobante de prueba corregido",
      })
    ).status,
    200
  );
  const reopened = (await f.req("/snapshot")).body;
  assert.equal(reopened.workflow.summary.pending_cents, 10000);
  assert.equal(reopened.summary.expense_cents, 20000);
  assert.equal(
    (
      await f.req(`/payment-requests/${id}/cancel`, "owner", {
        reason: "El saldo restante ya no se necesita",
      })
    ).status,
    200
  );
  assert.equal(
    (await f.req("/snapshot")).body.workflow.summary.pending_count,
    0
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_payments").get().n,
    2
  );
});
test("work observer sees bank balances and work detail while personal transactions and allocations stay private", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account();
  await f.bank(account, [
    {
      day: f.day,
      amount_cents: 20000,
      external_id: "shared",
      description: "SECRET-PERSONAL-BANK",
    },
  ]);
  await f.movement({
    business_id: "personal",
    kind: "expense",
    counterparty: "SECRET-PERSONAL-PAYEE",
    description: "SECRET-PERSONAL-REASON",
  });
  await f.movement({ description: "Compra de materiales de trabajo" });
  f.db
    .prepare("INSERT INTO finance_account_allocations VALUES (?,?,?)")
    .run(account, "personal", 12345);
  const r = await f.req("/members", "owner", {
    name: "Germán",
    username: "german",
    password,
    role: "viewer",
    work_view: true,
    business_ids: ["producalza", "marjorie", "gemashow"],
    space_ids: ["trabajo-varios"],
  });
  assert.equal(r.status, 201);
  await f.login("german");
  const snapshot = (await f.req("/snapshot", "german")).body;
  assert.equal(
    snapshot.accounts.find((a) => a.id === account).balance_cents,
    20000
  );
  assert.equal(snapshot.accounts[0].positions.personal, undefined);
  assert.equal(
    snapshot.accounts[0].opening_allocations.some(
      (a) => a.business_id === "personal"
    ),
    false
  );
  assert.equal(snapshot.bank_transactions.length, 0);
  assert.equal(
    snapshot.movements.some(
      (m) => m.description === "Compra de materiales de trabajo"
    ),
    true
  );
  assert.equal(JSON.stringify(snapshot).includes("SECRET-PERSONAL"), false);
  assert.equal(
    (await f.req("/snapshot?business_id=personal", "german")).status,
    403
  );
  assert.equal(
    (
      await f.req("/members", "owner", {
        name: "Incorrecto",
        username: "unsafe-observer",
        password,
        role: "viewer",
        work_view: true,
        business_ids: ["personal"],
      })
    ).status,
    400
  );
});
test("space membership edits and profile changes revoke sessions without dismissing a pending payment", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("normita");
  const member = f.db
    .prepare("SELECT id FROM finance_members WHERE username='normita'")
    .get();
  const r = await f.req("/quick/register", "normita", {
    request_id: crypto.randomUUID(),
    text: "Solicito pagar Producalza $90",
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await f.req(`/members/${member.id}/access`, "owner", {
        name: "Norma",
        role: "collector",
        business_ids: ["producalza"],
        unit_ids: [],
        space_ids: ["producalza-materiales"],
      })
    ).status,
    200
  );
  assert.equal((await f.req("/snapshot", "normita")).status, 401);
  assert.equal(
    (await f.req("/snapshot")).body.workflow.summary.pending_cents,
    9000
  );
  assert.equal((await f.req("/push/config")).body.enabled, false);
});
test("quick owner registration is idempotent, audited and never accredits a bank", async (t) => {
  const f = await fixture(t);
  await f.login();
  const request = {
    request_id: crypto.randomUUID(),
    text: "Puedes registrar un gasto personal de $80 en gasolina",
  };
  const first = await f.req("/quick/register", "owner", request);
  assert.equal(first.status, 201);
  assert.equal(first.body.movement.amount_cents, 8000);
  assert.equal(first.body.movement.status, "reported");
  assert.equal(first.body.movement.account_id, null);
  const replay = await f.req("/quick/register", "owner", request);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.movement.id, first.body.movement.id);
  assert.equal(
    (
      await f.req("/quick/register", "owner", {
        ...request,
        text: "Gasto personal gasolina $800",
      })
    ).status,
    409
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    1
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    0
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM finance_audit WHERE action='movement.quick_recorded'"
      )
      .get().n,
    1
  );
});
test("quick collaborators have assigned units, pending submissions and no cross-business access", async (t) => {
  const f = await fixture(t);
  await f.login("north");
  await f.login("reader");
  await f.login("owner");
  const r = await f.req("/quick/register", "north", {
    request_id: crypto.randomUUID(),
    text: "Solicito pagar $80 en materiales",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.movement.business_id, "marjorie");
  assert.equal(r.body.movement.unit_id, "marjorie-norte");
  assert.equal(r.body.movement.created_by, "north");
  assert.equal(r.body.movement.status, "pending");
  assert.equal(
    (
      await f.req("/quick/register", "north", {
        request_id: crypto.randomUUID(),
        text: "Solicito pagar Marjorie Sur $80",
        overrides: { unit_id: "marjorie-norte" },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await f.req("/quick/register", "north", {
        request_id: crypto.randomUUID(),
        text: "Gasto personal gasolina $80",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await f.req("/quick/register", "reader", {
        request_id: crypto.randomUUID(),
        text: "Gasto Marjorie $80",
      })
    ).status,
    403
  );
  const missing = await f.req("/quick/register", "owner", {
    request_id: crypto.randomUUID(),
    text: "Gasto personal",
  });
  assert.equal(missing.status, 400);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    1
  );
});
process.env.FINANCE_DOCUMENT_KEY ||=
  "test-only-document-key-at-least-32-characters";

test("shared account balances keep business ownership separate from unassigned money", async (t) => {
  const f = await fixture(t);
  await f.login();
  const created = await f.req("/accounts", "owner", {
    name: "Compartida",
    bank: "Test",
    kind: "bank",
    opening_cents: 10000,
    opening_date: f.start,
  });
  const id = created.body.id;
  assert.equal(
    (
      await f.req(`/accounts/${id}/allocate-opening`, "owner", {
        allocations: [
          { business_id: "producalza", amount_cents: 6000 },
          { business_id: "marjorie", amount_cents: 4000 },
        ],
      })
    ).status,
    200
  );
  await f.bank(id, [
    { day: f.day, amount_cents: 3000, external_id: "shared-in" },
  ]);
  const m = await f.movement({ account_id: id, amount_cents: 2000 });
  const b = f.db.prepare("SELECT id FROM finance_bank_transactions").get();
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: b.id,
        amount_cents: 2000,
      })
    ).status,
    200
  );
  const all = (await f.req("/snapshot")).body,
    produ = (await f.req("/snapshot?business_id=producalza")).body;
  assert.equal(all.summary.balance_cents, 13000);
  assert.equal(all.summary.unassigned_cents, 1000);
  assert.equal(produ.summary.balance_cents, 8000);
  assert.equal(
    all.businesses.find((x) => x.id === "marjorie").funds_cents,
    4000
  );
  assert.equal(
    (
      await f.req(`/accounts/${id}/allocate-opening`, "owner", {
        allocations: [{ business_id: "producalza", amount_cents: 11000 }],
      })
    ).status,
    400
  );
  assert.equal(
    (await f.req("/snapshot?business_id=producalza")).body.summary
      .balance_cents,
    8000
  );
});
async function fixture(t, withProduction = false) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  initFinanceDb(db);
  if (withProduction) {
    db.exec(`CREATE TABLE establishments (id INTEGER PRIMARY KEY,name TEXT UNIQUE,display_name TEXT,business_type TEXT,module_type TEXT,code_prefix TEXT,theme TEXT,logo_url TEXT,admin_username TEXT,admin_password TEXT,status TEXT,promoter_sales_enabled INTEGER);
      INSERT INTO establishments VALUES (1,'PRODUCALZA','Producalza','commercial','production','PC','producalza',NULL,NULL,NULL,'active',0);`);
    initProducalzaDb(db);
  }
  const member = db.prepare(
    "INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids) VALUES (?,?,?,?,?,?)"
  );
  const hash = passwordHash(password);
  member.run(
    "Owner",
    "owner",
    hash,
    "owner",
    JSON.stringify(["producalza", "marjorie", "gemashow", "personal"]),
    "[]"
  );
  member.run("Manager", "manager", hash, "manager", '["marjorie"]', "[]");
  member.run("Normita", "normita", hash, "collector", '["producalza"]', "[]");
  member.run("Peer", "peer", hash, "collector", '["producalza"]', "[]");
  member.run(
    "North",
    "north",
    hash,
    "collector",
    '["marjorie"]',
    '["marjorie-norte"]'
  );
  member.run("Reader", "reader", hash, "viewer", '["marjorie"]', "[]");
  const app = express();
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => (req.rawBody = buf),
    })
  );
  const production = withProduction
    ? registerProducalzaRoutes(app, db, () => 1)
    : null;
  registerFinanceRoutes(app, db, { production });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const cookies = new Map();
  async function raw(path, user = "owner", body, method, headers = {}) {
    return fetch(
      `http://127.0.0.1:${server.address().port}/api/finance${path}`,
      {
        method: method || (body ? "POST" : "GET"),
        headers: {
          "Content-Type": "application/json",
          "X-Finance-Request": "1",
          "X-Finance-Interactive": "1",
          ...(cookies.has(user) ? { Cookie: cookies.get(user) } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    );
  }
  async function req(path, user = "owner", body, method, headers) {
    const r = await raw(path, user, body, method, headers);
    return { status: r.status, body: await r.json() };
  }
  async function login(user = "owner") {
    const r = await raw("/login", user, { username: user, password });
    assert.equal(r.status, 200);
    cookies.set(user, r.headers.get("set-cookie").split(";")[0]);
    return r;
  }
  const day = financeDay();
  const start = `${day.slice(0, 7)}-01`;
  const account = async (business_id = null, name = "Bank") => {
    const r = await req("/accounts", "owner", {
      business_id,
      name,
      bank: "Test Bank",
      kind: "bank",
      last_four: "1234",
      opening_cents: 0,
      opening_date: start,
    });
    assert.equal(r.status, 201);
    return r.body.id;
  };
  const movement = async (overrides = {}, user = "owner") =>
    req("/movements", user, {
      business_id: "producalza",
      kind: "income",
      amount_cents: 10000,
      day,
      category: "Cobro",
      counterparty: "Cliente",
      ...overrides,
    });
  const bank = async (account_id, rows) =>
    req("/bank/import", "owner", { account_id, rows });
  const sale = (overrides = {}) => ({
    business_id: "marjorie",
    unit_id: "marjorie-norte",
    source_system: "alfabusiness",
    external_id: "sale-1",
    day,
    total_cents: 10000,
    refunded_cents: 0,
    state: "active",
    payments: [{ method: "cash", amount_cents: 10000 }],
    source_updated_at: `${day}T12:00:00-05:00`,
    ...overrides,
  });
  return {
    db,
    req,
    raw,
    login,
    cookies,
    day,
    start,
    account,
    movement,
    bank,
    sale,
  };
}

test("financial authentication is independent, uses private cookies, and never seeds demonstration in operation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.req("/snapshot")).status, 401);
  const wrong = await f.req("/login", "owner", {
    username: "owner",
    password: "incorrect",
  });
  assert.equal(wrong.status, 401);
  const login = await f.login();
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/finance/);
  const snapshot = await f.req("/snapshot");
  assert.equal(snapshot.body.summary.balance_cents, 0);
  assert.equal(snapshot.body.capabilities.demo, false);
  assert.ok(!JSON.stringify(snapshot.body).includes(password));
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_accounts").get().n,
    0
  );
});

test("sales, reported receipts, actual bank entries and reconciliation remain separate", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account();
  const m = await f.movement({ account_id: account });
  assert.equal(m.status, 201);
  importSale(f.db, f.sale({ total_cents: 10000 }));
  let s = (await f.req("/snapshot")).body.summary;
  assert.equal(s.sales_cents, 10000);
  assert.equal(s.income_cents, 0);
  assert.equal(s.balance_cents, 0);
  assert.equal(
    (
      await f.bank(account, [
        {
          day: f.day,
          amount_cents: 10000,
          reference: "REF-1",
          external_id: "BANK-1",
        },
      ])
    ).status,
    200
  );
  s = (await f.req("/snapshot")).body.summary;
  assert.equal(s.balance_cents, 10000);
  assert.equal(s.income_cents, 0);
  const b = f.db.prepare("SELECT id FROM finance_bank_transactions").get();
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: b.id,
        amount_cents: 10000,
      })
    ).status,
    200
  );
  s = (await f.req("/snapshot")).body.summary;
  assert.equal(s.balance_cents, 10000);
  assert.equal(s.income_cents, 10000);
  assert.equal(s.sales_cents, 10000);
});

test("bank imports are atomic, idempotent, and reject indistinguishable rows and altered identities", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account();
  const rows = [
    {
      day: f.day,
      amount_cents: 2000,
      reference: "R",
      external_id: "stable-bank-id",
    },
  ];
  assert.equal((await f.bank(account, rows)).body.imported, 1);
  assert.equal((await f.bank(account, rows)).body.duplicates, 1);
  assert.equal((await f.bank(account, [...rows, ...rows])).status, 400);
  assert.equal(
    (await f.bank(account, [{ ...rows[0], amount_cents: 3000 }])).status,
    409
  );
  assert.equal(
    (
      await f.bank(account, [
        { day: f.day, amount_cents: 1000, external_id: "new" },
        { ...rows[0], amount_cents: 3000 },
      ])
    ).status,
    409
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    1
  );
});

test("partial allocation cannot overdraw a receipt or reuse a bank entry; reversal preserves history", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account();
  const m = await f.movement({ amount_cents: 15000, account_id: account });
  await f.bank(account, [
    { day: f.day, amount_cents: 10000, external_id: "one" },
    { day: f.day, amount_cents: 5000, external_id: "two" },
  ]);
  const [one, two] = f.db
    .prepare("SELECT * FROM finance_bank_transactions ORDER BY id")
    .all();
  const a = await f.req("/reconcile", "owner", {
    movement_id: m.body.id,
    bank_transaction_id: one.id,
    amount_cents: 10000,
  });
  assert.equal(a.body.fully_reconciled, false);
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: one.id,
        amount_cents: 1,
      })
    ).status,
    409
  );
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: two.id,
        amount_cents: 6000,
      })
    ).status,
    409
  );
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: two.id,
        amount_cents: 5000,
      })
    ).body.fully_reconciled,
    true
  );
  const allocation = f.db
    .prepare("SELECT id FROM finance_allocations LIMIT 1")
    .get();
  assert.equal(
    (
      await f.req(
        `/allocations/${allocation.id}`,
        "owner",
        { reason: "Corregir referencia" },
        "DELETE"
      )
    ).status,
    200
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM finance_movements WHERE id=?")
      .get(m.body.id).status,
    "pending"
  );
  assert.ok(
    f.db
      .prepare(
        "SELECT id FROM finance_audit WHERE action='allocation.reversed'"
      )
      .get()
  );
});

test("reconciliation requires matching direction, account ownership, and approved expenses", async (t) => {
  const f = await fixture(t);
  await f.login();
  const account = await f.account("marjorie");
  await f.bank(account, [
    { day: f.day, amount_cents: -10000, external_id: "debit" },
  ]);
  const bank = f.db.prepare("SELECT id FROM finance_bank_transactions").get();
  const income = await f.movement();
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: income.body.id,
        bank_transaction_id: bank.id,
        amount_cents: 10000,
      })
    ).status,
    400
  );
  const expense = await f.movement({
    business_id: "marjorie",
    kind: "expense",
  });
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: expense.body.id,
        bank_transaction_id: bank.id,
        amount_cents: 10000,
      })
    ).status,
    400
  );
  await f.req(`/movements/${expense.body.id}/review`, "owner", {
    status: "approved",
  });
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: expense.body.id,
        bank_transaction_id: bank.id,
        amount_cents: 10000,
      })
    ).status,
    200
  );
});

test("collectors only see their records and cannot access private balances, peer evidence, or other businesses", async (t) => {
  const f = await fixture(t);
  for (const u of ["owner", "normita", "peer"]) await f.login(u);
  await f.account();
  await f.account("producalza");
  const own = await f.movement({}, "normita");
  const peer = await f.movement({ counterparty: "Private peer" }, "peer");
  await f.movement({
    business_id: "personal",
    counterparty: "Private personal",
  });
  const s = await f.req("/snapshot", "normita");
  assert.equal(s.body.movements.length, 1);
  assert.equal(s.body.movements[0].id, own.body.id);
  assert.equal(s.body.accounts.length, 0);
  assert.equal(s.body.bank_transactions.length, 0);
  assert.equal(s.body.budgets.length, 0);
  assert.equal(
    (await f.req("/snapshot?business_id=personal", "normita")).status,
    403
  );
  assert.equal(
    (
      await f.req(`/movements/${peer.body.id}/review`, "normita", {
        status: "approved",
      })
    ).status,
    403
  );
  assert.equal(
    (await f.movement({ business_id: "marjorie" }, "normita")).status,
    403
  );
});

test("unit assignments are enforced on writes, reads and account visibility", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("north");
  await f.account("marjorie");
  assert.equal(
    (
      await f.movement(
        { business_id: "marjorie", unit_id: "marjorie-valle" },
        "north"
      )
    ).status,
    403
  );
  assert.equal(
    (await f.movement({ business_id: "marjorie" }, "north")).status,
    403
  );
  assert.equal(
    (
      await f.movement(
        { business_id: "marjorie", unit_id: "marjorie-norte" },
        "north"
      )
    ).status,
    201
  );
  assert.equal((await f.req("/snapshot", "north")).body.accounts.length, 0);
});

test("viewer cannot write and manager cannot approve own requests or reconcile bank accounts", async (t) => {
  const f = await fixture(t);
  for (const u of ["owner", "manager", "reader"]) await f.login(u);
  assert.equal(
    (await f.movement({ business_id: "marjorie" }, "reader")).status,
    403
  );
  const m = await f.movement(
    { business_id: "marjorie", kind: "expense" },
    "manager"
  );
  assert.equal(
    (
      await f.req(`/movements/${m.body.id}/review`, "manager", {
        status: "approved",
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.req(`/movements/${m.body.id}/review`, "owner", {
        status: "approved",
      })
    ).status,
    200
  );
  assert.equal(
    (await f.req("/bank/import", "manager", { account_id: 1, rows: [] }))
      .status,
    403
  );
  assert.equal((await f.req("/members", "manager")).status, 403);
});

test("sales deliveries are idempotent, versioned and reject conflicting equal versions", async (t) => {
  const f = await fixture(t);
  const sale = f.sale();
  assert.equal(importSale(f.db, sale).ignored, false);
  assert.equal(importSale(f.db, { ...sale }).ignored, true);
  assert.throws(
    () => importSale(f.db, { ...sale, total_cents: 20000 }),
    /misma versión/
  );
  const updated = {
    ...sale,
    state: "cancelled",
    source_updated_at: `${f.day}T13:00:00-05:00`,
  };
  assert.equal(importSale(f.db, updated).ignored, false);
  assert.equal(importSale(f.db, sale).ignored, true);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM finance_sales").get().n, 1);
  assert.equal(
    f.db.prepare("SELECT state FROM finance_sales").get().state,
    "cancelled"
  );
  assert.throws(
    () =>
      importSale(f.db, {
        ...sale,
        payments: [{ method: "cash", amount_cents: 10001 }],
      }),
    /desglose/
  );
});

test("signed AlfaBusiness deliveries validate raw payload, timestamp and business scope", async (t) => {
  const f = await fixture(t);
  const old = process.env.FINANCE_SALES_WEBHOOK_SECRET;
  process.env.FINANCE_SALES_WEBHOOK_SECRET =
    "test-webhook-secret-at-least-32-characters";
  t.after(() => {
    if (old === undefined) delete process.env.FINANCE_SALES_WEBHOOK_SECRET;
    else process.env.FINANCE_SALES_WEBHOOK_SECRET = old;
  });
  const payload = f.sale({ business_id: "personal" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = (body, stamp) =>
    crypto
      .createHmac("sha256", process.env.FINANCE_SALES_WEBHOOK_SECRET)
      .update(`${stamp}.${JSON.stringify(body)}`)
      .digest("hex");
  const headers = {
    "x-finance-timestamp": timestamp,
    "x-finance-signature": sign(payload, timestamp),
  };
  assert.equal(
    (
      await f.req(
        "/integrations/alfabusiness",
        "none",
        payload,
        "POST",
        headers
      )
    ).status,
    200
  );
  assert.equal(
    f.db.prepare("SELECT business_id FROM finance_sales").get().business_id,
    "marjorie"
  );
  assert.equal(
    (
      await f.req(
        "/integrations/alfabusiness",
        "none",
        { ...payload, total_cents: 11000 },
        "POST",
        headers
      )
    ).status,
    401
  );
  const stale = String(Number(timestamp) - 400);
  assert.equal(
    (
      await f.req("/integrations/alfabusiness", "none", payload, "POST", {
        "x-finance-timestamp": stale,
        "x-finance-signature": sign(payload, stale),
      })
    ).status,
    401
  );
});

test("cash closing uses actual imported payment breakdown and flags later source changes", async (t) => {
  const f = await fixture(t);
  await f.login();
  importSale(
    f.db,
    f.sale({
      total_cents: 25000,
      payments: [
        { method: "cash", amount_cents: 10000 },
        { method: "card", amount_cents: 15000 },
      ],
    })
  );
  const body = {
    unit_id: "marjorie-norte",
    day: f.day,
    opening_cents: 2000,
    deposits_cents: 5000,
    counted_cents: 7000,
    note: "",
  };
  const closing = await f.req("/closings", "owner", body);
  assert.equal(closing.status, 201);
  assert.equal(closing.body.expected_cents, 7000);
  assert.equal(closing.body.difference_cents, 0);
  assert.equal((await f.req("/closings", "owner", body)).status, 409);
  assert.equal(
    (await f.movement({ business_id: "marjorie", unit_id: "marjorie-norte" }))
      .status,
    409
  );
  importSale(
    f.db,
    f.sale({
      total_cents: 26000,
      payments: [
        { method: "cash", amount_cents: 11000 },
        { method: "card", amount_cents: 15000 },
      ],
      source_updated_at: `${f.day}T13:00:00-05:00`,
    })
  );
  assert.equal(
    f.db.prepare("SELECT needs_review FROM finance_closings").get()
      .needs_review,
    1
  );
  assert.equal(
    (
      await f.req(`/closings/${closing.body.id}/reopen`, "owner", {
        reason: "Revisar nueva venta",
      })
    ).status,
    200
  );
  assert.ok(
    f.db
      .prepare("SELECT id FROM finance_audit WHERE action='cash.reopened'")
      .get()
  );
});

test("recurring expenses create pending commitments once per month and never debit accounts", async (t) => {
  const f = await fixture(t);
  await f.login();
  const r = await f.req("/recurring", "owner", {
    business_id: "marjorie",
    name: "Rent",
    category: "Arriendo",
    counterparty: "Landlord",
    amount_cents: 100000,
    due_day: 5,
  });
  assert.equal(r.status, 201);
  assert.equal(
    (await f.req("/recurring/generate", "owner", { month: f.day.slice(0, 7) }))
      .body.created,
    1
  );
  assert.equal(
    (await f.req("/recurring/generate", "owner", { month: f.day.slice(0, 7) }))
      .body.created,
    0
  );
  const s = (await f.req("/snapshot")).body;
  assert.equal(s.summary.pending_cents, 100000);
  assert.equal(s.summary.expense_cents, 0);
  assert.equal(s.summary.balance_cents, 0);
});

test("private evidence is encrypted, format-checked, deduplicated and scoped to its uploader", async (t) => {
  const f = await fixture(t);
  for (const u of ["owner", "normita", "peer"]) await f.login(u);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII=";
  const body = {
    business_id: "producalza",
    name: "receipt.png",
    mime: "image/png",
    data: png,
  };
  const created = await f.req("/evidence", "normita", body);
  assert.equal(created.status, 201);
  assert.equal(
    (await f.req("/evidence", "normita", body)).body.duplicate,
    true
  );
  assert.equal((await f.req("/evidence", "peer", body)).status, 409);
  assert.equal(
    (await f.req("/evidence", "normita", { ...body, mime: "application/pdf" }))
      .status,
    400
  );
  assert.equal(
    (await f.raw(`/evidence/${created.body.id}`, "peer")).status,
    404
  );
  const downloaded = await f.raw(`/evidence/${created.body.id}`, "normita");
  assert.equal(downloaded.status, 200);
  const raw = Buffer.from(png, "base64");
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), raw);
  const encrypted = f.db
    .prepare("SELECT encrypted FROM finance_evidence")
    .get().encrypted;
  assert.notDeepEqual(encrypted, raw);
  assert.deepEqual(decryptDocument(encrypted), raw);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptDocument(tampered));
});

test("CSRF, revocation and idle sessions are enforced on financial mutations", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("normita");
  assert.equal(
    (
      await f.req("/movements", "owner", {}, "POST", {
        "X-Finance-Request": "",
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.req("/movements", "owner", {}, "POST", {
        Origin: "https://unrelated.example",
      })
    ).status,
    403
  );
  const member = f.db
    .prepare("SELECT id FROM finance_members WHERE username='normita'")
    .get();
  assert.equal(
    (await f.req(`/members/${member.id}/status`, "owner", { active: false }))
      .status,
    200
  );
  assert.equal((await f.req("/snapshot", "normita")).status, 401);
  f.db
    .prepare("UPDATE finance_sessions SET last_seen=?")
    .run(Date.now() - 31 * 60 * 1000);
  assert.equal((await f.req("/snapshot")).status, 401);
});

test("integer cents, valid dates and Ecuador midnight boundaries are strict", async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.equal((await f.movement({ amount_cents: 10.5 })).status, 400);
  assert.equal((await f.movement({ amount_cents: -1 })).status, 400);
  assert.equal((await f.movement({ day: "2026-13-01" })).status, 400);
  assert.equal((await f.movement({ day: "2026-02-30" })).status, 400);
  assert.equal(financeDay("2026-11-09T04:59:59Z"), "2026-11-08");
  assert.equal(financeDay("2026-11-09T05:00:00Z"), "2026-11-09");
  assert.throws(() => validDay("2025-02-29"));
  assert.equal(validDay("2024-02-29"), "2024-02-29");
});

test("CSV output neutralizes formulas and audit hashes retain a verifiable chain", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.movement({ counterparty: '=HYPERLINK("bad")' });
  const csv = csvExport(f.db.prepare("SELECT * FROM finance_movements").all());
  assert.match(csv, /'=HYPERLINK/);
  const events = f.db.prepare("SELECT * FROM finance_audit ORDER BY id").all();
  let previous = "GENESIS";
  for (const e of events) {
    assert.equal(e.previous_hash, previous);
    const values = [
      e.business_id,
      e.actor,
      e.action,
      e.entity,
      e.entity_id,
      e.before_json,
      e.after_json,
      e.previous_hash,
      e.created_at,
    ];
    assert.equal(
      e.hash,
      crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex")
    );
    previous = e.hash;
  }
});

test("a complete SQLite backup retains encrypted evidence and ledger consistency", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.movement();
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gema-finance-test-"));
  const target = path.join(dir, "backup.sqlite");
  try {
    await f.db.backup(target);
    const copy = new Database(target, { readonly: true });
    assert.equal(copy.pragma("quick_check", { simple: true }), "ok");
    assert.equal(
      copy.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
      1
    );
    copy.close();
  } finally {
    const resolved = path.resolve(dir),
      temporary = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(
      resolved.startsWith(temporary) &&
        path.basename(resolved).startsWith("gema-finance-test-")
    );
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test("transfers preserve total funds and never count as revenue or expense", async (t) => {
  const f = await fixture(t);
  await f.login();
  const from = await f.account("producalza", "Origen"),
    to = await f.account("marjorie", "Destino");
  const result = await f.req("/transfers", "owner", {
    from_account_id: from,
    to_account_id: to,
    amount_cents: 5000,
    day: f.day,
    description: "Fondos prestados entre negocios",
  });
  assert.equal(result.status, 201);
  await f.bank(from, [{ day: f.day, amount_cents: -5000, external_id: "out" }]);
  await f.bank(to, [{ day: f.day, amount_cents: 5000, external_id: "in" }]);
  for (const id of result.body.movement_ids) {
    const m = f.db
      .prepare("SELECT * FROM finance_movements WHERE id=?")
      .get(id);
    const b = f.db
      .prepare("SELECT id FROM finance_bank_transactions WHERE account_id=?")
      .get(m.account_id);
    assert.equal(
      (
        await f.req("/reconcile", "owner", {
          movement_id: id,
          bank_transaction_id: b.id,
          amount_cents: 5000,
        })
      ).status,
      200
    );
  }
  const s = (await f.req("/snapshot")).body.summary;
  assert.equal(s.balance_cents, 0);
  assert.equal(s.income_cents, 0);
  assert.equal(s.expense_cents, 0);
});

test("cash custody transfers require physical confirmation and affect only the cash journal", async (t) => {
  const f = await fixture(t);
  await f.login();
  const create = async (name, opening) => {
    const r = await f.req("/accounts", "owner", {
      business_id: "gemashow",
      name,
      bank: "Custodia",
      kind: "custody",
      opening_cents: opening,
      opening_date: f.start,
    });
    return r.body.id;
  };
  const from = await create("Responsable A", 10000),
    to = await create("Responsable B", 0);
  const body = {
    from_account_id: from,
    to_account_id: to,
    amount_cents: 3000,
    day: f.day,
    description: "Entrega física de fondos de evento",
  };
  assert.equal((await f.req("/transfers", "owner", body)).status, 400);
  assert.equal(
    (await f.req("/transfers", "owner", { ...body, confirm_cash: true }))
      .status,
    201
  );
  const s = (await f.req("/snapshot")).body;
  assert.equal(s.accounts.find((a) => a.id === from).balance_cents, 7000);
  assert.equal(s.accounts.find((a) => a.id === to).balance_cents, 3000);
  assert.equal(s.summary.income_cents, 0);
  assert.equal(s.summary.expense_cents, 0);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM finance_bank_transactions WHERE source='cash_journal'"
      )
      .get().n,
    2
  );
});

test("TOTP matches RFC 6238 vectors and blocks replayed steps", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])
    assert.equal(totp(secret, seconds * 1000, 8), expected);
  const now = Date.now(),
    step = Math.floor(now / 30000),
    code = totp(secret, now);
  assert.equal(validTotpStep(secret, code, -1, now), step);
  assert.equal(validTotpStep(secret, code, step, now), null);
});

test("MFA enrollment encrypts the secret, requires a second factor, and consumes recovery codes once", async (t) => {
  const f = await fixture(t);
  await f.login();
  const enrollment = await f.req("/security/totp/start", "owner", { password });
  assert.equal(enrollment.status, 200);
  assert.match(enrollment.body.qr, /^data:image\/png/);
  const confirmed = await f.req("/security/totp/confirm", "owner", {
    code: totp(enrollment.body.secret),
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.recovery_codes.length, 8);
  const stored = f.db
    .prepare(
      "SELECT mfa_secret,mfa_enabled FROM finance_members WHERE username='owner'"
    )
    .get();
  assert.equal(stored.mfa_enabled, 1);
  assert.notEqual(stored.mfa_secret.toString(), enrollment.body.secret);
  assert.equal(
    (await f.req("/login", "owner", { username: "owner", password })).body.code,
    "MFA_REQUIRED"
  );
  assert.equal(
    (
      await f.req("/login", "owner", {
        username: "owner",
        password,
        code: totp(enrollment.body.secret),
      })
    ).status,
    401
  );
  const code = confirmed.body.recovery_codes[0];
  assert.equal(
    (await f.req("/login", "owner", { username: "owner", password, code }))
      .status,
    200
  );
  assert.equal(
    (await f.req("/login", "owner", { username: "owner", password, code }))
      .status,
    401
  );
  assert.equal((await f.req("/security", "owner")).body.recovery_remaining, 7);
  assert.ok(
    !f.db
      .prepare("SELECT hash FROM finance_recovery_codes LIMIT 1")
      .get()
      .hash.includes(code)
  );
  assert.equal(
    (
      await f.req("/security/totp/reset", "owner", {
        password,
        code: confirmed.body.recovery_codes[1],
      })
    ).status,
    200
  );
  assert.equal((await f.req("/security", "owner")).body.mfa_enabled, false);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_recovery_codes").get().n,
    0
  );
});

test("AI receives only scoped context, cannot mutate records, and filters invented citations", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("normita");
  await f.movement({ counterparty: "Visible client" }, "normita");
  await f.movement({
    business_id: "personal",
    counterparty: "Private personal marker",
  });
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-api-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  const actualFetch = globalThis.fetch;
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      request = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    answer: "Consulta de datos autorizados",
                    movement_ids: [999999],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return actualFetch(url, options);
  });
  const result = await f.req("/assistant", "normita", {
    question: "Resume mis cobros",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.movement_ids, []);
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.ok(!JSON.stringify(request).includes("Private personal marker"));
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    2
  );
});

test("a reconciled Producalza receipt updates its original order once and reversal restores the pending balance", async (t) => {
  const f = await fixture(t, true);
  await f.login();
  const client = f.db
    .prepare(
      "INSERT INTO production_clients (establishment_id,name) VALUES (1,'Cliente de prueba')"
    )
    .run().lastInsertRowid;
  const order = f.db
    .prepare(
      "INSERT INTO production_orders (establishment_id,client_id,order_number,status) VALUES (1,?,'PC-TEST-1','received')"
    )
    .run(client).lastInsertRowid;
  f.db
    .prepare(
      "INSERT INTO production_order_payments (establishment_id,order_id,payment_type,amount,status,reference) VALUES (1,?,'saldo',500,'pending','MANUAL-TOTAL-PENDIENTE')"
    )
    .run(order);
  const account = await f.account("producalza");
  const m = await f.movement({
    amount_cents: 20000,
    account_id: account,
    order_id: Number(order),
    reference: "BANK-PC-TEST",
  });
  await f.bank(account, [
    {
      day: f.day,
      amount_cents: 20000,
      reference: "BANK-PC-TEST",
      external_id: "pc-test",
    },
  ]);
  const b = f.db.prepare("SELECT id FROM finance_bank_transactions").get();
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: b.id,
        amount_cents: 20000,
      })
    ).status,
    200
  );
  let paid = f.db
    .prepare(
      "SELECT * FROM production_order_payments WHERE order_id=? AND status='paid'"
    )
    .all(order);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, 200);
  assert.equal(
    f.db
      .prepare(
        "SELECT SUM(amount) n FROM production_order_payments WHERE order_id=? AND status='pending'"
      )
      .get(order).n,
    300
  );
  syncInternalSources(f.db, { username: "owner" });
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n,
    1
  );
  const allocation = f.db.prepare("SELECT id FROM finance_allocations").get();
  assert.equal(
    (
      await f.req(
        `/allocations/${allocation.id}`,
        "owner",
        { reason: "Revisar acreditación" },
        "DELETE"
      )
    ).status,
    200
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT SUM(amount) n FROM production_order_payments WHERE order_id=? AND status='pending'"
      )
      .get(order).n,
    500
  );
  assert.equal(
    (
      await f.req("/reconcile", "owner", {
        movement_id: m.body.id,
        bank_transaction_id: b.id,
        amount_cents: 20000,
      })
    ).status,
    200
  );
  paid = f.db
    .prepare(
      "SELECT * FROM production_order_payments WHERE order_id=? AND status='paid'"
    )
    .all(order);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, 200);
});

test("Sur routes recipient-bank receipts to Marlon or Morelia and enforces the reviewer on the server", async (t) => {
  const f = await fixture(t);
  f.db.prepare("INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,review_unit_ids) VALUES (?,?,?,'collector','[\"marjorie\"]',?,?)").run("South", "south", passwordHash(password), '["marjorie-sur"]', '[]');
  f.db.prepare("INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,review_unit_ids) VALUES (?,?,?,'collector','[\"marjorie\"]','[]','[\"marjorie-sur\"]')").run("Morelia", "morelia", passwordHash(password));
  await f.login(); await f.login("south"); await f.login("morelia");
  function evidence(analysis = null) {
    return Number(f.db.prepare("INSERT INTO finance_evidence (business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by,analysis) VALUES ('marjorie','marjorie-sur','fixture.png','image/png',1,?,?,'south',?)").run(crypto.randomUUID(), encryptDocument(Buffer.from("fixture")), analysis && JSON.stringify(analysis)).lastInsertRowid);
  }
  const body = { unit_id: "marjorie-sur", amount_cents: 2000, evidence_id: evidence() };
  assert.equal((await f.req("/store-receipts", "south", body)).status, 400);
  const guay = await f.req("/store-receipts", "south", { ...body, receiving_bank: "Banco Guayaquil" });
  assert.equal(guay.status, 201); assert.equal(guay.body.responsible, "Marlon");
  assert.equal((await f.req(`/store-receipts/${guay.body.id}/confirm`, "morelia", {})).status, 403);
  let list = (await f.req("/store-receipts")).body.receipts;
  assert.equal(list.find((r) => r.id === guay.body.id).assigned_to_me, true);
  assert.equal((await f.req("/store-receipts", "morelia")).body.receipts.some((r) => r.id === guay.body.id), false);
  const same = await f.req("/store-receipts", "south", { ...body, receiving_bank: "Guayaquil" });
  assert.equal(same.body.duplicate, true);
  assert.equal((await f.req("/store-receipts", "south", { ...body, receiving_bank: "Pichincha" })).status, 409);
  const pich = await f.req("/store-receipts", "south", { ...body, evidence_id: evidence({ receiving_bank: "Banco Pichincha" }) });
  assert.equal(pich.status, 201); assert.equal(pich.body.responsible, "Morelia");
  list = (await f.req("/store-receipts")).body.receipts;
  assert.equal(list.find((r) => r.id === pich.body.id).assigned_to_me, false);
  const moreList = (await f.req("/store-receipts", "morelia")).body.receipts;
  assert.equal(moreList.find((r) => r.id === pich.body.id).assigned_to_me, true);
  assert.equal((await f.req(`/store-receipts/${pich.body.id}/confirm`, "morelia", {})).status, 200);
  assert.equal((await f.req(`/store-receipts/${guay.body.id}/confirm`, "owner", {})).status, 200);
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_bank_transactions").get().n, 0);
});

test("full account numbers are owner-managed, encrypted and never exposed to other readers", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.login("reader");
  const id = await f.account("marjorie");
  assert.equal(
    (await f.req(`/accounts/${id}/number`, "reader", { number: "0000001234" }))
      .status,
    403,
  );
  assert.equal(
    (await f.req(`/accounts/${id}/number`, "owner", { number: "0000009999" }))
      .status,
    400,
  );
  assert.equal(
    (await f.req(`/accounts/${id}/number`, "owner", { number: "0000001234" }))
      .status,
    200,
  );
  assert.equal(
    (await f.req("/snapshot")).body.accounts.find((a) => a.id === id)
      .account_number,
    "0000001234",
  );
  assert.equal(
    (await f.req("/snapshot", "reader")).body.accounts.find((a) => a.id === id)
      .account_number,
    undefined,
  );
  assert.equal(
    (
      await f.req("/custody/henry/account-number", "reader", {
        number: "0000005678",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.req("/custody/henry/account-number", "owner", {
        number: "0000005678",
      })
    ).status,
    200,
  );
  const settings = f.db
    .prepare("SELECT encrypted FROM finance_runtime_settings")
    .all();
  assert.equal(
    settings.some(
      (r) =>
        r.encrypted.toString().includes("0000001234") ||
        r.encrypted.toString().includes("0000005678"),
    ),
    false,
  );
  const log = f.db.prepare("SELECT * FROM finance_audit").all();
  assert.equal(JSON.stringify(log).includes("0000001234"), false);
});


test('financial conversation is restricted to the four responsible people',async t=>{
 const f=await fixture(t);await f.login();await f.login('normita');await f.login('reader');await f.login('north');
 for(const name of ['german','morelia'])f.db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids,unit_ids) VALUES (?,?,?,'collector','[\"producalza\"]','[]')").run(name,name,passwordHash(password));
 for(const name of ['german','morelia'])await f.login(name);
 for(const name of ['owner','german','morelia','normita'])assert.equal((await f.req('/assistant',name,{question:'¿Qué ventas hay hoy?'})).status,200);
 for(const name of ['reader','north'])assert.equal((await f.req('/assistant',name,{question:'¿Qué ventas hay hoy?'})).status,403);
});

test('remembered devices survive inactivity while ordinary sessions still expire',async t=>{
 const f=await fixture(t);await f.login();
 f.db.prepare('UPDATE finance_sessions SET last_seen=?').run(Date.now()-3600000);assert.equal((await f.req('/snapshot')).status,401);
 await f.login();const remembered=await f.raw('/remember-device','owner',{remember:true});assert.equal(remembered.status,200);assert.match(remembered.headers.get('set-cookie'),/Max-Age=2592000/);assert.match(remembered.headers.get('set-cookie'),/HttpOnly/);
 f.db.prepare('UPDATE finance_sessions SET last_seen=?').run(Date.now()-3600000);assert.equal((await f.req('/snapshot')).status,200);
 assert.equal((await f.req('/session')).body.remember_device,true);
 await f.req('/remember-device','owner',{remember:false});f.db.prepare('UPDATE finance_sessions SET last_seen=?').run(Date.now()-3600000);assert.equal((await f.req('/snapshot')).status,401);
});

test('team password requirement begins exactly at 09:00 Ecuador and exempts the owner',t=>{
 const previous=process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT;process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT='2026-11-10T09:00:00-05:00';t.after(()=>{if(previous===undefined)delete process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT;else process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT=previous;});
 const m={role:'collector'};assert.equal(passwordChangePolicy(m,Date.parse('2026-11-10T13:59:59.999Z')).password_change_required,false);assert.equal(passwordChangePolicy(m,Date.parse('2026-11-10T14:00:00Z')).password_change_required,true);
 assert.equal(passwordChangePolicy({role:'owner'},Date.parse('2026-11-11T14:00:00Z')).password_change_required,false);
 assert.equal(passwordChangePolicy({...m,password_policy_completed:'2026-11-10T14:00:00.000Z'},Date.parse('2026-11-11T14:00:00Z')).password_change_required,false);
});

test('a due password change blocks existing sessions until a personal change and revokes other sessions',async t=>{
 const previous=process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT;t.after(()=>{if(previous===undefined)delete process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT;else process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT=previous;});
 process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT=new Date(Date.now()+60000).toISOString();const f=await fixture(t);await f.login();await f.login('reader');assert.equal((await f.req('/snapshot','reader')).status,200);
 const other=await f.raw('/login','reader',{username:'reader',password}),otherCookie=other.headers.get('set-cookie').split(';')[0];
 process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT=new Date(Date.now()-1000).toISOString();
 const blocked=await f.req('/snapshot','reader');assert.equal(blocked.status,403);assert.equal(blocked.body.code,'PASSWORD_CHANGE_REQUIRED');assert.equal(blocked.body.user.username,'reader');assert.equal((await f.req('/snapshot')).status,200);
 assert.equal((await f.req('/session','reader')).body.user.password_change_required,true);assert.equal((await f.req('/security','reader')).status,200);
 assert.equal((await f.req('/security/password','reader',{password,new_password:password})).status,400);
 const changed=await f.req('/security/password','reader',{password,new_password:'TeamNew8'});assert.equal(changed.status,200);assert.equal(changed.body.user.password_change_required,false);assert.equal((await f.req('/snapshot','reader')).status,200);
 assert.equal((await f.raw('/snapshot','reader',undefined,'GET',{Cookie:otherCookie})).status,401);
 assert.equal((await f.req('/login','reader',{username:'reader',password})).status,401);assert.equal((await f.req('/login','reader',{username:'reader',password:'TeamNew8'})).status,200);
});

test('German can sign in using an accented name without altering password matching',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO finance_members(name,username,password_hash,role,business_ids,unit_ids) VALUES ('Germán','german',?,'viewer','[\"gemashow\"]','[]')").run(passwordHash(password));
 const r=await f.req('/login','german',{username:' Germán ',password});assert.equal(r.status,200);assert.equal(r.body.user.username,'german');assert.equal((await f.req('/login','german',{username:'german',password:password.toLowerCase()})).status,401);
});
