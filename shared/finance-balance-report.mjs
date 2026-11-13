import {canSeeAllBalances} from './finance-access.mjs';
export const canGenerateBalanceReport=user=>canSeeAllBalances(user)||user?.username==='morelia';
export const BALANCE_REPORT_LIMIT=40;
export const reportMoney=value=>'$'+(value/100).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2});
export const reportDate=value=>new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const clean=value=>String(value||'').replace(/[\r\n\t*_~\x00-\x1f]+/g,' ').replace(/\s+/g,' ').trim();
export function balanceReportRows(data){
 const rows=(data.accounts||[]).filter(a=>['bank','wallet','cash','custody'].includes(a.kind)).map(a=>({
  key:'account:'+a.id,name:a.name,bank:a.bank||'',kind:a.kind,number:a.account_number||(a.grouped?a.account_count+' cuentas agrupadas':a.last_four?'Terminada en '+a.last_four:''),
  balance_cents:Number.isSafeInteger(a.balance_cents)?a.balance_cents:null,
  reserved_cents:a.checking_reserved?Math.max(0,a.balance_cents||0):Math.max(0,a.reserved_cents||0),pending:false,
  ownership:(a.holder_key&&!['owner','marlon'].includes(a.holder_key))||a.kind==='custody'?'other':'own',account_count:a.account_count||1,
 }));
 for(const f of data.custody_funds||[])rows.push({key:'custody:'+f.id,name:f.name,bank:f.id==='efectivo'?'Efectivo':f.bank||'Pichincha',kind:f.id==='efectivo'?'cash':'custody',number:f.account_number||'',balance_cents:Number.isSafeInteger(f.balance_cents)?f.balance_cents:null,reserved_cents:0,pending:false,ownership:f.id==='efectivo'?'own':'other',account_count:1});
 for(const f of data.settlement_funds||[])if(f.provider==='diners')for(const pending of [false,true])rows.push({key:'settlement:diners:'+(pending?'pending':'available'),name:pending?'Diners falta':'Diners',bank:'Diners',kind:'settlement',number:'Saldo al '+f.as_of,balance_cents:pending?f.pending_cents:f.available_cents,reserved_cents:0,pending});
 return rows.sort((a,b)=>Number(a.ownership==='other')-Number(b.ownership==='other')||Number(b.reserved_cents>0)-Number(a.reserved_cents>0)||a.bank.localeCompare(b.bank,'es')||a.name.localeCompare(b.name,'es'));
}
const bankGroup=bank=>String(bank||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^banco\s+(de[l]?\s+)?/,'').replace(/\s+/g,'').trim();
export function groupBalanceReportRows(rows){
 const grouped=new Map(),separate=[];
 for(const r of rows){if(r.ownership==='other'||!['bank','wallet'].includes(r.kind)||!r.bank){separate.push(r);continue;}const key=bankGroup(r.bank);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
 const own=[...grouped.entries()].map(([key,accounts])=>{const known=accounts.filter(a=>a.balance_cents!==null),count=accounts.reduce((n,a)=>n+(a.account_count||1),0),unknown=accounts.reduce((n,a)=>n+(a.unknown_count??Number(a.balance_cents===null)),0);return {...accounts[0],key:'bank:'+key,name:accounts[0].bank,number:count>1?count+' cuentas seleccionadas':accounts[0].number,balance_cents:known.length?known.reduce((n,a)=>n+a.balance_cents,0):null,reserved_cents:accounts.reduce((n,a)=>n+a.reserved_cents,0),account_count:count,unknown_count:unknown,ownership:'own'};});
 return [...own,...separate].sort((a,b)=>Number(a.ownership==='other')-Number(b.ownership==='other')||Number(b.reserved_cents>0)-Number(a.reserved_cents>0)||a.bank.localeCompare(b.bank,'es')||a.name.localeCompare(b.name,'es'));
}
export function balanceReportTotals(rows){const total=rows.reduce((n,r)=>n+(r.balance_cents??0),0),pending=rows.reduce((n,r)=>n+(r.pending?(r.balance_cents??0):0),0),reserved=rows.reduce((n,r)=>n+r.reserved_cents,0);return {total_cents:total,pending_cents:pending,reserved_cents:reserved,available_cents:total-pending-reserved,unknown:rows.reduce((n,r)=>n+(r.unknown_count??Number(r.balance_cents===null)),0)};}
export function balanceEmoji(row){const bank=(row.bank||'').toLowerCase();return row.reserved_cents>0?'🎈':row.kind==='cash'?'💵':/pichincha/.test(bank)?'🟨':/guayaquil/.test(bank)?'🟣':/produbanco/.test(bank)?'🟢':/pac[ií]fico/.test(bank)?'🔵':/solidario/.test(bank)?'🪢':/de\s*una/.test(bank)?'🔖':/payphone/.test(bank)?'🟧':/diners/.test(bank)?'💳':'🏦';}
export function balanceReportText(report){
 const t=balanceReportTotals(report.rows),lines=['*REPORTE DE SALDOS*','Al '+reportDate(report.generated_at),''];let section;
 report.rows.forEach(r=>{const next=r.ownership==='other'?'other':'own';if(next!==section){if(section)lines.push('','-----------------------------','');lines.push(next==='other'?'*OTRAS PERSONAS*':'*MIS CUENTAS*');section=next;}const name=clean(r.name),bank=clean(r.bank),label=name.toLocaleLowerCase().includes(bank.toLocaleLowerCase())?name:bank+' · '+name;lines.push(balanceEmoji(r)+' *'+label+'*: '+(r.balance_cents===null?'Por indicar':reportMoney(r.balance_cents))+(r.pending?' (por acreditar)':r.reserved_cents?' ('+reportMoney(r.reserved_cents)+' apartados para cheques)':'')+(r.balance_cents!==null&&r.unknown_count?' ('+r.unknown_count+' saldo(s) por indicar)':''));});
 lines.push('','TOTAL'+(t.unknown?' CONOCIDO':'')+': *'+reportMoney(t.total_cents)+'*');
 if(t.pending_cents||t.reserved_cents)lines.push('Sin corriente ni pendientes: *'+reportMoney(t.available_cents)+'*');
 if(t.unknown)lines.push(t.unknown+' saldo(s) por indicar, no incluidos en el total.');
 lines.push('Solo las cuentas seleccionadas · USD');
 return lines.join('\n');
}

