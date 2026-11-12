import {isLili} from '../../shared/finance-access.mjs';
import crypto from "node:crypto";
import {storeReceiptRoute} from '../../shared/finance-store-receipts.mjs';
import { nativePushConfiguration, validateNativeSubscription, sendFinancePush } from "./finance-native-push.js";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { fail } from "./finance-service.js";
import { paymentProgress } from "../../shared/finance-workflow.mjs";
export function pushConfiguration() {
  const publicKey = process.env.FINANCE_VAPID_PUBLIC_KEY,
    privateKey = process.env.FINANCE_VAPID_PRIVATE_KEY,
    subject = process.env.FINANCE_VAPID_SUBJECT;
  return {
    nativeEnabled: nativePushConfiguration().enabled,
    enabled: nativePushConfiguration().enabled || Boolean(
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
  if(value?.provider==="fcm") return validateNativeSubscription(value);
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
    send = sendFinancePush,
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
        "SELECT m.*,(SELECT COALESCE(holder_key,'owner') FROM finance_accounts WHERE id=m.account_id) account_holder FROM finance_movements m WHERE m.id=?"
      )
      .get(event.request_id);
    const receipt=event.event_key.startsWith('receipt-review:');
    const payments = request&&!receipt
      ? db
          .prepare("SELECT * FROM finance_payments WHERE request_id=?")
          .all(request.id)
      : [];
    const confirmed=receipt&&request&&db.prepare('SELECT 1 FROM finance_store_confirmations WHERE movement_id=?').get(request.id);
    if (!request || request.hidden_at || (receipt ? request.kind!=='income'||!request.evidence_id||!['pending','reported'].includes(request.status)||confirmed : !request.is_payment_request||!paymentProgress(request, payments).remaining_cents)) {
      db.prepare(
        "UPDATE finance_push_outbox SET state='skipped' WHERE id=?"
      ).run(event.id);
      continue;
    }
    const recipient=receipt?storeReceiptRoute(request):null;
    const subscriptions = db
      .prepare(
        "SELECT p.*,m.role member_role,m.username member_username FROM finance_push_subscriptions p JOIN finance_members m ON m.id=p.member_id WHERE m.active=1"
      )
      .all().filter(s=>receipt?(recipient?.role==='local-reviewer'?(recipient.name==='Liliana'?['lili','liliana'].includes(s.member_username):s.member_username==='morelia'):s.member_role==='owner'):(s.member_role==='owner'||(['norma','normita','morelia'].includes(request.created_by)&&s.member_username==='german')));
    if (!subscriptions.length) continue;
    let failed = false, delivered = 0;
    for (const subscription of subscriptions) {
      try {
        const value = validatePushSubscription(
          JSON.parse(decryptDocument(subscription.encrypted).toString("utf8"))
        );
        const informational=!receipt&&subscription.member_username==='german';
        await send(
          value,
          JSON.stringify({
            title: informational?"Solicitud de transferencia · informativo":receipt?"Depósito por confirmar":"Te pidieron una transferencia",
            body: informational?`$${(request.amount_cents/100).toFixed(2)} para ${request.counterparty}`:receipt?'Recibiste un comprobante de cliente. Toca para revisarlo.':'Toca para ver los datos y subir el comprobante del pago.',
            url: informational?"/finanzas/":receipt?"/finanzas/confirmaciones":"/finanzas/pagos",
            ...(informational?{}:receipt?{receipt_id:String(request.id)}:{request_id:String(request.id)}),
            tag: `${receipt?'gema-receipt':'gema-payment'}-${request.id}`,
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
            topic: `gema-${receipt?'receipt':'payment'}-${request.id}`,
          }
        );
        delivered++;
      } catch (error) {
        if (!db.open) return;
        if ([404, 410].includes(error.statusCode))
          db.prepare(
            "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=?"
          ).run(subscription.endpoint_hash);
        else { failed = true; console.warn("[finance] Push delivery retry", { status: Number(error.statusCode) || 0 }); }
      }
    }
    if (db.open)
      db.prepare(
        "UPDATE finance_push_outbox SET state=?,attempts=attempts+1,next_attempt=? WHERE id=?"
      ).run(
        !delivered && !failed ? "queued" : failed && event.attempts < 4 ? "queued" : failed ? "failed" : "sent",
        Date.now() + Math.min(3600000, 60000 * 2 ** event.attempts),
        event.id
      );
  }
}
export function registerPaymentPush(app, db, { route, owner, send = sendFinancePush }) {
  if (process.env.NODE_ENV !== "test") console.info("[finance] Push readiness", {
    configured: pushConfiguration().enabled,
    android_configured: nativePushConfiguration().enabled,
    devices: db.prepare("SELECT COUNT(*) n FROM finance_push_subscriptions").get().n,
    pending: db.prepare("SELECT COUNT(*) n FROM finance_push_outbox WHERE state='queued'").get().n,
    failed: db.prepare("SELECT COUNT(*) n FROM finance_push_outbox WHERE state='failed'").get().n,
  });
  const authorized = (req) => {
    if (req.financeUser.role !== "owner" && !req.financeUser.checks_manage && !isLili(req.financeUser)) fail("Tu perfil no recibe estos avisos", 403);
  };
  app.get(
    "/api/finance/push/config",
    route((req, res) => {
      authorized(req);
      const config = pushConfiguration();
      res.json({
        enabled: config.enabled,
        public_key: config.enabled ? config.publicKey : null,
        native_enabled: config.nativeEnabled,
        registered_devices: db.prepare("SELECT COUNT(*) n FROM finance_push_subscriptions WHERE member_id=?").get(req.financeUser.id).n,
      });
    })
  );
  app.post(
    "/api/finance/push/subscribe",
    route((req, res) => {
      authorized(req);
      if (!pushConfiguration().enabled)
        fail("Las alertas al celular están pendientes de configuración", 503);
      const value = validatePushSubscription(req.body.subscription),
        hash = crypto.createHash("sha256").update(value.endpoint).digest("hex");
      if(value.provider==="fcm" && !nativePushConfiguration().enabled) fail("Los avisos Android están pendientes de configurar",503);
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
      authorized(req);
      const endpoint = String(req.body.endpoint || "");
      const hash = crypto.createHash("sha256").update(endpoint).digest("hex");
      db.prepare(
        "DELETE FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?"
      ).run(hash, req.financeUser.id);
      res.json({ ok: true });
    })
  );
  app.post("/api/finance/push/status", route((req,res) => {
    authorized(req);
    const hash = crypto.createHash("sha256").update(String(req.body.endpoint || "")).digest("hex");
    const registered = Boolean(db.prepare("SELECT 1 FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?").get(hash, req.financeUser.id));
    const latest = db.prepare("SELECT id,created_at,accepted_at,displayed_at,status_code FROM finance_push_tests WHERE endpoint_hash=? AND member_id=? ORDER BY created_at DESC LIMIT 1").get(hash, req.financeUser.id) || null;
    res.json({ registered, latest_test: latest });
  }));
  app.post("/api/finance/push/test", route(async (req,res) => {
    authorized(req);
    const config = pushConfiguration();
    if (!config.enabled) fail("Los avisos están pendientes de configurar",503);
    const hash = crypto.createHash("sha256").update(String(req.body.endpoint || "")).digest("hex");
    const subscription = db.prepare("SELECT encrypted FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?").get(hash,req.financeUser.id);
    if (!subscription) fail("Activa los avisos en este dispositivo primero",409);
    if (db.prepare("SELECT 1 FROM finance_push_tests WHERE member_id=? AND created_at>?").get(req.financeUser.id,new Date(Date.now()-30000).toISOString())) fail("Espera treinta segundos antes de repetir la prueba",429);
    const id = crypto.randomUUID();
    db.prepare("DELETE FROM finance_push_tests WHERE created_at<?").run(new Date(Date.now()-7*86400000).toISOString());
    db.prepare("INSERT INTO finance_push_tests(id,member_id,endpoint_hash,created_at) VALUES (?,?,?,?)").run(id,req.financeUser.id,hash,new Date().toISOString());
    try {
      await send(validatePushSubscription(JSON.parse(decryptDocument(subscription.encrypted).toString())),JSON.stringify({ title:"Gema Finanzas · prueba de aviso",body:"Los avisos de este dispositivo están funcionando. Tus pendientes siguen en la app.",url:"/finanzas/pagos",tag:"gema-push-test",test_id:id }),{vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},TTL:120,timeout:8000,urgency:"high"});
      db.prepare("UPDATE finance_push_tests SET accepted_at=? WHERE id=?").run(new Date().toISOString(),id);
      res.json({id,accepted:true});
    } catch(error) {
      const code=Number(error.statusCode)||0;
      db.prepare("UPDATE finance_push_tests SET status_code=? WHERE id=?").run(code,id);
      if ([404,410].includes(code)) db.prepare("DELETE FROM finance_push_subscriptions WHERE endpoint_hash=? AND member_id=?").run(hash,req.financeUser.id);
      fail([404,410].includes(code) ? "La suscripción caducó. Vuelve a activar los avisos en este dispositivo" : "El proveedor no aceptó el aviso. Reintenta; tus pagos siguen en la bandeja",502);
    }
  }));
  app.post("/api/finance/push/receipt",route((req,res) => {
    db.prepare("UPDATE finance_push_tests SET displayed_at=COALESCE(displayed_at,?) WHERE id=? AND member_id=?").run(new Date().toISOString(),String(req.body.id||""),req.financeUser.id);
    res.json({ok:true});
  }));
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
