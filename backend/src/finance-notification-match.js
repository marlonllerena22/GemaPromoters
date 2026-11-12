import { fail } from "./finance-service.js";
import {decryptDocument} from './finance-ai.js';
import {bankPartyConflicts} from './finance-bank-evidence-person.js';

// Shared by email and Android ingestion. Equal amounts alone never prove identity.
export function notificationBankMatch(
  db,
  { account_id, day, amount_cents, reference = "",counterparty='',occurred_at=null }
) {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='finance_notification_events'"
      )
      .get()
  )
    return null;
  const rows = db
    .prepare(
      `SELECT b.*,n.encrypted notification_payload FROM finance_notification_events n
    JOIN finance_bank_transactions b ON b.id=n.bank_transaction_id
    WHERE b.account_id=? AND b.amount_cents=? AND n.state IN ('applied','matched')
    AND ((?!='' AND b.reference=?) OR (b.day=? AND (b.reference='' OR ?='')))`
    )
    .all(account_id, amount_cents, reference, reference, day, reference);
  const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
  const exact = unique.filter((r) => reference && r.reference === reference);
  if (exact.length === 1 && unique.length === 1){
    if(bankPartyConflicts(db,exact[0].id,counterparty))fail('El nombre del aviso no coincide con el movimiento registrado',409);
    return exact[0];
  }
  const name=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').split(/\s+/).filter(w=>w.length>1).sort().join(' ');
  if(unique.length===1&&name(counterparty).split(' ').length>=2){
    const row=unique[0],p=JSON.parse(decryptDocument(row.notification_payload).toString());
    if(name(p.counterparty)===name(counterparty)&&Number.isFinite(Date.parse(occurred_at))&&Number.isFinite(Date.parse(row.occurred_at))&&Math.abs(Date.parse(occurred_at)-Date.parse(row.occurred_at))<=5*60000)return row;
  }
  if (rows.length)
    fail(
      "Hay un aviso Android con ese valor. Relaciónalo en Avisos de bancos para evitar registrarlo dos veces",
      409
    );
  return null;
}
