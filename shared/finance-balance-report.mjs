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
 const cash=rows.filter(r=>!r.checking&&!r.pending),{own,other,checks}=balanceReportSections(rows),pending=rows.filter(r=>r.pending);
 const sum=rs=>rs.reduce((n,r)=>n+(r.balance_cents??0),0),unknown=rs=>rs.reduce((n,r)=>n+(r.unknown_count??Number(r.balance_cents===null)),0);
 return {total_cents:sum(cash),own_cents:sum(own),others_cents:sum(other),checks_cents:sum(checks),pending_cents:sum(pending),available_cents:sum(cash),reserved_cents:sum(checks),unknown:unknown(rows),cash_unknown:unknown(cash),own_unknown:unknown(own),others_unknown:unknown(other),checks_unknown:unknown(checks),pending_unknown:unknown(pending)};
}
// Report placement is independent of legal ownership and account permissions.
const secondBlock=r=>r.ownership==='other'||r.kind==='cash'||/payphone/i.test(r.bank);
export function balanceReportSections(rows){const order=(a,b)=>reportRowStyle(a).rank-reportRowStyle(b).rank||a.name.localeCompare(b.name,'es');return {own:rows.filter(r=>!r.checking&&!r.pending&&!secondBlock(r)).sort(order),other:rows.filter(r=>!r.checking&&!r.pending&&secondBlock(r)).sort(order),checks:rows.filter(r=>r.checking),pending:rows.filter(r=>r.pending)};}
export const reportTotalLabel=(value,unknown)=>unknown?(value?reportMoney(value)+' (parcial)':'Por indicar'):reportMoney(value);
export function balanceEmoji(row){const bank=(row.bank||'').toLowerCase();return row.checking?'🎈':row.kind==='cash'?'💰':/pichincha/.test(bank)?'🟨':/guayaquil/.test(bank)?'🎈':/produbanco/.test(bank)?'🟢':/pac[ií]fico/.test(bank)?'🔵':/solidario/.test(bank)?'🪢':/de\s*una/.test(bank)?'🔖':/payphone/.test(bank)?'📙':/diners/.test(bank)?'💳':'🏦';}
export function reportRowStyle(r){
 const bank=bankGroup(r.bank),name=clean(r.name),id=r.key;
 if(r.checking)return {label:'Guayaquil Corr:',emoji:'🎈',rank:-1};
 if(r.pending)return {label:'Dinners falta',emoji:'💳',rank:7};
 if(r.kind==='settlement'&&bank==='diners')return {label:'Dinners',emoji:'💳',rank:6};
 if(bank==='payphone'&&r.ownership!=='other')return {label:'XAVI PAYPHONE',emoji:'📙',rank:10};
 if(id==='custody:xavi-ahorros')return {label:'XAVI Ahorro',emoji:'🎈',rank:11};
 if(id==='custody:efectivo')return {label:'EFECTIVO',emoji:'💰',rank:12};
 const holders={'custody:marcela':['MARCELA',13],'custody:marce':['MARCELA',13],'custody:henry':['HENRY',14],'custody:paty':['ÑAÑA PATY',15],'custody:morelia':['MORE',16],'custody:anita':['ANITA',17]};
 if(holders[id])return {label:holders[id][0],emoji:balanceEmoji(r),rank:holders[id][1]};
 const banks={pichincha:['Pichincha',0],produbanco:['Produbanco',1],pacifico:['Pacifico',2],solidario:['Solidario',3],guayaquil:['Guayaquil Ah',4],deuna:['De una',5]};
 if(r.ownership!=='other'&&banks[bank])return {label:id?.startsWith('bank:')?banks[bank][0]:name,emoji:balanceEmoji(r),rank:banks[bank][1]};
 return {label:name,emoji:balanceEmoji(r),rank:secondBlock(r)?20:8};
}
const whatsappMoney=value=>'$'+(value/100).toLocaleString('es-EC',{useGrouping:false,minimumFractionDigits:value%100?2:0,maximumFractionDigits:2});
const whatsappTotal=(value,unknown)=>unknown?(value?whatsappMoney(value)+' (parcial)':'Por indicar'):whatsappMoney(value);
export function balanceReportText(report){
 const t=balanceReportTotals(report.rows),s=balanceReportSections(report.rows),lines=[];
 const row=r=>{const {label,emoji}=reportRowStyle(r),amount=r.balance_cents===null?'Por indicar':whatsappMoney(r.balance_cents),extra=r.balance_cents!==null&&r.unknown_count?' ('+r.unknown_count+' saldo(s) por indicar)':'';
  if(r.checking)lines.push('🎈*Guayaquil Corr:*: '+amount+extra);
  else if(r.pending)lines.push('💳*Dinners falta*: '+amount+extra+'~');
  else if(label==='Dinners')lines.push('💳*Dinners* : '+amount+extra);
  else if(secondBlock(r)){const prefix=label==='EFECTIVO'?'💰 *EFECTIVO*  ':label==='HENRY'?'🟨 *HENRY* :':label==='MORE'?'🟨 *MORE* ':label==='ANITA'?'🟨 *ANITA* ':emoji+'*'+label+'* ';lines.push(prefix+amount+extra);}
  else lines.push(emoji+'*'+label+'*:'+(label==='Pichincha'?'':' ')+amount+extra);
 };
 if(s.checks.length){s.checks.forEach(row);lines.push('-----------------------------------------','');}
 if(s.own.length){s.own.forEach(row);lines.push('*......TOTAL '+whatsappTotal(t.own_cents,t.own_unknown)+'.....*');}
 s.pending.forEach(row);
 if(s.other.length){if(lines.length)lines.push('--------------------------------------------');s.other.forEach(row);lines.push('*......TOTAL '+whatsappTotal(t.others_cents,t.others_unknown)+'......*');}
 lines.push('','-----------------------------------------------','TOTAL EFECTIVO '+whatsappTotal(t.total_cents,t.cash_unknown));
 if(t.unknown)lines.push(t.unknown+' saldo(s) por indicar, no incluidos en el total.');
 return lines.join('\n');
}

