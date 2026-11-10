import {privateSetting} from "./finance-operations.js";
import {visibleAccounts} from "./finance-service.js";
const bank=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/banco|del|[^a-z]/g,"");
export function suggestOriginAccount(db,user,analysis){
  if(user.role!=="owner")return {state:"restricted",account_id:null};
  const suffix=String(analysis.origin_account_suffix||"").replace(/\s|-/g,"");
  if(!/^\d{3,20}$/.test(suffix))return {state:"unreadable",account_id:null};
  const registry=privateSetting(db,"own_account_registry")||{accounts:[]};
  const candidates=visibleAccounts(db,user).filter(a=>a.kind==="bank" && (!analysis.origin_bank||(bank(a.bank)===bank(analysis.origin_bank)||bank(analysis.origin_bank).startsWith(bank(a.bank))))).filter(a=>{
    const registered=registry.accounts.find(r=>r.account_id===a.id);
    const known=registered?.number||registered?.suffix||a.last_four;
    return known && String(known).slice(-Math.min(String(known).length,suffix.length))===suffix.slice(-Math.min(String(known).length,suffix.length));
  });
  return candidates.length===1?{state:"matched",account_id:candidates[0].id,suffix}: {state:candidates.length?"ambiguous":"not_found",account_id:null,suffix};
}
