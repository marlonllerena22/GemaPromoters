import {decryptDocument} from './finance-ai.js';
import {matchingBankPerson} from './finance-bank-identity.js';

// Missing names are not contradictions. Two explicit, different people must
// not be merged just because an imported reference and amount happen to match.
export function bankPartyConflicts(db,bankId,counterparty){
  if(!matchingBankPerson(counterparty,counterparty))return false;
  const parties=[];
  for(const table of ['finance_notification_events','finance_mail_messages']){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))continue;
    for(const row of db.prepare(`SELECT encrypted FROM ${table} WHERE bank_transaction_id=? AND state IN ('applied','matched')`).all(bankId)){
      const p=JSON.parse(decryptDocument(row.encrypted).toString());
      if(p.counterparty)parties.push(p.counterparty);
    }
  }
  return parties.some(p=>matchingBankPerson(p,p)&&!matchingBankPerson(p,counterparty));
}
