import React,{useEffect,useRef,useState} from 'react';
import {Upload,Send} from 'lucide-react';
import {Button,Field} from './components.jsx';
import {useFinance} from './context.jsx';
import {financeApi,money,amount,businessNames} from './api.js';
import {CopyDatum,uploadEvidence} from './payees.jsx';
import './iess.css';

export function IessLogo(){return <span className="gf-iess-logo"><img src="/finance/iess-logo.png" alt="IESS"/></span>;}
export function IessDetails({details,value}){return <section className="gf-iess-details">
  <div className="gf-iess-heading"><IessLogo/><div><small>Planilla IESS</small><strong>{money(value)}</strong></div></div>
  <CopyDatum label="Número de comprobante" value={details.comprobante}/>
  <div className="gf-iess-concept"><small>Concepto</small><p>{details.concept}</p></div>
  <CopyDatum label="Nombre / Razón social" value={details.legal_name}/>
  <CopyDatum label="RUC" value={details.ruc}/>
  {details.payment&&<p className="gf-note">Pago detectado · {details.payment.bank} · cuenta terminada en {details.payment.last_four} · {details.payment.day}</p>}
</section>;}

export function IessRequestForm({business,spaceId,unit,spaces,allowedBusinesses,units,changeSpace,setBusiness,setUnit,onSent,onBusy}){
  const {user,data,refresh}=useFinance(),fileRef=useRef(),key=useRef(crypto.randomUUID()),live=useRef(true);
  const [fields,setFields]=useState({comprobante:'',concept:'',legal_name:'',ruc:''}),[value,setValue]=useState(''),[evidence,setEvidence]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[warnings,setWarnings]=useState([]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  function loading(b){setBusy(b);onBusy?.(b);}
  function field(k,v){setFields(p=>({...p,[k]:v}));}
  async function read(file){
    if(!file)return;loading(true);setError('');setWarnings([]);setEvidence(null);setValue('');setFields({comprobante:'',concept:'',legal_name:'',ruc:''});key.current=crypto.randomUUID();
    try{
      const saved=await uploadEvidence(file,business,unit);if(!live.current)return;
      setEvidence({id:saved.id,name:file.name});
      if(!data.capabilities.ai){setWarnings(['Planilla guardada. Completa sus datos para enviarla.']);return;}
      const {analysis:a}=await financeApi(`/evidence/${saved.id}/iess`,{});if(!live.current)return;
      if(!a.is_iess){setEvidence(null);throw new Error('No se reconoció una planilla IESS. Sube el documento correcto.');}
      setFields({comprobante:a.comprobante||'',concept:a.concept||'',legal_name:a.legal_name||'',ruc:/^\d{13}$/.test(a.ruc||'')?a.ruc:''});
      setValue(Number.isSafeInteger(a.amount_cents)&&a.amount_cents>0?(a.amount_cents/100).toFixed(2):'');setWarnings(a.warnings||[]);
    }catch(e){if(live.current)setError(e.message);}finally{if(live.current)loading(false);}
  }
  async function submit(e){e.preventDefault();loading(true);setError('');try{
    const result=await financeApi('/payment-requests/iess',{request_id:key.current,business_id:business,unit_id:unit||null,space_id:spaceId||null,evidence_id:evidence.id,amount_cents:amount(value),...fields});
    await refresh();if(live.current)onSent(result,fields.legal_name,value);
  }catch(e){if(live.current)setError(e.message);}finally{if(live.current)loading(false);}}
  return <form className="gf-form gf-iess-form" onSubmit={submit}>
    <IessLogo/>
    {spaces.length>1&&<Field label="Espacio"><select value={spaceId} onChange={e=>changeSpace(e.target.value)} disabled={busy}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
    {allowedBusinesses.length>1&&<Field label="Negocio"><select value={business} onChange={e=>setBusiness(e.target.value)} disabled={busy}>{allowedBusinesses.map(b=><option key={b} value={b}>{businessNames[b]}</option>)}</select></Field>}
    {!unit&&user.unit_ids.length>0&&<Field label="Local"><select required value={unit||''} onChange={e=>setUnit(e.target.value)} disabled={busy}><option value="">Elige tu local</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
    <input hidden ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>{read(e.target.files?.[0]);e.target.value='';}}/>
    <Button type="button" icon={Upload} loading={busy} onClick={()=>fileRef.current.click()}> {evidence?'Cambiar planilla':'Subir foto o PDF de la planilla'}</Button>
    {evidence&&<small>{evidence.name}</small>}
    <Field label="Valor a pagar (USD)"><input required inputMode="decimal" placeholder="0,00" value={value} disabled={busy} onChange={e=>setValue(e.target.value)}/></Field>
    <Field label="Número de comprobante"><input required inputMode="numeric" maxLength={40} value={fields.comprobante} disabled={busy} onChange={e=>field('comprobante',e.target.value)}/></Field>
    <Field label="Concepto"><input required maxLength={500} value={fields.concept} disabled={busy} onChange={e=>field('concept',e.target.value)}/></Field>
    <Field label="Nombre / Razón social"><input required maxLength={200} value={fields.legal_name} disabled={busy} onChange={e=>field('legal_name',e.target.value)}/></Field>
    <Field label="RUC"><input required inputMode="numeric" pattern="[0-9]{13}" maxLength={13} value={fields.ruc} disabled={busy} onChange={e=>field('ruc',e.target.value)}/></Field>
    {warnings.map((w,i)=><small key={i}>{w}</small>)}
    {error&&<p role="alert" className="gf-error">{error}</p>}
    <small>Revisa los datos leídos. Enviar la planilla solicita el pago; todavía no descuenta dinero.</small>
    <Button type="submit" icon={Send} loading={busy} disabled={!evidence||amount(value)<=0||busy}>Solicitar pago IESS</Button>
  </form>;
}
