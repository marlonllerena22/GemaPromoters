import crypto from "node:crypto";
import { audit } from "./finance-db.js";

// Account-specific rule confirmed against the owner's bank statement, not a universal tax rule.
export function applyDigitalServiceTaxes(db, notice, account, parentId, actor = "system:bank-mail") {
  if (!notice.trusted || notice.event !== "card_payment" || notice.card_kind !== "debit" || account.business_id !== "gemashow" || !/pichincha/i.test(account.bank) || !notice.occurred_at || notice.occurred_at < "2026-11-10T08:00:00.000Z") return 0;
  const content = `${notice.counterparty || ""} ${notice.body || ""}`;
  const merchant = /facebk|facebook/i.test(content) ? "Facebook" : /google\s*\*?\s*chatgpt|g\.co\/helppay/i.test(content) ? "Google ChatGPT" : null;
  if (!merchant || /iva incluido|total con impuestos/i.test(content)) return 0;
  const parent = db.prepare("SELECT * FROM finance_bank_transactions WHERE id=? AND account_id=?").get(parentId, account.id);
  if (!parent || parent.amount_cents !== -notice.amount_cents) return 0;
  return db.transaction(() => {
    let count = 0;
    for (const [code, rate] of [["ISD", 5], ["IVA", 15]]) {
      if (db.prepare("SELECT 1 FROM finance_digital_taxes WHERE principal_bank_id=? AND tax_code=?").get(parent.id, code)) continue;
      const amount = Math.round(notice.amount_cents * rate / 100);
      if (!amount) continue;
      const key = `digital-tax:${parent.id}:${code}`;
      const inserted = db.prepare("INSERT INTO finance_bank_transactions(account_id,day,amount_cents,reference,description,fingerprint,batch_id,source,created_by,import_source,occurred_at) VALUES (?,?,?,?,?,?,?,'calculated',?,'digital-tax',?)").run(account.id, parent.day, -amount, `${parent.reference || parent.id}-${code}`, `${code} ${rate}% · ${merchant} · calculado sobre consumo`, crypto.createHash("sha256").update(key).digest("hex"), key, actor, parent.occurred_at);
      const bankId = Number(inserted.lastInsertRowid);
      db.prepare("INSERT INTO finance_digital_taxes VALUES (?,?,?,?,?,?,?,'calculated')").run(parent.id, code, merchant, rate, amount, bankId, new Date().toISOString());
      audit(db, actor, "digital.tax_calculated", "bank_transaction", bankId, null, { principal_bank_id: parent.id, tax_code: code, rate, amount_cents: amount, rule: "owner-confirmed-pichincha-digital-20261110" });
      count++;
    }
    return count;
  })();
}
