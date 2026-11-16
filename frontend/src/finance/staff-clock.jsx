import React,{useEffect,useState} from 'react';
import {Clock3,LogIn,LogOut,CalendarCheck} from 'lucide-react';
import {financeApi} from './api.js';
import {useFinance} from './context.jsx';
import {retailManagement} from '../../../shared/finance-retail.mjs';
import './retail.css';
export const clockTime=v=>v?new Date(v).toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
export const clockLabels={flexible:'Elige dónde trabajas hoy',rest:'Descanso',legacy:'Sin marcación histórica',scheduled:'Por llegar',present:'En el local',late:'Llegó con atraso',worked:'Jornada registrada',missing:'Sin llegada · revisar',justified:'Falta justificada',unjustified:'Falta injustificada'};
export function StaffClock(){
 const {user,refresh}=useFinance(),[selectedUnit,setSelectedUnit]=useState(''),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>financeApi('/retail/clock/me').then(result=>{setData(result);setError('');}).catch(e=>setError(e.message));
 useEffect(()=>{load();const timer=setInterval(load,60000);window.addEventListener('finance-staff-clock-updated',load);return()=>{clearInterval(timer);window.removeEventListener('finance-staff-clock-updated',load);};},[user.shift_day,user.assigned_unit_ids?.join(',')]);
 const punch=async action=>{setBusy(true);setError('');try{setData(await financeApi('/retail/clock/punch',{action,...(data.available_stores?.length?{unit_id:selectedUnit}:{})}));await refresh(true);window.dispatchEvent(new Event('finance-staff-clock-updated'));}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <section className="gr-clock-card" aria-label="Mi asistencia"><div className="gr-clock-title"><Clock3 size={22}/><strong>Mi asistencia</strong><span>{data?.local||(data?.available_stores?.length?'Turno flexible':'Sin turno')}</span></div>{data?<><p>{data.status==='legacy'&&data.can_in?'Marca tu llegada para comenzar':clockLabels[data.status]}{data.hours&&<> · {data.hours.start}–{data.hours.end}</>}</p><>{data.available_stores?.length>0&&<label className="gr-field">Local de hoy<select value={selectedUnit} disabled={busy} onChange={e=>setSelectedUnit(e.target.value)}><option value="">Selecciona el local</option>{data.available_stores.map(s=><option key={s.unit_id} value={s.unit_id}>{s.name}</option>)}</select><small>Disponible todos los días hasta definir tu horario.</small></label>}</><div className="gr-clock-times"><span>Entrada <b>{clockTime(data.in_at)}</b></span><span>Salida <b>{clockTime(data.out_at)}</b></span></div><div className="gr-clock-buttons"><button disabled={busy||!data.can_in||(data.available_stores?.length>0&&!selectedUnit)} onClick={()=>punch('in')}><LogIn size={18}/> Llegué</button><button disabled={busy||!data.can_out} onClick={()=>punch('out')}><LogOut size={18}/> Salí</button></div>{data.in_at&&data.late_minutes===null&&<small>Tolerancia u horario pendiente de configurar.</small>}<small>Se guarda la hora de Ecuador al recibir tu marcación. Necesitas conexión.</small></>:<p role="status">Cargando asistencia…</p>}{error&&<div role="alert" className="gr-error">{error}<button type="button" onClick={load}>Reintentar</button></div>}</section>;
}
export function AttendanceShortcut(){
 const {user,data}=useFinance();if(!retailManagement(user))return null;
 const pending=data.staff_attendance?.pending||[];
 return <a className={'gr-attendance-shortcut'+(pending.length?' is-pending':'')} href={'/finanzas/locales?asistencia=1'+(pending[0]?'&day='+pending[0].day:'')}><CalendarCheck size={22}/><span><strong>{pending.length?`${pending.length} jornadas por revisar`:'Quién está en cada local'}</strong><small>{pending.length?'Revisar asistencia o justificar faltas':'Calendario, entradas y salidas'}</small></span><b>→</b></a>;
}
