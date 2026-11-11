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
  const state=one(['state'])??(body.event==='sale.registered'?'active':undefined);
  return {external_id,unit_id,business_id:'marjorie',source_system:'alfabusiness',
    document_number:one(['document_number','invoice_number','factura'],String)||'',
    day:day??(sold?financeDay(sold):undefined),total_cents:total??usdTotal,
    refunded_cents:one(['refunded_cents'])??0,state,source_updated_at:updated,
    payments:one(['payments'])??[],...(one(['currency'])?{currency:one(['currency'])}:{})};
}
