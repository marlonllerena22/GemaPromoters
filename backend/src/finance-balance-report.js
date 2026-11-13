import PDFDocument from 'pdfkit';
import {snapshot,fail} from './finance-service.js';
import {attachOperations} from './finance-operations.js';
import {attachWorkflow} from './finance-workflow.js';
import {balanceReportRows,groupBalanceReportRows,balanceReportTotals,balanceReportText,canGenerateBalanceReport,BALANCE_REPORT_LIMIT,reportMoney,reportDate} from '../../shared/finance-balance-report.mjs';

export function balanceReportCatalog(db,user){
 if(!canGenerateBalanceReport(user))fail('No tienes acceso a reportes de saldos',403);
 const data=attachOperations(db,user,attachWorkflow(db,user,snapshot(db,user,{})));
 return {generated_at:new Date().toISOString(),accounts:balanceReportRows(data)};
}
export function selectedBalanceReport(db,user,keys){
 if(!Array.isArray(keys)||!keys.length||keys.length>BALANCE_REPORT_LIMIT||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length)fail('Selecciona entre 1 y '+BALANCE_REPORT_LIMIT+' cuentas diferentes');
 const catalog=balanceReportCatalog(db,user),allowed=new Map(catalog.accounts.map(r=>[r.key,r]));
 if(keys.some(k=>!allowed.has(k)))fail('Una cuenta ya no está disponible para tu perfil. Actualiza la selección',403);
 const selected=new Set(keys),accounts=catalog.accounts.filter(r=>selected.has(r.key)),rows=groupBalanceReportRows(accounts);
 return {generated_at:catalog.generated_at,accounts,rows,totals:balanceReportTotals(rows)};
}
export async function balanceReportPdf(report){
 const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:'Reporte de cuentas seleccionadas',Author:'Gema Finanzas'}}),chunks=[];
 const done=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const t=report.totals,w=doc.page.width,x=36,width=w-72,green='#254e3e',muted='#6d7d70';
 const write=(text,px,py,size=10,color=green,opts={})=>doc.font(opts.bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(String(text),px,py,{width:opts.width||width,lineBreak:false,...opts});
 doc.rect(0,0,w,8).fill(green);
 write('GEMA FINANZAS',x,34,10,green,{bold:true,characterSpacing:1.5});
 write('Reporte de cuentas',x,58,25,green,{bold:true});
 write('Saldos al '+reportDate(report.generated_at)+' · Ecuador',x,92,10,muted);
 doc.roundedRect(x,121,width,103,12).fill(green);
 write(t.unknown?'TOTAL CONOCIDO DE LA SELECCIÓN':'TOTAL EN CUENTAS SELECCIONADAS',x+20,138,9,'#e4ecdf',{bold:true});
 write(reportMoney(t.total_cents),x+20,156,34,'white',{bold:true,width:width-40});
 write(report.rows.reduce((n,r)=>n+(r.account_count||1),0)+' cuentas y fondos · Agrupados por banco · USD',x+20,200,9,'#e4ecdf');
 let start=241;
 if(t.reserved_cents||t.pending_cents){write('Sin corriente ni pendientes: '+reportMoney(t.available_cents),x,start,10,green,{bold:true});start+=20;}
 write('DETALLE DE LA SELECCIÓN',x,start,9,muted,{bold:true,characterSpacing:1});start+=20;
 const entries=[];let section;for(const r of report.rows){const next=r.ownership==='other'?'other':'own';if(section!==next){entries.push({heading:next==='other'?'OTRAS PERSONAS':'MIS CUENTAS'});section=next;}entries.push(r);}
 const columns=entries.length>16?2:1,gap=18,cw=(width-gap*(columns-1))/columns,perColumn=Math.ceil(entries.length/columns),rowH=Math.min(45,(748-start)/perColumn);
 entries.forEach((r,i)=>{
  const col=Math.floor(i/perColumn),row=i%perColumn,px=x+col*(cw+gap),py=start+row*rowH,compact=columns===2,labelWidth=cw-(compact?83:125);
  if(r.heading){doc.roundedRect(px,py,cw,rowH-2,4).fill('#e4eddf');write(r.heading,px+8,py+7,compact?8:9,green,{bold:true,width:cw-16});return;}
  if(row%2===0)doc.roundedRect(px,py,cw,rowH-2,4).fill('#f3f6ef');
  const name=(r.name.toLowerCase().includes(r.bank.toLowerCase())?'':r.bank+' · ')+r.name;
  doc.font('Helvetica-Bold').fontSize(compact?8:10).fillColor(green).text(name,px+8,py+3,{width:labelWidth-10,height:Math.max(10,rowH-16),ellipsis:true,lineGap:0});
  write(r.balance_cents===null?'Por indicar':reportMoney(r.balance_cents),px+cw-(compact?79:119),py+6,compact?10:12,green,{bold:true,width:compact?71:111,align:'right'});
  const detail=[r.number,r.pending?'Por acreditar':r.reserved_cents?reportMoney(r.reserved_cents)+' apartados para cheques':'',r.balance_cents!==null&&r.unknown_count?r.unknown_count+' saldo(s) por indicar':''].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(compact?6.8:8).fillColor(muted).text(detail,px+8,py+rowH-9,{width:cw-16,height:10,ellipsis:true,lineBreak:false});
 });
 doc.moveTo(x,758).lineTo(w-x,758).strokeColor('#dbe4d8').lineWidth(.7).stroke();
 const notes=['Solo incluye las cuentas seleccionadas. Saldos registrados en Gema al generar el reporte.'];
 if(t.reserved_cents)notes.push('Incluye '+reportMoney(t.reserved_cents)+' apartados en corriente para cheques.');
 if(t.pending_cents)notes.push('Incluye '+reportMoney(t.pending_cents)+' pendientes de acreditar; aún no disponibles.');
 if(t.unknown)notes.push(t.unknown+' saldo(s) por indicar no se suman al total.');
 notes.forEach((n,i)=>write(n,x,770+i*11,8,muted));
 write('Gema Finanzas · Reporte de saldos',x,822,8,muted);
 write('1 / 1',w-80,822,8,muted,{width:44,align:'right'});
 if(doc.bufferedPageRange().count!==1)throw new Error('El reporte excede una hoja');
 doc.end();return done;
}
export function registerBalanceReport(app,db,{route}){
 app.get('/api/finance/balance-report/accounts',route((req,res)=>res.json(balanceReportCatalog(db,req.financeUser))));
 app.post('/api/finance/balance-report',route((req,res)=>{const report=selectedBalanceReport(db,req.financeUser,req.body.keys);res.json({...report,text:balanceReportText(report)});}));
 app.post('/api/finance/balance-report.pdf',route(async(req,res)=>{const report=selectedBalanceReport(db,req.financeUser,req.body.keys),buffer=await balanceReportPdf(report);res.type('application/pdf').set('Content-Disposition','attachment; filename="reporte-cuentas.pdf"').set('Cache-Control','no-store').send(buffer);}));
}

