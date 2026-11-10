import { payeeBanks } from "./finance-payees.mjs";

const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
export function receivingBank(value) {
  const name = normalized(value);
  if (!name) return "";
  return payeeBanks.find((bank) => name === normalized(bank) || name === "banco" + normalized(bank) || name === "bancodel" + normalized(bank)) || "";
}

export function storeReceiptRoute(receipt) {
  if (receipt.unit_id !== "marjorie-sur") return null;
  const bank = receivingBank(receipt.receiving_bank);
  if (!bank) return null; // Older receipts without a destination bank retain their existing review flow.
  return bank === "Guayaquil"
    ? { role: "owner", name: "Marlon" }
    : { role: "local-reviewer", name: "Morelia" };
}
