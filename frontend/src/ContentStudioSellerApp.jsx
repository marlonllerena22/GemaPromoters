import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, CalendarCheck, Check, ClipboardCheck, Copy, DollarSign, Home, LogOut, Plus, RefreshCw, Sparkles, TrendingUp, UserPlus, UserRound, UsersRound, WandSparkles } from 'lucide-react';
import { api } from './api.js';
import ContentStudioApp from './ContentStudioApp.jsx';
import './content-studio-seller.css';
import './content-studio-brand-assets.css';

const activityLabels = { visit: 'Visita', demo: 'Demostración', followup: 'Seguimiento' };
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function ContentStudioSellerApp({ user, onLogout }) {
  const [tab, setTab] = useState('home');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saleResult, setSaleResult] = useState(null);
  const [trialResult, setTrialResult] = useState(null);
  const [activity, setActivity] = useState({ activity_type: 'visit', business_name: '', contact_name: '', notes: '' });
  const [sale, setSale] = useState({ customer_name: '', business_name: '', whatsapp: '', email: '', plan_id: 'negocio' });
  const [trial, setTrial] = useState({ name: '', business_name: '', whatsapp: '', email: '' });

  async function load() {
    try { setData(await api('/content-studio/seller/bootstrap')); setError(''); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { void load(); }, []);

  async function saveActivity(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/content-studio/seller/activities', { method: 'POST', body: JSON.stringify(activity) });
      setActivity({ activity_type: 'visit', business_name: '', contact_name: '', notes: '' });
      setNotice('Actividad registrada'); setTab('home'); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function saveSale(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api('/content-studio/seller/sales', { method: 'POST', body: JSON.stringify(sale) });
      setSale({ customer_name: '', business_name: '', whatsapp: '', email: '', plan_id: 'negocio' });
      setSaleResult(result);
      setNotice(`Venta ${result.order.order_number} registrada. Falta confirmar la transferencia.`); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function saveTrial(event) {
    event.preventDefault(); setBusy(true); setError(''); setTrialResult(null);
    try {
      const result = await api('/content-studio/seller/trials', { method: 'POST', body: JSON.stringify(trial) });
      setTrialResult(result); setTrial({ name: '', business_name: '', whatsapp: '', email: '' });
      setNotice(`Cuenta de prueba creada con ${result.credits} fotos`); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function copyTrialCredentials() {
    if (!trialResult?.credentials) return;
    const text = `Estudios Creativos\nhttps://estudioscreativos.com/ingresar\nUsuario: ${trialResult.credentials.username}\nContraseña: ${trialResult.credentials.password}\nIncluye ${trialResult.credits} fotos de prueba durante ${trialResult.days} días.`;
    try { await navigator.clipboard.writeText(text); setNotice('Acceso copiado para compartir con el cliente'); }
    catch { setError('No pudimos copiar automáticamente. Mantén presionados los datos para copiarlos.'); }
  }
  const summary = data?.sellers?.[0];
  const goals = data?.goals;
  const navigation = [['home', 'Inicio', Home], ['studio', 'Crear', WandSparkles], ['trials', 'Pruebas', UserPlus], ['sales', 'Ventas', DollarSign], ['profile', 'Perfil', UserRound]];
  return <div className="css-app">
    <header className="css-header"><a href="/" className="css-brand"><span><img src="/content-studio/brand/mascota-toque.webp" alt=""/></span><img src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="Estudios Creativos"/></a><div><BriefcaseBusiness/><strong>Portal de vendedores</strong></div><button type="button" onClick={onLogout}><LogOut/> Salir</button></header>
    <main className={`css-main ${tab === 'studio' ? 'studio' : ''}`}>
      {notice && <div className="css-notice"><Check/> {notice}</div>}
      {error && <div className="css-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
      {!data ? <div className="css-loading"><Sparkles/> Preparando tu panel...</div> : <>
        {tab === 'home' && <HomeView summary={summary} goals={goals} period={data.period} activities={data.activities} sales={data.sales} demo={data.demo} onCreate={() => setTab('studio')} onAddActivity={() => setTab('activity')} onAddSale={() => setTab('sales')} reload={load}/>}
        {tab === 'studio' && <ContentStudioApp user={user} embedded sellerDemo/>}
        {tab === 'trials' && <TrialUsersForm value={trial} setValue={setTrial} onSubmit={saveTrial} busy={busy} result={trialResult} copyCredentials={copyTrialCredentials} trials={data.trials} trialConfig={data.trial}/>}
        {tab === 'activity' && <ActivityForm value={activity} setValue={setActivity} onSubmit={saveActivity} busy={busy}/>} 
        {tab === 'sales' && <SalesForm value={sale} setValue={setSale} plans={data.plans} onSubmit={saveSale} busy={busy} result={saleResult} onNew={() => setSaleResult(null)}/>} 
        {tab === 'profile' && <Profile seller={data.seller} summary={summary} onLogout={onLogout}/>} 
      </>}
    </main>
    <nav className="css-nav" aria-label="Navegación de vendedor">{navigation.map(([id, label, Icon]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon/><span>{label}</span></button>)}</nav>
  </div>;
}

function HomeView({ summary, goals, period, activities, sales, demo, onCreate, onAddActivity, onAddSale, reload }) {
  const activityProgress = Math.min(100, ((summary?.activities || 0) / Math.max(1, goals?.activity?.total || 12)) * 100);
  return <section className="css-home"><div className="css-heading"><span>RESULTADOS DE LA QUINCENA</span><h1>Tu avance importa.</h1><p>{period?.start} al {period?.end}. Registra todo para que tus resultados cuenten.</p></div><div className="css-demo-card"><span><Sparkles/></span><div><small>CRÉDITOS PARA DEMOSTRACIONES</small><strong>{demo?.available ?? 0} disponibles</strong><p>Crea imágenes frente al cliente con las mismas herramientas del estudio.</p></div><button type="button" onClick={onCreate}>Hacer una prueba</button></div><div className="css-kpis"><article><span><DollarSign/></span><small>VENTAS AFIANZADAS</small><strong>{money(summary?.charged_total)}</strong><em>Meta {money(goals?.sales)}</em></article><article><span><UsersRound/></span><small>CLIENTES SUPERIORES</small><strong>{summary?.upper_clients || 0}/{goals?.upper_clients || 3}</strong><em>Planes de $39 y $69</em></article><article><span><CalendarCheck/></span><small>GANANCIA ACTUAL</small><strong>{money(summary?.total_earned)}</strong><em>{summary?.bonus_unlocked ? 'Bono de $100 desbloqueado' : 'Incluye incentivos individuales'}</em></article></div><section className="css-bonus"><div><span><TrendingUp/></span><div><small>BONO QUINCENAL</small><h2>{summary?.bonus_unlocked ? '¡Meta desbloqueada!' : 'Sigue construyendo tu bono de $100.'}</h2><p>Necesitas actividad comercial, {money(goals?.sales)} en ventas afianzadas y {goals?.upper_clients} clientes de planes superiores.</p></div></div><div className="css-progress"><b style={{ width: `${activityProgress}%` }}/></div><small>{summary?.activities || 0} de {goals?.activity?.total || 12} actividades registradas · {summary?.visits || 0}/{goals?.activity?.visits || 4} visitas · {summary?.demos || 0}/{goals?.activity?.demos || 3} demos · {summary?.followups || 0}/{goals?.activity?.followups || 3} seguimientos</small></section><div className="css-actions"><button type="button" onClick={onAddActivity}><ClipboardCheck/> Registrar actividad</button><button type="button" className="secondary" onClick={onAddSale}><Plus/> Registrar venta</button><button type="button" className="refresh" onClick={reload} aria-label="Actualizar"><RefreshCw/></button></div><section className="css-recent"><div><h2>Ventas registradas</h2><small>Una venta se afianza cuando el cliente paga, se activa y realiza su primera creación.</small></div>{sales?.length ? sales.slice(0, 6).map((sale) => <article key={sale.id}><div><strong>{sale.customer_name}</strong><small>{sale.business_name} · {sale.plan_name}</small></div><b>{money(sale.amount)}</b><span className={sale.is_affianzado ? 'ready' : sale.order_status}>{sale.is_affianzado ? 'Afianzada' : sale.order_status === 'confirmed' ? 'Pendiente de uso' : sale.order_status === 'rejected' ? 'Rechazada' : 'Pendiente de pago'}</span></article>) : <div className="css-empty">Aquí aparecerán tus ventas cuando las registres.</div>}</section><section className="css-recent"><div><h2>Actividad reciente</h2><small>Visitas, demostraciones y seguimientos.</small></div>{activities?.length ? activities.slice(0, 5).map((item) => <article key={item.id}><div><strong>{activityLabels[item.activity_type]}</strong><small>{item.business_name}{item.contact_name ? ` · ${item.contact_name}` : ''}</small></div><span>{new Date(`${item.created_at.replace(' ', 'T')}`).toLocaleDateString('es-EC')}</span></article>) : <div className="css-empty">Registra tu primera visita o demostración.</div>}</section></section>;
}

function ActivityForm({ value, setValue, onSubmit, busy }) { return <section className="css-form-page"><div className="css-heading"><span>ACTIVIDAD COMERCIAL</span><h1>Registra el avance.</h1><p>Las visitas, pruebas y seguimientos respaldan tu bono quincenal.</p></div><form onSubmit={onSubmit} className="css-form"><label>Tipo de actividad<select value={value.activity_type} onChange={(event) => setValue({ ...value, activity_type: event.target.value })}><option value="visit">Visita a negocio</option><option value="demo">Demostración o prueba</option><option value="followup">Seguimiento</option></select></label><label>Nombre del negocio<input required value={value.business_name} onChange={(event) => setValue({ ...value, business_name: event.target.value })} placeholder="Ej. Boutique Central"/></label><label>Contacto del negocio<input value={value.contact_name} onChange={(event) => setValue({ ...value, contact_name: event.target.value })} placeholder="Nombre de la persona atendida"/></label><label>Notas breves<textarea value={value.notes} onChange={(event) => setValue({ ...value, notes: event.target.value })} placeholder="Qué se mostró, interés y siguiente paso"/></label><button disabled={busy}>{busy ? 'Guardando...' : 'Guardar actividad'}</button></form></section>; }

function TrialUsersForm({ value, setValue, onSubmit, busy, result, copyCredentials, trials, trialConfig }) {
  return <section className="css-form-page css-trials-page"><div className="css-heading"><span>CUENTAS DE PRUEBA</span><h1>Entrega una prueba real.</h1><p>Cada cliente recibe {trialConfig?.credits || 5} fotos para conocer Estudios Creativos durante {trialConfig?.days || 7} días.</p></div>
    {result && <article className="css-trial-result"><span><Check/></span><div><small>ACCESO LISTO</small><h2>{result.user.name}</h2><dl><div><dt>Usuario</dt><dd>{result.credentials.username}</dd></div><div><dt>Contraseña</dt><dd>{result.credentials.password}</dd></div><div><dt>Créditos</dt><dd>{result.credits} fotos</dd></div></dl><button type="button" onClick={copyCredentials}><Copy/> Copiar acceso para el cliente</button></div></article>}
    <form onSubmit={onSubmit} className="css-form"><label>Nombre del cliente<input required value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} placeholder="Nombre completo"/></label><label>Nombre del negocio<input required value={value.business_name} onChange={(event) => setValue({ ...value, business_name: event.target.value })} placeholder="Negocio o local"/></label><label>WhatsApp<input required inputMode="tel" value={value.whatsapp} onChange={(event) => setValue({ ...value, whatsapp: event.target.value })} placeholder="098 376 3419"/></label><label>Correo opcional<input type="email" value={value.email} onChange={(event) => setValue({ ...value, email: event.target.value })} placeholder="cliente@correo.com"/></label><div className="css-sale-note">El sistema crea automáticamente un usuario y una contraseña. Un mismo cliente no puede recibir pruebas repetidas para acumular créditos.</div><button disabled={busy}>{busy ? 'Creando cuenta...' : <><UserPlus/> Crear usuario con {trialConfig?.credits || 5} fotos</>}</button></form>
    <section className="css-recent css-trial-list"><div><h2>Pruebas entregadas</h2><small>Clientes registrados desde tu cuenta de vendedor.</small></div>{trials?.length ? trials.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.business_name} · @{item.username}</small></div><b>{Math.max(0, Number(item.credit_limit || 5) - Number(item.usage || 0))}/{item.credit_limit || 5}</b><span>{item.status === 'active' ? 'Activa' : 'Inactiva'}</span></article>) : <div className="css-empty">Todavía no entregaste cuentas de prueba.</div>}</section>
  </section>;
}

function SalesForm({ value, setValue, plans, onSubmit, busy, result, onNew }) {
  if (result) {
    const bank = result.transfer || {};
    return <section className="css-form-page"><div className="css-heading"><span>VENTA REGISTRADA</span><h1>Ahora pide la transferencia.</h1><p>La cuenta se activará cuando administración confirme el pago.</p></div><div className="css-form css-transfer-card"><strong>{result.order.order_number} · {result.order.plan_name} · {money(result.order.amount)}</strong><dl><div><dt>Banco</dt><dd>{bank.bank_name || 'Datos por confirmar'}</dd></div>{bank.beneficiary && <div><dt>Beneficiario</dt><dd>{bank.beneficiary}</dd></div>}{bank.account_number && <div><dt>Cuenta</dt><dd>{bank.account_number} {bank.account_type || ''}</dd></div>}</dl>{bank.whatsapp_url && <a href={bank.whatsapp_url} target="_blank" rel="noreferrer">Enviar datos por WhatsApp</a>}<button type="button" onClick={onNew}>Registrar otra venta</button></div></section>;
  }
  return <section className="css-form-page"><div className="css-heading"><span>REGISTRAR VENTA</span><h1>Deja lista la activación.</h1><p>Al confirmar la transferencia, administración activará al cliente. El incentivo cuenta cuando empiece a usar el estudio.</p></div><form onSubmit={onSubmit} className="css-form"><label>Nombre del cliente<input required value={value.customer_name} onChange={(event) => setValue({ ...value, customer_name: event.target.value })} placeholder="Nombre completo"/></label><label>Nombre del negocio<input required value={value.business_name} onChange={(event) => setValue({ ...value, business_name: event.target.value })} placeholder="Negocio o local"/></label><label>WhatsApp<input required inputMode="tel" value={value.whatsapp} onChange={(event) => setValue({ ...value, whatsapp: event.target.value })} placeholder="098 376 3419"/></label><label>Correo<input required type="email" value={value.email} onChange={(event) => setValue({ ...value, email: event.target.value })} placeholder="cliente@correo.com"/></label><label>Plan<select value={value.plan_id} onChange={(event) => setValue({ ...value, plan_id: event.target.value })}>{(plans || []).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.photos} fotos · ${plan.price}</option>)}</select></label><div className="css-sale-note">Los planes de $10 y $20 se registran, pero el incentivo individual inicia desde $39.</div><button disabled={busy}>{busy ? 'Registrando...' : 'Registrar venta pendiente'}</button></form></section>;
}

function Profile({ seller, summary, onLogout }) { return <section className="css-profile"><div className="css-heading"><span>MI PERFIL</span><h1>{seller?.name}</h1><p>@{seller?.username}</p></div><article><UserRound/><div><strong>{seller?.email || 'Correo no registrado'}</strong><small>{seller?.phone || 'WhatsApp no registrado'}</small></div></article><article><BriefcaseBusiness/><div><strong>{summary?.affianzadas || 0} clientes afianzados</strong><small>En la quincena actual</small></div></article><button type="button" onClick={onLogout}><LogOut/> Cerrar sesión</button></section>; }
