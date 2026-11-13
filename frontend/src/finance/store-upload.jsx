import React,{useRef,useState} from 'react';
import {Camera,Upload,CheckCircle2} from 'lucide-react';
import {useFinance} from './context.jsx';
import {Modal,Button,Field} from './components.jsx';
import {financeApi,amount,money,today} from './api.js';
import {uploadEvidence} from './payees.jsx';
import {payeeBanks} from '../../../shared/finance-payees.mjs';
import {storeReceiptRoute} from '../../../shared/finance-store-receipts.mjs';

export function StoreReceiptForm({onClose}){
 const {data,user,refresh}=useFinance(),filePicker=useRef(),camera=useRef();
 const units=data.units.filter(u=>u.business_id==='marjorie'&&(!user.unit_ids.length||user.unit_ids.includes(u.id)));
 const [unit,setUnit]=useState(units.length===1?units[0].id:''),[purpose,setPurpose]=useState('client'),[evidence,setEvidence]=useState(null),[fields,setFields]=useState({value:'',customer:'',day:today(),reference:'',bank:''}),[details,setDetails]=useState(null),[busy,setBusy]=useState(false),[stage,setStage]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(null);
 const update=(key,value)=>setFields(f=>({...f,[key]:value}));
 const route=storeReceiptRoute({unit_id:unit,receiving_bank:fields.bank,receiving_holder:details?.receiving_holder});
 async function send(saved,automatic,values=fields){
  setStage('Enviando al responsable…');
  const result=await financeApi('/store-receipts',{unit_id:unit,purpose,evidence_id:saved.id,automatic,...(!automatic?{amount_cents:amount(values.value),customer:values.customer,day:values.day,reference:values.reference,receiving_bank:values.bank}:{})});
  setDone(result);await refresh();
 }
 async function upload(file){
  if(!file)return;setBusy(true);setError('');setDetails(null);setEvidence(null);setFields({value:'',customer:'',day:'',reference:'',bank:''});
  try{
   setStage('Subiendo comprobante…');const saved=await uploadEvidence(file,'marjorie',unit);setEvidence({...saved,name:file.name});
   if(!data.capabilities.ai){setError('La lectura automática no está disponible. Completa los datos para enviarlo.');return;}
   setStage('Leyendo monto, remitente y destino…');const result=await financeApi(`/evidence/${saved.id}/analyze`,{}),d=result.store_receipt;
   if(!d)throw new Error('No se pudo leer el comprobante. Completa los datos o sube otra foto.');
   setDetails(d);setFields({value:d.amount_cents?String(d.amount_cents/100):'',customer:d.customer||'',day:d.day||'',reference:d.reference||'',bank:d.receiving_bank||''});
   if(d.auto_ready)await send(saved,true);else setError('Revisa o completa: '+d.missing.join(', ')+'.');
  }catch(e){setError(e.message);}finally{setBusy(false);setStage('');if(filePicker.current)filePicker.current.value='';if(camera.current)camera.current.value='';}
 }
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{await send(evidence,false);}catch(e){setError(e.message);}finally{setBusy(false);setStage('');}}
 return <Modal title={done?'Comprobante registrado':'Enviar transferencia recibida'} subtitle={done?undefined:'Gema lee los datos y envía el comprobante automáticamente al responsable.'} onClose={onClose}>
  {done?<div className="gf-transfer-request-done"><CheckCircle2 size={44}/><strong>{money(done.amount_cents)}</strong><p>{done.duplicate?'Este comprobante ya estaba registrado. No se duplicó.':done.confirmed?'Transferencia confirmada. No necesitas volver a enviarla.':`Enviada a ${done.responsible} para confirmar.`}</p><Button onClick={onClose}>Listo</Button></div>:<form className="gf-operation-form" onSubmit={submit}>
   {units.length===1?<p><strong>Local: {units[0].name}</strong></p>:<Field label="Local"><select required value={unit} disabled={busy||!!evidence} onChange={e=>setUnit(e.target.value)}><option value="">Selecciona el local</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
   <Field label="Tipo de comprobante"><select value={purpose} disabled={busy||!!evidence} onChange={e=>setPurpose(e.target.value)}><option value="client">Transferencia de un cliente</option><option value="cash_remittance">Depósito desde la caja del local</option></select></Field>
   <input ref={filePicker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={e=>upload(e.target.files?.[0])}/>
   <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e=>upload(e.target.files?.[0])}/>
   <div className="gf-simple-actions"><Button type="button" icon={Upload} variant="secondary" disabled={!unit||busy} onClick={()=>filePicker.current.click()}>Subir comprobante</Button><Button type="button" icon={Camera} variant="secondary" disabled={!unit||busy} onClick={()=>camera.current.click()}>Tomar foto</Button></div>
   {busy&&<p role="status">{stage}</p>}{error&&<p role="alert" className="gf-error">{error}</p>}
   {evidence&&!busy&&<><p className="gf-muted">{evidence.name}</p><Field label="Monto recibido (USD)"><input required inputMode="decimal" value={fields.value} onChange={e=>update('value',e.target.value)}/></Field><Field label="Quién envió el dinero"><input required value={fields.customer} onChange={e=>update('customer',e.target.value)}/></Field><Field label="Fecha del comprobante"><input required type="date" max={today()} value={fields.day} onChange={e=>update('day',e.target.value)}/></Field><Field label="Banco receptor"><select required value={fields.bank} onChange={e=>update('bank',e.target.value)}><option value="">Seleccionar banco</option>{payeeBanks.map(b=><option key={b}>{b}</option>)}</select></Field><Field label="Referencia bancaria (si aparece)"><input value={fields.reference} onChange={e=>update('reference',e.target.value)}/></Field>{route&&<p>Se enviará a <strong>{route.name}</strong>.</p>}<Button type="submit" disabled={['conflict','ambiguous'].includes(details?.account_state)||!unit||!fields.bank||!fields.customer||!fields.day||!(amount(fields.value)>0)}>Enviar datos revisados</Button></>}
  </form>}
 </Modal>;
}
