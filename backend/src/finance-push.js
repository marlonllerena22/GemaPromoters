import crypto from "node:crypto";
import * as webpush from "web-push";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { fail } from "./finance-service.js";
import { paymentProgress } from "../../shared/finance-workflow.mjs";
export function pushConfiguration() {
  const publicKey = process.env.FINANCE_VAPID_PUBLIC_KEY,
    privateKey = process.env.FINANCE_VAPID_PRIVATE_KEY,
    subject = process.env.FINANCE_VAPID_SUBJECT;
  return {
    enabled: Boolean(
      publicKey &&
        privateKey &&
        subject &&
        process.env.FINANCE_DOCUMENT_KEY &&
        process.env.FINANCE_DEMO !== "1"
    ),
    publicKey,
    privateKey,
    subject,
  };
}
export function validatePushSubscription(value) {
  if (
    !value ||
    typeof value.endpoint !== "string" ||
    value.endpoint.length > 2000
  )
    fail("Suscripción no válida");
  let url;
  try {
    url = new URL(value.endpoint);
  } catch {
    fail("Destino de notificación inválido");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !(
      url.hostname === "fcm.googleapis.com" ||
      url.hostname === "web.push.apple.com" ||
      url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname.endsWith(".push.services.mozilla.com")
    )
  )
    fail("Este servicio de notificaciones no está permitido");
  if (
    !/^[A-Za-z0-9_-]{20,30}$/.test(value.keys?.auth || "") ||
    !/^[A-Za-z0-9_-]{80,100}$/.test(value.keys?.p256dh || "")
  )
    fail("Claves de notificación inválidas");
  return {
    endpoint: url.href,
    expirationTime: null,
    keys: { auth: value.keys.auth, p256dh: value.keys.p256dh },
  };
}
export async function flushPaymentPush(
  db,
  {
    send = webpush.sendNotification.bind(webpush),
    config = pushConfiguration(),
  } = {}
) {
  if (!config.enabled || !db.open) return;
  const events = db
    .prepare(
      "SELECT * FROM finance_push_outbox WHERE state='queued' AND next_attempt<=? ORDER BY id LIMIT 20"
    )
    .all(Date.now());
  for (const event of events) {
    if (!db.open) return;
    const request = db
      .prepare(
        "SELECT * FROM finance_movements WHERE id=? AND is_payment_request=1"
      )
      .get(event.request_id);
    const payments = request
      ? db
          .prepare("SELECT * FROM finance_payments WHERE request_id=?")
          .all(request.id)
      : [];
    if (!request || !paymentProgress(request, payments).remaining_cents) {
      db.prepare(
        "UPDATE finance_push_outbox SET state='skipped' WHERE id=?"
      ).run(event.id);
      continue;
    }
    const subscriptions = db
      .prepare(
        "SELECT p.* FROM finance_push_subscriptions p JOIN finance_members m ON m.id=p.member_id WHERE m.role='owner' AND m.active=1"
      )
      .all();
    if (!subscriptions.length) continue;
    let failed = false;
    for (const subscription of subscriptions) {
      try {
        const value = validatePushSubscription(
          JSON.parse(decryptDocument(subscription.encrypted).toString("utf8"))
        );
        await send(
          value,
          JSON.stringify({
            title: "Tienes una transferencia pendiente",
            body: "Abre Gema Finanzas para revisar la solicitud.",
            url: "/finanzas/pagos",
            tag: "gema-payment-requests",
          }),
          {
            vapidDetails: {
              subject: config.subject,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
            TTL: 86400,
            timeout: 8000,
            urgency: "normal",
            topic: "gema-payment-requests",
          }
        );
      } catch (error) {
        if (!db.open) return;
        if ([404, 410].includes(error.statusCode))
          db.prepare(
            "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=?"
          ).run(subscription.endpoint_hash);
        else failed = true;
      }
    }
    if (db.open)
      db.prepare(
        "UPDATE finance_push_outbox SET state=?,attempts=attempts+1,next_attempt=? WHERE id=?"
      ).run(
        failed && event.attempts < 4 ? "queued" : failed ? "failed" : "sent",
        Date.now() + Math.min(3600000, 60000 * 2 ** event.attempts),
        event.id
      );
  }
}
export function registerPaymentPush(app, db, { route, owner }) {
  app.get(
    "/api/finance/push/config",
    route((req, res) => {
      owner(req);
      const config = pushConfiguration();
      res.json({
        enabled: config.enabled,
        public_key: config.enabled ? config.publicKey : null,
      });
    })
  );
  app.post(
    "/api/finance/push/subscribe",
    route((req, res) => {
      owner(req);
      if (!pushConfiguration().enabled)
        fail("Las alertas al celular están pendientes de configuración", 503);
      const value = validatePushSubscription(req.body.subscription),
        hash = crypto.createHash("sha256").update(value.endpoint).digest("hex");
      if (
        db
          .prepare(
            "SELECT COUNT(*) n FROM finance_push_subscriptions WHERE member_id=?"
          )
          .get(req.financeUser.id).n >= 10 &&
        !db
          .prepare(
            "SELECT endpoint_hash FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?"
          )
          .get(hash, req.financeUser.id)
      )
        fail("Ya hay diez dispositivos registrados", 409);
      db.prepare(
        "INSERT INTO finance_push_subscriptions (endpoint_hash,member_id,encrypted) VALUES (?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET member_id=excluded.member_id,encrypted=excluded.encrypted"
      ).run(
        hash,
        req.financeUser.id,
        encryptDocument(Buffer.from(JSON.stringify(value)))
      );
      res.json({ ok: true });
    })
  );
  app.post(
    "/api/finance/push/unsubscribe",
    route((req, res) => {
      owner(req);
      const endpoint = String(req.body.endpoint || "");
      const hash = crypto.createHash("sha256").update(endpoint).digest("hex");
      db.prepare(
        "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?"
      ).run(hash, req.financeUser.id);
      res.json({ ok: true });
    })
  );
  if (pushConfiguration().enabled && process.env.NODE_ENV !== "test") {
    let running = false;
    const tick = async () => {
      if (running || !db.open) return;
      running = true;
      try {
        await flushPaymentPush(db);
      } catch {
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      if (!db.open) {
        clearInterval(timer);
        return;
      }
      void tick();
    }, 30000);
    timer.unref();
    void tick();
  }
}
