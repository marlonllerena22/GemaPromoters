import {privateSetting} from "./finance-operations.js";
import {visibleAccounts} from "./finance-service.js";
const bank=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/banco|del|[^a-z]/g,"");
export function suggestOriginAccount(db,user,analysis){
  if(user.role!=="owner")return {state:"restricted",account_id:null};
  const raw=String(analysis.origin_account_suffix||"").replace(/\s|-/g,"");
  const suffix=/^[\d*xX]+$/.test(raw)?(raw.match(/\d+$/)?.[0]||''):'';
  const allowed=visibleAccounts(db,user).filter(a=>a.kind==='bank');
  const reference=String(analysis.reference||'').trim();
  const verified=reference&&analysis.day&&Number.isSafeInteger(analysis.amount_cents)?db.prepare("SELECT DISTINCT account_id FROM finance_bank_transactions WHERE reference=? AND day=? AND amount_cents=? AND import_source IN ('bank-email','bank-notification')").all(reference,analysis.day,-analysis.amount_cents).filter(b=>allowed.some(a=>a.id===b.account_id)):[];
  if(!/^\d{3,20}$/.test(suffix))return verified.length===1?{state:'matched',account_id:verified[0].account_id,suffix:allowed.find(a=>a.id===verified[0].account_id).last_four,source:'bank_evidence'}:{state:verified.length?'ambiguous':'unreadable',account_id:null};
  const registry=privateSetting(db,"own_account_registry")||{accounts:[]};
  const candidates=allowed.filter(a=>(!analysis.origin_bank||(bank(a.bank)===bank(analysis.origin_bank)||bank(analysis.origin_bank).startsWith(bank(a.bank))))).filter(a=>{
    const registered=registry.accounts.find(r=>r.account_id===a.id);
    const known=registered?.number||registered?.suffix||a.last_four;
    return known && String(known).slice(-Math.min(String(known).length,suffix.length))===suffix.slice(-Math.min(String(known).length,suffix.length));
  });
  if(verified.length===1&&candidates.length&&!candidates.some(a=>a.id===verified[0].account_id))return {state:'conflict',account_id:null,suffix};
  return candidates.length===1?{state:"matched",account_id:candidates[0].id,suffix}: {state:candidates.length?"ambiguous":"not_found",account_id:null,suffix};
}
