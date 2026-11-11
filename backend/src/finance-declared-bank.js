import { fail } from "./finance-service.js";
import { decryptDocument } from "./finance-ai.js";

const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const unknownBankParty=value=>!normalized(value)||/^(?:movimiento por correo|beneficiario no indicado|origen no indicado|no indicado|no especificado|no identificado|desconocido|por identificar)$/.test(normalized(value));
export function bankEvidenceParty(payload={}){
  if(!unknownBankParty(payload.counterparty))return payload.counterparty;
  return payload.body?.match(/Cuenta destino\s+Nombre:\s*(?:N[uú]mero de cuenta:\s*)?([\p{L}][\p{L}\s.'-]+?)\s+(?:\*{2,}|Documento:)/iu)?.[1]?.trim()||'';
}
export function recordedBankOptions(db,{account_id,day,amount_cents}){
  const rows=db.prepare(`SELECT b.*,m.encrypted,m.state mail_state,xm.counterparty saved_counterparty,xm.kind saved_kind,
    EXISTS(SELECT 1 FROM finance_own_transfers t WHERE t.origin_bank_id=b.id OR t.destination_bank_id=b.id) own_transfer
    FROM finance_bank_transactions b LEFT JOIN finance_mail_messages m ON m.bank_transaction_id=b.id
    LEFT JOIN finance_allocations x ON x.bank_transaction_id=b.id LEFT JOIN finance_movements xm ON xm.id=x.movement_id
    WHERE b.account_id=? AND b.day=? AND b.amount_cents=? AND b.import_source!='assistant'`).all(account_id,day,amount_cents);
  const options=new Map();
  for(const {encrypted,mail_state,...row} of rows){
    let party=unknownBankParty(row.saved_counterparty)?'':row.saved_counterparty;
    try{if(encrypted&&mail_state==='applied')party=bankEvidenceParty(JSON.parse(decryptDocument(encrypted).toString()))||party;}catch{}
    options.set(row.id,{...row,counterparty:party});
  }
  return [...options.values()];
}
// A declaration without a bank reference must never be credited again just
// because its bank email arrives later. Ambiguity stays in the review inbox.
export function matchUnreferencedDeclaration(db, { account_id, day, amount_cents, counterparty }) {
  const rows = db.prepare(`SELECT DISTINCT b.*,m.counterparty FROM finance_bank_transactions b
    LEFT JOIN finance_allocations a ON a.bank_transaction_id=b.id
    LEFT JOIN finance_movements m ON m.id=a.movement_id
    WHERE b.account_id=? AND b.day=? AND b.amount_cents=? AND b.import_source IN ('assistant','statement-image') AND COALESCE(b.reference,'')=''`).all(account_id, day, amount_cents);
  if (!rows.length) return null;
  const name = normalized(counterparty);
  const matches = rows.filter((r) => name && normalized(r.counterparty) === name);
  if (matches.length === 1 && rows.length === 1) return matches[0];
  fail("Hay un registro declarado con el mismo valor y fecha, sin referencia bancaria. Relaciona el aviso en Revisión antes de sumarlo otra vez", 409);
}

export function matchKnownBankReceipt(db, {account_id,day,amount_cents,counterparty}) {
  const rows = db.prepare(`SELECT b.*,m.encrypted,a.counterparty saved_counterparty FROM finance_bank_transactions b
    LEFT JOIN finance_mail_messages m ON m.bank_transaction_id=b.id
    LEFT JOIN finance_allocations x ON x.bank_transaction_id=b.id
    LEFT JOIN finance_movements a ON a.id=x.movement_id
    WHERE b.account_id=? AND b.day=? AND b.amount_cents=? AND b.import_source!='assistant'`).all(account_id,day,amount_cents);
  const candidates=new Map();
  for (const row of rows) {
    let name=row.saved_counterparty;
    try { if(row.encrypted) name=JSON.parse(decryptDocument(row.encrypted).toString()).counterparty || name; } catch {}
    if(normalized(name) && normalized(name)===normalized(counterparty)) candidates.set(row.id,row);
    else if(!normalized(name)) fail("Ya hay un movimiento bancario con ese valor y fecha. Dime la referencia para relacionarlo sin duplicarlo",409);
  }
  if(candidates.size>1) fail("Hay varios depósitos iguales de esa persona. Necesito sus referencias para conservarlos separados",409);
  return [...candidates.values()][0] || null;
}
