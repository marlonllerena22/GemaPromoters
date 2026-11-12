import {settleIessProof} from './finance-iess.js';
import {canRequestPayments,canSeeAllBalances} from '../../shared/finance-access.mjs';
import crypto from "node:crypto";
import { decryptDocument } from "./finance-ai.js";
import { audit, financeDay, validDay, cents } from "./finance-db.js";
import {
  businessAccess,
  createMovement,
  fail,
  text,
} from "./finance-service.js";
import {
  workflowView,
  canSeeSpace,
  canSeePaymentRequest,
  paymentProgress,
} from "../../shared/finance-workflow.mjs";
export function workflowSource(db) {
  return {
    spaces: db
      .prepare("SELECT * FROM finance_spaces ORDER BY created_at,id")
      .all()
      .map((s) => ({
        ...s,
        business_ids: JSON.parse(s.business_ids),
        suggested_members: JSON.parse(s.suggested_members),
      })),
    members: db
      .prepare(
        "SELECT s.*,m.name FROM finance_space_members s JOIN finance_members m ON m.id=s.member_id AND m.active=1",
      )
      .all(),
    requests: db
      .prepare(
        "SELECT m.*,CASE WHEN i.request_id IS NOT NULL THEN 'iess' END request_kind,CASE WHEN i.bank_transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_payments pp WHERE pp.request_id=m.id AND pp.voided_at IS NULL) THEN m.amount_cents ELSE 0 END bank_paid_cents,u.name requester_name,e.name evidence_name FROM finance_movements m LEFT JOIN finance_iess_requests i ON i.request_id=m.id LEFT JOIN finance_members u ON u.username=m.created_by LEFT JOIN finance_evidence e ON e.id=m.evidence_id WHERE is_payment_request=1 AND hidden_at IS NULL ORDER BY m.created_at DESC,m.id DESC",
      )
      .all(),
    payments: db
      .prepare(
        "SELECT p.*,a.bank account_bank,a.last_four,m.status verification_status,e.name evidence_name,u.name payer_name FROM finance_payments p JOIN finance_accounts a ON a.id=p.account_id JOIN finance_movements m ON m.id=p.movement_id JOIN finance_evidence e ON e.id=p.evidence_id LEFT JOIN finance_members u ON u.username=p.created_by ORDER BY p.created_at DESC,p.id DESC",
      )
      .all(),
  };
}
export function financialWorkflow(db, user) {
  const result = workflowView(workflowSource(db), user),
    cache = new Map();
  for (const p of result.payments) {
    if (p.destination_index === null || p.destination_index === undefined)
      continue;
    if (!cache.has(p.request_id)) {
      const row = db
        .prepare(
          "SELECT encrypted FROM finance_request_payees WHERE request_id=?",
        )
        .get(p.request_id);
      cache.set(
        p.request_id,
        row ? JSON.parse(decryptDocument(row.encrypted).toString()) : null,
      );
    }
    const a = cache.get(p.request_id)?.accounts?.[p.destination_index];
    if (a) {
      p.destination_bank = a.bank;
      p.destination_last_four = a.number.slice(-4);
    }
  }
  return result;
}
export function attachWorkflow(db, user, data) {
  data.workflow = financialWorkflow(db, user);
  data.settlement_funds =
    canSeeAllBalances(user) &&
    data.businesses.some((b) => b.id === "marjorie")
      ? db
          .prepare(
            "SELECT * FROM finance_settlement_balances WHERE business_id='marjorie'",
          )
          .all()
      : [];
  data.capabilities.push = Boolean(
    process.env.FINANCE_VAPID_PUBLIC_KEY &&
      process.env.FINANCE_VAPID_PRIVATE_KEY &&
      process.env.FINANCE_VAPID_SUBJECT &&
      process.env.FINANCE_DOCUMENT_KEY &&
      process.env.FINANCE_DEMO !== "1",
  );
  return data;
}
export function requireSpace(db, user, id, { write = false } = {}) {
  const source = workflowSource(db),
    space = source.spaces.find((s) => s.id === id);
  if (!space || !canSeeSpace(space, user, source.members))
    fail("Espacio no disponible para tu acceso", 403);
  if (write) {
    if(!canRequestPayments(user))fail("Tu perfil no solicita transferencias",403);
    const membership = source.members.find(
      (m) => m.space_id === id && Number(m.member_id) === Number(user.id),
    );
    if (
      user.role !== "owner" &&
      ((user.role === "viewer" && !user.request_payments) ||
        !membership ||
        membership.role === "observer")
    )
      fail("En este espacio tienes acceso de consulta", 403);
    if (!space.active) fail("Este espacio está archivado", 409);
  }
  return space;
}
export function requireRequest(db, user, id) {
  const source = workflowSource(db),
    request = source.requests.find((r) => r.id === Number(id));
  if (
    !request ||
    !canSeePaymentRequest(request, user, source.spaces, source.members)
  )
    fail("Solicitud no disponible para tu acceso", 404);
  return { ...request, ...paymentProgress(request, source.payments) };
}
export function validateRequestSpace(db, user, id, business, unit) {
  if (!id) return;
  const space = requireSpace(db, user, id, { write: true });
  if (!space.business_ids.includes(business))
    fail("El negocio no corresponde a este espacio");
  if (space.unit_id && unit && space.unit_id !== unit)
    fail("El local no corresponde al espacio");
}
export function queuePaymentNotice(db, id) {
  db.prepare(
    "INSERT OR IGNORE INTO finance_push_outbox (event_key,request_id) VALUES (?,?)",
  ).run(`payment-request:${id}`, id);
}
export function recordRequestPayment(db, user, id, body) {
  if (user.role !== "owner")
    fail("Solo el propietario registra las transferencias realizadas", 403);
  if (body.confirm_paid !== true)
    fail("Confirma que ya realizaste el pago en el banco");
  if (
    typeof body.request_key !== "string" ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(body.request_key)
  )
    fail("Reabre el registro de transferencia para preparar el envío");
  const payload = {
    id: Number(id),
    amount_cents: cents(body.amount_cents),
    evidence_id: Number(body.evidence_id),
    account_id: Number(body.account_id),
    paid_day: validDay(body.paid_day),
    reference: text(body.reference, 200),
    destination_index:
      body.destination_index === undefined || body.destination_index === null
        ? null
        : Number(body.destination_index),
  };
  if (
    payload.paid_day > financeDay() ||
    !payload.reference ||
    !payload.evidence_id ||
    !payload.account_id
  )
    fail("Completa cuenta de salida, fecha, referencia y comprobante");
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return db.transaction(() => {
    const previous = db
      .prepare(
        "SELECT * FROM finance_payments WHERE created_by=? AND request_key=?",
      )
      .get(user.username, body.request_key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        fail("Este envío ya se utilizó con otros datos", 409);
      return { payment: previous, duplicate: true };
    }
    const request = requireRequest(db, user, id);
    const beneficiaryRow = db
      .prepare(
        "SELECT encrypted FROM finance_request_payees WHERE request_id=?",
      )
      .get(request.id);
    if (beneficiaryRow) {
      const beneficiary = JSON.parse(
        decryptDocument(beneficiaryRow.encrypted).toString(),
      );
      if (
        beneficiary.kind!=='employee'&&(!Number.isInteger(payload.destination_index) ||
        !beneficiary.accounts[payload.destination_index])
      )
        fail("Elige la cuenta de destino que utilizaste");
      if(beneficiary.kind==='employee'&&payload.destination_index!==null)fail('El pago a empleados no tiene una cuenta de destino guardada');
    }
    if (!request.remaining_cents)
      fail("La solicitud ya no tiene un valor pendiente", 409);
    if (payload.amount_cents > request.remaining_cents)
      fail("El pago supera el saldo pendiente", 409);
    const evidence = db
      .prepare("SELECT * FROM finance_evidence WHERE id=?")
      .get(payload.evidence_id);
    if (!evidence || evidence.business_id !== request.business_id)
      fail("El comprobante no corresponde al negocio");
    if (
      db
        .prepare(
          "SELECT id FROM finance_payments WHERE evidence_id=? AND voided_at IS NULL",
        )
        .get(payload.evidence_id)
    )
      fail(
        "Ese comprobante ya respalda otro pago. Conserva un solo registro para evitar duplicados",
        409,
      );
    const account = db
      .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
      .get(payload.account_id);
    if (!account || !["bank", "wallet", "card"].includes(account.kind))
      fail(
        "Selecciona la cuenta bancaria, billetera o tarjeta desde la que pagaste",
      );
    const movement = createMovement(db, user, {
      business_id: request.business_id,
      unit_id: request.unit_id,
      allow_cross_account: true,
      kind: "expense",
      amount_cents: payload.amount_cents,
      day: payload.paid_day,
      category: request.category,
      counterparty: request.counterparty,
      description: `Pago de solicitud #${request.id}: ${request.description}`,
      reference: payload.reference,
      account_id: payload.account_id,
      payment_method: account.kind === "card" ? "card" : "transfer",
      evidence_id: payload.evidence_id,
    });
    db.prepare(
      "UPDATE finance_movements SET status='reported',space_id=? WHERE id=?",
    ).run(request.space_id, movement.id);
    const inserted = db
      .prepare(
        "INSERT INTO finance_payments (request_id,movement_id,amount_cents,evidence_id,account_id,paid_day,reference,created_by,request_key,fingerprint,destination_index) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        request.id,
        movement.id,
        payload.amount_cents,
        payload.evidence_id,
        payload.account_id,
        payload.paid_day,
        payload.reference,
        user.username,
        body.request_key,
        fingerprint,
        payload.destination_index,
      );
    const remaining = request.remaining_cents - payload.amount_cents;
    db.prepare(
      "UPDATE finance_movements SET status=?,updated_at=? WHERE id=?",
    ).run(
      remaining === 0 ? "reported" : request.status,
      new Date().toISOString(),
      request.id,
    );
    const payment = db
      .prepare("SELECT * FROM finance_payments WHERE id=?")
      .get(inserted.lastInsertRowid);
    audit(
      db,
      user.username,
      "payment.recorded",
      "payment",
      payment.id,
      null,
      {
        request_id: request.id,
        amount_cents: payment.amount_cents,
        remaining_cents: remaining,
        verification: "reported",
      },
      request.business_id,
    );
    settleIessProof(db, user, request, payment);
    return { payment, duplicate: false, remaining_cents: remaining };
  })();
}
export function voidRequestPayment(db, user, id, reason) {
  if (user.role !== "owner") fail("Esta acción requiere al propietario", 403);
  const note = text(reason, 1000);
  if (!note) fail("Indica el motivo de la corrección");
  return db.transaction(() => {
    const payment = db
      .prepare("SELECT * FROM finance_payments WHERE id=?")
      .get(id);
    if (!payment || payment.voided_at) fail("Pago no disponible", 409);
    const request = requireRequest(db, user, payment.request_id);
    if (
      db
        .prepare("SELECT id FROM finance_allocations WHERE movement_id=?")
        .get(payment.movement_id)
    )
      fail("Revierte primero la conciliación bancaria de este pago", 409);
    if (
      request.unit_id &&
      db
        .prepare("SELECT id FROM finance_closings WHERE unit_id=? AND day=?")
        .get(request.unit_id, payment.paid_day)
    )
      fail("Reabre el cierre de ese día antes de corregir este pago", 409);
    db.prepare(
      "UPDATE finance_payments SET voided_at=?,voided_by=?,void_reason=? WHERE id=?",
    ).run(new Date().toISOString(), user.username, note, payment.id);
    db.prepare(
      "UPDATE finance_movements SET status='rejected',review_note=?,updated_at=? WHERE id=?",
    ).run(note, new Date().toISOString(), payment.movement_id);
    if (request.status !== "rejected")
      db.prepare(
        "UPDATE finance_movements SET status='pending',updated_at=? WHERE id=?",
      ).run(new Date().toISOString(), request.id);
    audit(
      db,
      user.username,
      "payment.corrected",
      "payment",
      payment.id,
      payment,
      { reason: note },
      request.business_id,
    );
    return { ok: true };
  })();
}
