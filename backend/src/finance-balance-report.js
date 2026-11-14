import PDFDocument from 'pdfkit';
import {snapshot,fail} from './finance-service.js';
import {attachOperations} from './finance-operations.js';
import {attachWorkflow} from './finance-workflow.js';
import {balanceReportRows,groupBalanceReportRows,balanceReportTotals,balanceReportSections,reportTotalLabel,balanceReportText,canGenerateBalanceReport,BALANCE_REPORT_LIMIT,reportMoney,reportDate} from '../../shared/finance-balance-report.mjs';

export function balanceReportCatalog(db,user){
 if(!canGenerateBalanceReport(user))fail('No tienes acceso a reportes de saldos',403);
 const data=attachOperations(db,user,attachWorkflow(db,user,snapshot(db,user,{})),{separateChecking:true});
 if(data.businesses.some(b=>b.id==='marjorie')&&(user.role==='owner'||user.username==='german')&&!data.settlement_funds.some(s=>s.provider==='diners'))data.settlement_funds.push({provider:'diners',available_cents:null,pending_cents:null});
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
 const t=report.totals,s=balanceReportSections(report.rows),w=doc.page.width,x=36,width=w-72,green='#254e3e',muted='#6d7d70';
 const write=(text,px,py,size=10,color=green,opts={})=>doc.font(opts.bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(String(text),px,py,{width:opts.width||width,lineBreak:false,...opts});
 doc.rect(0,0,w,8).fill(green);
 write('GEMA FINANZAS',x,34,10,green,{bold:true,characterSpacing:1.5});
 write('Reporte de cuentas',x,58,25,green,{bold:true});
 write('Saldos al '+reportDate(report.generated_at)+' · Ecuador',x,92,10,muted);
 doc.roundedRect(x,121,width,103,12).fill(green);
 write(t.cash_unknown?'TOTAL EFECTIVO CONOCIDO':'TOTAL EFECTIVO',x+20,138,9,'#e4ecdf',{bold:true});
 write(reportMoney(t.total_cents),x+20,156,34,'white',{bold:true,width:width-40});
 write('Sin Guayaquil corriente ni Diners pendientes · USD',x+20,200,9,'#e4ecdf');
 let start=241;
 write('DETALLE DE LA SELECCIÓN',x,start,9,muted,{bold:true,characterSpacing:1});start+=20;
 const entries=[];
 if(s.own.length)entries.push({heading:'MIS CUENTAS'},...s.own,{summary:'TOTAL MIS CUENTAS',value:reportTotalLabel(t.own_cents,t.own_unknown)});
 if(s.other.length)entries.push({heading:'OTRAS PERSONAS'},...s.other);
 if(s.own.length||s.other.length)entries.push({summary:'TOTAL EFECTIVO',value:reportTotalLabel(t.total_cents,t.cash_unknown)});
 if(s.checks.length)entries.push({heading:'GUAYAQUIL CORRIENTE · APARTE'},...s.checks);
 const columns=entries.length>16?2:1,gap=18,cw=(width-gap*(columns-1))/columns,perColumn=Math.max(1,Math.ceil(entries.length/columns)),rowH=Math.min(40,(686-start)/perColumn);
 entries.forEach((r,i)=>{
  const col=Math.floor(i/perColumn),row=i%perColumn,px=x+col*(cw+gap),py=start+row*rowH,compact=columns===2,labelWidth=cw-(compact?83:125);
  if(r.heading||r.summary){doc.roundedRect(px,py,cw,rowH-2,4).fill('#e4eddf');write(r.heading||r.summary,px+8,py+5,compact?7:9,green,{bold:true,width:r.summary?labelWidth-8:cw-16});if(r.summary)write(r.value,px+cw-(compact?79:119),py+5,compact?9:11,green,{bold:true,width:compact?71:111,align:'right'});return;}
  if(row%2===0)doc.roundedRect(px,py,cw,rowH-2,4).fill('#f3f6ef');
  const name=(r.name.toLowerCase().includes(r.bank.toLowerCase())?'':r.bank+' · ')+r.name;
  doc.font('Helvetica-Bold').fontSize(compact?7.2:10).fillColor(green).text(name,px+8,py+2,{width:labelWidth-10,height:Math.max(9,rowH-12),ellipsis:true,lineGap:0});
  write(r.balance_cents===null?'Por indicar':reportMoney(r.balance_cents),px+cw-(compact?79:119),py+4,compact?9:12,green,{bold:true,width:compact?71:111,align:'right'});
  const detail=[r.number,r.balance_cents!==null&&r.unknown_count?r.unknown_count+' saldo(s) por indicar':''].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(compact?6.2:8).fillColor(muted).text(detail,px+8,py+rowH-8,{width:cw-16,height:9,ellipsis:true,lineBreak:false});
 });
 doc.moveTo(x,758).lineTo(w-x,758).strokeColor('#dbe4d8').lineWidth(.7).stroke();
 [['TOTAL EFECTIVO',reportTotalLabel(t.total_cents,t.cash_unknown)],['TOTAL CHEQUES',reportTotalLabel(t.checks_cents,t.checks_unknown)],['Falta Diners',reportTotalLabel(t.pending_cents,t.pending_unknown)]].forEach(([label,value],i)=>{const y=701+i*18;write(label,x,y,10,green,{bold:true,width:width-160});write(value,w-x-155,y,12,green,{bold:true,width:155,align:'right'});});
 const notes=['Efectivo sin corriente ni Diners pendientes. Solo cuentas seleccionadas.', 'Total cheques: saldo registrado en Guayaquil corriente.'];
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

