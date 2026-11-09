import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretQuickEntry,
  quickMoney,
} from "../../shared/finance-quick.mjs";
const context = {
  business_ids: ["producalza", "marjorie", "gemashow", "personal"],
  unit_ids: [],
  day: "2026-11-09",
  units: [{ id: "norte", business_id: "marjorie", name: "Norte" }],
  accounts: [
    {
      id: 1,
      business_id: null,
      bank: "Pichincha",
      name: "Principal",
      kind: "bank",
    },
  ],
};
test("a spoken personal gasoline expense becomes a complete draft without assuming a bank", () => {
  for (const text of [
    "Puedes registrar un gasto personal de $80 en gasolina",
    "Gasté ochenta dólares en gasolina personal",
    "Gasto personal gasolina 80",
  ]) {
    const result = interpretQuickEntry(text, context);
    assert.equal(result.ready, true, text);
    assert.equal(result.draft.amount_cents, 8000);
    assert.equal(result.draft.business_id, "personal");
    assert.equal(result.draft.category, "Gasolina");
    assert.equal(result.draft.account_id, null);
    assert.equal(result.draft.payment_method, "other");
  }
});
test("Spanish decimals, cents, words and dates preserve the exact amount", () => {
  for (const [input, expected] of [
    ["80,50", 8050],
    ["1.250,75", 125075],
    ["1,250.75", 125075],
    ["1.250", 125000],
    ["0.50", 50],
    ["80.1234", null],
    ["-80", null],
  ])
    assert.equal(quickMoney(input), expected, input);
  const r = interpretQuickEntry(
    "Gasté ciento veinte con cincuenta en gasolina personal ayer con Pichincha",
    context,
  );
  assert.equal(r.draft.amount_cents, 12050);
  assert.equal(r.draft.day, "2026-11-08");
  assert.equal(r.draft.account_id, 1);
  assert.equal(
    interpretQuickEntry(
      "Gasto personal 80 dólares con 50 centavos gasolina",
      context,
    ).draft.amount_cents,
    8050,
  );
});
test("missing, contradictory and out-of-scope entries require correction instead of guessing", () => {
  for (const text of [
    "Gasto personal gasolina",
    "Gasto personal -80 con 50 centavos",
    "Gasto personal $80 y $30",
    "Gasto Producalza y Marjorie $80",
    "No registres un gasto personal $80",
    "Transfiere $80 personal",
    "Gasto personal 80 euros",
    "Gasto personal $80 el 2026-13-03",
    "Gasto personal $80 mañana",
    "Recibí $80 y gasté $30 personal",
  ])
    assert.equal(interpretQuickEntry(text, context).ready, false, text);
  assert.equal(
    interpretQuickEntry("Gasto personal $80", {
      ...context,
      business_ids: ["producalza"],
    }).ready,
    false,
  );
  assert.equal(
    interpretQuickEntry("Recibí $80 para gasolina personal", context).draft
      .kind,
    "income",
  );
});
test("local defaults, account ambiguity and payment requests stay explicit", () => {
  const scoped = {
    ...context,
    business_ids: ["marjorie"],
    unit_ids: ["norte"],
  };
  const r = interpretQuickEntry("Solicito pagar $80 en materiales", scoped);
  assert.equal(r.ready, true);
  assert.equal(r.draft.unit_id, "norte");
  assert.equal(r.is_request, true);
  assert.equal(
    interpretQuickEntry("Pagar Marjorie Sur $80", {
      ...scoped,
      units: [
        ...scoped.units,
        { id: "sur", business_id: "marjorie", name: "Sur" },
      ],
    }).ready,
    false,
  );
  const accounts = [
    ...context.accounts,
    { ...context.accounts[0], id: 2, name: "Ahorros" },
  ];
  const ambiguous = interpretQuickEntry("Gasto personal $80 con Pichincha", {
    ...context,
    accounts,
  });
  assert.equal(ambiguous.ready, false);
  assert.ok(ambiguous.missing.includes("account_id"));
  const fixed = interpretQuickEntry("Gasto personal $80 con Pichincha", {
    ...context,
    accounts,
    overrides: { account_id: 2 },
  });
  assert.equal(fixed.ready, true);
  assert.equal(fixed.draft.account_id, 2);
});
