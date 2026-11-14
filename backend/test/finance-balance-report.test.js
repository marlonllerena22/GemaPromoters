import test from 'node:test';import assert from 'node:assert/strict';import {PDFParse} from 'pdf-parse';
import {balanceReportRows,groupBalanceReportRows,balanceReportTotals,balanceReportText} from '../../shared/finance-balance-report.mjs';import {balanceReportPdf} from '../src/finance-balance-report.js';
test('WhatsApp matches the supplied template, with independent subtotals and no checking or pending in cash',async()=>{
 const data={accounts:[
  {id:1,name:'Corriente',bank:'Guayaquil',kind:'bank',balance_cents:50000,checking_reserved:true},
  ...[['Pichincha',3000],['Pichincha',2152],['Produbanco',144],['Pacífico',238],['Solidario',17],['Guayaquil',258],['Deuna',330],['PayPhone',4757]].map(([bank,value],i)=>({id:i+2,name:bank,bank,kind:'bank',balance_cents:value*100}))
 ],custody_funds:[['xavi-ahorros','Xavi Ahorros',350,'Guayaquil'],['efectivo','EFECTIVO',400,'Efectivo'],['marcela','Marcela',1770],['henry','Henry',4000],['paty','Ñaña Paty',1839],['morelia','More',1380],['anita','Anita',2000]].map(([id,name,value,bank])=>({id,name,balance_cents:value*100,bank})),settlement_funds:[{provider:'diners',available_cents:0,pending_cents:390000}]};
 const raw=balanceReportRows(data),rows=groupBalanceReportRows(raw),totals=balanceReportTotals(rows),report={rows,totals,generated_at:'2026-11-14T18:00:00Z'};
 assert.deepEqual(totals,balanceReportTotals(raw));assert.equal(totals.own_cents,613900);assert.equal(totals.others_cents,1649600);assert.equal(totals.total_cents,2263500);
 assert.equal(balanceReportText(report),`🎈*Guayaquil Corr:*: $500
-----------------------------------------

🟨*Pichincha*:$5152
🟢*Produbanco*: $144
🔵*Pacifico*: $238
🪢*Solidario*: $17
🎈*Guayaquil Ah*: $258
🔖*De una*: $330
💳*Dinners* : $0
*......TOTAL $6139.....*
💳*Dinners falta*: $3900~
--------------------------------------------
📙*XAVI PAYPHONE* $4757
🎈*XAVI Ahorro* $350
💰 *EFECTIVO*  $400
🟨*MARCELA* $1770
🟨 *HENRY* :$4000
🟨*ÑAÑA PATY* $1839
🟨 *MORE* $1380
🟨 *ANITA* $2000
*......TOTAL $16496......*

-----------------------------------------------
TOTAL EFECTIVO $22635`);
 const selected=rows.filter(r=>['bank:pichincha','custody:efectivo'].includes(r.key)),partial=balanceReportText({...report,rows:selected});assert.match(partial,/TOTAL EFECTIVO \$5552/);assert.doesNotMatch(partial,/Dinners|Guayaquil|MORE|PAYPHONE/);
 const parser=new PDFParse({data:await balanceReportPdf(report)});try{const pdf=await parser.getText();assert.equal(pdf.total,1);assert.ok(pdf.text.indexOf('Guayaquil Corr:')<pdf.text.indexOf('Pichincha'));assert.ok(pdf.text.indexOf('Dinners falta')<pdf.text.indexOf('XAVI PAYPHONE'));assert.match(pdf.text,/\$6\.139,00/);assert.match(pdf.text,/\$16\.496,00/);}finally{await parser.destroy();}
});
test('only selected owner accounts group by bank; other holders stay separate at the end',async()=>{
 const rows=balanceReportRows({accounts:[{id:1,name:'Marlon',bank:'Pichincha',kind:'bank',balance_cents:10010},{id:2,name:'Producalza',bank:'Pichincha',kind:'bank',balance_cents:20020},{id:3,name:'Gemashow',bank:'Pichincha',kind:'bank',balance_cents:99999},{id:4,name:'Corriente',bank:'Guayaquil',kind:'bank',balance_cents:50000,checking_reserved:true},{id:5,name:'Pagos',bank:'Guayaquil',kind:'bank',balance_cents:10000},{id:6,name:'Liliana',bank:'Pichincha',kind:'bank',holder_key:'lili',balance_cents:3000},{id:7,name:'More SUR',bank:'Pichincha',kind:'bank',holder_key:'more-sur',balance_cents:4000}],custody_funds:[{id:'henry',name:'Henry',bank:'Pichincha',balance_cents:5000},{id:'marce',name:'Marcela',bank:'Pichincha',balance_cents:6000}]});
 const selected=rows.filter(r=>r.key!=='account:3'),grouped=groupBalanceReportRows(selected);assert.equal(grouped.length,7);assert.deepEqual(balanceReportTotals(grouped),balanceReportTotals(selected));assert.equal(grouped.find(r=>r.key==='bank:pichincha').balance_cents,30030);assert.equal(grouped.find(r=>r.key==='bank:guayaquil').balance_cents,10000);assert.equal(grouped.at(-1).checking,true);assert.equal(grouped.at(-1).balance_cents,50000);assert.ok(grouped.slice(2,-1).every(r=>r.ownership==='other'));assert.equal(balanceReportTotals(grouped).own_cents,40030);assert.equal(balanceReportTotals(grouped).total_cents,58030);
 const report={generated_at:'2026-11-13T19:00:00Z',rows:grouped,totals:balanceReportTotals(grouped)},text=balanceReportText(report);assert.match(text,/🟨\*Pichincha\*:\$300,30/);assert.ok(text.indexOf('*HENRY*')>text.indexOf('*Guayaquil Ah*'));assert.match(text,/HENRY/);assert.match(text,/MARCELA/);assert.doesNotMatch(text,/Gemashow/);
 const parser=new PDFParse({data:await balanceReportPdf(report)});try{const parsed=await parser.getText();assert.equal(parsed.total,1);assert.ok(parsed.text.indexOf('MARCELA')>parsed.text.indexOf('Pichincha'));assert.match(parsed.text,/HENRY/);}finally{await parser.destroy();}
 const incomplete=groupBalanceReportRows([{...selected[0],bank:'Pichincha',balance_cents:null,ownership:'own'},{...selected[1],bank:'Pichincha',balance_cents:2000,ownership:'own'}]);assert.equal(incomplete[0].balance_cents,2000);assert.equal(balanceReportTotals(incomplete).unknown,1);assert.match(balanceReportText({...report,rows:incomplete}),/parcial/);
});
test('selected totals keep unknown, reserved and pending funds distinct without counting credit cards',()=>{
 const rows=balanceReportRows({accounts:[{id:1,kind:'bank',name:'Corriente',bank:'Guayaquil',balance_cents:50000,checking_reserved:true},{id:2,kind:'bank',name:'Marlon',bank:'Pichincha',balance_cents:10010},{id:3,kind:'bank',name:'Liliana',bank:'Pichincha',balance_cents:null},{id:4,kind:'card',balance_cents:-30000}],custody_funds:[{id:'efectivo',name:'EFECTIVO',balance_cents:5000}],settlement_funds:[{provider:'diners',available_cents:0,pending_cents:390000,as_of:'2026-11-13'}]});
 assert.equal(rows.length,6);const t=balanceReportTotals(rows);assert.equal(t.total_cents,15010);assert.equal(t.pending_cents,390000);assert.equal(t.checks_cents,50000);assert.equal(t.unknown,1);
 const selected=rows.filter(r=>['account:2','custody:efectivo'].includes(r.key));assert.equal(balanceReportTotals(selected).total_cents,15010);
 const text=balanceReportText({generated_at:'2026-11-13T18:00:00Z',rows});assert.match(text,/🟨\*Marlon\*: \$100,10/);assert.match(text,/Dinners falta\*: \$3900~/);assert.match(text,/TOTAL EFECTIVO \$150,10 \(parcial\)/);assert.match(text,/Guayaquil Corr:\*:\s*\$500/);assert.doesNotMatch(text,/NaN/);

});
test('PDF stays one A4 page for one, sixteen and forty selected accounts, with exact totals',async()=>{
 for(const n of [1,16,40]){const rows=Array.from({length:n},(_,i)=>({key:'account:'+i,name:'Cuenta '+String(i+1).padStart(2,'0'),bank:'Pichincha',number:'220000'+String(i).padStart(4,'0'),balance_cents:i===3?null:10010+i,checking:i===0,reserved_cents:i===0?10010:0,pending:i===5}));const report={generated_at:'2026-11-13T18:00:00Z',rows,totals:balanceReportTotals(rows)},pdf=await balanceReportPdf(report),parser=new PDFParse({data:pdf});try{const text=await parser.getText();assert.equal(text.total,1);assert.match(text.text,/Reporte de cuentas/);if(n>1)assert.match(text.text,new RegExp('Cuenta '+String(n).padStart(2,'0')));assert.ok(text.text.includes(rows.at(-1).number));assert.ok(text.text.includes('$'+(report.totals.total_cents/100).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2})));}finally{await parser.destroy();}}
});

