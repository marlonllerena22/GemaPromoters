import crypto from "node:crypto";
import { validDay, financeDay } from "./finance-db.js";
import { audit } from "./finance-db.js";
import { decryptDocument } from "./finance-ai.js";
import { fail, text } from "./finance-service.js";
import {
  listPayees,
  savePayee,
  createPayeeRequest,
  requestPayee,
} from "./finance-payees.js";
import {
  financialWorkflow,
  requireSpace,
  requireRequest,
  recordRequestPayment,
  voidRequestPayment,
  workflowSource,
} from "./finance-workflow.js";
export function assignSpaceMemberships(db, memberId, ids, role, businessIds) {
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    !["observer", "requester", "coordinator"].includes(role)
  )
    fail("Revisa los espacios asignados");
  for (const id of ids) {
    const space = db
      .prepare("SELECT business_ids FROM finance_spaces WHERE id=?")
      .get(id);
    if (
      !space ||
      !JSON.parse(space.business_ids).some((b) => businessIds.includes(b))
    )
      fail("Un espacio no corresponde a los negocios del usuario");
  }
  db.prepare("DELETE FROM finance_space_members WHERE member_id=?").run(
    memberId
  );
  const add = db.prepare(
    "INSERT INTO finance_space_members (space_id,member_id,role) VALUES (?,?,?)"
  );
  for (const id of new Set(ids)) add.run(id, memberId, role);
}
export function registerWorkflowRoutes(app, db, { route, owner }) {
  app.post(
    "/api/finance/settlement-funds/diners",
    route((req, res) => {
      owner(req);
      const b = req.body,
        as_of = validDay(b.as_of);
      if (
        as_of > financeDay() ||
        ![b.available_cents, b.pending_cents].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_000
        )
      )
        fail("Revisa los dos saldos y la fecha de actualización");
      const previous =
        db
          .prepare(
            "SELECT * FROM finance_settlement_balances WHERE provider='diners'"
          )
          .get() || null;
      db.transaction(() => {
        db.prepare(
          "INSERT INTO finance_settlement_balances (provider,business_id,available_cents,pending_cents,as_of,updated_by,updated_at) VALUES ('diners','marjorie',?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET available_cents=excluded.available_cents,pending_cents=excluded.pending_cents,as_of=excluded.as_of,updated_by=excluded.updated_by,updated_at=excluded.updated_at"
        ).run(
          b.available_cents,
          b.pending_cents,
          as_of,
          req.financeUser.username,
          new Date().toISOString()
        );
        audit(
          db,
          req.financeUser.username,
          "settlement.balance_updated",
          "settlement",
          "diners",
          previous,
          {
            available_cents: b.available_cents,
            pending_cents: b.pending_cents,
            as_of,
          },
          "marjorie"
        );
      })();
      res.json({ ok: true });
    })
  );
  app.get(
    "/api/finance/payees",
    route((req, res) =>
      res.json({
        contacts: listPayees(
          db,
          req.financeUser,
          req.query.business_id,
          req.query.space_id || null,
          req.query.kind || 'bank'
        ),
      })
    )
  );
  app.post(
    "/api/finance/payees",
    route((req, res) => {
      const result = savePayee(db, req.financeUser, req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    })
  );
  app.post(
    "/api/finance/payment-requests",
    route((req, res) => {
      const result = createPayeeRequest(db, req.financeUser, req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    })
  );
  app.get(
    "/api/finance/spaces",
    route((req, res) => res.json(financialWorkflow(db, req.financeUser)))
  );
  app.get(
    "/api/finance/spaces/:id",
    route((req, res) => {
      requireSpace(db, req.financeUser, req.params.id);
      const data = financialWorkflow(db, req.financeUser),
        space = data.spaces.find((s) => s.id === req.params.id);
      const requests = data.requests.filter((r) => r.space_id === space.id),
        ids = new Set(requests.map((r) => r.id));
      res.json({
        space,
        requests,
        payments: data.payments.filter((p) => ids.has(p.request_id)),
      });
    })
  );
  app.post(
    "/api/finance/spaces",
    route((req, res) => {
      owner(req);
      const b = req.body;
      if (
        !text(b.name) ||
        !Array.isArray(b.business_ids) ||
        !b.business_ids.length ||
        b.business_ids.some((id) => !req.financeUser.business_ids.includes(id))
      )
        fail("Completa el nombre y los negocios del espacio");
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO finance_spaces (id,name,kind,business_ids,description,share_label,created_by) VALUES (?,?,?,?,?,?,?)"
      ).run(
        id,
        text(b.name, 100),
        ["general", "materials", "event", "international", "misc"].includes(
          b.kind
        )
          ? b.kind
          : "general",
        JSON.stringify([...new Set(b.business_ids)]),
        text(b.description, 500),
        text(b.name, 100),
        req.financeUser.username
      );
      audit(db, req.financeUser.username, "space.created", "space", id, null, {
        name: b.name,
        business_ids: b.business_ids,
      });
      res.status(201).json({ id });
    })
  );
  app.post(
    "/api/finance/spaces/:id/settings",
    route((req, res) => {
      owner(req);
      const space = requireSpace(db, req.financeUser, req.params.id);
      const b = req.body;
      const shareType = b.share_type || space.share_type;
      if (!["group", "number", "manual"].includes(shareType))
        fail("Selecciona grupo, número o compartir manualmente");
      const phone =
        b.share_phone === undefined
          ? space.share_phone
          : String(b.share_phone).replace(/[^\d+]/g, "");
      if (shareType === "number" && !/^\+?[1-9]\d{6,14}$/.test(phone))
        fail("Escribe el número con código de país, por ejemplo +593");
      const name = b.name === undefined ? space.name : text(b.name, 100);
      if (!name) fail("Indica un nombre para el espacio");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_spaces SET name=?,description=?,share_type=?,share_label=?,share_phone=?,active=? WHERE id=?"
        ).run(
          name,
          b.description === undefined
            ? space.description
            : text(b.description, 500),
          shareType,
          b.share_label === undefined
            ? space.share_label
            : text(b.share_label, 100),
          phone,
          b.active === undefined ? space.active : b.active === true ? 1 : 0,
          space.id
        );
        if (b.members !== undefined) {
          if (!Array.isArray(b.members) || b.members.length > 100)
            fail("Revisa los participantes");
          const seen = new Set();
          for (const m of b.members) {
            const user = db
              .prepare(
                "SELECT business_ids FROM finance_members WHERE id=? AND active=1"
              )
              .get(m.member_id);
            if (
              seen.has(Number(m.member_id)) ||
              !user ||
              !JSON.parse(user.business_ids).some((id) =>
                space.business_ids.includes(id)
              ) ||
              !["observer", "requester", "coordinator"].includes(m.role)
            )
              fail("Un participante no corresponde al espacio");
            seen.add(Number(m.member_id));
          }
          db.prepare("DELETE FROM finance_space_members WHERE space_id=?").run(
            space.id
          );
          const add = db.prepare(
            "INSERT INTO finance_space_members (space_id,member_id,role) VALUES (?,?,?)"
          );
          for (const m of b.members) add.run(space.id, m.member_id, m.role);
        }
        audit(
          db,
          req.financeUser.username,
          "space.configured",
          "space",
          space.id,
          space,
          {
            name,
            share_type: shareType,
            share_label: b.share_label || "",
            members: b.members,
          }
        );
      })();
      res.json({ ok: true });
    })
  );
  app.get(
    "/api/finance/payment-requests/:id",
    route((req, res) => {
      const request = requireRequest(db, req.financeUser, req.params.id),
        source = workflowSource(db);
      const space = request.space_id
        ? source.spaces.find((s) => s.id === request.space_id)
        : null;
      const notes = db
        .prepare(
          "SELECT n.*,m.name actor_name FROM finance_space_notes n LEFT JOIN finance_members m ON m.username=n.actor WHERE request_id=? ORDER BY id"
        )
        .all(request.id);
      res.json({
        request,
        beneficiary: requestPayee(db, request.id),
        space,
        payments: financialWorkflow(db, req.financeUser).payments.filter(
          (p) => p.request_id === request.id
        ),
        notes,
      });
    })
  );
  app.post(
    "/api/finance/payment-requests/:id/notes",
    route((req, res) => {
      if (req.financeUser.role === "viewer")
        fail("Tu acceso es de consulta", 403);
      const request = requireRequest(db, req.financeUser, req.params.id),
        body = text(req.body.body, 1000);
      if (!body) fail("Escribe el mensaje");
      const inserted = db
        .prepare(
          "INSERT INTO finance_space_notes (request_id,actor,body) VALUES (?,?,?)"
        )
        .run(request.id, req.financeUser.username, body);
      audit(
        db,
        req.financeUser.username,
        "request.note_added",
        "request",
        request.id,
        null,
        { note_id: Number(inserted.lastInsertRowid) },
        request.business_id
      );
      res.status(201).json({ ok: true });
    })
  );
  app.post(
    "/api/finance/payment-requests/:id/payments",
    route((req, res) => {
      const result = recordRequestPayment(
        db,
        req.financeUser,
        req.params.id,
        req.body
      );
      res.status(result.duplicate ? 200 : 201).json(result);
    })
  );
  app.post(
    "/api/finance/payment-requests/:id/cancel",
    route((req, res) => {
      owner(req);
      const request = requireRequest(db, req.financeUser, req.params.id),
        reason = text(req.body.reason, 1000);
      if (!reason) fail("Indica por qué se anula esta solicitud");
      if (!request.remaining_cents)
        fail("La solicitud ya no tiene saldo pendiente", 409);
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_movements SET status='rejected',review_note=?,reviewed_by=?,updated_at=? WHERE id=?"
        ).run(
          reason,
          req.financeUser.username,
          new Date().toISOString(),
          request.id
        );
        audit(
          db,
          req.financeUser.username,
          "request.cancelled",
          "request",
          request.id,
          request,
          { reason },
          request.business_id
        );
      })();
      res.json({ ok: true });
    })
  );
  app.post(
    "/api/finance/payments/:id/void",
    route((req, res) =>
      res.json(
        voidRequestPayment(
          db,
          req.financeUser,
          Number(req.params.id),
          req.body.reason
        )
      )
    )
  );
  const document = (res, e) => {
    if (!e) fail("Comprobante no disponible", 404);
    res
      .set("Content-Security-Policy", "sandbox; default-src 'none'")
      .attachment(e.name)
      .type(e.mime)
      .send(decryptDocument(e.encrypted));
  };
  app.get(
    "/api/finance/payment-requests/:id/evidence",
    route((req, res) => {
      const r = requireRequest(db, req.financeUser, req.params.id);
      document(
        res,
        db
          .prepare("SELECT * FROM finance_evidence WHERE id=?")
          .get(r.evidence_id)
      );
    })
  );
  app.get(
    "/api/finance/payments/:id/evidence",
    route((req, res) => {
      const p = db
        .prepare("SELECT * FROM finance_payments WHERE id=?")
        .get(req.params.id);
      if (!p) fail("Pago no encontrado", 404);
      requireRequest(db, req.financeUser, p.request_id);
      document(
        res,
        db
          .prepare("SELECT * FROM finance_evidence WHERE id=?")
          .get(p.evidence_id)
      );
    })
  );
}
