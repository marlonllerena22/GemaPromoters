// Shared, deterministic interpretation of short financial entries. It does not
// execute actions or certify money. The operational server revalidates the draft.
export const quickNormalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const words = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};
const numberWords = `(?:${Object.keys(words).join("|")}|mil)`;
function spokenInteger(value) {
  let total = 0,
    group = 0;
  for (const token of value.split(/\s+/)) {
    if (token === "y") continue;
    if (token === "mil") {
      total += (group || 1) * 1000;
      group = 0;
    } else if (Object.hasOwn(words, token)) group += words[token];
    else return null;
  }
  return total + group;
}
export function quickMoney(value) {
  let raw = String(value).trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;
  const dot = raw.lastIndexOf("."),
    comma = raw.lastIndexOf(",");
  let integer = raw,
    fraction = "";
  if (dot >= 0 || comma >= 0) {
    const last = Math.max(dot, comma),
      tail = raw.slice(last + 1);
    if (tail.length <= 2) {
      integer = raw.slice(0, last);
      fraction = tail;
      const grouping = dot > comma ? "," : ".";
      if (integer.includes(dot > comma ? "." : ",")) return null;
      if (
        integer.includes(grouping) &&
        !/^\d{1,3}(?:[.,]\d{3})+$/.test(integer)
      )
        return null;
    } else if (
      !/^\d{1,3}(?:([.,])\d{3})+$/.test(raw) ||
      (dot >= 0 && comma >= 0)
    )
      return null;
  }
  const cents =
    Number(integer.replace(/[.,]/g, "")) * 100 +
    Number(fraction.padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000_000
    ? cents
    : null;
}
function extractMoney(input) {
  const clean = input
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, " ")
    .replace(
      /\b(?:pedido|factura|referencia|ref|cuenta|tarjeta|terminada|terminado)\s*(?:(?:en|numero|nro)\s*)?\d{3,}\b/g,
      " ",
    )
    .replace(/\b(?:un|una)\s+(?:gasto|cobro|pago|abono)\b/g, " ");
  if (/(?:^|[^\d])-\s*\$?\s*\d/.test(clean)) return {};
  const withCents = clean.match(
    /\b(\d+)\s*(?:dolares?\s*)?con\s*(\d{1,2})\s*(?:centavos?)?\b/,
  );
  if (withCents && (clean.match(/-?\d+(?:[.,]\d+)*/g) || []).length === 2)
    return { amount: Number(withCents[1]) * 100 + Number(withCents[2]) };
  const numeric = clean.match(/-?\d+(?:[.,]\d+)*/g) || [];
  if (numeric.length)
    return numeric.length === 1
      ? { amount: quickMoney(numeric[0]) }
      : { ambiguous: true };
  const fragments = [
    ...clean.matchAll(
      new RegExp(
        `\\b${numberWords}(?:\\s+(?:y\\s+)?${numberWords})*(?:\\s+con\\s+${numberWords}(?:\\s+(?:y\\s+)?${numberWords})*)?\\b`,
        "g",
      ),
    ),
  ];
  const meaningful = fragments.filter(
    (x) => !["un", "una", "uno"].includes(x[0]),
  );
  if (meaningful.length !== 1) return { ambiguous: meaningful.length > 1 };
  const [base, decimals] = meaningful[0][0].split(/\s+con\s+/);
  const integer = spokenInteger(base),
    cents = decimals ? spokenInteger(decimals) : 0;
  return integer !== null && cents !== null && cents < 100
    ? { amount: integer * 100 + cents }
    : {};
}
const businesses = [
  ["producalza", /\bproducalza\b/],
  ["marjorie", /\bmarjorie(?: botas)?\b/],
  ["gemashow", /\bgema\s*show\b|\bticketera\b/],
  ["personal", /\bpersonal(?:es)?\b|\bpara mi\b/],
];
const categories = [
  ["Gasolina", /\bgasolina\b|\bcombustible\b|\bdiesel\b/],
  ["Sueldos", /\bsueldo|\bnomina\b|\bsalario/],
  ["Materiales", /\bmaterial|\bcuero\b|\bsuela|\bpegamento/],
  ["Arriendo", /\barriendo\b|\balquiler\b/],
  [
    "Publicidad",
    /\bpublicidad\b|\banuncios?\b|\bredes sociales\b|\bfacebook\b|\binstagram\b/,
  ],
  ["Servicios", /\binternet\b|\bluz\b|\bagua\b|\btelefono\b/],
  ["Alimentación", /\balmuerzo|\bcena\b|\bcomida\b|\bdesayuno/],
  ["Transporte", /\btaxi\b|\buber\b|\bflete\b|\btransporte\b|\bgas\b/],
  ["Producción de evento", /\bsonido\b|\bescenario\b|\bartista\b|\bevento\b/],
];
const validDate = (value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};
export function interpretQuickEntry(value, context = {}) {
  const original = String(value || "").trim();
  const text = quickNormalize(original),
    overrides = context.overrides || {};
  const allowed = context.business_ids || [],
    allUnits = context.units || [],
    accounts = context.accounts || [];
  const missing = [],
    warnings = [];
  let error = null;
  if (original.length > 1000)
    error = "Describe un solo movimiento en hasta 1000 caracteres.";
  if (
    /\b(?:no registres|no guardes|cancelar|borra|elimina|anula|transfiere|traspasa)\b/.test(
      text,
    )
  )
    error =
      "Este botón registra cobros o gastos. Para trasladar dinero o corregir un registro, usa su opción específica.";
  if (/\beuros?\b|\beur\b|€|\bpesos?\b/.test(text))
    error =
      "El registro rápido utiliza dólares USD. Indica el valor en dólares.";
  const explicit = businesses
    .filter(([, re]) => re.test(text))
    .map(([id]) => id);
  if (explicit.some((id) => !allowed.includes(id)))
    error = "Ese negocio no está asignado a tu acceso.";
  let business_id =
    overrides.business_id ||
    (explicit.length === 1 ? explicit[0] : null) ||
    context.default_business_id ||
    (allowed.length === 1 ? allowed[0] : null);
  if (explicit.length > 1 && !overrides.business_id) {
    business_id = null;
    warnings.push("Indica un solo negocio para este movimiento.");
  }
  if (business_id && !allowed.includes(business_id))
    error = "Ese negocio no está asignado a tu acceso.";
  if (!business_id) missing.push("business_id");
  const income =
    /\b(?:cobro|cobre|cobrado|recibi|recibimos|abonaron|depositaron|ingreso|abono)\b/.test(
      text,
    );
  const expense = /\b(?:gasto|gaste|gastamos|pague|pagamos|pago|pagar)\b/.test(
    text,
  );
  const categoryExpense =
    !income &&
    /\b(?:gasolina|sueldo|arriendo|almuerzo|publicidad|materiales)\b/.test(
      text,
    );
  const kind =
    overrides.kind ||
    (income && !expense
      ? "income"
      : !income && (expense || categoryExpense)
        ? "expense"
        : income && expense
          ? null
          : context.default_kind || null);
  if (kind && !["income", "expense"].includes(kind))
    error = "Selecciona cobro o gasto.";
  if (!kind) missing.push("kind");
  const extracted = extractMoney(text);
  const amount_cents = Object.hasOwn(overrides, "amount_cents")
    ? overrides.amount_cents
    : (extracted.amount ?? null);
  if (
    !Number.isSafeInteger(amount_cents) ||
    amount_cents <= 0 ||
    amount_cents > 100_000_000_000
  )
    missing.push("amount_cents");
  if (extracted.ambiguous && overrides.amount_cents === undefined)
    warnings.push("Hay más de un valor. Elige el monto de este registro.");
  const today =
    context.day ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guayaquil",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  let day = overrides.day || today;
  if (!overrides.day) {
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/),
      local = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (iso) day = iso[0];
    else if (local)
      day = `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
    else if (/\b(?:ayer|anteayer)\b/.test(text)) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (/\banteayer\b/.test(text) ? 2 : 1));
      day = d.toISOString().slice(0, 10);
    }
    if (/\bmanana\b|\bproxim[oa]\b/.test(text))
      error =
        "Para programar un pago futuro utiliza una solicitud con vencimiento.";
  }
  if (!validDate(day) || day > today)
    error = "Revisa la fecha: debe ser válida y no futura.";
  const units = allUnits.filter(
    (u) =>
      u.business_id === business_id &&
      (!(context.unit_ids || []).length || context.unit_ids.includes(u.id)),
  );
  const unitMatches = allUnits
    .filter((u) => u.business_id === business_id)
    .filter((u) =>
      new RegExp(
        `\\b${quickNormalize(u.name)
          .replace(/^local /, "")
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      ).test(text),
    );
  if (
    (context.unit_ids || []).length &&
    unitMatches.some((u) => !context.unit_ids.includes(u.id))
  )
    error =
      "Ese local no está asignado a tu acceso. Revisa el destino del registro.";
  if (!overrides.unit_id && unitMatches.length > 1) missing.push("unit_id");
  const unit_id =
    overrides.unit_id ||
    (unitMatches.length === 1 ? unitMatches[0].id : null) ||
    (units.length === 1 ? units[0].id : null);
  if (unit_id && !units.some((u) => u.id === unit_id))
    error = "Ese local no pertenece a tu acceso o al negocio.";
  if ((context.unit_ids || []).length && !unit_id) missing.push("unit_id");
  const relevant = accounts.filter(
    (a) =>
      context.allow_cross_account === true ||
      !a.business_id ||
      a.business_id === business_id,
  );
  const named = relevant.filter((a) =>
    [a.bank, a.name].some((label) => {
      const n = quickNormalize(label);
      return n.length >= 4 && text.includes(n);
    }),
  );
  let account_id =
    overrides.account_id !== undefined
      ? overrides.account_id
      : named.length === 1
        ? named[0].id
        : null;
  if (account_id && !relevant.some((a) => a.id === Number(account_id)))
    error = "La cuenta no está disponible para ese negocio.";
  if (named.length > 1 && overrides.account_id === undefined) {
    missing.push("account_id");
    warnings.push("Hay varias cuentas con ese nombre. Selecciona una.");
  }
  const account = relevant.find((a) => a.id === Number(account_id));
  const payment_method =
    overrides.payment_method ||
    (/\befectivo\b/.test(text)
      ? "cash"
      : /\btarjeta\b|\bdiners\b/.test(text)
        ? "card"
        : /\bpayphone\b/.test(text)
          ? "payphone"
          : /\btransferencia\b|\bdeuna\b|\bde una\b/.test(text)
            ? "transfer"
            : account?.kind === "card"
              ? "card"
              : account?.kind === "cash"
                ? "cash"
                : account
                  ? "transfer"
                  : "other");
  if (
    !["cash", "card", "payphone", "transfer", "other"].includes(payment_method)
  )
    error = "Revisa el medio de pago.";
  let category =
    overrides.category ||
    (kind === "income"
      ? business_id === "producalza"
        ? "Abono de pedido"
        : "Ventas de local"
      : categories.find(([, re]) => re.test(text))?.[0] ||
        (business_id === "personal" ? "Gasto personal" : "Otros"));
  if (typeof category !== "string" || !category || category.length > 80)
    error = "Revisa la categoría.";
  if (!account_id)
    warnings.push(
      "La cuenta queda por asignar. Esto no modifica ningún saldo bancario.",
    );
  return {
    ready: !missing.length && !error,
    missing: [...new Set(missing)],
    warnings,
    error,
    draft: {
      business_id,
      unit_id,
      kind,
      amount_cents,
      day,
      category,
      counterparty: String(
        overrides.counterparty ||
          (kind === "income" ? "Cliente por identificar" : category),
      ).slice(0, 200),
      description:
        original ||
        (kind === "income" ? "Comprobante recibido" : "Registro rápido"),
      reference: String(overrides.reference || "").slice(0, 200),
      payment_method,
      account_id: account_id ? Number(account_id) : null,
      allow_cross_account: context.allow_cross_account === true,
    },
    is_request:
      context.request === true ||
      /\b(?:solicito|solicitud|necesito pagar|por pagar|pendiente de pago|pedir pago|pagar)\b/.test(
        text,
      ),
  };
}
