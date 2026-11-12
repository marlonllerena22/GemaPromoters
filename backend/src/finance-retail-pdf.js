import PDFDocument from 'pdfkit';

const money=v=>v===null?'Por completar':'$'+(v/100).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2});
const total=xs=>xs.reduce((n,x)=>n+x.amount_cents,0);
// Generated from the same authorized report as the screen. No additional ledger writes.
export async function retailMonthlyPdf(report){
 const doc=new PDFDocument({size:'A4',margin:36,autoFirstPage:false,bufferPages:true,info:{Title:'Reporte mensual de locales',Author:'Gema Finanzas'}}),chunks=[];
 const finished=new Promise((resolve,reject)=>{doc.on('data',x=>chunks.push(x));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 let page=0,title='';
 function newPage(){doc.addPage();page++;doc.fillColor('#254e3e').font('Helvetica-Bold').fontSize(18).text(title,36,34,{width:523});doc.font('Helvetica').fontSize(9).fillColor('#617466').text(`REPORTE MENSUAL · ${report.period.from} / ${report.period.to}`,36,60);doc.text(`Gema Finanzas · ${page}`,36,800,{lineBreak:false});}
 function table(heading,rows,x,y,w=250){
  const header=()=>{if(y>730){newPage();y=90;}doc.roundedRect(x,y,w,23,5).fill('#eaf1e6');doc.fillColor('#254e3e').font('Helvetica-Bold').fontSize(10).text(heading,x+8,y+7,{width:w-16});y+=29;};header();
  for(const [label,value,bold=false] of rows){
   doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(9);const h=Math.max(23,doc.heightOfString(String(label),{width:w-93})+10,doc.heightOfString(String(value),{width:78})+10);
   if(y+h>765){newPage();y=90;header();}
   doc.fillColor('#304c40').text(String(label),x+5,y+4,{width:w-93});doc.text(String(value),x+w-83,y+4,{width:78,align:'right'});doc.moveTo(x,y+h-2).lineTo(x+w,y+h-2).strokeColor('#e3e8df').lineWidth(.5).stroke();y+=h;
  }
  return y+12;
 }
 for(const s of report.stores){title=s.name;newPage();const firstPage=page-1,m=s.management,b=s.sales.breakdown;
  // Compact familiar summary; long transaction lists are placed in the appendix below.
  let left=table('VENTAS DEL MES',[
   ['Efectivo',money(b.cash)],['Transferencias',money(b.transfer)],['Tarjetas · bruto',money(b.card)],['Descuento tarjeta estimado',money(-m.card_fee_cents)],
   ...(b.payphone?[['PayPhone · bruto',money(b.payphone)]]:[]),...(b.other?[['Otros cobros',money(b.other)]]:[]),
   ['Venta neta de devoluciones',money(s.sales.net_cents),true],['Pares identificados',String(s.sales.pairs)],
  ],36,90);
  const expenseRows=group=>s.expenses.filter(c=>c.group===group&&c.amount_cents).map(c=>[c.label,money(c.amount_cents)]);
  left=table('GASTOS VARIOS',expenseRows('varios').length?expenseRows('varios'):[['Sin gastos registrados',money(0)]],36,left);
  const services=[...expenseRows('servicios'),...m.fixed.filter(f=>f.pending_cents).map(f=>[`${f.description||f.category} · previsto`,money(f.pending_cents)])];
  left=table('SERVICIOS Y ARRIENDOS',services.length?services:[['Sin pagos registrados',money(0)]],36,left);
  table('CONTROL DE CAJA',[
   ['Fondo al inicio',money(s.cash.opening_cents)],['Efectivo según registros',money(s.cash.balance_cents)],['Efectivo contado',money(s.cash.counted_cents)],['Diferencia de caja',money(s.cash.difference_cents)],
  ],36,left);
  doc.switchToPage(firstPage);
  // Right column remains on the same page for normal monthly summaries.
  let right=table('SUELDOS Y COMISIONES',m.personnel.flatMap(p=>[[`${p.name} · sueldo`,money(p.salary_cents)],[`${p.name} · comisión`,money(p.commission_cents)]]),309,90);
  right=table('ENTREGAS Y DEPÓSITOS',[
   ['Entregado desde caja',money(total(s.remittances))],['Depósitos bancarios asociados',money(total(s.direct_deposits))],['Solo informativo','No se resta de ventas'],
  ],309,right);
  // A full-width result table is kept separate from cash reconciliation.
  let y=right;
  y=table('RESULTADO DE GESTIÓN',[
   ['Ventas netas',money(s.sales.net_cents)],['Descuento de tarjetas (estimación)',money(-m.card_fee_cents)],['Producalza · pares de ese proveedor × $38',money(-m.producalza_cents)],['Costo de otros proveedores',money(-m.other_products_cents)],['Sueldos asignados y comisiones',money(-m.salary_cents-m.commission_cents)],['Gastos operativos registrados',money(-m.operating_cents)],['Gastos fijos previstos aún sin pago registrado',money(-m.fixed_pending_cents)],['Resultado con datos disponibles',money(m.net_provisional_cents),true],
  ],309,y,250);
  if(y>710){newPage();y=90;}doc.font('Helvetica').fontSize(9).fillColor('#6e654a').text(m.complete?'Descuento bancario estimado, sujeto a comprobación con vouchers.':'PROVISIONAL: faltan datos. No representa un resultado final ni dinero libre en bancos.',309,y,{width:250});
  // Auditable detail and pending data, paginated by measured row height.
  if(s.warnings.length||s.expenses.some(c=>c.entries.length)||s.remittances.length||s.direct_deposits.length||m.personnel.length){newPage();let detailY=90;
   if(s.warnings.length)detailY=table('DATOS POR COMPLETAR',s.warnings.map(x=>[x,'Pendiente']),36,detailY,523);
   if(m.personnel.length)detailY=table('DETALLE DE NÓMINA · NO ES DEUDA PENDIENTE',m.personnel.flatMap(p=>[[`${p.name} · sueldo + comisiones`,money(p.salary_cents+p.commission_cents)],[`${p.name} · descuentos + adelantos`,money((p.deductions_cents||0)+(p.advances_cents||0))],[`${p.name} · neto de nómina`,money(p.payable_cents??p.salary_cents+p.commission_cents)]]),36,detailY,523);
   for(const c of s.expenses.filter(c=>c.entries.length))detailY=table(c.label.toUpperCase(),c.entries.map(e=>[`${e.day} · ${e.description||e.counterparty||c.label}`,money(e.amount_cents)]),36,detailY,523);
   if(s.remittances.length)detailY=table('ENTREGAS DESDE CAJA · INFORMATIVO',s.remittances.map(e=>[`${e.day} · ${e.counterparty} · ${e.description}`,money(e.amount_cents)]),36,detailY,523);
   if(s.direct_deposits.length)table('DEPÓSITOS ASOCIADOS · NO SUMAR OTRA VEZ',s.direct_deposits.map(e=>[`${e.day} · ${e.account_name} · ${e.description}`,money(e.amount_cents)]),36,detailY,523);
  }
 }
 doc.end();return finished;
}
