import {StaffClock} from './staff-clock.jsx';
import React,{useState} from 'react';
import {ReceiptText,Upload,CalendarDays,CheckCircle2} from 'lucide-react';
import './retail.css';
import {useFinance} from './context.jsx';
import {financeApi,today,money} from './api.js';
import {Modal,Button} from './components.jsx';
import {CashForm} from './retail-forms.jsx';
import {ReceiptList} from './receipts.jsx';
import {PushEnrollment} from './workflows.jsx';
import {RETAIL_STORES} from '../../../shared/finance-retail.mjs';
export function StoreStaffHome(){
 const {user,open,navigate}=useFinance();
 const stores=(user.assigned_unit_ids||user.unit_ids).filter(id=>RETAIL_STORES[id]).map(unit_id=>({unit_id,name:RETAIL_STORES[unit_id]}));
 return <div className="gf-collaborator-home"><div className="gf-collaborator-heading"><span className="gf-eyebrow">TU JORNADA DE HOY</span><h1>Hola, {user.name.split(' ')[0]}.</h1><p>{stores.length?stores.map(s=>s.name).join(' · '):user.shift_off?'Hoy tienes descanso.':'Morelia debe asignar tu local en el calendario.'}</p></div><StaffClock/><PushEnrollment/><div className="gf-simple-actions gf-staff-actions"><button disabled={!stores.length} onClick={()=>open('store-expense')}><ReceiptText size={24}/><span><strong>Registrar gasto</strong><small>Valor, motivo y comprobante</small></span></button><button disabled={!stores.length} onClick={()=>open('store-receipt')}><Upload size={24}/><span><strong>Subir transferencia de cliente</strong><small>Foto o archivo · envío automático</small></span></button>{stores.length>0&&<button onClick={()=>navigate('locales')}><CalendarDays size={24}/><span><strong>Mi reporte del día</strong><small>{stores[0].name}</small></span></button>}{user.review_unit_ids?.length>0&&<button onClick={()=>navigate('confirmaciones')}><CheckCircle2 size={24}/><span><strong>Confirmar depósitos recibidos</strong></span></button>}</div><ReceiptList/></div>;
}
export function StoreExpenseDialog({onClose}){
 const {user,data,refresh,notify}=useFinance(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const stores=(user.assigned_unit_ids||user.unit_ids||[]).filter(id=>RETAIL_STORES[id]).map(unit_id=>({unit_id,name:RETAIL_STORES[unit_id]}));
 const save=async(path,body)=>{setBusy(true);setError('');try{await financeApi('/retail/'+path,body);await refresh();onClose();notify('Gasto registrado en la caja del local');}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <Modal title="Gasto del local" onClose={onClose}>{error&&<p role="alert" className="gf-error">{error}</p>}{stores.length?<div className="gr-report"><CashForm data={{stores,capabilities:data.capabilities}} initial={{kind:'expense',unit_id:stores[0].unit_id}} day={today()} busy={busy} save={save}/></div>:<p>{user.shift_off?'Hoy tienes descanso.':'No tienes un local asignado hoy.'} Si estás trabajando, Morelia debe actualizar tu turno en el calendario.</p>}</Modal>;
}
export function WarehouseHome(){const {user,data,open}=useFinance();return <div className="gf-collaborator-home"><h1>Hola, {user.name.split(' ')[0]}.</h1><p>Tus solicitudes de transferencia y sus comprobantes.</p><Button onClick={()=>open('quick',{mode:'request'})}>＋ Pedir transferencia</Button><h2>Mis solicitudes</h2><div className="gf-simple-actions">{(data.workflow?.requests||[]).map(r=><button key={r.id} onClick={()=>open('pay-request',{id:r.id})}><span><strong>{r.counterparty} · {money(r.amount_cents)}</strong><small>{r.payment_state==='paid'?'Pagada · ver comprobante':r.payment_state==='cancelled'?'Cancelada':'Pendiente'}</small></span><span>→</span></button>)}</div>{!data.workflow?.requests?.length&&<p>Todavía no tienes solicitudes.</p>}</div>;}
