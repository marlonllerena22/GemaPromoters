import { payeeBanks } from "./finance-payees.mjs";

const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
export function receivingBank(value) {
  const name = normalized(value);
  if (!name) return "";
  return payeeBanks.find((bank) => name === normalized(bank) || name === "banco" + normalized(bank) || name === "bancodel" + normalized(bank)) || "";
}

export function storeReceiptRoute(receipt) {
  if(['marjorie-valle','marjorie-bosque'].includes(receipt.unit_id))return {role:'owner',name:'Marlon'};
  if(receipt.unit_id==='marjorie-norte')return {role:'local-reviewer',name:'Liliana'};
  if (receipt.unit_id !== "marjorie-sur") return null;
  const bank = receivingBank(receipt.receiving_bank);
  if (!bank) return {role:"local-reviewer",name:"Morelia"};
  if(receipt.account_holder==='owner')return {role:'owner',name:'Marlon'};
  if(receipt.account_holder==='more-sur')return {role:'local-reviewer',name:'Morelia'};
  if(receipt.account_holder==='lili')return {role:'local-reviewer',name:'Liliana'};
  return ["Guayaquil","Produbanco"].includes(bank)
    ? { role: "owner", name: "Marlon" }
    : { role: "local-reviewer", name: "Morelia" };
}
