import {financeDay} from './finance-db.js';
const reject=message=>{throw Object.assign(new Error(message),{status:400});};
const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const stores={
  'marjorie-norte':['norte','quito norte','marjorie norte','marjorie botas norte','local marjorie botas norte'],
  'marjorie-sur':['sur','quito sur','marjorie sur','marjorie botas sur','local marjorie botas sur'],
  'marjorie-valle':['valle','marjorie valle','marjorie botas valle','local marjorie botas valle'],
  'marjorie-bosque':['bosque','el bosque','paseo el bosque','jc sebastian','jc sebastian / paseo el bosque','marjorie bosque','marjorie botas bosque','local marjorie botas bosque'],
};
const aliases=new Map(Object.entries(stores).flatMap(([id,names])=>[id,...names].map(n=>[key(n),id])));
const locationFields=['unit_id','unitId','local','location','sucursal','branch_name','branchName','store_name','storeName'];
function localId(value){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const candidates=['unit_id','unitId','code','name','nombre','label','id'].map(k=>value[k]).filter(v=>typeof v==='string').map(v=>aliases.get(key(v))).filter(Boolean);
    const found=[...new Set(candidates)];if(found.length===1)return found[0];if(found.length>1)reject('El objeto local identifica locales diferentes');
  }else if(typeof value==='string'&&aliases.has(key(value)))return aliases.get(key(value));
  reject('Local no reconocido. Usa unit_id: marjorie-norte, marjorie-sur, marjorie-valle o marjorie-bosque');
}
const present=v=>v!==undefined&&v!==null&&v!=='';
function dollars(value){
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)))reject('El total en dólares debe ser positivo y tener hasta dos decimales; usa total_cents para centavos');
  const [whole,dec='']=String(value).split('.'),amount=Number(whole)*100+Number(dec.padEnd(2,'0'));if(!Number.isSafeInteger(amount))reject('Importe fuera de rango');return amount;
}
const paymentAliases=new Map([
  ['cash','cash'],['efectivo','cash'],['card','card'],['tarjeta','card'],
  ['tarjetadecredito','card'],['tarjetadedebito','card'],
  ['transfer','transfer'],['transferencia','transfer'],['transferenciabancaria','transfer'],
  ['payphone','payphone'],['other','other'],['otro','other'],['otros','other'],
]);
function paymentBreakdown(rows,label){
  if(!Array.isArray(rows)||rows.length>20)reject(`${label} debe ser un desglose de hasta 20 pagos`);
  return rows.map(p=>{
    if(!p||typeof p!=='object'||Array.isArray(p))reject(`Pago inválido en ${label}`);
    const method=paymentAliases.get(key(p.method));
    if(!method)reject(`Medio de pago no reconocido en ${label}`);
    const amount=present(p.amount)?dollars(p.amount):undefined;
    if(p.amount_cents!==undefined&&amount!==undefined&&p.amount_cents!==amount)reject('amount y amount_cents del pago no coinciden');
    const amount_cents=p.amount_cents??amount,refunded_cents=p.refunded_cents??0;
    if(!Number.isSafeInteger(amount_cents)||amount_cents<0||!Number.isSafeInteger(refunded_cents)||refunded_cents<0||refunded_cents>amount_cents)reject(`Importe de pago inválido en ${label}`);
    return {method,amount_cents,...(refunded_cents?{refunded_cents}:{})};
  });
}
function paymentTotals(rows){
  const totals=new Map();
  for(const p of rows){const prior=totals.get(p.method)||[0,0];prior[0]+=p.amount_cents;prior[1]+=p.refunded_cents||0;totals.set(p.method,prior);}
  return JSON.stringify([...totals].sort(([a],[b])=>a.localeCompare(b)));
}
function upsertState(status,voidInfo,returns,explicitState,refund){
  if(!status||typeof status!=='object'||Array.isArray(status)){
    if(explicitState)return explicitState;
    reject('sale.upserted requiere state o sale.status con invoice_status e is_voided');
  }
  if(status.is_voided!==undefined&&typeof status.is_voided!=='boolean')reject('sale.status.is_voided debe ser booleano');
  if(!Array.isArray(returns))reject('sale.returns debe ser una lista');
  if(returns.length&&(!explicitState||refund===undefined))reject('Las devoluciones requieren state y refunded_cents acumulados explícitos');
  let derived;
  if(status.is_voided===true)derived='cancelled';
  else if(status.is_voided===false&&!present(voidInfo)&&!present(status.invoice_void_status)&&!returns.length&&!(refund>0)&&status.invoice_status==='invoiced')derived='active';
  if(explicitState){
    if(derived&&explicitState!==derived)reject('state contradice el estado de la factura/anulación');
    return explicitState;
  }
  if(!derived)reject('Estado de sale.upserted ambiguo: envía state financiero explícito');
  return derived;
}
// Called only after verification of the HMAC over the original request bytes.
// Query parameters never identify a store: they are outside the signed body.
export function normalizeAlfaBusinessSale(body,{idempotencyKey}={}){
  if(!body||typeof body!=='object'||Array.isArray(body))reject('Envía un objeto JSON de venta');
  if(body.sale!==undefined&&(!body.sale||typeof body.sale!=='object'||Array.isArray(body.sale)))reject('sale debe ser un objeto de venta');
  const sources=[body,...(body.sale?[body.sale]:[])];
  const values=fields=>sources.flatMap(s=>fields.map(k=>s[k])).filter(present);
  const one=(fields,transform=v=>v)=>{const vs=values(fields).map(transform);if(new Set(vs.map(v=>JSON.stringify(v))).size>1)reject(`Datos contradictorios en ${fields[0]}`);return vs[0];};
  const locations=values(locationFields).map(localId),unique=[...new Set(locations)];
  if(!unique.length)reject('La venta debe identificar el local: envía unit_id en la raíz o sale.local (marjorie-norte, marjorie-sur, marjorie-valle, marjorie-bosque)');
  if(unique.length!==1)reject('Los campos del aviso identifican locales diferentes');
  const unit_id=unique[0];
  // Preserve previously accepted canonical bodies and their payload comparison.
  if(present(body.unit_id)&&['external_id','day','total_cents','state','source_updated_at'].every(k=>present(body[k])))return {...body,unit_id,business_id:'marjorie',source_system:'alfabusiness'};
  const sourceIds=(body.sale?[body.sale.sale_id??body.sale.id,body.sale_id]:[body.sale_id,body.id]).filter(present).map(String);
  if(new Set(sourceIds).size>1)reject('Los identificadores de venta son contradictorios');
  const external_id=one(['external_id'],String)??sourceIds[0]??(idempotencyKey?.match(/^mb-sale-(.+)$/)?.[1]);
  const total=one(['total_cents']),usdTotal=one(['total'],dollars);if(total!==undefined&&usdTotal!==undefined&&total!==usdTotal)reject('total y total_cents no coinciden');
  const updated=one(['source_updated_at'])??one(['updated_at'])??body.occurred_at??one(['sold_at']);
  const sold=one(['sold_at'])??body.occurred_at,day=one(['day','sale_date']);
  if(!day&&sold&&(!/(Z|[+-]\d{2}:\d{2})$/.test(String(sold))||!Number.isFinite(Date.parse(sold))))reject('Incluye la zona horaria en sold_at u occurred_at');
  const explicitState=one(['state']),refund=one(['refunded_cents']);
  const state=body.event==='sale.upserted'
    ?upsertState(one(['status']),one(['void']),one(['returns'])??[],explicitState,refund)
    :explicitState??(body.event==='sale.registered'?'active':undefined);
  const rawPayments=one(['payments']),rawMethods=one(['payment_methods']);
  const canonicalPayments=rawPayments===undefined?[]:paymentBreakdown(rawPayments,'payments');
  const methodPayments=rawMethods===undefined?[]:paymentBreakdown(rawMethods,'payment_methods');
  if(canonicalPayments.length&&methodPayments.length&&paymentTotals(canonicalPayments)!==paymentTotals(methodPayments))reject('payments y payment_methods no coinciden');
  // Preserve the representation of earlier canonical envelopes on replay.
  const payments=body.event!=='sale.upserted'&&rawMethods===undefined?(rawPayments??[]):canonicalPayments.length?canonicalPayments:methodPayments;
  const paid=one(['amount_paid'],dollars),due=one(['balance_due'],dollars),total_cents=total??usdTotal;
  if(paid!==undefined&&paid!==payments.reduce((sum,p)=>sum+p.amount_cents,0))reject('amount_paid no coincide con el desglose de cobros');
  if(paid!==undefined&&due!==undefined&&!(refund>0)&&paid+due!==total_cents)reject('amount_paid y balance_due no coinciden con el total');
  return {external_id,unit_id,business_id:'marjorie',source_system:'alfabusiness',
    document_number:one(['document_number','invoice_number','factura'],String)||'',
    day:day??(sold?financeDay(sold):undefined),total_cents,
    refunded_cents:refund??0,state,source_updated_at:updated,
    payments,...(one(['currency'])?{currency:one(['currency'])}:{})};
}
