import React,{useState} from 'react';
import {useFinance} from './context.jsx';
import {Button,Field} from './components.jsx';
import {businessNames} from './api.js';
import {quickMoney} from '../../../shared/finance-quick.mjs';

export function ConversationDraftEditor({draft,busy,onReview,onBack}){
  const {data,user}=useFinance(),{action,data:initial}=draft.editable;
  const [values,setValues]=useState({...initial}),[amount,setAmount]=useState(initial.amount_cents==null?'':(initial.amount_cents/100).toFixed(2)),[showAll,setShowAll]=useState(!draft.incomplete);
  const missing=new Set(draft.missing_fields||[]),balance=['account_balance','custody_balance'].includes(action),bank=['bank_entry','account_balance'].includes(action);
  const bankFixed=Boolean(draft.already_in_bank);
  const set=(key,value)=>setValues(v=>({...v,[key]:value}));
  const field=(key,label,children)=>!showAll&&!missing.has(key)?null:<Field label={label} hint={missing.has(key)?'Falta completar este dato':undefined} className={missing.has(key)?'gf-draft-field-missing':''}>{children}</Field>;
  const input=(key,label,props={})=>field(key,label,<input {...props} value={values[key]||''} onChange={e=>set(key,e.target.value||null)} disabled={busy||(bankFixed&&['reference','day','counterparty'].includes(key))}/>);
  async function review(e){
    e.preventDefault();const negative=action==='account_balance'&&amount.trim().startsWith('-');
    const parsed=quickMoney(negative?amount.trim().slice(1):amount.trim());
    await onReview({...values,amount_cents:parsed==null?null:parsed*(negative?-1:1)});
  }
  return <form className="gf-conversation-editor" onSubmit={review} aria-label="Editar borrador">
    <p>{draft.incomplete?'Dejé los datos que entendí. Completa lo señalado y revisa el resumen.':'Puedes corregir estos datos antes de confirmar.'}</p>
    {draft.incomplete&&!showAll&&<p className="gf-draft-known">Conservo: {[businessNames[initial.business_id],data.accounts.find(a=>a.id===initial.account_id)?.name,initial.description].filter(Boolean).join(' · ')||'los datos de esta conversación'}</p>}
    {bankFixed&&<small>El banco confirmó el monto y la cuenta. Puedes completar el negocio y el motivo.</small>}
    {field('amount_cents',balance?'Saldo final ($)':'Monto ($)',<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" autoComplete="off" disabled={busy||bankFixed}/>)}
    {!balance&&field('business_id','¿De qué negocio es?',<select value={values.business_id||''} onChange={e=>setValues(v=>({...v,business_id:e.target.value||null,unit_id:null}))} disabled={busy}><option value="">Elegir negocio</option>{user.business_ids.map(id=><option key={id} value={id}>{businessNames[id]||id}</option>)}</select>)}
    {bank&&field('account_id','Cuenta',<select value={values.account_id||''} onChange={e=>set('account_id',e.target.value?Number(e.target.value):null)} disabled={busy||bankFixed}><option value="">Elegir cuenta</option>{data.accounts.filter(a=>a.kind==='bank'||(action==='account_balance'&&a.kind==='wallet')).map(a=><option key={a.id} value={a.id}>{a.name}{a.last_four?' · '+a.last_four:''}</option>)}</select>)}
    {action==='custody_balance'&&field('custody_id','Fondo',<select value={values.custody_id||''} onChange={e=>set('custody_id',e.target.value||null)} disabled={busy}><option value="">Elegir fondo</option>{(data.custody_funds||[]).filter(f=>f.can_adjust).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>)}
    {input('description','Motivo o descripción',{placeholder:'Por ejemplo: pago de materiales',maxLength:200})}
    {!balance&&(missing.has('unit_id')||values.unit_id)&&field('unit_id','Local o unidad',<select value={values.unit_id||''} onChange={e=>set('unit_id',e.target.value||null)} disabled={busy}><option value="">Elegir local</option>{data.units.filter(u=>u.business_id===values.business_id).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>)}
    {!balance&&(showAll||['counterparty','kind','direction'].some(k=>missing.has(k)))&&<details open={missing.has('counterparty')||missing.has('kind')||missing.has('direction')}><summary>Más datos</summary>
      {input('counterparty',action==='request'?'¿A quién se paga?':'Persona o comercio (opcional)',{maxLength:200})}
      {field('kind','Tipo de movimiento',<select value={values.kind||''} disabled={busy||bankFixed} onChange={e=>setValues(v=>({...v,kind:e.target.value||null,direction:e.target.value==='income'?'incoming':e.target.value==='expense'?'outgoing':v.direction}))}><option value="">Elegir tipo</option><option value="expense">Gasto</option><option value="income">Ingreso</option>{initial.kind==='transfer'&&<option value="transfer">Traslado recibido</option>}</select>)}
      {bank&&field('direction','El dinero',<select value={values.direction||''} onChange={e=>set('direction',e.target.value||null)} disabled={busy||bankFixed}><option value="">Elegir</option><option value="incoming">Entró a la cuenta</option><option value="outgoing">Salió de la cuenta</option></select>)}
      {input('category','Categoría (opcional)',{maxLength:200})}{input('reference','Referencia bancaria (opcional)',{maxLength:200})}{input('day','Fecha',{type:'date'})}
    </details>}
    {draft.incomplete&&<button type="button" className="gf-text-button" onClick={()=>setShowAll(v=>!v)} disabled={busy}>{showAll?'Mostrar solo lo que falta':'Editar todos los datos'}</button>}
    <small>Esto prepara el resumen. El registro se guarda después de tu confirmación.</small>
    <Button type="submit" loading={busy}>Revisar borrador</Button>
    <button type="button" className="gf-text-button" onClick={onBack} disabled={busy}>{draft.incomplete?'Seguir conversando':'Volver al resumen'}</button>
  </form>;
}
