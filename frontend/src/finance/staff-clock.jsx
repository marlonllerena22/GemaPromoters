import React,{useEffect,useState} from 'react';
import {Clock3,LogIn,LogOut,CalendarCheck} from 'lucide-react';
import {financeApi} from './api.js';
import {useFinance} from './context.jsx';
import {retailManagement} from '../../../shared/finance-retail.mjs';
import './retail.css';
export const clockTime=v=>v?new Date(v).toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
export const clockLabels={rest:'Descanso',legacy:'Sin marcación histórica',scheduled:'Por llegar',present:'En el local',late:'Llegó con atraso',worked:'Jornada registrada',missing:'Sin llegada · revisar',justified:'Falta justificada',unjustified:'Falta injustificada'};
export function StaffClock(){
 const {user}=useFinance(),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>financeApi('/retail/clock/me').then(setData).catch(e=>setError(e.message));
 useEffect(()=>{load();const timer=setInterval(load,60000);window.addEventListener('finance-staff-clock-updated',load);return()=>{clearInterval(timer);window.removeEventListener('finance-staff-clock-updated',load);};},[user.shift_day,user.assigned_unit_ids?.join(',')]);
 const punch=async action=>{setBusy(true);setError('');try{setData(await financeApi('/retail/clock/punch',{action}));window.dispatchEvent(new Event('finance-staff-clock-updated'));}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <section className="gr-clock-card" aria-label="Mi asistencia"><div className="gr-clock-title"><Clock3 size={22}/><strong>Mi asistencia</strong><span>{data?.local||'Sin turno'}</span></div>{data?<><p>{clockLabels[data.status]}{data.hours&&<> · {data.hours.start}–{data.hours.end}</>}</p><div className="gr-clock-times"><span>Entrada <b>{clockTime(data.in_at)}</b></span><span>Salida <b>{clockTime(data.out_at)}</b></span></div><div className="gr-clock-buttons"><button disabled={busy||!data.can_in} onClick={()=>punch('in')}><LogIn size={18}/> Llegué</button><button disabled={busy||!data.can_out} onClick={()=>punch('out')}><LogOut size={18}/> Salí</button></div>{data.in_at&&data.late_minutes===null&&<small>Tolerancia u horario pendiente de configurar.</small>}<small>Se guarda la hora de Ecuador al recibir tu marcación. Necesitas conexión.</small></>:<p>Cargando asistencia…</p>}{error&&<p role="alert" className="gr-error">{error}</p>}</section>;
}
export function AttendanceShortcut(){
 const {user,data}=useFinance();if(!retailManagement(user))return null;
 const pending=data.staff_attendance?.pending||[];
 return <a className={'gr-attendance-shortcut'+(pending.length?' is-pending':'')} href={'/finanzas/locales?asistencia=1'+(pending[0]?'&day='+pending[0].day:'')}><CalendarCheck size={22}/><span><strong>{pending.length?`${pending.length} jornadas por revisar`:'Quién está en cada local'}</strong><small>{pending.length?'Revisar asistencia o justificar faltas':'Calendario, entradas y salidas'}</small></span><b>→</b></a>;
}
