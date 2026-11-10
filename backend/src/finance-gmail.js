import { ensureCardCycles } from "./finance-funding.js";
import crypto from "node:crypto";
import {
  encryptDocument,
  decryptDocument,
  analyzeCardStatementPdf,
} from "./finance-ai.js";
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
  "bancopacifico.ec",
  "pacificard.ec",
  "solidario.fin.ec",
  "banco-solidario.com",
  "deuna.app",
  "deuna.com",
];
export const MAIL_QUERY = `-in:spam -in:trash {${ROOTS.map((root) => `from:${root}`).join(" ")}}`;
const headers = (m) => m.payload?.headers || [];
const head = (m, n) =>
  headers(m).find((h) => h.name.toLowerCase() === n)?.value || "";
const decodeEntities = (s) =>
  s
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(
      /&(aacute|eacute|iacute|oacute|uacute|ntilde|uuml|Aacute|Eacute|Iacute|Oacute|Uacute|Ntilde|quot|apos|lt|gt|nbsp|amp|dollar);/g,
      (_, n) =>
        ({
          aacute: "á",
          eacute: "é",
          iacute: "í",
          oacute: "ó",
          uacute: "ú",
          ntilde: "ñ",
          uuml: "ü",
          Aacute: "Á",
          Eacute: "É",
          Iacute: "Í",
          Oacute: "Ó",
          Uacute: "Ú",
          Ntilde: "Ñ",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
          nbsp: " ",
          amp: "&",
          dollar: "$",
        })[n],
    );
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
  return decodeEntities(
    [result, ...(payload?.parts || []).filter((p) => !p.filename).map(mailText)]
      .join(" ")
      .replace(/&nbsp;|&#160;|&#xa0;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100000),
  );
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
const bankLabel = (root) =>
  root.includes("pichincha")
    ? "Pichincha"
    : root.includes("produbanco")
      ? "Produbanco"
      : root.includes("guayaquil")
        ? "Guayaquil"
        : /pacifico|pacificard/.test(root)
          ? "Pacífico"
          : /solidario/.test(root)
            ? "Solidario"
            : "Deuna";
const bankCode = (s) => normalize(s).replace(/banco|del|de|[^a-z]/g, "");
export function parseBankMail(m, registry = { accounts: [] }) {
  const from = head(m, "from"),
    domain = (from.match(/@([a-z0-9.-]+)>?/i)?.[1] || "").toLowerCase(),
    allowed = ROOTS.find(
      (root) => domain === root || domain.endsWith("." + root),
    );
  if (!allowed) return null;
  const bank = bankLabel(allowed),
    body = mailText(m.payload),
    plain = normalize(body),
    subject = head(m, "subject"),
    isStatement = /estado[s]? de cuenta/i.test(subject);
  if (
    /clave temporal|codigo de seguridad|c[oó]digo de acceso|verificaci[oó]n de acceso|notificaci[oó]n otp/i.test(
      subject,
    ) ||
    (!isStatement &&
      !/(transfer|pago|consumo|deposit|debito|credito|cheque)/.test(plain))
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
      ),
    pending =
      /en proceso|pendiente de (confirmacion|aprobacion)|solicitud recibida|sera debitada|ser[aá] acreditad|acreditada.*en (?:1|una) hora/.test(
        plain,
      );
  const settlement =
      /pago (?:de la |de |a |realizado a |recibido en )?(?:tu )?tarjeta de credito|pago tarjeta de credito/.test(
        plain,
      ),
    isCard = /tarjeta de debito|tarjeta de credito/.test(plain) && !settlement;
  const outgoing =
      settlement ||
      /realizaste una transferencia|transferencia enviada|pago exitoso|pago realizado correctamente|pago con tu|consumo (con|de)/.test(
        plain,
      ),
    incoming =
      /transferencia recibida|recibiste|deposito recibido|acreditacion|se ha acreditado/.test(
        plain,
      );
  const amount = dollars(
    body.match(
      /(?:Monto|Valor)\s*:?\s*(?:Concepto\s*)?(?:USD\s*)?\$?\s*([\d.,]+)/i,
    )?.[1] || subject.match(/\$\s*([\d.,]+)/)?.[1],
  );
  const origin = (
    body.match(
      /(?:Cuenta (?:de )?origen|Cuenta de d[eé]bito|Desde la cuenta)\s*(?:N[uú]mero de cuenta\s*:?)?\s*:?\s*([*xX\d\s-]{5,40})/i,
    )?.[1] || ""
  ).replace(/\s/g, "");
  const destination =
    body.match(/Cuenta (?:\/ Tarjeta )?[Dd]estino\s*:?\s*([*xX\d-]+)/)?.[1] ||
    body.match(/Cuenta acreditada\s*:\s*([*xX\d-]+)/i)?.[1] ||
    body.match(
      /Cuenta destino\s+Nombre:\s*N[uú]mero de cuenta:\s*.*?\s([*xX]+\d{3,10})/i,
    )?.[1] ||
    "";
  const card =
      body.match(
        /(?:N[uú]mero de tarjeta|Tarjeta(?: de cr[eé]dito)?(?: No\.)?)\s*:?\s*([*xX\d-]{5,30})/i,
      )?.[1] || "",
    suffix = (s) => s.match(/\d{3,}$/)?.[0] || "";
  const find = (value, hint) => {
    if (!value) return null;
    const tail = suffix(value),
      candidates = (registry.accounts || []).filter((a) => {
        if (hint && a.bank && bankCode(a.bank) !== bankCode(hint)) return false;
        if (tail.length >= 3)
          return a.number ? String(a.number).endsWith(tail) : a.suffix === tail;
        const visible = value.replace(/[*xX-]/g, "");
        if (
          visible.length < 4 ||
          !a.number ||
          !/^\d{2}[*xX]+\d{2}$/.test(value)
        )
          return false;
        return new RegExp("^" + value.replace(/[*xX]/g, "\\d") + "$").test(
          String(a.number),
        );
      });
    return candidates.length === 1 ? candidates[0].account_id : null;
  };
  const originId = find(origin, outgoing ? bank : null),
    destinationId = find(destination, incoming ? bank : null),
    cardMatches = (registry.debit_cards || []).filter(
      (c) =>
        c.bank &&
        bankCode(c.bank) === bankCode(bank) &&
        c.suffix === suffix(card),
    );
  const mappedCardId =
    cardMatches.length === 1 ? cardMatches[0].account_id : null;
  const accountId = isCard
    ? mappedCardId
    : outgoing
      ? originId
      : incoming
        ? destinationId
        : null;
  const sender =
      body.match(/Te confirmamos que\s+(.+?)\s+ha realizado/i)?.[1] || "",
    ownerWords = normalize(registry.owner_name)
      .split(/\s+/)
      .filter((w) => w.length > 2),
    senderOwn =
      ownerWords.length >= 3 &&
      ownerWords.every((w) => normalize(sender).includes(w));
  const transfer = Boolean(
    !settlement && destinationId && (outgoing || originId || senderOwn),
  );
  const reference =
    body.match(/Referencia\s*:?\s*([A-Z0-9-]{5,60})/i)?.[1] ||
    body.match(
      /(?:N[uú]mero de (?:documento|comprobante))\s*:?\s*([A-Z0-9-]{5,60})/i,
    )?.[1] ||
    body.match(/Documento:\s*Fecha:\s*(\d{5,30})/i)?.[1] ||
    "";
  const receivedDate = new Date(
    Number(m.internalDate || m.internal_date || Date.parse(head(m, "date"))),
  );
  if (!Number.isFinite(receivedDate.getTime())) return null;
  const received = receivedDate.toISOString();
  const date = body.match(/(\d{2})[/-](\d{2})[/-](\d{4})/),
    time = body.match(/(?:a la\(s\)|a las)\s*(\d{1,2}:\d{2})/i);
  let occurred = null;
  if (date && time) {
    const value = new Date(
      `${date[3]}-${date[2]}-${date[1]}T${time[1].padStart(5, "0")}:00-05:00`,
    );
    if (Number.isFinite(value.getTime())) occurred = value.toISOString();
  }
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
      d = new Date(day + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day
      ? day
      : null;
  };
  const statement = isStatement
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
    bank,
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
          : settlement
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
      body.match(/Comercio\s+(.+?)\s+Fecha\s/i)?.[1] ||
      body.match(
        /Nombre del beneficiario:\s*(.+?)\s*Identificaci[oó]n/i,
      )?.[1] ||
      "Movimiento por correo",
  };
}
export function ingestBankMessages(db, messages, { reprocess = false } = {}) {
  const registry = privateSetting(db, "own_account_registry") || {
      accounts: [],
    },
    cutoff = privateSetting(db, "opening_cutoff");
  registry.debit_cards =
    privateSetting(db, "debit_card_accounts") || registry.debit_cards || [];
  let imported = 0,
    duplicates = 0;
  return db.transaction(() => {
    const seen = new Set();
    for (const m of messages) {
      if (seen.has(m.id)) {
        duplicates++;
        continue;
      }
      seen.add(m.id);
      if (!m.id) continue;
      if (
        db.prepare("SELECT id FROM finance_mail_messages WHERE id=?").get(m.id)
      ) {
        const old = db
          .prepare("SELECT state FROM finance_mail_messages WHERE id=?")
          .get(m.id);
        if (old.state === "applied" || !reprocess) {
          duplicates++;
          continue;
        }
        db.prepare(
          "DELETE FROM finance_mail_messages WHERE id=? AND bank_transaction_id IS NULL AND movement_id IS NULL",
        ).run(m.id);
        if (
          db
            .prepare("SELECT id FROM finance_mail_messages WHERE id=?")
            .get(m.id)
        ) {
          duplicates++;
          continue;
        }
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
      if (recordMailStatement(db, draft)) finalState = "statement";
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
      autoApplyBankMail(db, m.id);
      imported++;
    }
    putPrivateSetting(db, "mail_last_sync", new Date().toISOString());
    putPrivateSetting(db, "mail_sync_error", null);
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
    const alreadyApplied = row.state === "applied";
    if (alreadyApplied && (row.movement_id || !body.business_id))
      return { ok: true, duplicate: true };
    if (row.state !== "draft" && !alreadyApplied)
      fail("Este aviso no corresponde a un movimiento nuevo aplicable", 409);
    const p = JSON.parse(decryptDocument(row.encrypted).toString());
    if (
      alreadyApplied &&
      ["internal_transfer", "card_settlement"].includes(p.event)
    )
      return { ok: true, duplicate: true };
    if (
      !p.trusted ||
      !p.amount_cents ||
      ["failed", "pending", "unrecognized", "card_statement"].includes(p.event)
    )
      fail(
        "Revisa este aviso directamente en el banco; no se aplicará de forma automática",
      );
    const timestamp =
        p.occurred_at ||
        body.occurred_at ||
        (alreadyApplied ? p.received_at : null),
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
    if (alreadyApplied && account.id !== row.account_id)
      fail("Este aviso ya está registrado en otra cuenta", 409);
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
    const importedBank = alreadyApplied
      ? { transaction_ids: [row.bank_transaction_id] }
      : importBank(db, user, {
          source_system: "bank-email",
          account_id: account.id,
          rows: [
            {
              day,
              occurred_at: timestamp,
              amount_cents:
                p.amount_cents * (direction === "outgoing" ? -1 : 1),
              reference: p.reference,
              description: "Aviso bancario revisado",
              external_id: key || `mail:${id}:${account.id}:${direction}`,
            },
          ],
        });
    const bank = { id: importedBank.transaction_ids[0] };
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
    if (p.event === "card_settlement")
      recordCardPayment(db, p, { bankId: bank.id, accountId: account.id });
    if (p.fee_cents && direction === "outgoing") {
      const feeKey = (key || `mail:${id}:${account.id}:${direction}`) + ":fee";
      const importedFee = importBank(db, user, {
        source_system: "bank-email",
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
        const feeBank = { id: importedFee.transaction_ids[0] };
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
    cursor = privateSetting(db, "mail_poll_cursor"),
    started = cursor?.started || new Date().toISOString(),
    since =
      cursor?.since ??
      Math.floor(
        Date.parse(privateSetting(db, "mail_poll_watermark") || cutoff) / 1000,
      ) -
        (privateSetting(db, "mail_poll_watermark") ? 3 : 45) * 86400;
  let page = cursor?.page,
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
      const parsed = parseBankMail(
        full,
        privateSetting(db, "own_account_registry") || { accounts: [] },
      );
      if (
        parsed?.trusted &&
        parsed.event === "card_statement" &&
        process.env.OPENAI_API_KEY
      )
        await importStatementAttachment(db, token.access_token, full, parsed);
      imported += ingestBankMessages(db, [full]).imported;
    }
    page = result.nextPageToken;
    putPrivateSetting(
      db,
      "mail_poll_cursor",
      page ? { page, since, started } : null,
    );
    if (!page) break;
  }
  putPrivateSetting(db, "mail_last_sync", new Date().toISOString());
  if (!page) putPrivateSetting(db, "mail_poll_watermark", started);
  putPrivateSetting(db, "mail_sync_error", null);
  return { imported, has_more: Boolean(page) };
}

export function recordMailStatement(db, draft) {
  const bill = draft.statement;
  if (
    !draft.trusted ||
    !bill ||
    !Number.isSafeInteger(bill.total_cents) ||
    bill.total_cents < 0 ||
    !bill.due_date
  )
    return false;
  const cutoff = privateSetting(db, "opening_cutoff");
  if (cutoff && bill.due_date < financeDay(cutoff)) return false;
  const cards = db
    .prepare("SELECT * FROM finance_credit_cards")
    .all()
    .filter(
      (c) =>
        bankCode(c.bank) === bankCode(draft.bank) &&
        Number(bill.due_date.slice(-2)) === c.due_day,
    );
  if (cards.length !== 1) return false;
  const c = cards[0],
    due = new Date(bill.due_date + "T12:00:00Z"),
    cut =
      bill.cut_date ||
      new Date(
        Date.UTC(due.getUTCFullYear(), due.getUTCMonth() - 1, c.cut_day, 12),
      )
        .toISOString()
        .slice(0, 10);
  if (Number(cut.slice(-2)) !== c.cut_day || cut > financeDay()) return false;
  const expected = new Date(cut + "T12:00:00Z");
  expected.setUTCMonth(expected.getUTCMonth() + 1, c.due_day);
  if (expected.toISOString().slice(0, 10) !== bill.due_date) return false;
  const id = c.id + ":" + cut;
  db.prepare(
    "INSERT OR IGNORE INTO finance_card_statements (id,card_id,cut_date,due_date,state) VALUES (?,?,?,?,'awaiting')",
  ).run(id, c.id, cut, bill.due_date);
  const changed = db
    .prepare(
      "UPDATE finance_card_statements SET total_cents=?,source_mail_id=?,updated_by='bank-email',updated_at=?,state='recorded' WHERE id=? AND total_cents IS NULL AND state IN ('awaiting','payment_recorded')",
    )
    .run(bill.total_cents, draft.id, new Date().toISOString(), id).changes;
  if (changed) {
    audit(
      db,
      "system:bank-mail",
      "card.statement_from_mail",
      "card_statement",
      id,
      null,
      {
        total_cents: bill.total_cents,
        source_mail_id: draft.id,
        attachment_sha256: bill.source_hash || null,
      },
    );
    refreshCardPaymentState(db, id);
  }
  return Boolean(changed);
}
export function refreshCardPaymentState(db, id) {
  const statement = db
    .prepare("SELECT * FROM finance_card_statements WHERE id=?")
    .get(id);
  if (!statement) return;
  const payments = db
    .prepare("SELECT * FROM finance_card_payments WHERE statement_id=?")
    .all(id);
  if (!payments.length) return;
  const paid = payments.reduce((n, p) => n + p.amount_cents, 0),
    complete = statement.total_cents !== null && paid >= statement.total_cents;
  db.prepare(
    "UPDATE finance_card_statements SET state=?,paid_bank_id=COALESCE(paid_bank_id,?),updated_at=? WHERE id=?",
  ).run(
    complete
      ? payments.every((p) => p.historical)
        ? "paid_before_start"
        : "paid"
      : statement.total_cents === null
        ? "payment_recorded"
        : "partial",
    complete && payments.length === 1 ? payments[0].bank_transaction_id : null,
    new Date().toISOString(),
    id,
  );
}
export function recordCardPayment(
  db,
  p,
  { bankId = null, accountId = p.account_id, historical = false } = {},
) {
  if (
    !p.trusted ||
    p.event !== "card_settlement" ||
    p.pending ||
    p.rejected ||
    !p.amount_cents
  )
    return false;
  if (
    db
      .prepare("SELECT id FROM finance_card_payments WHERE source_mail_id=?")
      .get(p.id)
  )
    return true;
  const cards = db
    .prepare("SELECT * FROM finance_credit_cards")
    .all()
    .filter(
      (c) =>
        bankCode(c.bank) === bankCode(p.bank) &&
        (!c.debit_account_id || c.debit_account_id === accountId),
    );
  if (cards.length !== 1) return false;
  const day = financeDay(p.occurred_at || p.received_at),
    c = cards[0];
  ensureCardCycles(db, new Date(p.occurred_at || p.received_at));
  const candidates = db
    .prepare(
      "SELECT * FROM finance_card_statements WHERE card_id=? AND due_date BETWEEN date(?,'-35 days') AND date(?,'+10 days') AND state NOT IN ('paid','paid_before_start') ORDER BY due_date",
    )
    .all(c.id, day, day);
  const exact = candidates.filter((s) => s.total_cents === p.amount_cents),
    statement =
      exact.length === 1
        ? exact[0]
        : candidates.length === 1
          ? candidates[0]
          : null;
  db.prepare(
    "INSERT INTO finance_card_payments (id,card_id,statement_id,amount_cents,day,account_id,bank_transaction_id,source_mail_id,historical,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "mail:" + p.id,
    c.id,
    statement?.id || null,
    p.amount_cents,
    day,
    accountId || null,
    bankId,
    p.id,
    historical ? 1 : 0,
    new Date().toISOString(),
  );
  if (statement) refreshCardPaymentState(db, statement.id);
  audit(db, "system:bank-mail", "card.payment_from_mail", "card", c.id, null, {
    statement_id: statement?.id || null,
    amount_cents: p.amount_cents,
    historical,
    bank_transaction_id: bankId,
  });
  return true;
}
export function autoApplyBankMail(db, id) {
  const row = db
    .prepare("SELECT * FROM finance_mail_messages WHERE id=?")
    .get(id);
  if (!row) return;
  const p = JSON.parse(decryptDocument(row.encrypted).toString());
  if (!p.trusted || p.pending || p.rejected) return;
  if (row.state === "historical") {
    recordCardPayment(db, p, { historical: true });
    return;
  }
  if (
    row.state !== "draft" ||
    !p.account_id ||
    !p.amount_cents ||
    ![
      "expense",
      "income",
      "card_payment",
      "card_settlement",
      "internal_transfer",
    ].includes(p.event)
  )
    return;
  const account = db
    .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
    .get(p.account_id);
  if (!account) return;
  if (
    !p.occurred_at &&
    account.opening_at &&
    financeDay(p.received_at) === account.opening_date
  )
    return;
  if (p.event === "card_payment" && p.card_kind === "credit") return;
  const direction = p.event === "income" ? "incoming" : "outgoing";
  try {
    db.transaction(() =>
      applyMailDraft(
        db,
        {
          role: "owner",
          username: "system:bank-mail",
          business_ids: ["producalza", "marjorie", "gemashow", "personal"],
          unit_ids: [],
        },
        id,
        {
          account_id: account.id,
          direction,
          occurred_at: p.occurred_at || p.received_at,
        },
      ),
    )();
  } catch (e) {
    if (!e.status) throw e;
  }
}

async function importStatementAttachment(db, access, message, draft) {
  const collect = (p) => [
    ...(p.filename && /\.pdf$/i.test(p.filename) ? [p] : []),
    ...(p.parts || []).flatMap(collect),
  ];
  if (
    db
      .prepare(
        "SELECT id FROM finance_card_statements WHERE source_mail_id=? AND total_cents IS NOT NULL",
      )
      .get(message.id)
  )
    return;
  for (const part of collect(message.payload).slice(0, 2)) {
    try {
      if (part.body?.size > 6 * 1024 * 1024) continue;
      const attachment = part.body?.attachmentId
        ? await gmail(
            access,
            `messages/${message.id}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
          )
        : part.body;
      if (!attachment?.data || attachment.data.length > 8400000) continue;
      const buffer = Buffer.from(attachment.data, "base64url");
      if (buffer.subarray(0, 5).toString() !== "%PDF-") continue;
      const fields = await analyzeCardStatementPdf(buffer);
      if (!fields.unambiguous) continue;
      recordMailStatement(db, {
        ...draft,
        statement: {
          ...fields,
          source_hash: crypto.createHash("sha256").update(buffer).digest("hex"),
        },
      });
    } catch {
      putPrivateSetting(
        db,
        "mail_attachment_attention",
        "Hay un estado de tarjeta que necesita revisión manual",
      );
    }
  }
}
