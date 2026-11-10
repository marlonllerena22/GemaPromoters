import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { initFinanceDb, financeDay } from "../src/finance-db.js";
import {
  initBankNotifications,
  ingestBankNotifications,
  applyBankNotification,
  parseBankNotification,
} from "../src/finance-bank-notifications.js";
import { putPrivateSetting } from "../src/finance-operations.js";
import { importBank } from "../src/finance-service.js";
import { ingestBankMessages,applyMailDraft } from "../src/finance-gmail.js";
import { recordedAccountBalance } from "../src/finance-check-ledger.js";

process.env.FINANCE_DOCUMENT_KEY = "test-only-bank-notification-key-0123456789";
test('localized notification amounts keep thousand separators and cents correct',()=>{
  const policy={bank:'Deuna',account_id:1};
  for(const [text,cents] of [['Recibiste $1.500,25',150025],['Recibiste USD 1,500.25',150025],['Recibiste $1,500',150000],['Pagaste $25,00.',2500]])assert.equal(parseBankNotification({text},policy).amount_cents,cents);
});
const owner = {
  role: "owner",
  username: "marlon",
  business_ids: ["personal", "gemashow", "marjorie", "producalza"],
  unit_ids: [],
};
function fixture(t, { automatic = false } = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  initFinanceDb(db);
  initBankNotifications(db);
  t.after(() => db.close());
  const member = db
    .prepare(
      "INSERT INTO finance_members(name,username,password_hash,role,business_ids) VALUES ('Owner','marlon','unused','owner','[]')"
    )
    .run().lastInsertRowid;
  const account = Number(
    db
      .prepare(
        "INSERT INTO finance_accounts(name,bank,kind,opening_cents,opening_date) VALUES ('Deuna','Deuna','bank',10000,?)"
      )
      .run(financeDay()).lastInsertRowid
  );
  const device = {
    id: crypto.randomUUID(),
    created_at: new Date(Date.now() - 3600000).toISOString(),
    apps_json: JSON.stringify([
      {
        package_name: "app.test.deuna",
        bank: "Deuna",
        account_id: account,
        automatic,
      },
    ]),
  };
  db.prepare(
    "INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(
    device.id,
    crypto.randomUUID(),
    member,
    "test-session",
    crypto.randomUUID(),
    device.apps_json,
    device.created_at,
    Date.now() + 3600000
  );
  const event = (overrides = {}) => ({
    id: crypto.randomUUID(),
    package_name: "app.test.deuna",
    posted_at: new Date(Date.now() - 10000).toISOString(),
    title: "Deuna",
    text: "Recibiste $25,00. Referencia: 12345678",
    ...overrides,
  });
  const balance = () =>
    recordedAccountBalance(
      db,
      db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(account)
    );
  return { db, account, device, event, balance };
}
test("review first; encrypted storage, explicit confirmation and repeat delivery change the bank balance once", (t) => {
  const f = fixture(t),
    event = f.event();
  assert.deepEqual(ingestBankNotifications(f.db, f.device, [event]).ack, [
    event.id,
  ]);
  assert.equal(f.balance(), 10000);
  const row = f.db.prepare("SELECT * FROM finance_notification_events").get();
  assert.equal(row.state, "review");
  assert.equal(row.encrypted.includes(Buffer.from("Recibiste")), false);
  assert.throws(
    () => applyBankNotification(f.db, { role: "viewer" }, row.id),
    (e) => e.status === 403
  );
  applyBankNotification(f.db, owner, row.id);
  assert.equal(f.balance(), 12500);
  ingestBankNotifications(f.db, f.device, [event]);
  applyBankNotification(f.db, owner, row.id);
  assert.equal(f.balance(), 12500);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    1
  );
});
test('a later email without reference can be explicitly linked to an Android entry without changing the balance',t=>{
  const f=fixture(t);f.db.prepare("UPDATE finance_accounts SET bank='Pichincha' WHERE id=?").run(f.account);
  f.device.apps_json=JSON.stringify([{package_name:'app.test.deuna',bank:'Pichincha',account_id:f.account,automatic:false}]);
  putPrivateSetting(f.db,'own_account_registry',{accounts:[{account_id:f.account,bank:'Pichincha',number:'2200001234'}]});
  ingestBankNotifications(f.db,f.device,[f.event({text:'Recibiste $25. Cuenta destino ***1234'})]);
  const first=applyBankNotification(f.db,owner,f.db.prepare('SELECT id FROM finance_notification_events').get().id);
  ingestBankMessages(f.db,[{id:'late-no-ref',internalDate:String(Date.now()-5000),payload:{headers:[{name:'From',value:'alerta@pichincha.com'},{name:'Subject',value:'Transferencia recibida'},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=pichincha.com'}],body:{content:'Transferencia recibida. Monto: $25. Cuenta destino: ***1234'}}}]);
  assert.equal(f.balance(),12500);assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'draft');
  applyMailDraft(f.db,owner,'late-no-ref',{account_id:f.account,direction:'incoming',occurred_at:new Date(Date.now()-5000).toISOString(),link_bank_id:first.bank_transaction_id});
  assert.equal(f.balance(),12500);assert.equal(f.db.prepare('SELECT state FROM finance_mail_messages').get().state,'applied');
});
test("selected app only; security codes and old, oversized or future events are discarded before storage", (t) => {
  const f = fixture(t);
  const ignored = [
    f.event({ package_name: "com.whatsapp" }),
    f.event({ text: "Tu código es 123456. Pago $25" }),
    f.event({ text: "Clave temporal: 123456" }),
    f.event({ posted_at: new Date(Date.now() - 7200000).toISOString() }),
    f.event({ posted_at: new Date(Date.now() + 600000).toISOString() }),
    f.event({ text: "a".repeat(6500) }),
  ];
  assert.equal(
    ingestBankNotifications(f.db, f.device, ignored).ack.length,
    ignored.length
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_notification_events").get().n,
    0
  );
  assert.equal(f.balance(), 10000);
});
test("automatic posting requires a completed operation, clear amount, account and actual numeric reference", (t) => {
  const f = fixture(t, { automatic: true });
  ingestBankNotifications(f.db, f.device, [
    f.event(),
    f.event({ text: "Pagaste $12. Referencia 98765432" }),
    f.event({ text: "Recibiste $30. Transacción aprobada" }),
    f.event({ text: "Transferencia pendiente $90. Referencia 55555555" }),
    f.event({ text: "Consumo de tarjeta de crédito $80. Referencia 44444444" }),
    f.event({ text: "Recibiste $25. Saldo $150. Referencia 33333333" }),
  ]);
  assert.equal(f.balance(), 11300);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM finance_notification_events WHERE state='review'"
      )
      .get().n,
    4
  );
});
test("ambiguous account and conflicting account suffix always stay in review", (t) => {
  const f = fixture(t, { automatic: true }),
    p = { bank: "Pichincha", account_id: 1 };
  const registry = {
    accounts: [
      { bank: "Pichincha", number: "2200001234", account_id: 1 },
      { bank: "Pichincha", number: "2300001234", account_id: 2 },
    ],
  };
  assert.equal(
    parseBankNotification(
      f.event({ text: "Recibiste $25 en cuenta ***1234. Referencia 12345678" }),
      p,
      registry
    ).account_id,
    null
  );
  assert.equal(
    parseBankNotification(
      f.event({ text: "Recibiste $25 en cuenta ***9999. Referencia 12345678" }),
      p,
      registry
    ).certain,
    false
  );
  const unbound = {
    ...f.device,
    apps_json: JSON.stringify([
      { package_name: "app.test.deuna", bank: "Deuna", automatic: true },
    ]),
  };
  ingestBankNotifications(f.db, unbound, [f.event()]);
  assert.equal(f.balance(), 10000);
});
test("same reference from email or another Android notice links without a second credit, in either arrival order", (t) => {
  const f = fixture(t, { automatic: true });
  ingestBankNotifications(f.db, f.device, [f.event()]);
  assert.equal(f.balance(), 12500);
  importBank(f.db, owner, {
    source_system: "bank-email",
    account_id: f.account,
    rows: [
      {
        day: financeDay(),
        amount_cents: 2500,
        reference: "12345678",
        external_id: "mail-one",
      },
    ],
  });
  assert.equal(f.balance(), 12500);
  ingestBankNotifications(f.db, f.device, [f.event()]);
  assert.equal(f.balance(), 12500);
  importBank(f.db, owner, {
    source_system: "bank-email",
    account_id: f.account,
    rows: [
      {
        day: financeDay(),
        amount_cents: 1700,
        reference: "22222222",
        external_id: "mail-two",
      },
    ],
  });
  ingestBankNotifications(f.db, f.device, [
    f.event({ text: "Recibiste $17. Referencia 22222222" }),
  ]);
  assert.equal(f.balance(), 14200);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    2
  );
});
test("missing reference holds email and Android overlap for manual linking, preserving equal separate payments", (t) => {
  const f = fixture(t);
  ingestBankNotifications(f.db, f.device, [
    f.event({ text: "Recibiste $25 de Ana" }),
  ]);
  const row = f.db.prepare("SELECT id FROM finance_notification_events").get();
  const applied = applyBankNotification(f.db, owner, row.id);
  assert.equal(f.balance(), 12500);
  assert.throws(
    () =>
      importBank(f.db, owner, {
        source_system: "bank-email",
        account_id: f.account,
        rows: [
          {
            day: financeDay(),
            amount_cents: 2500,
            reference: "OTHER12345",
            external_id: "late-mail",
          },
        ],
      }),
    (e) => e.status === 409
  );
  assert.equal(f.balance(), 12500);
  ingestBankNotifications(f.db, f.device, [
    f.event({ text: "Recibiste $25 de Ana" }),
  ]);
  const second = f.db
    .prepare("SELECT id FROM finance_notification_events ORDER BY id DESC")
    .get();
  assert.throws(
    () => applyBankNotification(f.db, owner, second.id),
    (e) => e.status === 409
  );
  applyBankNotification(f.db, owner, second.id, {
    link_bank_id: applied.bank_transaction_id,
  });
  assert.equal(f.balance(), 12500);
});
test("a known receipt already recorded in bank ledger is related, never credited again", (t) => {
  const f = fixture(t, { automatic: true });
  importBank(f.db, owner, {
    source_system: "assistant",
    account_id: f.account,
    rows: [
      {
        day: financeDay(),
        amount_cents: -1000,
        reference: "PAY12345",
        external_id: "receipt-paid",
      },
    ],
  });
  ingestBankNotifications(f.db, f.device, [
    f.event({ text: "Pagaste $10. Referencia PAY12345" }),
  ]);
  assert.equal(f.balance(), 9000);
  assert.equal(
    f.db.prepare("SELECT state FROM finance_notification_events").get().state,
    "matched"
  );
});
test("opening checkpoint prevents a delayed Android alert from adding funds already in initial balances", (t) => {
  const f = fixture(t, { automatic: true });
  f.db
    .prepare("UPDATE finance_accounts SET opening_at=? WHERE id=?")
    .run(new Date(Date.now() - 5000).toISOString(), f.account);
  ingestBankNotifications(f.db, f.device, [f.event()]);
  assert.equal(f.balance(), 10000);
  assert.equal(
    f.db.prepare("SELECT state FROM finance_notification_events").get().state,
    "review"
  );
});
test("real email ingestion after Android with the same bank reference preserves the already recorded balance", (t) => {
  const f = fixture(t, { automatic: true });
  f.db
    .prepare("UPDATE finance_accounts SET bank='Pichincha' WHERE id=?")
    .run(f.account);
  const apps = [
    {
      package_name: "app.test.deuna",
      bank: "Pichincha",
      account_id: f.account,
      automatic: true,
    },
  ];
  f.device.apps_json = JSON.stringify(apps);
  putPrivateSetting(f.db, "own_account_registry", {
    accounts: [
      { account_id: f.account, bank: "Pichincha", number: "2200001234" },
    ],
  });
  ingestBankNotifications(f.db, f.device, [
    f.event({
      text: "Recibiste $25. Cuenta destino ***1234. Referencia 12345678",
    }),
  ]);
  assert.equal(f.balance(), 12500);
  const m = {
    id: "real-mail-shape",
    internalDate: String(Date.now() - 5000),
    payload: {
      headers: [
        { name: "From", value: "alerta@pichincha.com" },
        { name: "Subject", value: "Transferencia recibida" },
        {
          name: "Authentication-Results",
          value: "mx.google.com; dmarc=pass header.from=pichincha.com",
        },
      ],
      body: {
        content:
          "Transferencia recibida. Monto: $25. Cuenta destino: ***1234. Referencia: 12345678",
      },
    },
  };
  ingestBankMessages(f.db, [m]);
  assert.equal(f.balance(), 12500);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM finance_bank_transactions").get().n,
    1
  );
});
