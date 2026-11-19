import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {encryptDocument,decryptDocument} from './finance-ai.js';
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function ticketEventDate(value){const raw=String(value||''),date=new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z');return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',dateStyle:'long',timeStyle:'short'}).format(date):'Fecha por confirmar';}
export function initTicketDownloads(db){
 db.exec(`CREATE TABLE IF NOT EXISTS ticketing_download_links(token_hash TEXT PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES ticketing_orders(id),ticket_ids TEXT NOT NULL,expires_at TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT);
 CREATE TABLE IF NOT EXISTS ticketing_download_jobs(id TEXT PRIMARY KEY,encrypted BLOB NOT NULL);`);
}
function orderData(db,id){
 const order=db.prepare(`SELECT o.id,o.establishment_id,o.order_number,o.payment_status,c.name customer_name,e.title event_title,e.event_date,e.venue,e.city FROM ticketing_orders o JOIN ticketing_customers c ON c.id=o.customer_id JOIN ticketing_events e ON e.id=o.event_id WHERE o.id=?`).get(id);
 if(!order)fail('Pedido no encontrado',404);
 const tickets=db.prepare(`SELECT t.id,t.code,t.status,i.ticket_name FROM ticketing_tickets t JOIN ticketing_order_items i ON i.id=t.order_item_id WHERE t.order_id=? ORDER BY t.id`).all(id);
 return {...order,tickets};
}
export function createTicketDownload(db,orderId,{establishmentId,actor,baseUrl,days=7}){
 const order=orderData(db,orderId);
 if(order.establishment_id!==establishmentId)fail('Pedido no encontrado',404);
 if(order.payment_status!=='paid')fail('El pago debe estar confirmado');
 const tickets=order.tickets.filter(t=>t.status==='valid');
 if(!tickets.length)fail('No hay entradas vigentes para descargar');
 const token=crypto.randomBytes(32).toString('base64url'),expires_at=new Date(Date.now()+Math.min(30,Math.max(1,days))*86400000).toISOString();
 db.prepare('INSERT INTO ticketing_download_links(token_hash,order_id,ticket_ids,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?)').run(hash(token),order.id,JSON.stringify(tickets.map(t=>t.id)),expires_at,actor,new Date().toISOString());
 return {url:baseUrl.replace(/\/$/,'')+'/api/ticketing/downloads/'+token+'/entradas.pdf',expires_at,order_number:order.order_number,ticket_count:tickets.length};
}
export function ticketDownloadData(db,token){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))fail('Enlace no disponible',404);
 const link=db.prepare('SELECT * FROM ticketing_download_links WHERE token_hash=?').get(hash(token));
 if(!link)fail('Enlace no disponible',404);
 if(link.revoked_at||Date.parse(link.expires_at)<=Date.now())fail('El enlace caducó. Solicita uno nuevo a ProTickets.',410);
 const order=orderData(db,link.order_id),ids=JSON.parse(link.ticket_ids);
 const tickets=order.tickets.filter(t=>ids.includes(t.id));
 if(order.payment_status!=='paid'||tickets.length!==ids.length||tickets.some(t=>t.status!=='valid'))fail('Las entradas cambiaron de estado. Solicita un enlace actualizado a ProTickets.',410);
 return {...order,tickets};
}
export async function ticketsPdf(order,baseUrl){
 const qr=await Promise.all(order.tickets.map(t=>QRCode.toBuffer(baseUrl.replace(/\/$/,'')+'/tickets/entrada/'+encodeURIComponent(t.code),{width:720,margin:4,errorCorrectionLevel:'H'})));
 const doc=new PDFDocument({size:'A5',margin:28,autoFirstPage:false,info:{Title:'Entradas '+order.order_number,Author:'ProTickets'}});
 const chunks=[],done=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 for(let i=0;i<order.tickets.length;i++){
  const t=order.tickets[i];doc.addPage();const w=doc.page.width;
  doc.rect(0,0,w,58).fill('#24103f');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('ProTickets',28,20);
  doc.font('Helvetica').fontSize(10).text('ENTRADA '+(i+1)+' DE '+order.tickets.length,w-140,25,{width:112,align:'right'});
  doc.fillColor('#24103f').font('Helvetica-Bold').fontSize(20).text(order.event_title,28,77,{width:w-56,height:56,ellipsis:true});
  doc.fillColor('#55515d').font('Helvetica').fontSize(11).text(ticketEventDate(order.event_date),28,143,{width:w-56});
  doc.text([order.venue,order.city].filter(Boolean).join(' · '),28,161,{width:w-56,height:30});
  doc.fillColor('#24103f').font('Helvetica-Bold').fontSize(20).text(t.ticket_name,28,204,{width:w-56,align:'center'});
  doc.fillColor('#55515d').font('Helvetica').fontSize(11).text(order.customer_name,28,238,{width:w-56,height:32,align:'center'});
  doc.image(qr[i],(w-220)/2,278,{width:220,height:220});
  doc.fillColor('#24103f').font('Helvetica-Bold').fontSize(10).text(t.code,28,511,{width:w-56,align:'center'});
  doc.fillColor('#55515d').font('Helvetica').fontSize(9).text('Pedido '+order.order_number,28,530,{width:w-56,align:'center'});
  doc.fontSize(8).text('Presenta este QR desde tu celular o impreso. Cada entrada permite un solo ingreso. Guarda este documento para ti.',28,553,{width:w-56,height:30,align:'center'});
 }
 doc.end();return done;
}
export function registerTicketDownloadRoutes(app,db,{requireTicketAdmin,publicAppUrl}){
 initTicketDownloads(db);
 app.post('/api/ticketing/admin/orders/:id/download-link',requireTicketAdmin,(req,res)=>{
  try{res.set('Cache-Control','no-store').json(createTicketDownload(db,Number(req.params.id),{establishmentId:req.ticketEstablishment.id,actor:req.user.username||req.user.role,baseUrl:publicAppUrl()}));}
  catch(e){res.status(e.status||500).json({message:e.status?e.message:'No se pudo preparar el enlace'});}
 });
 app.get('/api/ticketing/downloads/:token/entradas.pdf',async(req,res)=>{
  res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer'});
  try{const order=ticketDownloadData(db,req.params.token),pdf=await ticketsPdf(order,publicAppUrl());
   res.type('application/pdf').set('Content-Disposition','attachment; filename="entradas-'+order.order_number.replace(/[^a-z0-9_-]/gi,'')+'.pdf"').send(pdf);
  }catch(e){res.status(e.status||500).type('text/plain').send(e.status?e.message:'No se pudo generar el PDF. Intenta nuevamente.');}
 });
 setImmediate(()=>applyPrivateTicketDownload(db,publicAppUrl()));
}
function applyPrivateTicketDownload(db,baseUrl){
 const payload=process.env.TICKETING_DOWNLOAD_JOB;if(!payload)return;
 try{
  const job=JSON.parse(decryptDocument(Buffer.from(payload,'base64')).toString());
  if(job.kind!=='ticket-download-v1'||!/^[a-f0-9-]{36}$/.test(job.id)||Date.parse(job.expires_at)<=Date.now()||!Number.isFinite(Date.parse(job.expires_at))||Date.parse(job.expires_at)>Date.now()+2*3600000)throw new Error('Invalid download job');
  if(db.prepare('SELECT 1 FROM ticketing_download_jobs WHERE id=?').get(job.id))return;
  const output=db.transaction(()=>{
   const row=db.prepare('SELECT id FROM ticketing_orders WHERE order_number=?').get(job.order_number);if(!row)throw new Error('Order unavailable');
   const order=orderData(db,row.id),name=order.customer_name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   if(order.tickets.length!==job.expected_ticket_count||!job.expected_name_parts?.every(p=>name.includes(p))||order.city.toLowerCase()!==job.expected_city.toLowerCase())throw new Error('Order verification mismatch');
   const result={...createTicketDownload(db,order.id,{establishmentId:order.establishment_id,actor:'marlon:authorized-support',baseUrl}),customer_name:order.customer_name,event_title:order.event_title,event_date:order.event_date,tickets:order.tickets.map(t=>({code:t.code,ticket_name:t.ticket_name,status:t.status}))};
   const encrypted=encryptDocument(Buffer.from(JSON.stringify(result)));db.prepare('INSERT INTO ticketing_download_jobs(id,encrypted) VALUES (?,?)').run(job.id,encrypted);return encrypted.toString('base64');
  })();
  console.info('[ticketing] Private download job '+job.id+'|0|1|'+output);
 }catch(e){console.error('[ticketing] Private download job needs attention: '+e.message);}
}

