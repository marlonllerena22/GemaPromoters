import { financeDay } from "./finance-db.js";
const normal = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const usd = (n) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export function assistantFilters(question, filters = {}, now = new Date()) {
  const q = normal(question),
    today = financeDay(now);
  if (/\bhoy\b/.test(q)) return { ...filters, from: today, to: today };
  if (/\bayer\b/.test(q)) {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return {
      ...filters,
      from: d.toISOString().slice(0, 10),
      to: d.toISOString().slice(0, 10),
    };
  }
  return filters;
}
export function assistantHistory(value) {
  return (Array.isArray(value) ? value : [])
    .slice(-8)
    .filter(
      (x) =>
        ["user", "assistant"].includes(x.role) && typeof x.text === "string",
    )
    .map((x) => ({
      role: x.role,
      text: x.text.slice(0, 1800),
      ...(x.topic === "sales" ? { topic: "sales" } : {}),
    }));
}
export function sourcedAnswer(question, data, history = []) {
  const q = normal(question),
    h = assistantHistory(history),
    last = [...h].reverse().find((x) => x.role === "assistant");
  const salesQuestion =
    /\bventas?\b|cuanto.*vend|como.*vend/.test(q) ||
    (last?.topic === "sales" &&
      /de que|cuales|esa cifra|esos|por que/.test(q) &&
      !q.includes("cheque"));
  if (salesQuestion) {
    const sales = (data.sales || []).filter((s) => s.state === "active"),
      total = sales.reduce((n, s) => n + s.total_cents - s.refunded_cents, 0),
      paid = sales.reduce(
        (n, s) =>
          n +
          (s.payments || []).reduce(
            (p, x) => p + x.amount_cents - (x.refunded_cents || 0),
            0,
          ),
        0,
      );
    const period =
      data.period.from === data.period.to
        ? data.period.from
        : `${data.period.from} al ${data.period.to}`;
    const grouped = new Map();
    for (const s of sales) {
      const label =
        data.units.find((u) => u.id === s.unit_id)?.name ||
        data.businesses.find((b) => b.id === s.business_id)?.name ||
        "Venta registrada";
      const g = grouped.get(label) || { n: 0, total: 0 };
      g.n++;
      g.total += s.total_cents - s.refunded_cents;
      grouped.set(label, g);
    }
    const details = [...grouped]
      .map(
        ([label, g]) =>
          `• ${label}: ${g.n} ${g.n === 1 ? "venta" : "ventas"} por ${usd(g.total)}.`,
      )
      .join("\n");
    return {
      mode: "data",
      topic: "sales",
      period: data.period,
      answer: sales.length
        ? `Del ${period} hay ${sales.length} ${sales.length === 1 ? "venta registrada" : "ventas registradas"} por ${usd(total)}.\n\n${details}\n\nLos sistemas de venta reportan ${usd(paid)} cobrados. En bancos hay ${usd(data.summary.income_cents)} conciliados para ese período. Las ventas no aumentan el saldo bancario hasta comprobar sus cobros.`
        : `No hay ventas registradas del ${period} en las fuentes disponibles. Eso no demuestra que no se haya vendido: ${data.integrations.some((i) => i.source === "alfabusiness" && i.state !== "ready") ? "AlfaBusiness todavía no envía todas las ventas de los locales." : "hay que comprobar la cobertura de los sistemas de venta."}`,
      movement_ids: [],
      references: sales
        .slice(0, 12)
        .map((s) => ({
          kind: "sale",
          id: s.id,
          label: `${s.document_number || s.external_id} · ${usd(s.total_cents - s.refunded_cents)}`,
        })),
    };
  }
  return null;
}
