import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Edit3, Mail, MessageCircle, Printer, RefreshCw, Save, Search, UserPlus, X } from 'lucide-react';

const money = (value) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const date = (value) => value ? new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : '-05:00')).toLocaleString('es-EC') : '-';
const statuses = { pending: 'Pendiente', paid: 'Pagado', expired: 'Vencido', rejected: 'Rechazado' };

export function TransferDetails({ order }) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const details = order.transfer;
  if (!details) return null;
  const deadline = order.expires_at_iso || order.expires_at.replace(' ', 'T') + '-05:00';
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  const phone = details.whatsapp.startsWith('593') ? `0${details.whatsapp.slice(3)}` : details.whatsapp;
  async function copyPhone() {
    try { await navigator.clipboard.writeText(phone); setCopied(true); setCopyError(''); }
    catch { setCopyError('No se pudo copiar. Puedes seleccionar el numero.'); }
  }
  return <div className="pt-transfer-details">
    <img className="pt-bank-logo" src="/protickets/banco-pichincha.png" alt="Banco Pichincha" />
    <dl><div><dt>Beneficiario</dt><dd>{details.beneficiary}</dd></div><div><dt>Banco</dt><dd>{details.bank_name}</dd></div><div><dt>Cedula</dt><dd>{details.identification}</dd></div>
      {details.account_number && <div><dt>{details.account_type || 'Cuenta'}</dt><dd>{details.account_number}</dd></div>}</dl>
    {left > 0 ? <>
      {details.deuna_qr_url && <div className="pt-deuna"><strong>Pagos por Deuna</strong><img src={details.deuna_qr_url} alt="QR Deuna para pagar este evento" /></div>}
      <p className="pt-transfer-deadline">Reserva vigente: {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · Hasta {date(deadline)}</p>
      <a className="pt-whatsapp" href={details.whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle /> Enviar comprobante</a>
    </> : <div className="pt-alert error">La reserva vencio. No realices un nuevo pago. Si ya transferiste, contacta a soporte con tu numero de pedido.</div>}
    <div className="pt-copy-phone"><a href={details.whatsapp_url} target="_blank" rel="noreferrer">{phone}</a><button type="button" title="Copiar numero de WhatsApp" aria-label="Copiar numero de WhatsApp" onClick={copyPhone}><Copy size={17} /></button>{copied && <span>Copiado</span>}</div>
    {copyError && <p role="status">{copyError}</p>}
    <p className="pt-transfer-status">Pendiente de verificacion bancaria. Las entradas se enviaran al correo registrado cuando se confirme el pago.</p>
  </div>;
}

function TransferUsers({ api }) {
  const empty = { name: '', username: '', password: '', status: 'active', access_scope: 'transfers' };
  const [form, setForm] = useState(empty);
  const [users, setUsers] = useState([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  async function load() { try { setUsers((await api('/admin/validators', { admin: true })).filter((u) => u.access_scope === 'transfers')); } catch (e) { setNotice(e.message); } }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault(); setSaving(true); setNotice('');
    try {
      await api(form.id ? `/admin/validators/${form.id}` : '/admin/validators', { admin: true, method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) });
      setForm(empty); await load(); setNotice('Acceso guardado');
    } catch (e) { setNotice(e.message); } finally { setSaving(false); }
  }
  return <section className="pta-section pt-transfer-users"><h2>Usuarios de transferencias</h2>
    {notice && <p role="status">{notice}</p>}
    <form className="pta-validator-form" onSubmit={save}>
      <label>Nombre<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label>Usuario<input required pattern="[a-zA-Z0-9._-]{3,80}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
      <label>Contrasena<input type="password" minLength={8} required={!form.id} value={form.password} placeholder={form.id ? 'Conservar contrasena' : 'Minimo 8 caracteres'} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
      {form.id && <label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>}
      <button className="pta-primary" disabled={saving}><UserPlus /> {form.id ? 'Guardar' : 'Crear usuario'}</button>
      {form.id && <button type="button" className="pta-secondary" onClick={() => setForm(empty)}>Cancelar</button>}
    </form>
    <div className="pta-validator-user-list">{users.map((u) => <article key={u.id}><div><strong>{u.name}</strong><span>{u.username}</span></div><span>{u.status === 'active' ? 'Activo' : 'Inactivo'}</span><button className="pta-secondary" onClick={() => setForm({ ...u, password: '' })}><Edit3 /> Editar</button></article>)}</div>
  </section>;
}

export function TransfersAdmin({ api, restricted = false }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [references, setReferences] = useState({});
  const [busy, setBusy] = useState(null);
  async function load() { try { setOrders(await api('/transfers', { admin: true })); } catch (e) { setNotice(e.message); } }
  useEffect(() => { load(); }, []);
  async function process(order, action) {
    if (!window.confirm(action === 'confirm' ? `Confirmar que recibiste ${money(order.total)} del pedido ${order.order_number} y emitir sus entradas?` : `Rechazar ${order.order_number}?`)) return;
    setBusy(order.id); setNotice('');
    try {
      const result = await api(`/transfers/${order.id}/${action}`, { admin: true, method: 'POST', body: JSON.stringify({ reference: references[order.id] || order.transfer_reference || '' }) });
      setNotice(action === 'reject' ? 'Pedido rechazado' : result.email?.sent ? 'Pago confirmado. Entradas enviadas al correo.' : 'Pago confirmado. El correo no pudo enviarse; puedes reintentar sin duplicar entradas.');
      await load();
    } catch (e) { setNotice(e.message); } finally { setBusy(null); }
  }
  const visible = orders.filter((o) => (filter === 'all' || o.payment_status === filter) && `${o.order_number} ${o.customer_name} ${o.customer_email} ${o.transfer_reference || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="pt-payment-admin">
    <section className="pta-section">
      <div className="pta-section-title"><h2>Validacion de transferencias</h2><button className="pta-secondary" onClick={load}><RefreshCw /> Actualizar</button></div>
      <div className="pta-filters"><label><Search /><input placeholder="Cliente, pedido o referencia" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="pending">Pendientes</option><option value="all">Todos</option><option value="paid">Pagados</option><option value="expired">Vencidos</option><option value="rejected">Rechazados</option></select></div>
      {notice && <div className="pt-alert info" role="status">{notice}</div>}
      <div className="pt-transfer-orders">{visible.map((o) => <article key={o.id}>
        <div><span className={`pta-pill ${o.payment_status}`}>{statuses[o.payment_status]}</span><h3>{o.customer_name}</h3><p>{o.customer_email}</p><strong>{o.order_number}</strong><p>{o.event_title} · {o.detail}</p><small>Creado: {date(o.created_at)} · Limite: {date(o.expires_at)}</small></div>
        <div className="pt-transfer-amount"><span>Importe a verificar</span><strong>{money(o.total)}</strong><small>Entradas: {money(o.subtotal)} · Servicio: {money(o.service_fee)}</small></div>
        {['pending', 'expired'].includes(o.payment_status) && <form onSubmit={(e) => { e.preventDefault(); process(o, 'confirm'); }}>
          <label>Referencia bancaria<input required maxLength={120} value={references[o.id] || ''} onChange={(e) => setReferences({ ...references, [o.id]: e.target.value })} /></label>
          {o.payment_status === 'expired' && <small>Reserva vencida: la aprobacion requiere stock libre.</small>}
          <div className="pta-actions"><button className="pta-primary" disabled={busy === o.id}><Check /> Validar pago</button><button type="button" className="pta-secondary" disabled={busy === o.id} onClick={() => process(o, 'reject')}><X /> Rechazar</button></div>
        </form>}
        {o.payment_status === 'paid' && <div><strong>Referencia: {o.transfer_reference}</strong><p>{o.transfer_checked_by} · {date(o.paid_at)}</p>{!o.email_sent_at && <button className="pta-secondary" disabled={busy === o.id} onClick={() => process(o, 'confirm')}><Mail /> Reenviar entradas</button>}</div>}
      </article>)}{!visible.length && <div className="pta-empty">No hay transferencias con estos filtros.</div>}</div>
    </section>
    {!restricted && <TransferUsers api={api} />}
  </div>;
}

export function PaymentSettings({ api }) {
  const [form, setForm] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [qr, setQr] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/admin/payment-settings', { admin: true }).then((r) => {
    setForm(r.settings); setEvents(r.events); setEventId(String(r.events[0]?.id || '')); setQr(r.events[0]?.transfer_qr_url || '');
  }).catch((e) => setNotice(e.message)); }, []);
  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api('/admin/payment-settings', { admin: true, method: 'PUT', body: JSON.stringify({ ...form, event_id: eventId, event_qr_url: qr }) });
      setEvents(events.map((event) => String(event.id) === eventId ? { ...event, transfer_qr_url: qr } : event)); setNotice('Configuracion guardada');
    } catch (error) { setNotice(error.message); } finally { setSaving(false); }
  }
  function imageChanged(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2800000) { setNotice('Utiliza PNG, JPG o WebP de hasta 2,8 MB'); return; }
    const reader = new FileReader(); reader.onload = () => setQr(reader.result); reader.readAsDataURL(file);
  }
  if (!form) return <div className="pta-empty">{notice || 'Cargando configuracion...'}</div>;
  const field = (name, label, type = 'text') => <label>{label}<input type={type} required={!['account_number', 'account_type'].includes(name)} step={type === 'number' ? '0.01' : undefined} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} /></label>;
  return <section className="pta-section"><h2>Configuracion de pagos</h2>{notice && <p role="status">{notice}</p>}<form className="pta-form" onSubmit={save}>
    <label className="pta-check"><input type="checkbox" checked={Boolean(form.transfer_enabled)} onChange={(e) => setForm({ ...form, transfer_enabled: e.target.checked })} /> Habilitar transferencia y Deuna</label>
    <div className="pta-grid two">{field('beneficiary', 'Beneficiario')}{field('bank_name', 'Banco')}{field('identification', 'Cedula / RUC')}{field('account_number', 'Numero de cuenta (opcional)')}{field('account_type', 'Tipo de cuenta (opcional)')}{field('whatsapp', 'WhatsApp con codigo de pais')}{field('transfer_minutes', 'Limite de reserva (minutos)', 'number')}{field('payphone_fee_percent', 'Comision PayPhone con IVA (%)', 'number')}</div>
    <label>Evento del QR<select value={eventId} onChange={(e) => { setEventId(e.target.value); setQr(events.find((event) => String(event.id) === e.target.value)?.transfer_qr_url || ''); }}>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
    <label>QR Deuna<input type="file" accept="image/png,image/jpeg,image/webp" onChange={imageChanged} /></label>
    {qr && <img className="pt-settings-qr" src={qr} alt="QR Deuna del evento seleccionado" />}
    <button className="pta-primary" disabled={saving}><Save /> {saving ? 'Guardando...' : 'Guardar configuracion'}</button>
  </form></section>;
}

export function TicketSalesReport({ api }) {
  const [filters, setFilters] = useState({ event_id: '', from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reportRef = useRef(null);
  async function load(e) {
    e?.preventDefault(); setBusy(true); setError('');
    try { setData(await api(`/admin/sales-report?${new URLSearchParams(filters)}`, { admin: true })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  function print() {
    const popup = window.open('', '_blank');
    if (!popup) { setError('Permite ventanas emergentes para imprimir'); return; }
    popup.document.write(`<!doctype html><html><head><title>Reporte ProTickets</title><style>@page{size:A4 landscape;margin:10mm}body{font:11px Arial;color:#111}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #777;padding:6px;overflow-wrap:anywhere;text-align:right}td:first-child,th:first-child{text-align:left}h2{font-size:20px}h3{font-size:14px}.pt-report-totals{display:flex;flex-wrap:wrap;gap:15px;margin:14px 0}.pt-report-totals div{display:grid;gap:4px}tr{break-inside:avoid}</style></head><body>${reportRef.current.innerHTML}</body></html>`);
    popup.document.close(); setTimeout(() => popup.print(), 250);
  }
  return <section className="pta-section"><div className="pta-section-title"><h2>Reporte de ventas por localidad</h2><button className="pta-secondary" disabled={!data} onClick={print}><Printer /> Imprimir</button></div>
    <form className="pt-report-filters" onSubmit={load}><label>Evento<select value={filters.event_id} onChange={(e) => setFilters({ ...filters, event_id: e.target.value })}><option value="">Todos</option>{data?.events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label><label>Pagado desde<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label><label>Hasta<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label><button className="pta-primary" disabled={busy}><Search /> Consultar</button></form>
    {error && <div className="pt-alert error">{error}</div>}
    {data && <div ref={reportRef} className="pt-finance-report"><h3>ProTickets · Ventas confirmadas</h3><p>{data.from || 'Inicio'} hasta {data.to || 'Hoy'}</p>
      <div className="pt-report-totals">{[['quantity', 'Entradas vendidas'], ['gross', 'Total cobrado'], ['payphone_fee', 'Comision PayPhone'], ['protickets_net', 'Neto ProTickets'], ['event_net', 'Neto del evento']].map(([key, label]) => <div key={key}><span>{label}</span><strong>{key === 'quantity' ? data.totals[key] : money(data.totals[key])}</strong></div>)}</div>
      <div className="pt-report-table"><table><thead><tr><th>Evento / localidad</th><th>Metodo</th><th>Precio entrada</th><th>Cantidad</th><th>Entradas $</th><th>Servicio cobrado</th><th>Total cobrado</th><th>PayPhone</th><th>ProTickets neto</th><th>Evento neto</th></tr></thead><tbody>{data.rows.map((row, i) => <tr key={i}><td>{row.event_title}<br /><strong>{row.locality}</strong></td><td>{row.payment_method === 'transfer' ? 'Transferencia' : 'PayPhone'}</td><td>{money(row.unit_price)}</td><td>{row.quantity}</td>{['subtotal', 'service_fee', 'gross', 'payphone_fee', 'protickets_net', 'event_net'].map((key) => <td key={key}>{money(row[key])}</td>)}</tr>)}</tbody><tfoot><tr><th colSpan={3}>TOTAL</th><th>{data.totals.quantity}</th>{['subtotal', 'service_fee', 'gross', 'payphone_fee', 'protickets_net', 'event_net'].map((key) => <th key={key}>{money(data.totals[key])}</th>)}</tr></tfoot></table></div>
      {!data.rows.length && <p>No hay ventas pagadas en este periodo.</p>}
      <p>PayPhone se descuenta del total procesado. ProTickets neto es el servicio cobrado menos PayPhone. Las transferencias no tienen costo PayPhone.</p>
      {data.estimated_orders > 0 && <p>{data.estimated_orders} pedidos anteriores no tenian comision guardada: se calculan con la tarifa configurada ({data.payphone_fee_percent}%). Verifica contra la liquidacion de PayPhone.</p>}
    </div>}
  </section>;
}
