import crypto from "node:crypto";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { audit, financeDay } from "./finance-db.js";
import {
  fail,
  importBank,
  createMovement,
  reconcile,
} from "./finance-service.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";
const ROOTS = [
  "pichincha.com",
  "pichinchamiles.com",
  "produbanco.com",
  "produbanco.com.ec",
  "bancoguayaquil.com",
  "bancodelpacifico.com",
  "solidario.fin.ec",
  "banco-solidario.com",
  "deuna.app",
  "deuna.com",
];
export const MAIL_QUERY =
  "-in:spam -in:trash {from:pichincha.com from:produbanco.com from:produbanco.com.ec from:bancoguayaquil.com from:bancodelpacifico.com from:solidario.fin.ec from:deuna.app}";
const headers = (m) => m.payload?.headers || [];
const head = (m, n) =>
  headers(m).find((h) => h.name.toLowerCase() === n)?.value || "";
export function mailText(payload) {
  let result = "";
  if (payload?.body?.content) result = payload.body.content;
  else if (payload?.body?.data || payload?.body?.base64_url_content)
    result = Buffer.from(
      payload.body.data || payload.body.base64_url_content,
      "base64url",
    ).toString();
  if (payload?.mimeType === "text/html" || payload?.mime_type === "text/html")
    result = result
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  return [
    result,
    ...(payload?.parts || []).filter((p) => !p.filename).map(mailText),
  ]
    .join(" ")
    .replace(/&nbsp;|&#160;|&#xa0;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
}
const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function dollars(s) {
  if (!s) return null;
  let v = s.replace(/[^\d.,-]/g, "");
  if (v.includes(",") && v.includes(".")) {
    v =
      v.lastIndexOf(",") > v.lastIndexOf(".")
        ? v.replace(/\./g, "").replace(",", ".")
        : v.replace(/,/g, "");
  } else if (v.includes(",")) v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) &&
    n > 0 &&
    Number.isSafeInteger(Math.round(n * 100))
    ? Math.round(n * 100)
    : null;
}
export function parseBankMail(m, registry = { accounts: [] }) {
  const from = head(m, "from"),
    domain = (from.match(/@([a-z0-9.-]+)>?/i)?.[1] || "").toLowerCase(),
    allowed = ROOTS.find(
      (root) => domain === root || domain.endsWith("." + root),
    );
  if (!allowed) return null;
  const body = mailText(m.payload),
    plain = normalize(body),
    subject = head(m, "subject");
  if (
    /clave temporal|codigo de seguridad|c[oó]digo de acceso|verificaci[oó]n de acceso/i.test(
      subject,
    ) ||
    !/(transfer|pago|consumo|deposit|debito|credito)/.test(plain)
  )
    return null;
  const auth = headers(m)
      .filter((h) => h.name.toLowerCase() === "authentication-results")
      .map((h) => h.value)
      .join(" "),
    trusted =
      /dmarc=pass/i.test(auth) &&
      auth.toLowerCase().includes("header.from=" + domain);
  const rejected =
    /fondos insuficientes|no se pudo procesar|rechazad|fallid|no fue realizad/.test(
      plain,
    );
  const pending =
    /en proceso|pendiente de (confirmacion|aprobacion)|solicitud recibida/.test(
      plain,
    );
  const isCard = /tarjeta de debito|tarjeta de credito/.test(plain),
    outgoing =
      /realizaste una transferencia|transferencia enviada|pago exitoso|pago con tu|consumo (con|de)/.test(
        plain,
      ),
    incoming =
      /transferencia recibida|recibiste|deposito recibido|acreditacion|se ha acreditado/.test(
        plain,
      );
  const amount = dollars(
    body.match(/Monto\s*:?\s*(?:Concepto\s*)?\$?\s*([\d.,]+)/i)?.[1] ||
      subject.match(/\$\s*([\d.,]+)/)?.[1],
  );
  const origin =
      body
        .match(
          /Cuenta (?:de )?origen\s*(?:N[uú]mero de cuenta\s*:?)?\s*([*xX\d\s-]{5,40})/i,
        )?.[1]
        ?.replace(/\s/g, "") || "",
    destination =
      body.match(/Cuenta (?:\/ Tarjeta )?[Dd]estino\s*:?\s*([*xX\d-]+)/)?.[1] ||
      body.match(
        /Cuenta destino\s+Nombre:\s*N[uú]mero de cuenta:\s*.*?\s([*xX]+\d{3,10})/i,
      )?.[1] ||
      "",
    card = body.match(/N[uú]mero de tarjeta\s*:?[\s]*([*xX\d-]+)/i)?.[1] || "";
  const suffix = (s) => s.match(/\d{3,}$/)?.[0] || "",
    registryAccounts = registry.accounts || [];
  const find = (s) => {
    const tail = suffix(s);
    if (tail.length < 3) return null;
    const candidates = registryAccounts.filter((a) =>
      a.number ? String(a.number).endsWith(tail) : a.suffix === tail,
    );
    return candidates.length === 1 ? candidates[0].account_id : null;
  };
  const originId = find(origin),
    destinationId = find(destination),
    accountId = isCard
      ? null
      : outgoing
        ? originId
        : incoming
          ? destinationId
          : null;
  const sender =
    body.match(/Te confirmamos que\s+(.+?)\s+ha realizado/i)?.[1] || "";
  const ownerWords = normalize(registry.owner_name)
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const senderOwn =
    ownerWords.length >= 3 &&
    ownerWords.every((w) => normalize(sender).includes(w));
  const transfer = Boolean(
    destinationId && (outgoing || originId || senderOwn),
  );
  const reference =
    body.match(/Referencia\s*:?\s*([A-Z0-9-]{5,60})/i)?.[1] ||
    body.match(/Documento:\s*Fecha:\s*(\d{5,30})/i)?.[1] ||
    "";
  const receivedDate = new Date(
    Number(m.internalDate || m.internal_date || Date.parse(head(m, "date"))),
  );
  if (!Number.isFinite(receivedDate.getTime())) return null;
  const received = receivedDate.toISOString();
  const date = body.match(/(\d{2})\/(\d{2})\/(\d{4})/),
    time = body.match(/a la\(s\)\s*(\d{2}:\d{2})/i);
  let occurred = null;
  if (date && time)
    occurred = new Date(
      `${date[3]}-${date[2]}-${date[1]}T${time[1]}:00-05:00`,
    ).toISOString();
  const twelve = body.match(/Hora\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i);
  if (date && twelve) {
    const hour =
      (Number(twelve[1]) % 12) + (twelve[3].toLowerCase() === "p" ? 12 : 0);
    occurred = new Date(
      `${date[3]}-${date[2]}-${date[1]}T${String(hour).padStart(2, "0")}:${twelve[2]}:00-05:00`,
    ).toISOString();
  }
  const statementDate = (label) => {
    const x = body.match(label);
    if (!x) return null;
    const day = `${x[3]}-${x[2]}-${x[1]}`,
      d = new Date(`${day}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day
      ? day
      : null;
  };
  const statement = /estado de cuenta/i.test(subject)
    ? {
        total_cents: dollars(
          body.match(
            /(?:total a pagar|pago total|valor total a pagar)\s*:?\s*\$?\s*([\d.,]+)/i,
          )?.[1],
        ),
        cut_date: statementDate(
          /fecha de corte\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i,
        ),
        due_date: statementDate(
          /fecha (?:m[aá]xima de pago|l[ií]mite de pago|de pago)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i,
        ),
      }
    : null;
  return {
    id: m.id,
    from,
    subject,
    received_at: received,
    occurred_at: occurred,
    body,
    bank: allowed.includes("pichincha")
      ? "Pichincha"
      : allowed.includes("produbanco")
        ? "Produbanco"
        : allowed.includes("guayaquil")
          ? "Guayaquil"
          : allowed.includes("pacifico")
            ? "Pacífico"
            : allowed.includes("solidario")
              ? "Solidario"
              : "Deuna",
    trusted,
    statement,
    rejected,
    pending,
    amount_cents: rejected ? null : amount,
    fee_cents: dollars(
      body.match(
        /(?:tiene un costo de|costo total|comisi[oó]n (?:total|con IVA))\s*:?\s*\$?\s*([\d.,]+)/i,
      )?.[1],
    ),
    reference,
    origin_suffix: suffix(origin),
    destination_suffix: suffix(destination),
    card_suffix: suffix(card),
    card_kind: /tarjeta de credito/.test(plain)
      ? "credit"
      : isCard
        ? "debit"
        : null,
    account_id: accountId,
    origin_account_id: originId,
    destination_account_id: destinationId,
    event: rejected
      ? "failed"
      : pending
        ? "pending"
        : statement
          ? "card_statement"
          : /pago (?:de |a |realizado a |recibido en )?(?:tu )?tarjeta de credito/.test(
                plain,
              )
            ? "card_settlement"
            : transfer
              ? "internal_transfer"
              : isCard
                ? "card_payment"
                : outgoing
                  ? "expense"
                  : incoming
                    ? "income"
                    : "unrecognized",
    counterparty:
      body.match(/Comercio\s+(.+?)\s+Fecha\s/i)?.[1] || "Movimiento por correo",
  };
}
export function ingestBankMessages(db, messages) {
  const registry = privateSetting(db, "own_account_registry") || {
      accounts: [],
    },
    cutoff = privateSetting(db, "opening_cutoff");
  let imported = 0,
    duplicates = 0;
  return db.transaction(() => {
    for (const m of messages) {
      if (!m.id) continue;
      if (
        db.prepare("SELECT id FROM finance_mail_messages WHERE id=?").get(m.id)
      ) {
        duplicates++;
        continue;
      }
      const draft = parseBankMail(m, registry);
      if (!draft) continue;
      const accountCutoff = draft.account_id
        ? db
            .prepare("SELECT opening_at FROM finance_accounts WHERE id=?")
            .get(draft.account_id)?.opening_at
        : null;
      const applicableCutoff = accountCutoff || cutoff;
      const state = draft.rejected
        ? "failed"
        : draft.pending
          ? "pending"
          : applicableCutoff &&
              Date.parse(draft.occurred_at || draft.received_at) <=
                Date.parse(applicableCutoff)
            ? "historical"
            : "draft";
      const txKey = draft.reference
        ? `${draft.bank}|${draft.reference}|${draft.amount_cents}`
        : null;
      let finalState = state;
      const bill = draft.statement;
      if (
        draft.trusted &&
        bill?.total_cents &&
        bill.cut_date &&
        bill.due_date &&
        bill.cut_date <= financeDay()
      ) {
        const normalized = (s) =>
          s
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        const cards = db
          .prepare("SELECT * FROM finance_credit_cards")
          .all()
          .filter(
            (c) =>
              normalized(c.bank) === normalized(draft.bank) &&
              Number(bill.cut_date.slice(-2)) === c.cut_day &&
              Number(bill.due_date.slice(-2)) === c.due_day,
          );
        const nextMonth = new Date(`${bill.cut_date}T12:00:00Z`);
        nextMonth.setUTCMonth(
          nextMonth.getUTCMonth() + 1,
          Number(bill.due_date.slice(-2)),
        );
        if (
          cards.length === 1 &&
          nextMonth.toISOString().slice(0, 10) === bill.due_date
        ) {
          const c = cards[0],
            id = `${c.id}:${bill.cut_date}`;
          db.prepare(
            "INSERT OR IGNORE INTO finance_card_statements (id,card_id,cut_date,due_date,state) VALUES (?,?,?,?,'awaiting')",
          ).run(id, c.id, bill.cut_date, bill.due_date);
          const updated = db
            .prepare(
              "UPDATE finance_card_statements SET total_cents=?,state='recorded',source_mail_id=?,updated_by='bank-email',updated_at=? WHERE id=? AND total_cents IS NULL AND state='awaiting'",
            )
            .run(bill.total_cents, m.id, new Date().toISOString(), id);
          if (updated.changes) finalState = "statement";
        }
      }
      db.prepare(
        "INSERT INTO finance_mail_messages (id,received_at,encrypted,state,account_id,transaction_key,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        m.id,
        draft.received_at,
        encryptDocument(Buffer.from(JSON.stringify(draft))),
        finalState,
        draft.account_id,
        txKey,
        new Date().toISOString(),
      );
      imported++;
    }
    putPrivateSetting(db, "mail_last_sync", new Date().toISOString());
    return { imported, duplicates };
  })();
}
export function mailDrafts(db) {
  return db
    .prepare(
      "SELECT id,state,account_id,movement_id,bank_transaction_id,encrypted FROM finance_mail_messages ORDER BY received_at DESC LIMIT 250",
    )
    .all()
    .map((r) => ({
      ...JSON.parse(decryptDocument(r.encrypted).toString()),
      ...r,
      encrypted: undefined,
    }));
}
export function applyMailDraft(db, user, id, body) {
  if (user.role !== "owner")
    fail("Solo el propietario revisa el correo bancario", 403);
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM finance_mail_messages WHERE id=?")
      .get(id);
    if (!row) fail("Aviso no encontrado", 404);
    if (row.state === "applied") return { ok: true, duplicate: true };
    if (row.state !== "draft")
      fail("Este aviso no corresponde a un movimiento nuevo aplicable", 409);
    const p = JSON.parse(decryptDocument(row.encrypted).toString());
    if (
      !p.trusted ||
      !p.amount_cents ||
      ["failed", "pending", "unrecognized", "card_statement"].includes(p.event)
    )
      fail(
        "Revisa este aviso directamente en el banco; no se aplicará de forma automática",
      );
    const timestamp = p.occurred_at || body.occurred_at,
      cutoff = privateSetting(db, "opening_cutoff");
    if (
      !timestamp ||
      !Number.isFinite(Date.parse(timestamp)) ||
      Date.parse(timestamp) > Date.now() ||
      (cutoff && Date.parse(timestamp) <= Date.parse(cutoff))
    )
      fail("Indica la hora real posterior al saldo inicial");
    const account = db
      .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
      .get(body.account_id || row.account_id);
    if (!account) fail("Selecciona la cuenta real de este movimiento");
    if (
      p.event === "card_payment" &&
      p.card_kind === "credit" &&
      account.kind !== "card"
    )
      fail(
        "Un consumo de crédito se registra en la tarjeta, sin restarlo todavía de una cuenta bancaria",
      );
    const direction = body.direction;
    if (!["incoming", "outgoing"].includes(direction))
      fail("Indica si el dinero entra o sale");
    if (
      (["expense", "card_payment", "card_settlement"].includes(p.event) &&
        direction !== "outgoing") ||
      (p.event === "income" && direction !== "incoming")
    )
      fail("La dirección no coincide con el aviso");
    const key =
      row.transaction_key &&
      `${row.transaction_key}|${account.id}|${direction}`;
    const previous = db
      .prepare(
        "SELECT id FROM finance_mail_messages WHERE id!=? AND state='applied' AND transaction_key=? AND account_id=?",
      )
      .get(id, row.transaction_key, account.id);
    if (row.transaction_key && previous)
      fail("Este movimiento ya fue registrado desde otro aviso", 409);
    const day = financeDay(timestamp),
      kind = direction === "incoming" ? "income" : "expense";
    const existing = p.reference
      ? db
          .prepare(
            "SELECT * FROM finance_movements WHERE account_id=? AND reference=? AND amount_cents=? AND kind=? AND is_payment_request=0 AND status!='rejected'",
          )
          .all(account.id, p.reference, p.amount_cents, kind)
      : [];
    if (existing.length > 1)
      fail(
        "Hay varios registros con esta referencia. Revisa la asociación antes de importar",
        409,
      );
    if (existing[0]?.status === "reconciled")
      fail(
        "El gasto con esta referencia ya está conciliado. Revisa el aviso para evitar duplicarlo",
        409,
      );
    importBank(db, user, {
      account_id: account.id,
      rows: [
        {
          day,
          occurred_at: timestamp,
          amount_cents: p.amount_cents * (direction === "outgoing" ? -1 : 1),
          reference: p.reference,
          description: "Aviso bancario revisado",
          external_id: key || `mail:${id}:${account.id}:${direction}`,
        },
      ],
    });
    const bank = db
      .prepare(
        "SELECT id FROM finance_bank_transactions WHERE account_id=? AND fingerprint=?",
      )
      .get(
        account.id,
        crypto
          .createHash("sha256")
          .update(key || `mail:${id}:${account.id}:${direction}`)
          .digest("hex"),
      );
    let movement = existing[0] || null;
    if (
      !movement &&
      !["internal_transfer", "card_settlement"].includes(p.event) &&
      body.business_id
    ) {
      movement = createMovement(db, user, {
        business_id: body.business_id,
        kind: direction === "incoming" ? "income" : "expense",
        amount_cents: p.amount_cents,
        day,
        category: body.category || "Otros",
        counterparty: p.counterparty,
        description: String(
          body.description ||
            "Detectado por correo bancario y revisado por propietario",
        ).slice(0, 2000),
        allow_cross_account: true,
        reference: p.reference,
        account_id: account.id,
        payment_method: p.event === "card_payment" ? "card" : "transfer",
      });
      db.prepare(
        "UPDATE finance_movements SET status='reported',source_system='bank-email' WHERE id=?",
      ).run(movement.id);
    }
    if (movement) {
      if (movement.status === "pending")
        db.prepare(
          "UPDATE finance_movements SET status='reported',reviewed_by=? WHERE id=?",
        ).run(user.username, movement.id);
      reconcile(db, user, {
        movement_id: movement.id,
        bank_transaction_id: bank.id,
        amount_cents: p.amount_cents,
      });
    }
    db.prepare(
      "UPDATE finance_mail_messages SET state='applied',account_id=?,movement_id=?,bank_transaction_id=? WHERE id=?",
    ).run(account.id, movement?.id || null, bank.id, id);
    if (p.fee_cents && direction === "outgoing") {
      const feeKey = (key || `mail:${id}:${account.id}:${direction}`) + ":fee";
      importBank(db, user, {
        account_id: account.id,
        rows: [
          {
            day,
            occurred_at: timestamp,
            amount_cents: -p.fee_cents,
            reference: p.reference ? `${p.reference}-FEE` : "",
            description: "Comisión bancaria identificada en el aviso",
            external_id: feeKey,
          },
        ],
      });
      if (body.business_id) {
        const feeMovement = createMovement(db, user, {
          business_id: body.business_id,
          kind: "expense",
          amount_cents: p.fee_cents,
          day,
          category: "Comisiones bancarias",
          allow_cross_account: true,
          counterparty: p.bank,
          description:
            "Comisión identificada por el banco; registrada junto al traslado",
          account_id: account.id,
          reference: p.reference ? `${p.reference}-FEE` : "",
          payment_method: "transfer",
        });
        db.prepare(
          "UPDATE finance_movements SET status='reported' WHERE id=?",
        ).run(feeMovement.id);
        const feeBank = db
          .prepare(
            "SELECT id FROM finance_bank_transactions WHERE account_id=? AND fingerprint=?",
          )
          .get(
            account.id,
            crypto.createHash("sha256").update(feeKey).digest("hex"),
          );
        reconcile(db, user, {
          movement_id: feeMovement.id,
          bank_transaction_id: feeBank.id,
          amount_cents: p.fee_cents,
        });
      }
    }
    audit(db, user.username, "mail.applied", "mail", id, null, {
      account_id: account.id,
      bank_transaction_id: bank.id,
      movement_id: movement?.id || null,
    });
    return { ok: true };
  })();
}
const config = () => ({
  client: process.env.FINANCE_GMAIL_CLIENT_ID,
  secret: process.env.FINANCE_GMAIL_CLIENT_SECRET,
  redirect: process.env.FINANCE_GMAIL_REDIRECT_URI,
  email: process.env.FINANCE_GMAIL_ADDRESS,
});
async function oauthToken(params) {
  const c = config(),
    r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.client,
        client_secret: c.secret,
        ...params,
      }),
    });
  if (!r.ok)
    fail(
      "Google no pudo autorizar la lectura del correo. Vuelve a conectarlo",
      502,
    );
  return r.json();
}
async function gmail(access, path) {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${access}` },
    },
  );
  if (!r.ok) fail("No se pudo leer Gmail; revisa la conexión", 502);
  return r.json();
}
export function registerGmailPublic(app, db, { route }) {
  app.get(
    "/api/finance/integrations/gmail/callback",
    route(async (req, res) => {
      const state = String(req.query.state || ""),
        hash = crypto.createHash("sha256").update(state).digest("hex"),
        saved = db
          .prepare(
            "SELECT * FROM finance_oauth_states WHERE hash=? AND expires_at>?",
          )
          .get(hash, Date.now());
      if (!saved || !req.query.code)
        fail("La autorización venció. Inicia la conexión desde Finanzas", 400);
      if (
        !db
          .prepare(
            "SELECT id FROM finance_members WHERE id=? AND role='owner' AND active=1",
          )
          .get(saved.member_id)
      )
        fail("Acceso del propietario no disponible", 403);
      db.prepare("DELETE FROM finance_oauth_states WHERE hash=?").run(hash);
      const c = config(),
        token = await oauthToken({
          grant_type: "authorization_code",
          code: String(req.query.code),
          redirect_uri: c.redirect,
          code_verifier: decryptDocument(saved.verifier).toString(),
        }),
        profile = await gmail(token.access_token, "profile"),
        expected = privateSetting(db, "mail_address") || c.email;
      if (profile.emailAddress.toLowerCase() !== String(expected).toLowerCase())
        fail("Autoriza únicamente el correo bancario configurado", 403);
      const old = db
          .prepare("SELECT encrypted FROM finance_mail_oauth WHERE id='gmail'")
          .get(),
        previous = old
          ? JSON.parse(decryptDocument(old.encrypted).toString())
          : {};
      if (!token.refresh_token && !previous.refresh_token)
        fail("Autoriza el acceso de lectura permanente en Google", 400);
      db.prepare(
        "INSERT INTO finance_mail_oauth VALUES ('gmail',?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,updated_at=excluded.updated_at",
      ).run(
        encryptDocument(
          Buffer.from(
            JSON.stringify({
              refresh_token: token.refresh_token || previous.refresh_token,
              email: profile.emailAddress,
            }),
          ),
        ),
        new Date().toISOString(),
      );
      audit(
        db,
        String(saved.member_id),
        "mail.connected",
        "integration",
        "gmail",
        null,
        { read_only: true },
      );
      res.redirect("/finanzas/conexiones");
    }),
  );
}
export function registerGmailRoutes(app, db, { route, owner }) {
  app.get(
    "/api/finance/mail",
    route((req, res) => {
      owner(req);
      res.json({ messages: mailDrafts(db) });
    }),
  );
  app.post(
    "/api/finance/mail/:id/apply",
    route((req, res) => {
      owner(req);
      res.json(applyMailDraft(db, req.financeUser, req.params.id, req.body));
    }),
  );
  app.post(
    "/api/finance/integrations/gmail/start",
    route((req, res) => {
      owner(req);
      const c = config();
      if (
        !c.client ||
        !c.secret ||
        !c.redirect ||
        !/^https:\/\//.test(c.redirect)
      )
        fail("Falta configurar el cliente OAuth de Google en el servidor", 503);
      const state = crypto.randomBytes(32).toString("base64url"),
        verifier = crypto.randomBytes(48).toString("base64url");
      db.prepare("DELETE FROM finance_oauth_states WHERE expires_at<?").run(
        Date.now(),
      );
      db.prepare("INSERT INTO finance_oauth_states VALUES (?,?,?,?)").run(
        crypto.createHash("sha256").update(state).digest("hex"),
        req.financeUser.id,
        encryptDocument(Buffer.from(verifier)),
        Date.now() + 600000,
      );
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: c.client,
        redirect_uri: c.redirect,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent",
        login_hint: privateSetting(db, "mail_address") || c.email || "",
        state,
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      res.json({ url: url.href });
    }),
  );
  app.post(
    "/api/finance/integrations/gmail/sync",
    route(async (req, res) => {
      owner(req);
      res.json(await syncGmail(db));
    }),
  );
  app.post(
    "/api/finance/integrations/gmail/disconnect",
    route((req, res) => {
      owner(req);
      db.prepare("DELETE FROM finance_mail_oauth WHERE id='gmail'").run();
      audit(
        db,
        req.financeUser.username,
        "mail.disconnected",
        "integration",
        "gmail",
      );
      res.json({ ok: true });
    }),
  );
  if (process.env.FINANCE_DEMO !== "1") {
    let running = false;
    const timer = setInterval(async () => {
      if (
        running ||
        !config().client ||
        !db.prepare("SELECT id FROM finance_mail_oauth WHERE id='gmail'").get()
      )
        return;
      running = true;
      try {
        await syncGmail(db);
      } catch {
        putPrivateSetting(
          db,
          "mail_sync_error",
          "No se pudo actualizar; revisa la conexión",
        );
      } finally {
        running = false;
      }
    }, 120000);
    timer.unref();
  }
}
export async function syncGmail(db) {
  const row = db
    .prepare("SELECT encrypted FROM finance_mail_oauth WHERE id='gmail'")
    .get();
  if (!row) fail("Conecta Gmail para activar la lectura continua", 503);
  const saved = JSON.parse(decryptDocument(row.encrypted).toString()),
    token = await oauthToken({
      grant_type: "refresh_token",
      refresh_token: saved.refresh_token,
    }),
    cutoff = privateSetting(db, "opening_cutoff") || new Date().toISOString(),
    since = Math.floor(Date.parse(cutoff) / 1000) - 86400;
  let page,
    imported = 0;
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      q: `${MAIL_QUERY} after:${since}`,
      maxResults: "100",
    });
    if (page) params.set("pageToken", page);
    const result = await gmail(token.access_token, "messages?" + params);
    for (const m of result.messages || []) {
      if (
        db.prepare("SELECT id FROM finance_mail_messages WHERE id=?").get(m.id)
      )
        continue;
      const full = await gmail(
        token.access_token,
        `messages/${m.id}?format=full`,
      );
      imported += ingestBankMessages(db, [full]).imported;
    }
    page = result.nextPageToken;
    if (!page) break;
  }
  putPrivateSetting(db, "mail_last_sync", new Date().toISOString());
  return { imported, has_more: Boolean(page) };
}
