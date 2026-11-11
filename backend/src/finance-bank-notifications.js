import crypto from "node:crypto";
import { audit, financeDay } from "./finance-db.js";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { privateSetting } from "./finance-operations.js";
import { fail, importBank, reconcile } from "./finance-service.js";
import {linkRecordedBankEvidence} from './finance-evidence-links.js';
import {reconcileRecordedReceipt} from './finance-receipts.js';
import {matchingBankPerson,receivedWithoutAccount} from './finance-bank-identity.js';

const digest = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");
const norm = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export const notificationBanks = [
  "Pichincha",
  "Guayaquil",
  "Pacífico",
  "Produbanco",
  "Solidario",
  "Deuna",
];
export const sensitiveNotification = (v) =>
  /\botp\b|clave|contrase[nñ]a|c[oó]digo|verifica(?:ci[oó]n|r) (?:tu |de |el )?(?:acceso|identidad|inicio)|inici[oó] (?:de )?sesi[oó]n/i.test(
    v
  );
export function initBankNotifications(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS finance_notification_devices(
    id TEXT PRIMARY KEY,client_id TEXT NOT NULL,member_id INTEGER NOT NULL REFERENCES finance_members(id),
    session_hash TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,apps_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,last_seen TEXT,
    UNIQUE(member_id,client_id));
    CREATE TABLE IF NOT EXISTS finance_notification_events(
    id INTEGER PRIMARY KEY,device_id TEXT NOT NULL REFERENCES finance_notification_devices(id),event_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,package_name TEXT NOT NULL,bank TEXT NOT NULL,posted_at TEXT NOT NULL,
    encrypted BLOB NOT NULL,state TEXT NOT NULL DEFAULT 'review',reason TEXT NOT NULL DEFAULT '',
    account_id INTEGER REFERENCES finance_accounts(id),amount_cents INTEGER,reference TEXT NOT NULL DEFAULT '',
    bank_transaction_id INTEGER REFERENCES finance_bank_transactions(id),created_at TEXT NOT NULL,
    UNIQUE(device_id,event_key));
    CREATE INDEX IF NOT EXISTS finance_notifications_bank ON finance_notification_events(bank_transaction_id);
    CREATE TABLE IF NOT EXISTS finance_notification_device_health(device_id TEXT PRIMARY KEY REFERENCES finance_notification_devices(id),observed_at TEXT NOT NULL,status_json TEXT NOT NULL);
  `);
  if(!db.prepare('PRAGMA table_info(finance_notification_events)').all().some(c=>c.name==='archived_at'))db.exec('ALTER TABLE finance_notification_events ADD COLUMN archived_at TEXT');
}
const bankCode = (v) => norm(v).replace(/banco|del|de|[^a-z]/g, "");
function usableAccount(db, id, bank) {
  const a = db
    .prepare(
      "SELECT * FROM finance_accounts WHERE id=? AND active=1 AND kind='bank'"
    )
    .get(id);
  if (!a || bankCode(a.bank) !== bankCode(bank))
    fail("Elige una cuenta bancaria de esa entidad");
  return a;
}
export function parseBankNotification(
  event,
  policy,
  registry = { accounts: [] }
) {
  const body = `${event.title || ""}\n${event.text || ""}`.slice(0, 6000),
    plain = norm(body);
  if (sensitiveNotification(body)) return null;
  const currencyMatches=[...body.matchAll(/(?:US\$|USD|\$)\s*([\d.,]+)/gi)];
  const phraseMatches=[...plain.matchAll(/(?:\brecibiste|\bhas recibido|\bacabas de recibir|\bte (?:han? )?(?:pagaron|pago|pagado|enviaron|envio|enviado|depositaron|deposito|depositado|transfirieron|transfirio|transferido|acreditaron|acredito|acreditado)|\bpagaste|\benviaste|\btransferiste|\bconsumiste|\btu (?:pago|transferencia) (?:de|por)|\bpago por|\b(?:abono|deposito) recibido|\bse (?:ha )?(?:acredito|debito)|\bmonto\s*:?|\bvalor\s*:?)\s*(?:una? (?:pago|deposito|abono|transferencia)\s*)?(?:(?:por|de|valor de|un monto de)\s*)?(?:usd\s*|\$\s*)?([\d.,]+)/g)];
  const amountMatches=[...currencyMatches,...phraseMatches];
  let amounts = amountMatches.map(
    (m) => {
      let v = m[1].replace(/[.,]+$/, "");
      if (/^\d{1,3}(?:[,.]\d{3})+$/.test(v)) v = v.replace(/[,.]/g, "");
      if (v.includes(",") && v.includes("."))
        v =
          v.lastIndexOf(",") > v.lastIndexOf(".")
            ? v.replace(/\./g, "").replace(",", ".")
            : v.replace(/,/g, "");
      else v = v.replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) &&
        n > 0 &&
        Number.isSafeInteger(Math.round(n * 100))
        ? Math.round(n * 100)
        : null;
    }
  );
  amounts=[...new Set(amounts)];
  const incoming =
    /\brecibiste\b|\bhas recibido\b|\bacabas de recibir\b|transferencia recibida|deposito recibido|abono recibido|\bte (?:ha[n]? )?(?:envi(?:o|ado|aron)|pag(?:o|ado|aron)|deposit(?:o|ado|aron)|transfiri(?:o|eron)|transferido|acreditaron)\b|se (?:ha )?acredit(?:ado|o)/.test(
      plain
    );
  const outgoing =
    /\bpagaste\b|\benviaste\b|\btransferiste\b|\bconsumiste\b|realizaste (?:un|una) (?:pago|transferencia|compra)|transferencia exitosa|transferencia enviada|pago realizado|pago exitoso|compra (?:realizada|exitosa)|consumo (?:con|de|realizado)|se (?:ha )?debit(?:ado|o)/.test(
      plain
    );
  const blocked =
    /pendiente|en proceso|por confirmar|solicitud|rechazad|fallid|insuficiente|no se pudo|no fue exitosa|no exitoso|no se (?:realizo|proceso|envio)|anulad|cancelad|revertid|autorizacion|ser[aá] (?:debitad|acreditad)|intento|recordatorio/.test(
      plain
    );
  const credit =
    /tarjeta (?:de )?credito|cupo disponible|pago minimo|estado de cuenta/.test(
      plain
    );
  const destinationText=body.match(/(?:a la cuenta|cuenta (?:de )?destino)\s*[:#]?\s*([*xX\d-]{3,30})/i)?.[1]||'';
  const destinationSuffix=destinationText.match(/\d{3,}$/)?.[0]||'';
  const accountText = outgoing&&destinationText
    ?body.match(/cuenta (?:de )?origen\s*[:#]?\s*([*xX\d-]{3,30})/i)?.[1]||''
    :
    body.match(
      /cuenta(?: (?:de )?(?:origen|destino|acreditada|debito|ahorros|corriente))?\s*[:#·]?\s*([*xX\d-]{3,30})/i
    )?.[1] || "";
  const suffix = accountText.match(/\d{3,}$/)?.[0] || "";
  const matches = (registry.accounts || []).filter(
    (a) =>
      bankCode(a.bank) === bankCode(policy.bank) &&
      suffix &&
      String(a.number || a.suffix || "").endsWith(suffix)
  );
  const mapped = suffix
    ? matches.length === 1
      ? matches[0].account_id
      : null
    : policy.account_id || null;
  const conflict = suffix && policy.account_id && mapped !== policy.account_id;
  let reference =
    body.match(
      /(?:referencia|comprobante|transacci[oó]n|operaci[oó]n)\s*(?:n[º°o.]?\s*)?[:#]?\s*([A-Z0-9-]{5,60})\b/i
    )?.[1] || "";
  if (!/\d/.test(reference)) reference = "";
  const direction =
    incoming !== outgoing ? (incoming ? "incoming" : "outgoing") : null;
  const counterparty=(body.match(/(?:recibiste|has recibido|transferencia recibida|te pagaron|te depositaron|te transfirieron)[\s\S]*?(?:\bde\s+)([\p{L}][\p{L}\s.'-]+?)(?=\s+(?:cuenta|referencia|banco|saldo|fecha|por|el)\b|[.\n]|$)/iu)?.[1]||body.match(/(?:^|[\n!.])\s*([\p{L}][\p{L}\s.'-]+?)\s+te (?:ha[n]? )?(?:envi[oó]|enviado|pag[oó]|pagado|deposit[oó]|depositado|transfiri[oó]|transferido)\s*[\d.,]+/iu)?.[1]||'').trim();
  return {
    parser_version:3,
    body,
    bank: policy.bank,
    amount_cents: amounts.length === 1 ? amounts[0] : null,
    direction,
    counterparty,
    destination_suffix:destinationSuffix,
    reference,
    account_id: conflict ? null : mapped,
    suffix,
    blocked,
    credit,
    certain: !!(
      amounts.length === 1 &&
      amounts[0] &&
      direction &&
      !blocked &&
      !credit &&
      mapped &&
      !conflict &&
      reference
    ),
    reason: blocked
      ? "El aviso no confirma una operación completada"
      : credit
      ? "Revisa el consumo en la tarjeta de crédito"
      : !direction
      ? "Falta identificar si entra o sale dinero"
      : amounts.length !== 1
      ? "El importe necesita revisión"
      : conflict
      ? "La cuenta visible no coincide con la configurada"
      : !mapped
      ? "Falta identificar la cuenta"
      : !reference
      ? "Sin referencia: comprobar posibles duplicados"
      : "Listo para revisar",
  };
}
function decode(row) {
  return JSON.parse(decryptDocument(row.encrypted).toString());
}
function notificationReceipt(db,row,p) {
  if(p.blocked||p.credit||p.direction!=='incoming'||!p.amount_cents)return null;
  const candidates=db.prepare(`SELECT m.*,a.bank account_bank FROM finance_movements m JOIN finance_accounts a ON a.id=m.account_id WHERE m.kind='income' AND m.is_payment_request=0
    AND (? IS NULL OR m.account_id=?) AND m.amount_cents=? AND m.day=? AND m.evidence_id IS NOT NULL
    AND m.hidden_at IS NULL AND m.status IN ('pending','reported','approved')`).all(row.account_id,row.account_id,p.amount_cents,financeDay(row.posted_at)).filter(m=>bankCode(m.account_bank)===bankCode(row.bank));
  const matches=candidates.filter(m=>{
    if(p.reference&&m.reference)return p.reference===m.reference;
    return matchingBankPerson(p.counterparty,m.counterparty);
  });
  return matches.length===1?matches[0]:null;
}
export function autoConfirmNotificationReceipts(db) {
  if(privateSetting(db,'receipt_auto_confirm_from_notification')!==true)return 0;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'").get())return 0;
  let confirmed=0;
  for(const row of db.prepare("SELECT * FROM finance_notification_events WHERE state='review' AND archived_at IS NULL ORDER BY id").all()){
    const receipt=notificationReceipt(db,row,decode(row));
    if(!receipt)continue;
    try {
      applyBankNotification(db,{role:'owner',username:'system:bank-evidence'},row.id,{matched_receipt_id:receipt.id});
      confirmed++;
    }catch(error){if(!error.status)throw error;}
  }
  return confirmed;
}
export function reprocessBankNotifications(db){
  const registry=privateSetting(db,'own_account_registry')||{accounts:[]};
  let upgraded=0;
  for(const row of db.prepare("SELECT * FROM finance_notification_events WHERE state='review' AND archived_at IS NULL").all()){
    const prior=decode(row);if(prior.parser_version===3)continue;
    const device=db.prepare('SELECT apps_json FROM finance_notification_devices WHERE id=?').get(row.device_id);
    const policy=device&&JSON.parse(device.apps_json).find(a=>a.package_name===row.package_name);
    if(!policy)continue;
    const parsed=parseBankNotification({text:prior.body},policy,registry);if(!parsed)continue;
    db.prepare('UPDATE finance_notification_events SET encrypted=?,account_id=?,amount_cents=?,reference=?,reason=? WHERE id=?').run(encryptDocument(Buffer.from(JSON.stringify(parsed))),parsed.account_id,parsed.amount_cents?parsed.amount_cents*(parsed.direction==='outgoing'?-1:1):null,parsed.reference,parsed.reason,row.id);
    upgraded++;
  }
  const links=linkRecordedBankEvidence(db),confirmed=autoConfirmNotificationReceipts(db);
  if(upgraded||links.notifications||confirmed)console.info('[finance] Phone notices automatically matched '+JSON.stringify({upgraded,linked:links.notifications,confirmed}));
  return {upgraded,linked:links.notifications,confirmed};
}
export function applyBankNotification(db, user, id, body = {}) {
  if (user.role !== "owner")
    fail("Solo Marlon revisa los avisos bancarios", 403);
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM finance_notification_events WHERE id=?")
      .get(id);
    if (!row) fail("Aviso no encontrado", 404);
    if (["applied", "matched"].includes(row.state))
      return { ok: true, duplicate: true };
    if (row.state !== "review") fail("Este aviso ya fue descartado", 409);
    const p = decode(row);
    if (p.blocked || p.credit)
      fail("Este aviso no confirma un débito o abono bancario aplicable");
    const receipt=body.matched_receipt_id?notificationReceipt(db,row,p):null;
    if(body.matched_receipt_id&&receipt?.id!==Number(body.matched_receipt_id))fail('La notificación y el comprobante no identifican una transferencia única',409);
    const reference=p.reference||receipt?.reference||'';
    const account = usableAccount(
      db,
      Number(body.account_id || row.account_id || receipt?.account_id),
      row.bank
    );
    const amount = body.amount_cents ?? p.amount_cents,
      direction = body.direction || p.direction;
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !["incoming", "outgoing"].includes(direction)
    )
      fail("Indica importe y dirección");
    if (p.amount_cents && p.amount_cents !== amount)
      fail("El valor no coincide con el aviso");
    if (p.direction && p.direction !== direction)
      fail("La dirección no coincide con el aviso");
    const signed = amount * (direction === "outgoing" ? -1 : 1),
      day = financeDay(row.posted_at);
    const cutoff = account.opening_at || privateSetting(db, "opening_cutoff");
    if (cutoff && Date.parse(row.posted_at) <= Date.parse(cutoff))
      fail("El aviso es anterior al saldo inicial; no se sumará otra vez", 409);
    const candidates = db
      .prepare(
        "SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND (day=? OR (?!='' AND reference=?)) ORDER BY id DESC"
      )
      .all(account.id, signed, day, reference, reference);
    let bank = null;
    if (body.link_bank_id) {
      bank = candidates.find((r) => r.id === Number(body.link_bank_id));
      if (!bank)
        fail("El movimiento elegido no coincide con cuenta, fecha y valor");
    } else {
      const exact = candidates.filter(
        (r) => reference && r.reference === reference
      );
      if (exact.length > 1)
        fail("Hay varias coincidencias con esa referencia", 409);
      if (exact.length === 1) bank = exact[0];
      else if (candidates.length && body.new_operation !== true)
        fail(
          "Hay movimientos con igual valor y fecha. Selecciona el correspondiente o confirma que es otra operación distinta",
          409
        );
    }
    if (!bank) {
      const result = importBank(db, user, {
        account_id: account.id,
        source_system: "bank-notification",
        rows: [
          {
            day,
            occurred_at: row.posted_at,
            amount_cents: signed,
            reference,
            description: "Aviso Android de " + row.bank,
            external_id: "android:" + row.device_id + ":" + row.event_key,
          },
        ],
      });
      bank = { id: result.transaction_ids[0] };
    }
    const matched =
      !!body.link_bank_id || candidates.some((r) => r.id === bank.id);
    db.prepare(
      "UPDATE finance_notification_events SET state=?,account_id=?,amount_cents=?,bank_transaction_id=?,reason=?,reference=? WHERE id=?"
    ).run(
      matched ? "matched" : "applied",
      account.id,
      signed,
      bank.id,
      matched ? "Relacionado sin sumar de nuevo" : "Registrado en la cuenta",
      reference,
      row.id
    );
    audit(
      db,
      user.username,
      "android.bank_notice_applied",
      "notification",
      id,
      null,
      { account_id: account.id, bank_transaction_id: bank.id, matched },
      account.business_id
    );
    if(receipt&&!reference){
      reconcile(db,{role:'owner',username:'system:bank-evidence',business_ids:['producalza','marjorie','gemashow','personal'],unit_ids:[]},{movement_id:receipt.id,bank_transaction_id:bank.id,amount_cents:receipt.amount_cents});
      if(receipt.business_id==='marjorie')db.prepare("INSERT OR IGNORE INTO finance_store_confirmations(movement_id,actor,confirmed_at,mode) VALUES (?,'system:bank-evidence',?,'bank_verified')").run(receipt.id,new Date().toISOString());
      db.prepare("UPDATE finance_push_outbox SET state='skipped' WHERE request_id=? AND state='queued'").run(receipt.id);
    }else for(const receipt of db.prepare("SELECT id FROM finance_movements WHERE account_id=? AND reference=? AND kind='income' AND evidence_id IS NOT NULL AND hidden_at IS NULL AND status IN ('pending','reported','approved')").all(account.id,reference))reconcileRecordedReceipt(db,receipt.id);
    return { ok: true, matched, bank_transaction_id: bank.id };
  })();
}
export function ingestBankNotifications(db, device, events) {
  if (!Array.isArray(events) || !events.length || events.length > 50)
    fail("Envía entre 1 y 50 avisos");
  const policies = JSON.parse(device.apps_json),
    ack = [];
  const registry = privateSetting(db, "own_account_registry") || {
    accounts: [],
  };
  for (const e of events) {
    if (typeof e.id !== "string" || !/^[-a-zA-Z0-9_:]{1,160}$/.test(e.id))
      fail("Identificador de aviso inválido");
    const policy = policies.find((p) => p.package_name === e.package_name);
    const at = Date.parse(e.posted_at),
      raw = `${e.title || ""}\n${e.text || ""}`;
    const restart=privateSetting(db,'activity_restart_at');
    if(restart&&Number.isFinite(at)&&at<=Date.parse(restart)){ack.push(e.id);continue;}
    if (
      !policy ||
      !Number.isFinite(at) ||
      at < Date.parse(device.created_at) ||
      at < Date.now() - 7 * 86400000 ||
      at > Date.now() + 120000 ||
      raw.length > 6000 ||
      sensitiveNotification(raw)
    ) {
      ack.push(e.id);
      continue;
    }
    db.transaction(() => {
      const prior = db
        .prepare(
          "SELECT id,content_hash FROM finance_notification_events WHERE device_id=? AND event_key=?"
        )
        .get(device.id, e.id);
      const contentHash = digest(raw);
      // Updates to a notification may not turn an earlier alert into a second debit.
      if (prior) {
        ack.push(e.id);
        return;
      }
      const parsed = parseBankNotification(e, policy, registry);
      if (!parsed) {
        ack.push(e.id);
        return;
      }
      const inserted = db
        .prepare(
          "INSERT INTO finance_notification_events(device_id,event_key,content_hash,package_name,bank,posted_at,encrypted,reason,account_id,amount_cents,reference,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
        )
        .run(
          device.id,
          e.id,
          contentHash,
          e.package_name,
          policy.bank,
          new Date(at).toISOString(),
          encryptDocument(Buffer.from(JSON.stringify(parsed))),
          parsed.reason,
          parsed.account_id,
          parsed.amount_cents
            ? parsed.amount_cents * (parsed.direction === "outgoing" ? -1 : 1)
            : null,
          parsed.reference,
          new Date().toISOString()
        );
      linkRecordedBankEvidence(db);
      autoConfirmNotificationReceipts(db);
      if (policy.automatic && parsed.certain && db.prepare('SELECT state FROM finance_notification_events WHERE id=?').get(inserted.lastInsertRowid).state==='review') {
        try {
          applyBankNotification(
            db,
            { role: "owner", username: "system:android-bank" },
            Number(inserted.lastInsertRowid)
          );
        } catch (err) {
          if (!err.status) throw err;
          db.prepare(
            "UPDATE finance_notification_events SET reason=? WHERE id=?"
          ).run(err.message, inserted.lastInsertRowid);
        }
      }
      ack.push(e.id);
    })();
  }
  db.prepare(
    "UPDATE finance_notification_devices SET last_seen=? WHERE id=?"
  ).run(new Date().toISOString(), device.id);
  return { ok: true, ack };
}
export function registerNotificationPublic(app, db, { route,requestMailCorroboration }) {
  initBankNotifications(db);
  const attempts = new Map();
  // This bearer can only submit events. It cannot read accounts, emails, or balances.
  app.post(
    "/api/finance/android-bank-events",
    route((req, res) => {
      const token = req.get("x-gema-bank-device") || "";
      if (!/^[a-f0-9]{64}$/.test(token))
        fail("Vuelve a conectar el celular desde tu usuario", 401);
      const device = db
        .prepare(
          `SELECT d.* FROM finance_notification_devices d JOIN finance_members m ON m.id=d.member_id
      JOIN finance_sessions s ON s.token_hash=d.session_hash AND s.member_id=d.member_id
      WHERE d.token_hash=? AND d.revoked=0 AND d.expires_at>? AND s.expires_at>? AND m.active=1 AND m.role='owner'`
        )
        .get(digest(token), Date.now(), Date.now());
      if (!device) fail("Vuelve a conectar el celular desde tu usuario", 401);
      const bucket = Math.floor(Date.now() / 60000),
        key = device.id + ":" + bucket;
      if (attempts.size > 200) attempts.clear();
      const n = (attempts.get(key) || 0) + 1;
      attempts.set(key, n);
      if (n > 60) fail("Demasiados avisos; se reintentará", 429);
      const result=ingestBankNotifications(db, device, req.body.events);
      requestMailCorroboration?.();
      res
        .set("Cache-Control", "no-store")
        .json(result);
    })
  );
}
export function registerNotificationRoutes(
  app,
  db,
  { route, owner, sessionToken,requestMailCorroboration }
) {
  queueMicrotask(()=>{try{reprocessBankNotifications(db);}catch(error){console.error('[finance] Phone notice replay needs attention: '+(error.status?error.message:error.code||error.name));}});
  app.get(
    "/api/finance/bank-notifications",
    route((req, res) => {
      owner(req);
      requestMailCorroboration?.();
      const mailConnected=Boolean(db.prepare("SELECT 1 FROM finance_mail_oauth WHERE id='gmail'").get());
      const events = db
        .prepare(
          "SELECT * FROM finance_notification_events WHERE archived_at IS NULL ORDER BY id DESC LIMIT 100"
        )
        .all()
        .map((r) => {
          const p = decode(r);
          return {
            id: r.id,
            bank: r.bank,
            posted_at: r.posted_at,
            state: r.state,
            account_pending:receivedWithoutAccount(r,p),
            awaiting_mail:r.state==='review'&&!p.blocked&&!p.credit&&p.direction&&p.amount_cents&&!r.account_id&&mailConnected&&Date.now()-Date.parse(r.created_at)<180000,
            reason: r.reason,
            account_id: r.account_id,
            amount_cents: Math.abs(r.amount_cents || 0) || null,
            reference: r.reference,
            direction: p.direction,
            text: p.body,
            blocked: p.blocked || p.credit,
            bank_transaction_id: r.bank_transaction_id,
          };
        });
      const devices = db
        .prepare(
          "SELECT id,client_id,apps_json,last_seen,expires_at,revoked FROM finance_notification_devices WHERE member_id=? ORDER BY created_at DESC"
        )
        .all(req.financeUser.id)
        .map(({ apps_json, ...d }) => ({ ...d, apps: JSON.parse(apps_json),health:JSON.parse(db.prepare('SELECT status_json FROM finance_notification_device_health WHERE device_id=?').get(d.id)?.status_json||'null') }));
      res
        .set("Cache-Control", "no-store")
        .json({ events, devices, banks: notificationBanks,reader_release:{version:'1.1.1',reader_version:2,url:'/finanzas/downloads/gema-finanzas-1.1.1.apk'} });
    })
  );
  app.post('/api/finance/bank-notification-devices/:id/health',route((req,res)=>{
    owner(req);
    const device=db.prepare('SELECT id FROM finance_notification_devices WHERE id=? AND member_id=? AND revoked=0').get(req.params.id,req.financeUser.id);
    if(!device)fail('Celular no disponible para este usuario',404);
    const b=req.body;
    const timestamp=value=>Number.isSafeInteger(value)&&value>0&&value<=Date.now()+120000?value:null;
    const error=['','app_changed','queue_full','capture_error','upload_pending','reconnect','listener_reconnect'].includes(b.error)?b.error:'reader_error';
    const health={reader_version:b.reader_version===2?2:1,permission:b.permission===true,enabled:b.enabled===true,paired:b.paired===true,listener_connected:typeof b.listener_connected==='boolean'?b.listener_connected:null,queued:Number.isInteger(b.queued)&&b.queued>=0&&b.queued<=500?b.queued:null,last_capture:timestamp(b.last_capture),last_upload:timestamp(b.last_upload),error,reported_at:new Date().toISOString()};
    const old=JSON.parse(db.prepare('SELECT status_json FROM finance_notification_device_health WHERE device_id=?').get(device.id)?.status_json||'null');
    db.prepare('INSERT INTO finance_notification_device_health VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET observed_at=excluded.observed_at,status_json=excluded.status_json').run(device.id,health.reported_at,JSON.stringify(health));
    if(!old||['reader_version','permission','enabled','paired','listener_connected','queued','last_capture','last_upload','error'].some(k=>old[k]!==health[k]))console.info('[finance] Android bank reader health '+JSON.stringify(health));
    res.json({ok:true});
  }));
  app.post(
    "/api/finance/bank-notification-devices",
    route((req, res) => {
      owner(req);
      const body = req.body;
      if (
        !/^[a-f0-9-]{36}$/.test(body.client_id || "") ||
        !Array.isArray(body.apps) ||
        body.apps.length < 1 ||
        body.apps.length > 12
      )
        fail("Selecciona las apps bancarias de este celular");
      const apps = body.apps.map((p) => {
        if (
          !/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(p.package_name || "") ||
          p.package_name.length > 200 ||
          !notificationBanks.includes(p.bank)
        )
          fail("App o banco inválido");
        if (p.account_id) usableAccount(db, Number(p.account_id), p.bank);
        return {
          package_name: p.package_name,
          bank: p.bank,
          account_id: p.account_id ? Number(p.account_id) : null,
          automatic: p.automatic === true,
        };
      });
      if (new Set(apps.map((p) => p.package_name)).size !== apps.length)
        fail("No repitas apps");
      const session_hash = digest(sessionToken(req));
      const session = db
        .prepare("SELECT expires_at FROM finance_sessions WHERE token_hash=?")
        .get(session_hash);
      const token = crypto.randomBytes(32).toString("hex"),
        id = crypto.randomUUID(),
        now = new Date().toISOString();
      db.prepare(
        `INSERT INTO finance_notification_devices(id,client_id,member_id,session_hash,token_hash,apps_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(member_id,client_id) DO UPDATE SET session_hash=excluded.session_hash,token_hash=excluded.token_hash,apps_json=excluded.apps_json,expires_at=excluded.expires_at,revoked=0`
      ).run(
        id,
        body.client_id,
        req.financeUser.id,
        session_hash,
        digest(token),
        JSON.stringify(apps),
        now,
        session.expires_at
      );
      const device = db
        .prepare(
          "SELECT id,created_at FROM finance_notification_devices WHERE member_id=? AND client_id=?"
        )
        .get(req.financeUser.id, body.client_id);
      audit(
        db,
        req.financeUser.username,
        "android.bank_device_connected",
        "notification_device",
        device.id,
        null,
        { apps: apps.map((p) => ({ bank: p.bank, automatic: p.automatic })) }
      );
      res.set("Cache-Control", "no-store").json({
        device_id: device.id,
        token,
        started_at: device.created_at,
        apps,
        expires_at: session.expires_at,
      });
    })
  );
  app.post(
    "/api/finance/bank-notification-devices/:id/revoke",
    route((req, res) => {
      owner(req);
      db.prepare(
        "UPDATE finance_notification_devices SET revoked=1 WHERE id=? AND member_id=?"
      ).run(req.params.id, req.financeUser.id);
      audit(
        db,
        req.financeUser.username,
        "android.bank_device_revoked",
        "notification_device",
        req.params.id
      );
      res.json({ ok: true });
    })
  );
  app.post(
    "/api/finance/bank-notifications/:id/apply",
    route((req, res) => {
      owner(req);
      res.json(
        applyBankNotification(
          db,
          req.financeUser,
          Number(req.params.id),
          req.body
        )
      );
    })
  );
  app.post(
    "/api/finance/bank-notifications/:id/dismiss",
    route((req, res) => {
      owner(req);
      db.prepare(
        "UPDATE finance_notification_events SET state='dismissed',reason='Descartado por el propietario' WHERE id=? AND state='review'"
      ).run(Number(req.params.id));
      audit(
        db,
        req.financeUser.username,
        "android.bank_notice_dismissed",
        "notification",
        req.params.id
      );
      res.json({ ok: true });
    })
  );
}
