import React, {useState} from 'react';
import {Trash2} from 'lucide-react';
import {useFinance} from './context.jsx';
import {Button,Modal} from './components.jsx';
import {financeApi,money} from './api.js';

export function DeleteRequestButton({request,onDeleted}){
  const {user,refresh,notify}=useFinance();
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!request||(user.role!=='owner'&&request.created_by!==user.username)||request.remaining_cents<=0||request.payment_state==='cancelled')return null;
  async function remove(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      await financeApi(`/payment-requests/${request.id}/cancel`,{reason:'Petición eliminada de pendientes por quien la gestiona.'});
    }catch(e){setError(e.message);setBusy(false);return;}
    setConfirm(false);
    notify('Petición eliminada de pendientes. El historial se conserva.');
    onDeleted?.();
    try{await refresh();}catch{notify('Petición eliminada. Actualiza la pantalla para ver la lista.');}
    setBusy(false);
  }
  return <>
    <button type="button" className="gf-request-delete-button" title="Eliminar petición" aria-label={`Eliminar petición de ${request.counterparty}`} onClick={()=>{setError('');setConfirm(true);}}><Trash2 size={19} aria-hidden="true"/></button>
    {confirm&&<Modal title="¿Eliminar esta petición?" onClose={()=>{if(!busy)setConfirm(false);}}>
      <p><strong>{request.counterparty}</strong> · {money(request.remaining_cents)}</p>
      <p>Se quitará de las transferencias pendientes. El historial y los pagos registrados se conservan.</p>
      {error&&<p className="gf-error" role="alert">{error}</p>}
      <div className="gf-request-delete-actions">
        <Button variant="secondary" disabled={busy} onClick={()=>setConfirm(false)}>Volver</Button>
        <Button icon={Trash2} className="gf-request-delete-confirm" disabled={busy} onClick={remove}>{busy?'Eliminando…':'Eliminar petición'}</Button>
      </div>
    </Modal>}
  </>;
}
