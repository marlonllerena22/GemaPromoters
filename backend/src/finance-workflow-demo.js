import crypto from "node:crypto";
import { financeDay, safeMember, passwordHash } from "./finance-db.js";
import { createMovement, importBank, reconcile } from "./finance-service.js";
import { encryptDocument } from "./finance-ai.js";
import { recordRequestPayment } from "./finance-workflow.js";
import { PROFILE_TEMPLATES } from "../../shared/finance-workflow.mjs";
import { savePayee } from "./finance-payees.js";
export function seedWorkflowDemo(db) {
  if (db.pragma("database_list")[0].file !== "")
    throw new Error(
      "Los perfiles y pagos de ejemplo solo se generan en memoria",
    );
  const owner = db
    .prepare(
      "SELECT * FROM finance_members WHERE username='demo' AND role='owner'",
    )
    .get();
  if (!owner) throw new Error("La base no es una demostración");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,work_view) VALUES (?,?,?,?,?,?,?)",
  );
  const profileUsers = {
    owner: {
      ...safeMember(owner),
      name: "Propietario",
      preview_persona: "owner",
    },
  };
  for (const p of PROFILE_TEMPLATES) {
    const units =
      p.unit_ids ||
      (["ana", "jose", "norma"].includes(p.id) ? ["producalza-fabrica"] : []);
    insert.run(
      p.name,
      p.id,
      passwordHash(crypto.randomBytes(24).toString("hex")),
      p.role,
      JSON.stringify(p.business_ids),
      JSON.stringify(units),
      p.work_view ? 1 : 0,
    );
    db.prepare(
      "UPDATE finance_members SET request_payments=?,review_unit_ids=?,auto_confirm_unit_ids=?,custody_adjust=?,checks_manage=?,checks_clear=? WHERE username=?",
    ).run(
      p.request_payments ? 1 : 0,
      JSON.stringify(p.review_unit_ids || []),
      JSON.stringify(p.auto_confirm_unit_ids || []),
      p.custody_adjust ? 1 : 0,
      p.checks_manage ? 1 : 0,
      p.checks_clear ? 1 : 0,
      p.id,
    );
    const member = db
      .prepare("SELECT * FROM finance_members WHERE username=?")
      .get(p.id);
    profileUsers[p.id] = { ...safeMember(member), preview_persona: p.id };
    for (const id of p.spaces)
      db.prepare(
        "INSERT OR IGNORE INTO finance_space_members VALUES (?,?,?)",
      ).run(
        id,
        member.id,
        p.role === "viewer" && !p.request_payments
          ? "observer"
          : p.id === "morelia"
            ? "coordinator"
            : "requester",
      );
  }
  for (const space of db.prepare("SELECT id FROM finance_spaces").all())
    db.prepare(
      "INSERT OR IGNORE INTO finance_space_members VALUES (?,?,'coordinator')",
    ).run(space.id, owner.id);
  db.prepare(
    "UPDATE finance_spaces SET share_label='Depósitos materiales' WHERE id='producalza-materiales'",
  ).run();
  db.prepare(
    "UPDATE finance_spaces SET share_label='Transferencias Producalza' WHERE id='producalza-pagos'",
  ).run();
  db.prepare(
    "UPDATE finance_spaces SET share_label='Depósitos Dani Manager' WHERE id='gema-exterior-dani'",
  ).run();
  db.prepare(
    "UPDATE finance_movements SET created_by='norma' WHERE business_id='producalza' AND kind='income' AND id%3=0",
  ).run();
  const day = financeDay(),
    prior = new Date(`${day}T12:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  const yesterday = prior.toISOString().slice(0, 10);
  const bank = db
    .prepare(
      "SELECT id FROM finance_accounts WHERE business_id='producalza' AND kind='bank' LIMIT 1",
    )
    .get().id;
  const shared = db
    .prepare(
      "SELECT id FROM finance_accounts WHERE business_id IS NULL LIMIT 1",
    )
    .get().id;
  const card = Number(
    db
      .prepare(
        "INSERT INTO finance_accounts (business_id,name,bank,kind,last_four,custodian,opening_cents,opening_date) VALUES ('gemashow','Tarjeta de eventos · ejemplo','Tarjeta','card','4202','Propietario',0,?)",
      )
      .run(`${day.slice(0, 7)}-01`).lastInsertRowid,
  );
  const tasks = [
    [
      "producalza-pagos",
      "norma",
      "Servicios básicos",
      12540,
      "Servicios",
      "Pagar la planilla de servicios de la fábrica",
    ],
    [
      "producalza-materiales",
      "ana",
      "Proveedor de suelas",
      48000,
      "Materiales",
      "Compra de suelas para los pedidos de esta semana",
    ],
    [
      "producalza-materiales",
      "jose",
      "Cuero para producción",
      32000,
      "Materiales",
      "Material de bodega · se pagó un primer abono",
    ],
    [
      "gema-mago-loja",
      "demo",
      "Sonido · Loja",
      85000,
      "Producción de evento",
      "Anticipo de sonido para Mago de Oz · Loja",
    ],
    [
      "gema-exterior-dani",
      "demo",
      "Dani Manager",
      35000,
      "Producción de evento",
      "Pago al exterior con tarjeta · ejemplo",
    ],
    [
      "trabajo-varios",
      "demo",
      "Transporte de equipos",
      9500,
      "Transporte",
      "Traslado de equipos coordinado con papá",
    ],
  ];
  const ids = [];
  for (const [
    space_id,
    actor,
    counterparty,
    amount_cents,
    category,
    description,
  ] of tasks) {
    const user = actor === "demo" ? profileUsers.owner : profileUsers[actor];
    const business_id = space_id.startsWith("producalza")
      ? "producalza"
      : "gemashow";
    const r = createMovement(db, user, {
      business_id,
      unit_id: business_id === "producalza" ? "producalza-fabrica" : null,
      kind: "expense",
      amount_cents,
      day,
      category,
      counterparty,
      description,
      payment_method: "transfer",
    });
    db.prepare(
      "UPDATE finance_movements SET is_payment_request=1,space_id=? WHERE id=?",
    ).run(space_id, r.id);
    ids.push(r.id);
  }
  const oldDemo = process.env.FINANCE_DEMO;
  process.env.FINANCE_DEMO = "1";
  try {
    let index = 0;
    for (const [id, amount_cents, account_id] of [
      [ids[2], 10000, bank],
      [ids[4], 35000, card],
      [ids[5], 9500, shared],
    ]) {
      const request = db
        .prepare("SELECT * FROM finance_movements WHERE id=?")
        .get(id);
      const bytes = Buffer.concat([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO8sAAAAASUVORK5CYII=",
          "base64",
        ),
        Buffer.from(`DEMO-SIN-VALOR-${index}`),
      ]);
      const evidence_id = Number(
        db
          .prepare(
            "INSERT INTO finance_evidence (business_id,name,mime,bytes,sha256,encrypted,created_by) VALUES (?,?,'image/png',?,?,?,'demo')",
          )
          .run(
            request.business_id,
            `Comprobante-ejemplo-${index}.png`,
            bytes.length,
            crypto.createHash("sha256").update(bytes).digest("hex"),
            encryptDocument(bytes),
          ).lastInsertRowid,
      );
      const paid = recordRequestPayment(db, profileUsers.owner, id, {
        request_key: crypto.randomUUID(),
        amount_cents,
        evidence_id,
        account_id,
        paid_day: yesterday,
        reference: `EJEMPLO-PAGO-${++index}`,
        confirm_paid: true,
      });
      if (account_id === card) {
        importBank(db, profileUsers.owner, {
          account_id,
          rows: [
            {
              day: yesterday,
              amount_cents: -amount_cents,
              reference: `EJEMPLO-PAGO-${index}`,
              external_id: "EJEMPLO-TARJETA-EVENTO",
            },
          ],
        });
        const b = db
          .prepare(
            "SELECT id FROM finance_bank_transactions WHERE account_id=?",
          )
          .get(card);
        reconcile(db, profileUsers.owner, {
          movement_id: paid.payment.movement_id,
          bank_transaction_id: b.id,
          amount_cents,
        });
      }
    }
  } finally {
    if (oldDemo === undefined) delete process.env.FINANCE_DEMO;
    else process.env.FINANCE_DEMO = oldDemo;
  }
  db.prepare(
    "INSERT INTO finance_space_notes (request_id,actor,body) VALUES (?,'ana','La compra corresponde únicamente a materiales de bodega. Datos de demostración.')",
  ).run(ids[1]);
  for (const [space_id, actor, name] of [
    ["producalza-materiales", "ana", "Materiales · contacto de ejemplo"],
    ["producalza-pagos", "norma", "Servicios · contacto de ejemplo"],
    ["gema-mago-loja", "owner", "Transporte · contacto de ejemplo"],
  ]) {
    const business_id = space_id.startsWith("producalza")
      ? "producalza"
      : "gemashow";
    const { contact } = savePayee(
      db,
      profileUsers[actor] || profileUsers.owner,
      {
        business_id,
        space_id,
        name,
        document: "",
        email: "pagos@example.invalid",
        accounts: [
          {
            bank: "Pichincha",
            type: "savings",
            number: "0012345678",
            holder: "Titular de ejemplo",
          },
          {
            bank: "Produbanco",
            type: "checking",
            number: "0098765432",
            holder: "Titular de ejemplo",
          },
        ],
      },
    );
    const rows = db
      .prepare(
        "SELECT id FROM finance_movements WHERE is_payment_request=1 AND space_id=?",
      )
      .all(space_id);
    for (const row of rows)
      db.prepare(
        "INSERT INTO finance_request_payees (request_id,payee_id,encrypted) VALUES (?,?,?)",
      ).run(
        row.id,
        contact.id,
        encryptDocument(
          Buffer.from(
            JSON.stringify({
              name: contact.name,
              document: contact.document,
              email: contact.email,
              accounts: contact.accounts,
              contact_id: contact.id,
            }),
          ),
        ),
      );
  }
  return profileUsers;
}
