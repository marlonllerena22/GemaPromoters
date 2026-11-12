import {allocateCents,tierCommission} from '../../shared/finance-retail.mjs';

const methods=['cash','transfer','card','payphone','other'];
const sum=(xs,f)=>xs.reduce((n,x)=>n+f(x),0);
// Allocate sequentially against remaining row capacity, preserving both axes to the cent.
export function retailNotebook(entries,thresholds,settings,unit,management,expenses,period){
 const rows=entries.flatMap(s=>{
  const items=s.items||[{product:'Detalle por completar',size:'',seller:'',quantity:null,unit_price_cents:null}], known=!!s.items;
  const weights=items.map(x=>known?x.quantity*x.unit_price_cents:s.net_cents),remaining=[...weights];
  const columns={};let paid=0;
  for(const method of methods){
   const value=sum(s.payments.filter(p=>p.method===method),p=>p.amount_cents-(p.refunded_cents||0));paid+=value;
   // Overpayments stay in a separate reconciliation row, never inflate a product's price.
   const allocatable=Math.min(Math.max(0,value),sum(remaining,x=>x));
   columns[method]=allocateCents(allocatable,remaining);columns[method].forEach((v,i)=>remaining[i]-=v);
   columns[method].overflow=value-allocatable;
  }
  const fee=Math.round(sum(s.payments.filter(p=>p.method==='card'),p=>p.amount_cents-(p.refunded_cents||0))*settings[s.day.slice(0,7)].card_fee_bps/10000);
  const feeParts=allocateCents(fee,columns.card);
  const eligible=thresholds.find(t=>t.month===s.day.slice(0,7))?.eligible;
  const result=items.map((x,i)=>{
   const commission=known?(eligible?x.quantity*tierCommission(x.unit_price_cents,unit==='marjorie-bosque'):0):null;
   return {sale_id:s.id,external_id:s.external_id,day:s.day,document_number:s.document_number,product:x.product,size:x.size,seller:x.seller,quantity:x.quantity,unit_price_cents:x.unit_price_cents,total_cents:weights[i],...Object.fromEntries(methods.map(m=>[m,columns[m][i]])),unpaid_cents:remaining[i],commission_cents:commission,complete:known,
    ...(management?{unit_cost_cents:known?x.unit_cost_cents:null,cost_cents:known?x.quantity*x.unit_cost_cents:null,card_fee_cents:feeParts[i],margin_cents:known?weights[i]-x.quantity*x.unit_cost_cents-feeParts[i]-commission:null}:{} )};
  });
  if(methods.some(m=>columns[m].overflow))result.push({sale_id:s.id,external_id:s.external_id,day:s.day,product:'Cobros por conciliar',size:'',seller:'',quantity:0,total_cents:0,unit_price_cents:null,...Object.fromEntries(methods.map(m=>[m,columns[m].overflow])),unpaid_cents:Math.min(0,s.net_cents-paid),commission_cents:0,complete:false,...(management?{unit_cost_cents:null,cost_cents:0,card_fee_cents:fee-sum(feeParts,x=>x),margin_cents:null}:{})});
  return result;
 });
 const keys=['quantity','total_cents',...methods,'unpaid_cents','commission_cents',...(management?['cost_cents','card_fee_cents','margin_cents']:[])];
 const totals=Object.fromEntries(keys.map(k=>[k,rows.some(r=>r[k]===null)?null:sum(rows,r=>r[k]||0)]));
 const days=[];for(let d=period.from;d<=period.to;){const sales=sum(entries.filter(s=>s.day===d),s=>s.net_cents),spent=sum(expenses.filter(e=>e.day===d),e=>e.amount_cents);days.push({day:d,sales_cents:sales,expenses_cents:spent,after_expenses_cents:sales-spent});const date=new Date(d+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);d=date.toISOString().slice(0,10);}
 return {rows,totals,days,expenses_cents:sum(expenses,e=>e.amount_cents),after_expenses_cents:sum(entries,s=>s.net_cents)-sum(expenses,e=>e.amount_cents)};
}
