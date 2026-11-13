import React,{useEffect,useRef,useState} from 'react';
import {Check,Copy,Download,FileText,RefreshCw} from 'lucide-react';
import {useFinance} from './context.jsx';
import {Button,Modal} from './components.jsx';
import {BankLogo} from './banks.jsx';
import {financeApi,saveBlob} from './api.js';
import {BALANCE_REPORT_LIMIT,balanceReportTotals,reportMoney,reportDate,canGenerateBalanceReport} from '../../../shared/finance-balance-report.mjs';
import './balance-report.css';

export function BalanceReportButton(){
 const {user}=useFinance(),[show,setShow]=useState(false);
 if(!canGenerateBalanceReport(user))return null;
 return <><Button variant="secondary" icon={FileText} onClick={()=>setShow(true)}>Generar reporte</Button>{show&&<BalanceReportDialog onClose={()=>setShow(false)}/>}</>;
}
function BalanceReportDialog({onClose}){
 const {user}=useFinance(),[catalog,setCatalog]=useState(null),[selected,setSelected]=useState(new Set()),[busy,setBusy]=useState('loading'),[error,setError]=useState(''),[status,setStatus]=useState(''),[text,setText]=useState(''),textRef=useRef();
 const storageKey='gf-balance-report-selection:'+user.username;
 async function load(initial=false){
  setBusy('loading');setError('');try{const next=await financeApi('/balance-report/accounts');let keys=[...selected];if(initial)try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))keys=saved;}catch{}
   setCatalog(next);setSelected(new Set(keys.filter(k=>next.accounts.some(a=>a.key===k)).slice(0,BALANCE_REPORT_LIMIT)));
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 useEffect(()=>{load(true);},[]);
 const rows=catalog?.accounts.filter(a=>selected.has(a.key))||[],totals=balanceReportTotals(rows);
 function select(keys){setSelected(new Set(keys));setText('');setStatus('');setError('');}
 function toggle(key){if(!selected.has(key)&&selected.size>=BALANCE_REPORT_LIMIT){setError('Puedes incluir hasta '+BALANCE_REPORT_LIMIT+' cuentas por hoja.');return;}select(selected.has(key)?[...selected].filter(k=>k!==key):[...selected,key]);}
 async function generate(kind){
  setBusy(kind);setError('');setStatus('');
  try{
   const keys=[...selected];try{localStorage.setItem(storageKey,JSON.stringify(keys));}catch{}
   if(kind==='pdf'){
    const r=await fetch('/api/finance/balance-report.pdf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Finance-Request':'1','X-Finance-Interactive':'1'},body:JSON.stringify({keys})});
    if(!r.ok){let message='No se pudo generar el PDF';try{message=(await r.json()).message||message;}catch{}throw new Error(message);}
    const location=await saveBlob(await r.blob(),'reporte-cuentas.pdf');if(location)setStatus('PDF guardado. Puedes compartirlo o imprimirlo.');
   }else{const report=await financeApi('/balance-report',{keys});setText(report.text);setCatalog(c=>({...c,generated_at:report.generated_at,accounts:c.accounts.map(a=>(report.accounts||report.rows).find(r=>r.key===a.key)||a)}));try{await navigator.clipboard.writeText(report.text);setStatus('Texto copiado. Ya puedes pegarlo en WhatsApp.');}catch{setStatus('Texto listo. Pulsa Copiar texto o mantenlo presionado para copiar.');}}
  }catch(e){setError(e.message);}finally{setBusy('');}
 }
 async function copy(){try{await navigator.clipboard.writeText(text);setStatus('Texto copiado para WhatsApp.');}catch{textRef.current?.focus();textRef.current?.select();setStatus('Texto seleccionado: usa Copiar en tu dispositivo.');}}
 return <Modal title="Reporte de mi dinero" subtitle="Elige las cuentas: las tuyas se agrupan por banco y las de otras personas van al final." onClose={onClose} className="gf-balance-report-modal">
  <div className="gf-balance-report">
   <div className="gf-balance-report-total"><span>{totals.unknown?'Total conocido seleccionado':'Total seleccionado'}</span><strong>{reportMoney(totals.total_cents)}</strong><small>{rows.length} cuentas y fondos</small>{(totals.pending_cents>0||totals.reserved_cents>0)&&<p>Sin corriente ni pendientes: <b>{reportMoney(totals.available_cents)}</b></p>}{totals.unknown>0&&<p>{totals.unknown} saldo(s) por indicar no se suman.</p>}</div>
   <div className="gf-balance-report-tools"><button disabled={!!busy||!catalog} onClick={()=>select(catalog.accounts.slice(0,BALANCE_REPORT_LIMIT).map(a=>a.key))}>{catalog?.accounts.length>BALANCE_REPORT_LIMIT?'Seleccionar primeras '+BALANCE_REPORT_LIMIT:'Seleccionar todas'}</button><button disabled={!!busy||!selected.size} onClick={()=>select([])}>Ninguna</button><button disabled={!!busy} onClick={()=>load()} aria-label="Actualizar saldos"><RefreshCw size={16}/></button></div>
   {busy==='loading'&&<p role="status">Consultando saldos…</p>}
   <div className="gf-balance-report-options">{catalog?.accounts.map(a=><label key={a.key}><input type="checkbox" checked={selected.has(a.key)} onChange={()=>toggle(a.key)} disabled={!!busy}/><BankLogo bank={a.bank} kind={a.kind}/><span><strong>{a.name}</strong><small>{[a.bank,a.number].filter(Boolean).join(' · ')}</small>{(a.pending||a.reserved_cents>0)&&<em>{a.pending?'Pendiente de acreditar':'Apartado para cheques'}</em>}</span><b>{a.balance_cents===null?'Por indicar':reportMoney(a.balance_cents)}</b></label>)}</div>
   {catalog&&!catalog.accounts.length&&<p>No tienes cuentas disponibles para este reporte.</p>}
   {catalog&&<p className="gf-balance-report-date">Consultado: {reportDate(catalog.generated_at)}. Al generar se consultan los saldos actuales.</p>}
   {text&&<details className="gf-balance-report-text"><summary>Ver texto para WhatsApp</summary><label htmlFor="gf-report-text">Texto para WhatsApp</label><textarea id="gf-report-text" ref={textRef} readOnly value={text} rows={8}/><Button variant="secondary" icon={Copy} onClick={copy}>Copiar texto</Button></details>}
   <div className="gf-balance-report-actions">{error&&<p className="gf-error" role="alert">{error}</p>}{status&&<p role="status" className="gf-balance-report-success"><Check size={17}/>{status}</p>}<Button icon={Copy} disabled={!rows.length||!!busy} loading={busy==='text'} onClick={()=>generate('text')}>Copiar para WhatsApp</Button><Button variant="secondary" icon={Download} disabled={!rows.length||!!busy} loading={busy==='pdf'} onClick={()=>generate('pdf')}>Guardar PDF</Button></div>
  </div>
 </Modal>;
}

