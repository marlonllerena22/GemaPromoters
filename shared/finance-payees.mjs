// Shared validation, never confirmation of bank ownership or account validity.
export const payeeBanks = [
  "Pichincha",
  "Produbanco",
  "Guayaquil",
  "Pacífico",
  "Solidario",
  "Banco de Loja",
  "Deuna",
  "Payphone",
  "Diners",
  "Otro",
];
export const accountTypes = {
  savings: "Ahorros",
  checking: "Corriente",
  wallet: "Billetera",
  international: "Internacional",
};
const clean = (value, max = 150) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
export function normalizePayee(value = {}) {
  const accounts = (Array.isArray(value.accounts) ? value.accounts : [])
    .slice(0, 12)
    .map((a) => ({
      bank: clean(a.bank, 80),
      type: Object.hasOwn(accountTypes, a.type) ? a.type : "",
      number: clean(a.number, 80).replace(/[\s-]/g, "").toUpperCase(),
      holder: clean(a.holder),
    }));
  return {
    name: clean(value.name),
    document: clean(value.document, 30).replace(/[\s-]/g, ""),
    email: clean(value.email, 180),
    accounts,
  };
}
export function payeeError(p) {
  if (!p.name) return "Escribe el nombre del contacto";
  if (!p.accounts.length) return "Añade una cuenta de destino";
  if (
    p.accounts.some(
      (a) => !a.bank || !a.type || !/^[A-Z0-9]{4,34}$/.test(a.number)
    )
  )
    return "Revisa banco, tipo y número completo de cada cuenta; no uses números ocultos o incompletos";
  if (p.document && !/^\d{5,20}$/.test(p.document))
    return "Revisa la cédula o RUC; puedes dejarlo vacío si no lo conoces";
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
    return "Revisa el correo del contacto";
  if (
    new Set(p.accounts.map((a) => `${a.bank.toLowerCase()}|${a.number}`))
      .size !== p.accounts.length
  )
    return "Hay una cuenta repetida en este contacto";
  return null;
}
export function bankDraft(value = {}) {
  const result = normalizePayee(value);
  // Masked, conflicting or unreadable numbers remain blank for explicit review.
  result.accounts = result.accounts.map((a) => ({
    ...a,
    number: /^[A-Z0-9]{4,34}$/.test(a.number) ? a.number : "",
  }));
  return {
    ...result,
    warnings: (Array.isArray(value.warnings) ? value.warnings : [])
      .slice(0, 20)
      .map((x) => clean(x, 300)),
    draft: true,
  };
}
