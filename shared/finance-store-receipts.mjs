import { payeeBanks } from "./finance-payees.mjs";

const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
export function receivingBank(value) {
  const name = normalized(value);
  if (!name) return "";
  return payeeBanks.find((bank) => ['', 'banco', 'bancode', 'bancodel'].some(prefix=>name===prefix+normalized(bank))) || "";
}

export function storeReceiptRoute(receipt) {
  const bank = receivingBank(receipt.receiving_bank);
  if(!['marjorie-norte','marjorie-sur','marjorie-valle','marjorie-bosque'].includes(receipt.unit_id))return null;
  if(bank==='Guayaquil')return {role:'owner',name:'Marlon'};
  if(receipt.unit_id==='marjorie-norte')return {role:'local-reviewer',name:'Liliana'};
  if(receipt.unit_id==='marjorie-sur')return {role:'local-reviewer',name:'Morelia'};
  if(receipt.unit_id==='marjorie-valle'){
    const holder=receipt.account_holder||receipt.receiving_holder;
    if(holder==='lili')return {role:'local-reviewer',name:'Liliana'};
    if(['more-sur','morelia'].includes(holder))return {role:'local-reviewer',name:'Morelia'};
  }
  return {role:'owner',name:'Marlon'};
}
export function receiptNamedHolder(name){
 const words=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]+/g)||[];
 const lili=words.some(w=>['lili','liliana'].includes(w)),more=words.some(w=>['more','morelia'].includes(w));
 const owner=words.includes('marlon');
 return [lili,more,owner].filter(Boolean).length>1?'ambiguous':lili?'lili':more?'morelia':owner?'owner':null;
}
