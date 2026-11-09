import crypto from "node:crypto";
import {
  encryptDocument,
  decryptDocument,
  privateFingerprint,
} from "./finance-ai.js";
import { audit } from "./finance-db.js";
import { businessAccess, unitAccess, fail } from "./finance-service.js";
import { requireSpace, validateRequestSpace } from "./finance-workflow.js";
import { registerQuickEntry } from "./finance-quick.js";
import { normalizePayee, payeeError } from "../../shared/finance-payees.mjs";
const decode = (row) => ({
  ...JSON.parse(decryptDocument(row.encrypted).toString()),
  id: row.id,
  business_id: row.business_id,
  space_id: row.space_id,
});
function scopeAccess(db, user, business, space, { write = false } = {}) {
  businessAccess(user, business);
  if (write && !["owner", "manager", "collector"].includes(user.role)&&!user.request_payments)
    fail("Tu acceso es de consulta", 403);
  if (space) {
    const s = requireSpace(db, user, space, { write });
    if (!s.business_ids.includes(business))
      fail("El contacto no corresponde al negocio");
  }
}
export function listPayees(db, user, business, space) {
  scopeAccess(db, user, business, space);
  return db
    .prepare(
      "SELECT * FROM finance_payees WHERE business_id=? AND space_id IS ? AND created_by=? ORDER BY created_at DESC"
    )
    .all(business, space || null, user.username)
    .map(decode);
}
export function getPayee(db, user, id, { write = false } = {}) {
  const row = db.prepare("SELECT * FROM finance_payees WHERE id=?").get(id);
  if (!row) fail("Contacto no disponible", 404);
  if(row.created_by!==user.username&&user.role!=='owner')fail('Contacto privado de otro usuario',404);
  if(write&&row.created_by!==user.username)fail('Elige un contacto de tu usuario',404);
  scopeAccess(db, user, row.business_id, row.space_id, { write });
  if (
    !row.space_id &&
    user.role !== "owner" &&
    row.created_by !== user.username
  )
    fail("Contacto no disponible", 404);
  return decode(row);
}
export function savePayee(db, user, body) {
  const space = body.space_id || null,
    business = body.business_id;
  scopeAccess(db, user, business, space, { write: true });
  const p = normalizePayee(body),
    error = payeeError(p);
  if (error) fail(error);
  const scope = `${business}|${space || `private:${user.username}`}|user:${user.username}`;
  const hashes = p.accounts.map((a) =>
    privateFingerprint(
      JSON.stringify([
        a.bank
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/^banco\s+/, ""),
        a.number,
      ])
    )
  );
  return db.transaction(() => {
    const ids = new Set(
      hashes
        .map(
          (h) =>
            db
              .prepare(
                "SELECT payee_id FROM finance_payee_accounts WHERE scope=? AND fingerprint=?"
              )
              .get(scope, h)?.payee_id
        )
        .filter(Boolean)
    );
    if (ids.size > 1)
      fail(
        "Estas cuentas ya pertenecen a contactos diferentes. Selecciona el contacto guardado",
        409
      );
    if (ids.size) {
      const existing = getPayee(db, user, [...ids][0], { write: true });
      const a = existing.accounts
          .map((x) => `${x.bank.toLowerCase()}|${x.number}`)
          .sort(),
        b = p.accounts.map((x) => `${x.bank.toLowerCase()}|${x.number}`).sort();
      if (
        (existing.document && p.document && existing.document !== p.document) ||
        JSON.stringify(a) !== JSON.stringify(b) ||
        existing.name.toLowerCase() !== p.name.toLowerCase()
      )
        fail(
          "La cuenta ya está guardada con otros datos. Selecciona y revisa ese contacto; no se sobrescribió",
          409
        );
      return { contact: existing, duplicate: true };
    }
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO finance_payees (id,business_id,space_id,encrypted,created_by) VALUES (?,?,?,?,?)"
    ).run(
      id,
      business,
      space,
      encryptDocument(Buffer.from(JSON.stringify(p))),
      user.username
    );
    const add = db.prepare(
      "INSERT INTO finance_payee_accounts (payee_id,scope,fingerprint) VALUES (?,?,?)"
    );
    hashes.forEach((h) => add.run(id, scope, h));
    audit(
      db,
      user.username,
      "payee.created",
      "payee",
      id,
      null,
      { account_count: p.accounts.length, space_id: space },
      business
    );
    return {
      contact: { ...p, id, business_id: business, space_id: space },
      duplicate: false,
    };
  })();
}
export function requestPayee(db, id) {
  const row = db
    .prepare("SELECT encrypted FROM finance_request_payees WHERE request_id=?")
    .get(id);
  return row ? JSON.parse(decryptDocument(row.encrypted).toString()) : null;
}
export function createPayeeRequest(db, user, body) {
  return db.transaction(() => {
    const contact = getPayee(db, user, body.contact_id, { write: true });
    if (
      contact.business_id !== body.business_id ||
      (contact.space_id || null) !== (body.space_id || null)
    )
      fail("El contacto pertenece a otro espacio", 403);
    validateRequestSpace(
      db,
      user,
      body.space_id,
      body.business_id,
      body.unit_id
    );
    unitAccess(db, user, body.unit_id, body.business_id);
    const payee = {
      name: contact.name,
      document: contact.document,
      email: contact.email,
      accounts: contact.accounts.map((a) => ({ ...a })),
      contact_id: contact.id,
    };
    // Destination participates in idempotency without becoming public description/reference.
    const key = String(body.request_id || "");
    const original = db
      .prepare(
        "SELECT movement_id FROM finance_quick_requests WHERE member_id=? AND request_id=?"
      )
      .get(user.id, key);
    if (
      original &&
      JSON.stringify(requestPayee(db, original.movement_id)) !==
        JSON.stringify(payee)
    )
      fail("Este envío ya se utilizó con otro destinatario", 409);
    const result = registerQuickEntry(db, user, {
      request_id: key,
      text: String(body.description || "Pago solicitado"),
      request: true,
      space_id: body.space_id || null,
      evidence_id: body.evidence_id || null,
      overrides: {
        business_id: body.business_id,
        unit_id: body.unit_id || null,
        kind: "expense",
        amount_cents: body.amount_cents,
        counterparty: contact.name,
        payment_method: "transfer",
        category: body.category || "Otros",
      },
    });
    if (!result.duplicate)
      db.prepare(
        "INSERT INTO finance_request_payees (request_id,payee_id,encrypted) VALUES (?,?,?)"
      ).run(
        result.movement.id,
        contact.id,
        encryptDocument(Buffer.from(JSON.stringify(payee)))
      );
    return result;
  })();
}
