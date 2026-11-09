import crypto from "node:crypto";
import { audit, financeDay } from "./finance-db.js";
import {
  createMovement,
  fail,
  scoped,
  visibleAccounts,
} from "./finance-service.js";
import { interpretQuickEntry } from "../../shared/finance-quick.mjs";
import {
  validateRequestSpace,
  queuePaymentNotice,
} from "./finance-workflow.js";

export function quickContext(db, user) {
  return {
    business_ids: user.business_ids,
    unit_ids: user.unit_ids,
    day: financeDay(),
    units: db.prepare("SELECT id,business_id,name FROM finance_units").all(),
    accounts: visibleAccounts(db, user),
    allow_cross_account: user.role === "owner",
  };
}
export function registerQuickEntry(db, user, body) {
  if (
    !["owner", "manager", "collector"].includes(user.role) &&
    !(user.request_payments && body.request === true)
  )
    fail("Tu acceso es de consulta", 403);
  if (
    typeof body.request_id !== "string" ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(body.request_id)
  )
    fail("Reabre el registro rápido para preparar un identificador válido");
  if (typeof body.text !== "string" || body.text.length > 1000)
    fail("Describe un solo movimiento en hasta 1000 caracteres");
  const accepted = [
    "business_id",
    "unit_id",
    "kind",
    "amount_cents",
    "day",
    "category",
    "counterparty",
    "reference",
    "payment_method",
    "account_id",
  ];
  const overrides = Object.fromEntries(
    accepted
      .filter((key) => body.overrides?.[key] !== undefined)
      .map((key) => [key, body.overrides[key]]),
  );
  const payload = {
    text: body.text,
    overrides,
    evidence_id: body.evidence_id || null,
    request: body.request === true,
    space_id: body.space_id || null,
  };
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return db.transaction(() => {
    const previous = db
      .prepare(
        "SELECT * FROM finance_quick_requests WHERE member_id=? AND request_id=?",
      )
      .get(user.id, body.request_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        fail(
          "Ese envío ya se utilizó. Inicia un registro nuevo para cambiarlo",
          409,
        );
      const movement = db
        .prepare("SELECT * FROM finance_movements WHERE id=?")
        .get(previous.movement_id);
      if (!movement || !scoped(user, movement))
        fail("Registro no disponible para tu acceso", 403);
      return { movement, duplicate: true };
    }
    const parsed = interpretQuickEntry(body.text, {
      ...quickContext(db, user),
      overrides,
      request: payload.request,
    });
    if (!parsed.ready)
      fail(
        parsed.error ||
          "Falta completar el negocio, tipo, monto, local o cuenta indicado en el resumen",
      );
    if (payload.space_id && !parsed.is_request)
      fail("El espacio de pagos se utiliza para solicitudes de pago");
    validateRequestSpace(
      db,
      user,
      payload.space_id,
      parsed.draft.business_id,
      parsed.draft.unit_id,
    );
    const created = createMovement(db, user, {
      ...parsed.draft,
      evidence_id: payload.evidence_id,
    });
    const status =
      created.kind === "expense" &&
      !parsed.is_request &&
      ["owner", "manager"].includes(user.role)
        ? "reported"
        : "pending";
    db.prepare(
      "UPDATE finance_movements SET status=?,source_system='quick',external_id=?,is_payment_request=?,space_id=? WHERE id=?",
    ).run(
      status,
      `${user.id}:${body.request_id}`,
      parsed.is_request ? 1 : 0,
      payload.space_id,
      created.id,
    );
    if (parsed.is_request) queuePaymentNotice(db, created.id);
    const movement = db
      .prepare("SELECT * FROM finance_movements WHERE id=?")
      .get(created.id);
    audit(
      db,
      user.username,
      "movement.quick_recorded",
      "movement",
      movement.id,
      created,
      movement,
      movement.business_id,
    );
    db.prepare(
      "INSERT INTO finance_quick_requests (member_id,request_id,fingerprint,movement_id) VALUES (?,?,?,?)",
    ).run(user.id, body.request_id, fingerprint, movement.id);
    return { movement, duplicate: false };
  })();
}
