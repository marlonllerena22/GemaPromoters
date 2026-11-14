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
  reserved_cents:a.checking_reserved?Math.max(0,a.balance_cents||0):Math.max(0,a.reserved_cents||0),pending:false,checking:Boolean(a.checking_reserved||(/guayaquil/i.test(a.bank)&&/corriente/i.test(a.name))),
  ownership:(a.holder_key&&!['owner','marlon'].includes(a.holder_key))||a.kind==='custody'?'other':'own',account_count:a.account_count||1,
 }));
 for(const f of data.custody_funds||[])rows.push({key:'custody:'+f.id,name:f.name,bank:f.id==='efectivo'?'Efectivo':f.bank||'Pichincha',kind:f.id==='efectivo'?'cash':'custody',number:f.account_number||'',balance_cents:Number.isSafeInteger(f.balance_cents)?f.balance_cents:null,reserved_cents:0,pending:false,ownership:f.id==='efectivo'?'own':'other',account_count:1});
 for(const f of data.settlement_funds||[])if(f.provider==='diners')for(const pending of [false,true])rows.push({key:'settlement:diners:'+(pending?'pending':'available'),name:pending?'Falta Diners':'Diners',bank:'Diners',kind:'settlement',number:f.as_of?'Saldo al '+f.as_of:'Saldo pendiente de indicar',balance_cents:(pending?f.pending_cents:f.available_cents)??null,reserved_cents:0,pending,ownership:'own',checking:false});
 return rows.sort(reportOrder);
}
const reportOrder=(a,b)=>Number(Boolean(a.checking))-Number(Boolean(b.checking))||Number(a.ownership==='other')-Number(b.ownership==='other')||a.bank.localeCompare(b.bank,'es')||a.name.localeCompare(b.name,'es');
const bankGroup=bank=>String(bank||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^banco\s+(de[l]?\s+)?/,'').replace(/\s+/g,'').trim();
export function groupBalanceReportRows(rows){
 const grouped=new Map(),separate=[];
 for(const r of rows){if(r.checking||r.ownership==='other'||!['bank','wallet'].includes(r.kind)||!r.bank){separate.push(r);continue;}const key=bankGroup(r.bank);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
 const own=[...grouped.entries()].map(([key,accounts])=>{const known=accounts.filter(a=>a.balance_cents!==null),count=accounts.reduce((n,a)=>n+(a.account_count||1),0),unknown=accounts.reduce((n,a)=>n+(a.unknown_count??Number(a.balance_cents===null)),0);return {...accounts[0],key:'bank:'+key,name:accounts[0].bank,number:count>1?count+' cuentas seleccionadas':accounts[0].number,balance_cents:known.length?known.reduce((n,a)=>n+a.balance_cents,0):null,reserved_cents:accounts.reduce((n,a)=>n+a.reserved_cents,0),account_count:count,unknown_count:unknown,ownership:'own'};});
 return [...own,...separate].sort(reportOrder);
}
export function balanceReportTotals(rows){
 const cash=rows.filter(r=>!r.checking&&!r.pending),own=cash.filter(r=>r.ownership!=='other'),checks=rows.filter(r=>r.checking),pending=rows.filter(r=>r.pending);
 const sum=rs=>rs.reduce((n,r)=>n+(r.balance_cents??0),0),unknown=rs=>rs.reduce((n,r)=>n+(r.unknown_count??Number(r.balance_cents===null)),0);
 return {total_cents:sum(cash),own_cents:sum(own),others_cents:sum(cash.filter(r=>r.ownership==='other')),checks_cents:sum(checks),pending_cents:sum(pending),available_cents:sum(cash),reserved_cents:sum(checks),unknown:unknown(rows),cash_unknown:unknown(cash),own_unknown:unknown(own),checks_unknown:unknown(checks),pending_unknown:unknown(pending)};
}
export function balanceReportSections(rows){return {own:rows.filter(r=>!r.checking&&!r.pending&&r.ownership!=='other'),other:rows.filter(r=>!r.checking&&!r.pending&&r.ownership==='other'),checks:rows.filter(r=>r.checking)};}
export const reportTotalLabel=(value,unknown)=>unknown?(value?reportMoney(value)+' (parcial)':'Por indicar'):reportMoney(value);
export function balanceEmoji(row){const bank=(row.bank||'').toLowerCase();return row.reserved_cents>0?'🎈':row.kind==='cash'?'💵':/pichincha/.test(bank)?'🟨':/guayaquil/.test(bank)?'🟣':/produbanco/.test(bank)?'🟢':/pac[ií]fico/.test(bank)?'🔵':/solidario/.test(bank)?'🪢':/de\s*una/.test(bank)?'🔖':/payphone/.test(bank)?'🟧':/diners/.test(bank)?'💳':'🏦';}
export function balanceReportText(report){
 const t=balanceReportTotals(report.rows),s=balanceReportSections(report.rows),lines=['*REPORTE DE SALDOS*','Al '+reportDate(report.generated_at),''];
 const row=r=>{const name=clean(r.name),bank=clean(r.bank),label=name.toLocaleLowerCase().includes(bank.toLocaleLowerCase())?name:bank+' · '+name;lines.push(balanceEmoji(r)+' *'+label+'*: '+(r.balance_cents===null?'Por indicar':reportMoney(r.balance_cents))+(r.balance_cents!==null&&r.unknown_count?' ('+r.unknown_count+' saldo(s) por indicar)':''));};
 if(s.own.length){lines.push('*MIS CUENTAS*');s.own.forEach(row);lines.push('','TOTAL MIS CUENTAS: *'+reportTotalLabel(t.own_cents,t.own_unknown)+'*');}
 if(s.other.length){lines.push('','-----------------------------','','*OTRAS PERSONAS*');s.other.forEach(row);}
 lines.push('','TOTAL EFECTIVO: *'+reportTotalLabel(t.total_cents,t.cash_unknown)+'*');
 if(s.checks.length){lines.push('','-----------------------------','','*CORRIENTE PARA CHEQUES · APARTE*');s.checks.forEach(row);}
 lines.push('','TOTAL EFECTIVO: *'+reportTotalLabel(t.total_cents,t.cash_unknown)+'*','TOTAL CHEQUES: *'+reportTotalLabel(t.checks_cents,t.checks_unknown)+'*','Falta Diners: *'+reportTotalLabel(t.pending_cents,t.pending_unknown)+'*');
 if(t.unknown)lines.push(t.unknown+' saldo(s) por indicar, no incluidos en el total.');
 lines.push('Efectivo sin corriente ni Diners pendientes. Solo cuentas seleccionadas · USD');
 return lines.join('\n');
}

