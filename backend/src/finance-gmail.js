import { matchUnreferencedDeclaration } from "./finance-declared-bank.js";
import {isBankPromotion} from '../../shared/finance-bank-promotions.mjs';
import {archiveBankNotice} from './finance-bank-inbox.js';
import {linkRecordedBankEvidence} from './finance-evidence-links.js';
import {postOwnTransferDestination} from './finance-own-transfers.js';
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
import { applyDigitalServiceTaxes } from "./finance-digital-taxes.js";
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
  let v = s.replace(/[^\d.,-]/g, "").replace(/[.,]+$/, "");
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
const registrySignature=registry=>crypto.createHash('sha256').update(JSON.stringify({accounts:registry.accounts||[],debit_cards:registry.debit_cards||[],owner_name:registry.owner_name||''})).digest('hex');
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
  if(!isStatement&&isBankPromotion(subject,body))return null;
  if (
    /clave temporal|codigo de seguridad|c[oó]digo de acceso|verificaci[oó]n de acceso|notificaci[oó]n otp/i.test(
      subject,
    ) ||
    (!isStatement &&
      !/(transfer|pago|consumo|deposit|debito|credito|cheque)/.test(plain))
  )
    return null;
  // Only Gmail's authentication result can authorize automatic bank entries.
  const auth = headers(m)
      .filter((h) => h.name.toLowerCase() === "authentication-results")
      .map((h) => h.value)
      .find((value) => /^mx\.google\.com\s*;/i.test(value.trim())),
    dmarc = auth?.match(/(?:^|;)\s*dmarc=pass\b([^;]*)/i),
    trusted = Boolean(
      dmarc &&
        new RegExp(
          "(?:^|\\s)header\\.from=" +
            domain.replace(/\./g, "\\.") +
            "(?=\\s|$)",
          "i",
        ).test(dmarc[1]),
    );
  const debitCompleted=/\b(?:se (?:ha )?debito|(?:fue|ha sido) debitad[oa])\b/.test(plain);
  const rejected =
      /fondos insuficientes|no se pudo procesar|rechazad|fallid|no fue realizad|no (?:se (?:ha )?debito|(?:fue|ha sido) debitad)/.test(
        plain,
      );
  let pending =
      /en proceso|pendiente de (confirmacion|aprobacion)|solicitud recibida/.test(plain) || (!debitCompleted && /sera debitada|sera acreditad|acreditada.*en (?:1|una) hora/.test(
        plain,
      ));
  const settlement =
      /pago (?:de la |de |a |realizado a |recibido en )?(?:tu )?tarjeta de credito|pago tarjeta de credito/.test(
        plain,
      ),
    isCard = /tarjeta de debito|tarjeta de credito/.test(plain) && !settlement;
  const outgoing =
      settlement || debitCompleted || /transferencia solicitada sera debitada de su cuenta/.test(plain) ||
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
  const destinationBankText=body.match(/Banco destino\s*:\s*(.+?)(?=\s+Cuenta|\s+Fecha|$)/i)?.[1]||'';
  const destinationBank=/(?:pichincha|produbanco|guayaquil|pacifico|solidario|deuna)/.test(normalize(destinationBankText))?bankLabel(normalize(destinationBankText)):null;
  const originId = find(origin, outgoing ? bank : null),
    destinationId = destinationBankText&&!destinationBank?null:find(destination, incoming ? bank : destinationBank),
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
      body.match(/Te confirmamos que\s+(.+?)\s+ha realizado/i)?.[1] || body.match(/Nombre del (?:ordenante|remitente)\s*:\s*(.+?)(?=\s+(?:Identificaci[oó]n|Cuenta|Banco|Fecha|Monto)\b|$)/i)?.[1] || "",
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
    // Gmail receipt time is used if this template omits the operation time.
    Number(m.internalDate || m.internal_date || Date.parse(head(m, "date"))),
  );
  if (!Number.isFinite(receivedDate.getTime())) return null;
  const acceptedScheduledTransfer=bank==='Pichincha'&&!rejected&&originId!==destinationId&&Boolean(amount&&originId&&reference)&&/la transferencia solicitada sera debitada de su cuenta/.test(plain);
  if(acceptedScheduledTransfer)pending=false;
  const received = receivedDate.toISOString();
  const date = body.match(/(\d{2})[/-](\d{2})[/-](\d{4})/),
    time = body.match(/(?:a la\(s\)|a las|Hora\s*:?)\s*(\d{1,2}:\d{2})/i);
  let occurred = null;
  if (date && time) {
    const value = new Date(
      `${date[3]}-${date[2]}-${date[1]}T${time[1].padStart(5, "0")}:00-05:00`,
    );
    if (Number.isFinite(value.getTime())) occurred = value.toISOString();
  }
  const twelve = body.match(
    /Hora\s*:?\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i,
  );
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
    parser_version:2,
    registry_signature:registrySignature(registry),
    accepted_scheduled_transfer:acceptedScheduledTransfer,
    from,
    subject,
    received_at: received,
    occurred_at: occurred,
    operation_day: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
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
      incoming && sender
        ? sender
        : body.match(/Comercio\s+(.+?)\s+Fecha\s/i)?.[1] ||
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
          .prepare("SELECT state,archived_at FROM finance_mail_messages WHERE id=?")
          .get(m.id);
        if (old.archived_at || old.state === "applied" || !reprocess) {
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
      const restart=privateSetting(db,'activity_restart_at');
      if(restart && Date.parse(draft.received_at)<=Date.parse(restart))db.prepare('UPDATE finance_mail_messages SET archived_at=? WHERE id=?').run(restart,m.id);
      else {
        linkRecordedBankEvidence(db);
        autoApplyBankMail(db, m.id);
      }
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
      "SELECT id,state,account_id,movement_id,bank_transaction_id,encrypted FROM finance_mail_messages WHERE archived_at IS NULL AND inbox_hidden_at IS NULL ORDER BY received_at DESC LIMIT 250",
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
    if (!row || row.archived_at) fail("Aviso no encontrado", 404);
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
      || (p.event === "internal_transfer" && p.destination_account_id === account.id && p.origin_account_id !== account.id && direction !== "incoming")
      || (p.event === "internal_transfer" && p.origin_account_id === account.id && p.destination_account_id !== account.id && direction !== "outgoing")
    )
      fail("La dirección no coincide con el aviso");
    const key =
      row.transaction_key &&
      `${row.transaction_key}|${account.id}|${direction}`;
    const previous = db
      .prepare(
        "SELECT id,bank_transaction_id FROM finance_mail_messages WHERE id!=? AND state='applied' AND transaction_key=? AND account_id=?",
      )
      .get(id, row.transaction_key, account.id);
    if (row.transaction_key && previous){
      const known=db.prepare('SELECT * FROM finance_bank_transactions WHERE id=? AND account_id=? AND amount_cents=?').get(previous.bank_transaction_id,account.id,p.amount_cents*(direction==='outgoing'?-1:1));
      if(!known)fail("Este aviso tiene una referencia ya registrada con otros datos",409);
      db.prepare("UPDATE finance_mail_messages SET state='applied',account_id=?,bank_transaction_id=? WHERE id=?").run(account.id,known.id,id);
      postOwnTransferDestination(db,p,known.id);
      return {ok:true,duplicate:true};
    }
    const day = financeDay(timestamp),
      kind = direction === "incoming" ? "income" : "expense";
    const existing = p.reference
      ? db
          .prepare(
            "SELECT * FROM finance_movements WHERE account_id=? AND reference=? AND amount_cents=? AND kind=? AND is_payment_request=0 AND status!='rejected' AND hidden_at IS NULL",
          )
          .all(account.id, p.reference, p.amount_cents, kind)
      : [];
    if (existing.length > 1)
      fail(
        "Hay varios registros con esta referencia. Revisa la asociación antes de importar",
        409,
      );
    const declared = !alreadyApplied && p.reference
      ? db.prepare("SELECT * FROM finance_bank_transactions WHERE account_id=? AND amount_cents=? AND reference=? AND import_source IN ('assistant','statement-image')").all(account.id, p.amount_cents * (direction === "outgoing" ? -1 : 1), p.reference)
      : [];
    if (declared.length > 1) fail("Hay varios registros manuales con esa referencia. Revisa antes de aplicar el aviso", 409);
    const linkedBank = body.link_bank_id && !alreadyApplied ? db.prepare("SELECT * FROM finance_bank_transactions WHERE id=? AND account_id=? AND day=? AND amount_cents=?").get(Number(body.link_bank_id),account.id,day,p.amount_cents*(direction==='outgoing'?-1:1)) : null;
    if(body.link_bank_id&&!alreadyApplied&&!linkedBank)fail('El movimiento elegido no coincide con cuenta, fecha y valor');
    const declaredBank = linkedBank || declared[0] || (!alreadyApplied ? matchUnreferencedDeclaration(db, { account_id: account.id, day, amount_cents: p.amount_cents * (direction === "outgoing" ? -1 : 1), counterparty: p.counterparty }) : null);
    if (existing[0]?.status === "reconciled" && !declaredBank)
      fail(
        "El gasto con esta referencia ya está conciliado. Revisa el aviso para evitar duplicarlo",
        409,
      );
    if (declaredBank) {
      if (existing[0]?.status === "reconciled" && !db.prepare("SELECT 1 FROM finance_allocations WHERE movement_id=? AND bank_transaction_id=?").get(existing[0].id, declaredBank.id)) fail("Este registro ya se relacionó con otro movimiento bancario", 409);
      const includedInBalance=db.prepare('SELECT as_of_at FROM finance_balance_checkpoints WHERE account_id=?').all(account.id).some(c=>financeDay(c.as_of_at)>declaredBank.day||(financeDay(c.as_of_at)===declaredBank.day&&(!declaredBank.occurred_at||Date.parse(declaredBank.occurred_at)<=Date.parse(c.as_of_at))));
      // Corroborating a recorded entry must not move it past the owner's balance
      // checkpoint: that would count the same money a second time.
      db.prepare("UPDATE finance_bank_transactions SET day=?,occurred_at=?,reference=?,import_source='bank-email' WHERE id=?").run(includedInBalance?declaredBank.day:day,includedInBalance?declaredBank.occurred_at:timestamp,linkedBank?.reference || p.reference || declaredBank.reference, declaredBank.id);
      audit(db, user.username, "assistant.bank_notice_matched", "bank_transaction", declaredBank.id, { import_source: declaredBank.import_source }, { import_source: "bank-email", mail_id: id,bank_reported_at:timestamp,balance_checkpoint_preserved:includedInBalance }, account.business_id);
    }
    const importedBank = declaredBank
      ? { transaction_ids: [declaredBank.id] }
      : alreadyApplied
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
              counterparty:p.counterparty,
              origin_account_id:p.origin_account_id,
              external_id: key || `mail:${id}:${account.id}:${direction}`,
            },
          ],
        });
    const bank = { id: importedBank.transaction_ids[0] };
    if(p.reference)db.prepare("UPDATE finance_bank_transactions SET reference=? WHERE id=? AND COALESCE(reference,'')=''").run(p.reference,bank.id);
    postOwnTransferDestination(db,p,bank.id);
    let movement = existing[0] || (declaredBank ? db.prepare("SELECT m.* FROM finance_allocations a JOIN finance_movements m ON m.id=a.movement_id WHERE a.bank_transaction_id=?").get(declaredBank.id) : null) || null;
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
    if (movement && movement.status !== "reconciled") {
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
    const taxes = applyDigitalServiceTaxes(db, p, account, bank.id, user.username);
    linkRecordedBankEvidence(db);
    return { ok: true, taxes };
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
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    console.error(
      "[finance] Gmail token response " +
        r.status +
        " " +
        String(detail.error || "")
          .replace(/[^a-zA-Z0-9_]/g, "")
          .slice(0, 80),
    );
    fail(
      "Google no pudo autorizar la lectura del correo. Vuelve a conectarlo",
      502,
    );
  }
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
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    console.error(
      "[finance] Gmail API response " +
        r.status +
        " " +
        String(detail.error?.status || "")
          .replace(/[^A-Z_]/g, "")
          .slice(0, 80),
    );
    console.error(
      "[finance] Gmail reason " +
        String(
          detail.error?.errors?.[0]?.reason ||
            detail.error?.details?.find((x) => x.reason)?.reason ||
            "",
        )
          .replace(/[^A-Za-z0-9_]/g, "")
          .slice(0, 80) +
        " " +
        (path.startsWith("messages?")
          ? "list"
          : path.startsWith("messages/")
            ? "message"
            : "profile"),
    );
    fail("No se pudo leer Gmail; revisa la conexión", 502);
  }
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
      console.info("[finance] Gmail read-only connection authorized");
      res.redirect("/finanzas/conexiones");
    }),
  );
}
export function registerGmailRoutes(app, db, { route, owner }) {
  app.post('/api/finance/mail/:id/archive',route((req,res)=>{owner(req);res.json(archiveBankNotice(db,req.financeUser,'mail',req.params.id));}));
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
    queueMicrotask(()=>{
      try{replayAutomaticBankMail(db);}
      catch(error){console.error('[finance] Bank mail replay needs attention: '+(error.status?error.message:error.code||error.name));}
    });
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
      } catch (error) {
        console.error(
          "[finance] Gmail scheduled synchronization needs attention: " +
            (error.status ? error.message : error.code || error.name),
        );
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
const gmailSyncJobs = new WeakMap();
export function syncGmail(db) {
  if (gmailSyncJobs.has(db)) return gmailSyncJobs.get(db);
  const pending = performGmailSync(db).finally(() => gmailSyncJobs.delete(db));
  gmailSyncJobs.set(db, pending);
  return pending;
}
async function performGmailSync(db) {
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
  const importMessages = async (messages) => {
    for (const m of messages || []) {
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
  };
  // New payments take priority while older pages continue in the background.
  if (page) {
    const recent = new URLSearchParams({ q: `${MAIL_QUERY} after:${Math.floor(Date.now() / 1000) - 15 * 60}`, maxResults: "20" });
    const newest = await gmail(token.access_token, "messages?" + recent);
    await importMessages(newest.messages);
  }
  const params = new URLSearchParams({ q: `${MAIL_QUERY} after:${since}`, maxResults: page ? "20" : "40" });
  if (page) params.set("pageToken", page);
  const result = await gmail(token.access_token, "messages?" + params);
  await importMessages(result.messages);
  page = result.nextPageToken;
  putPrivateSetting(db, "mail_poll_cursor", page ? { page, since, started } : null);
  putPrivateSetting(db, "mail_last_sync", new Date().toISOString());
  if (!page) putPrivateSetting(db, "mail_poll_watermark", started);
  const autoPosted = replayAutomaticBankMail(db);
  putPrivateSetting(db, "mail_sync_error", null);
  console.info(
    "[finance] Gmail synchronized " +
      JSON.stringify({ imported, auto_posted: autoPosted.applied, has_more: Boolean(page) }),
  );
  return { imported, auto_posted: autoPosted.applied, has_more: Boolean(page) };
}

export function replayAutomaticBankMail(db) {
  const configured = process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER;
  if (process.env.FINANCE_GMAIL_AUTO_APPLY === "0" || !configured || !Number.isFinite(Date.parse(configured)) || Date.now() < Date.parse(configured))
    return { applied: 0, scanned: 0 };
  const after = new Date(configured).toISOString();
  const saved = privateSetting(db, "mail_auto_replay_cursor");
  const cursor = saved?.after === after ? saved : null;
  const rows = db.prepare(`SELECT id,received_at,state FROM finance_mail_messages
    WHERE state IN ('draft','applied','pending') AND archived_at IS NULL AND received_at>=? AND
      (? IS NULL OR received_at>? OR (received_at=? AND id>?))
    ORDER BY received_at,id LIMIT 40`).all(after, cursor?.received_at || null, cursor?.received_at || null, cursor?.received_at || null, cursor?.id || "");
  let applied = 0, taxes = 0;
  for (const row of rows) {
    taxes += autoApplyBankMail(db, row.id)?.taxes || 0;
    if (row.state !== "applied" && db.prepare("SELECT state FROM finance_mail_messages WHERE id=?").get(row.id)?.state === "applied") applied++;
  }
  const last = rows.at(-1);
  putPrivateSetting(db, "mail_auto_replay_cursor", rows.length === 40 ? { after, received_at: last.received_at, id: last.id } : null);
  putPrivateSetting(db, "mail_auto_posting_last_run", new Date().toISOString());
  if (applied || taxes) console.info("[finance] Bank mail automatically posted " + JSON.stringify({ applied, taxes }));
  return { applied, taxes, scanned: rows.length };
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
export function mailAutoPostingAllowed(draft, now = Date.now()) {
  if (process.env.FINANCE_GMAIL_AUTO_APPLY === "0") return false;
  const configured = process.env.FINANCE_GMAIL_AUTO_APPLY_AFTER;
  if (!configured) return true;
  const after = Date.parse(configured);
  if (!Number.isFinite(after) || now < after) return false;
  if (draft.occurred_at) return Date.parse(draft.occurred_at) >= after;
  const day = financeDay(draft.received_at);
  return (
    day > financeDay(after) &&
    (!draft.operation_day || draft.operation_day === day)
  );
}
export function autoApplyBankMail(db, id) {
  if (process.env.FINANCE_GMAIL_AUTO_APPLY === "0") return;
  let row = db
    .prepare("SELECT * FROM finance_mail_messages WHERE id=?")
    .get(id);
  if (!row || row.archived_at) return;
  let p = JSON.parse(decryptDocument(row.encrypted).toString());
  const registry=privateSetting(db,'own_account_registry')||{accounts:[]};
  registry.debit_cards=privateSetting(db,'debit_card_accounts')||registry.debit_cards||[];
  if(p.trusted&&(p.parser_version!==2||p.registry_signature!==registrySignature(registry))){
    const parsed=parseBankMail({id:p.id||id,internalDate:String(Date.parse(p.received_at)),payload:{headers:[{name:'From',value:p.from},{name:'Subject',value:p.subject}],body:{content:p.body}}},registry);
    if(parsed&&!(row.state==='applied'&&parsed.account_id!==row.account_id)){
      p={...parsed,trusted:p.trusted};
      const state=row.state==='applied'||row.state==='historical'?row.state:p.pending?'pending':p.rejected?'failed':'draft';
      db.prepare('UPDATE finance_mail_messages SET encrypted=?,account_id=?,state=? WHERE id=?').run(encryptDocument(Buffer.from(JSON.stringify(p))),p.account_id,state,id);
      row={...row,state,account_id:p.account_id};
    }
  }
  if (!mailAutoPostingAllowed(p)) return;
  if (!p.trusted || p.pending || p.rejected) return;
  if (row.state === "historical") {
    recordCardPayment(db, p, { historical: true });
    return;
  }
  if (
    !["draft", "applied"].includes(row.state) ||
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
  if (row.state === "applied" && row.bank_transaction_id){
    postOwnTransferDestination(db,p,row.bank_transaction_id);
    return { taxes: applyDigitalServiceTaxes(db, p, account, row.bank_transaction_id) };
  }
  if (
    !p.occurred_at &&
    account.opening_at &&
    financeDay(p.received_at) === account.opening_date
  )
    return;
  if (p.event === "card_payment" && p.card_kind === "credit") return;
  const direction = p.event === "income" || (p.event === "internal_transfer" && p.destination_account_id === account.id && p.origin_account_id !== account.id) ? "incoming" : "outgoing";
  try {
    return db.transaction(() =>
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
