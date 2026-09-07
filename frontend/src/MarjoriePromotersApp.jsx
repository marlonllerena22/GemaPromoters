import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck, BarChart3, CalendarDays, Check, ChevronRight, ClipboardCheck, Copy,
  DollarSign, ExternalLink, Eye, EyeOff, FileText, Gift, Home, Image as ImageIcon, KeyRound,
  Link as LinkIcon, LogOut, MapPin, Menu, PackageCheck, Pencil, Plus, Save,
  Search, Share2, ShoppingBag, Smartphone, Sparkles, Store, Trash2, UserRound,
  UsersRound, WalletCards, X
} from 'lucide-react';
import { api, clearToken, setToken, setUser } from './api.js';
import './marjorie-promoters.css';

const LOGO = '/marjorie-botas-logo.png';
const money = (value) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const date = (value, long = false) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-EC', long ? { day: 'numeric', month: 'long', year: 'numeric' } : undefined) : '-';
const today = () => new Date().toLocaleDateString('en-CA');
const statusText = { pending: 'Pendiente', active: 'Activa', review: 'En revision', suspended: 'Suspendida', revoked: 'Revocada', rejected: 'Rechazada', approved: 'Aprobado' };

const terms = [
  'No existe horario fijo ni obligacion de presentarse diariamente en un local.',
  'Puedes organizar tu actividad y recomendar clientes por redes sociales, WhatsApp o contactos.',
  'Toda venta debe identificarse con tu codigo, QR o enlace de referencia.',
  'Debes utilizar unicamente precios y promociones oficiales; no puedes realizar cobros no autorizados.',
  'Solo generan comision las compras pagadas, entregadas, no anuladas y no devueltas.',
  'Con autorizacion previa puedes crear contenido en cualquiera de nuestros locales.'
];

async function imageData(file) {
  if (!file) return '';
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 6 * 1024 * 1024) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 6 MB');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.86));
      };
      image.onerror = () => reject(new Error('La imagen no es valida'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function Notice({ value, error = false }) {
  return value ? <div className={`mb-notice ${error ? 'error' : ''}`} role="status">{value}</div> : null;
}

function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  return <span className="mb-password-field"><input {...props} type={visible ? 'text' : 'password'} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{visible ? <EyeOff /> : <Eye />}</button></span>;
}

export function MarjorieRegistration() {
  const empty = { name: '', cedula: '', whatsapp: '', email: '', instagram: '', city: '', photo_url: '', password: '', accepted_terms: false };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      await api('/marjorie/register', { method: 'POST', body: JSON.stringify(form) });
      setDone(true); setForm(empty);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  async function photo(file) {
    try { const photoUrl = await imageData(file); setForm((current) => ({ ...current, photo_url: photoUrl })); setError(''); }
    catch (err) { setError(err.message); }
  }

  return <main className="mb-register-page">
    {done && <div className="mb-success-overlay"><section><BadgeCheck /><h2>Solicitud enviada</h2><p>Revisaremos tus datos. Cuando tu perfil sea aprobado podrás ingresar con tu correo y contraseña.</p><button onClick={() => { setDone(false); window.location.href = '/'; }}>Entendido</button></section></div>}
    <header className="mb-public-header"><a href="/"><img src={LOGO} alt="Calzado Marjorie Botas" /></a><a href="/">Ya tengo una cuenta</a></header>
    <section className="mb-register-intro"><span>PROGRAMA DE PROMOTORAS</span><h1>Convierte tus recomendaciones en oportunidades</h1><p>Regístrate para formar parte del programa oficial de promotoras de Calzado Marjorie Botas.</p></section>
    <form className="mb-register-form" onSubmit={submit}>
      <div className="mb-form-heading"><h2>Datos personales</h2><p>Completa la información tal como consta en tus documentos.</p></div>
      <div className="mb-form-grid">
        <label>Nombres completos<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Cédula<input required inputMode="numeric" value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} /></label>
        <label>WhatsApp<input required inputMode="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
        <label>Correo electrónico<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Instagram<input required placeholder="usuario" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} /></label>
        <label>Ciudad<input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label>Contraseña<PasswordInput required minLength="6" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label className="mb-photo-input">Foto de perfil<input required type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => photo(e.target.files?.[0])} />{form.photo_url ? <img src={form.photo_url} alt="Vista previa" /> : <span><UserRound /> Elegir foto</span>}</label>
      </div>
      <div className="mb-terms"><h3>Condiciones del programa</h3>{terms.map((item) => <p key={item}><Check />{item}</p>)}</div>
      <label className="mb-terms-check"><input type="checkbox" checked={form.accepted_terms} onChange={(e) => setForm({ ...form, accepted_terms: e.target.checked })} /><span>He leído y acepto las condiciones del Programa de Promotoras Marjorie Botas.</span></label>
      <Notice value={error} error />
      <button className="mb-primary wide" disabled={saving || !form.accepted_terms}>{saving ? 'Enviando…' : 'Enviar solicitud'}<ChevronRight /></button>
    </form>
  </main>;
}

export function MarjorieReferralPage({ code }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/marjorie/ref/${encodeURIComponent(code)}`).then(setData).catch((err) => setError(err.message)); }, [code]);
  return <main className="mb-ref-page"><section>
    <img src={LOGO} alt="Calzado Marjorie Botas" />
    {error ? <Notice value={error} error /> : !data ? <p>Verificando código…</p> : <>
      <span className={`mb-status ${data.active ? 'active' : ''}`}>{data.status}</span>
      <p>Código de promotora</p><h1>{data.code}</h1>
      <div className="mb-ref-locations"><h2>Presenta este código en nuestros locales</h2>{data.branches.map((branch) => <div key={branch.id}><Store /><span><strong>{branch.name}</strong><small>{branch.city}{branch.address ? ` · ${branch.address}` : ''}</small></span></div>)}</div>
    </>}
  </section></main>;
}

function DigitalCard({ profile, onNotice }) {
  async function copy(value, message) {
    try { await navigator.clipboard.writeText(value); onNotice(message); } catch { onNotice('No se pudo copiar automáticamente'); }
  }
  async function share() {
    if (navigator.share) return navigator.share({ title: 'Promotora autorizada Marjorie Botas', text: `Mi código es ${profile.code}`, url: profile.referral_url });
    return copy(profile.referral_url, 'Enlace copiado');
  }
  return <article className="mb-digital-card">
    <div className="mb-card-brand"><img src={LOGO} alt="" /><span>PERSONAS QUE<br />INSPIRAN PASOS</span></div>
    <div className="mb-card-code"><small>MI CÓDIGO</small><strong>{profile.code}</strong>{profile.qr_url && <img src={profile.qr_url} alt={`QR ${profile.code}`} />}<span><Sparkles /> Nivel {profile.level.name}</span></div>
    <div className="mb-card-actions"><button title="Copiar código" onClick={() => copy(profile.code, 'Código copiado')}><Copy /></button><button title="Compartir enlace" onClick={share}><Share2 /></button></div>
  </article>;
}

function Metric({ icon: Icon, label, value, note }) {
  return <article className="mb-metric"><Icon /><div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div></article>;
}

function PromoterHome({ profile, setNotice }) {
  return <>
    <section className="mb-profile-head"><div className="mb-avatar">{profile.photo_url ? <img src={profile.photo_url} alt={profile.name} /> : <UserRound />}</div><div><img src={LOGO} alt="Calzado Marjorie Botas" /><h1>{profile.name}</h1><span><BadgeCheck /> Promotora Autorizada</span></div></section>
    {profile.status !== 'active' && <Notice value={profile.status === 'pending' ? 'Tu solicitud está pendiente de aprobación. Aquí aparecerán tu código, ciclos y beneficios cuando sea activada.' : `Estado de tu cuenta: ${profile.status_label}.`} error={profile.status !== 'pending'} />}
    {profile.status === 'active' && <>
      <DigitalCard profile={profile} onNotice={setNotice} />
      <section className="mb-progress"><div><span>Tu próximo nivel: <strong>{profile.level.next || profile.level.name}</strong></span><small>{profile.level.next ? `${profile.level.remaining} pares más para subir` : 'Nivel máximo alcanzado'}</small></div><div><span style={{ width: `${profile.level.progress}%` }} /></div></section>
      <section className="mb-metrics"><Metric icon={BarChart3} label="Pares del ciclo" value={profile.cycle_pairs} note={`${money(profile.cycle_rate)} por par`} /><Metric icon={DollarSign} label="Comisiones" value={money(profile.cycle_commission)} /><Metric icon={CalendarDays} label="Próximo corte" value={date(profile.payable_cut?.due_date)} /><Metric icon={Gift} label="Bono digital" value={`${money(profile.bonuses.filter((item) => item.cycle_start === profile.cycle?.start && item.status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0))} / $50`} /></section>
    </>}
  </>;
}

function PromoterSales({ profile }) {
  return <section className="mb-member-section"><div className="mb-section-title"><span>ACTIVIDAD</span><h2>Mis ventas</h2></div><div className="mb-member-list">{profile.sales.map((sale) => <article key={sale.id}><div><strong>{sale.customer_name}</strong><span>{sale.branch_name}</span><small>{date(sale.sale_date)} · {sale.pairs} pares</small></div><div><strong>{sale.effective_pairs} válidos</strong><span>{sale.is_voided ? 'Anulada' : sale.returned_pairs ? `${sale.returned_pairs} devueltos` : sale.is_paid && sale.is_delivered ? 'Confirmada' : 'En proceso'}</span></div></article>)}{!profile.sales.length && <p className="mb-empty">Todavía no tienes ventas registradas.</p>}</div></section>;
}

function PromoterPayments({ profile }) {
  return <section className="mb-member-section"><div className="mb-section-title"><span>CORTES PERSONALES</span><h2>Pagos y comisiones</h2></div><div className="mb-balance"><span>Saldo pendiente</span><strong>{money(profile.pending_total)}</strong><small>Próximo corte: {date(profile.payable_cut?.due_date, true)}</small></div><div className="mb-member-list">{profile.payments.map((payment) => <article key={payment.id}><div><strong>Pago del corte {payment.cut_number}</strong><span>Ciclo iniciado {date(payment.cycle_start)}</span><small>{date(payment.paid_at)}</small></div><div><strong>{money(payment.total_amount)}</strong><span>Comisión {money(payment.commission_amount)} · Bono {money(payment.bonus_amount)}</span>{Number(payment.adjustment_amount) !== 0 && <small>Ajuste {money(payment.adjustment_amount)}</small>}</div></article>)}{!profile.payments.length && <p className="mb-empty">Tus pagos realizados aparecerán aquí.</p>}</div></section>;
}

function PromoterContent({ profile }) {
  const [data, setData] = useState({ library: [], requests: [], branches: [] });
  const [form, setForm] = useState({ branch_client_id: '', request_type: 'Fotografias', desired_date: today(), comment: '' });
  const [notice, setNotice] = useState('');
  useEffect(() => { api('/marjorie/my-content').then(setData).catch((err) => setNotice(err.message)); }, []);
  async function request(event) {
    event.preventDefault(); setNotice('');
    try { await api('/marjorie/content-requests', { method: 'POST', body: JSON.stringify(form) }); setNotice('Solicitud enviada a administración'); setData(await api('/marjorie/my-content')); }
    catch (err) { setNotice(err.message); }
  }
  return <section className="mb-member-section"><div className="mb-section-title"><span>MATERIAL AUTORIZADO</span><h2>Contenido</h2></div>
    <div className="mb-content-grid">{data.library.map((item) => <article key={item.id}>{item.content_type === 'image' && item.asset_url && <img src={item.asset_url} alt="" />}<div><span>{item.content_type}</span><h3>{item.title}</h3><p>{item.description}</p>{item.asset_url && item.content_type !== 'image' && <a href={item.asset_url} target="_blank" rel="noreferrer">Abrir material <ExternalLink /></a>}</div></article>)}{!data.library.length && <p className="mb-empty">El material aprobado aparecerá en esta sección.</p>}</div>
    <form className="mb-request-form" onSubmit={request}><h3>Solicitar autorización en un local</h3><div className="mb-form-grid"><label>Local<select required value={form.branch_client_id} onChange={(e) => setForm({ ...form, branch_client_id: e.target.value })}><option value="">Seleccionar</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Tipo<select value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>{['Fotografias', 'Videos', 'Reels', 'TikTok Live', 'Otro'].map((type) => <option key={type}>{type}</option>)}</select></label><label>Fecha deseada<input type="date" min={today()} value={form.desired_date} onChange={(e) => setForm({ ...form, desired_date: e.target.value })} /></label><label>Comentario<textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label></div><Notice value={notice} error={/no |revisa|debe|error/i.test(notice)} /><button className="mb-primary">Enviar solicitud</button></form>
    <div className="mb-member-list">{data.requests.map((item) => <article key={item.id}><div><strong>{item.request_type}</strong><span>{item.branch_name}</span><small>{date(item.desired_date)}</small></div><span className={`mb-status ${item.status}`}>{statusText[item.status] || item.status}</span></article>)}</div>
  </section>;
}

function PromoterProfile({ profile, reload }) {
  const [form, setForm] = useState({ whatsapp: profile.whatsapp, instagram: profile.instagram, city: profile.city, photo_url: profile.photo_url || '' });
  const [password, setPassword] = useState({ current_password: '', new_password: '' });
  const [notice, setNotice] = useState('');
  async function save(event) { event.preventDefault(); try { await api('/marjorie/me', { method: 'PATCH', body: JSON.stringify(form) }); await reload(); setNotice('Perfil actualizado'); } catch (err) { setNotice(err.message); } }
  async function changePassword(event) { event.preventDefault(); try { await api('/marjorie/password', { method: 'PATCH', body: JSON.stringify(password) }); setPassword({ current_password: '', new_password: '' }); setNotice('Contraseña actualizada'); } catch (err) { setNotice(err.message); } }
  return <section className="mb-member-section"><div className="mb-section-title"><span>MI CUENTA</span><h2>Perfil</h2></div><div className="mb-profile-forms"><form onSubmit={save}><h3>Datos de contacto</h3><label>WhatsApp<input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label><label>Instagram<input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} /></label><label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label><label>Foto<input type="file" accept="image/*" onChange={async (e) => { try { setForm({ ...form, photo_url: await imageData(e.target.files?.[0]) }); } catch (err) { setNotice(err.message); } }} /></label><button className="mb-primary"><Save /> Guardar perfil</button></form><form onSubmit={changePassword}><h3>Seguridad</h3><label>Contraseña actual<PasswordInput value={password.current_password} onChange={(e) => setPassword({ ...password, current_password: e.target.value })} /></label><label>Nueva contraseña<PasswordInput minLength="6" value={password.new_password} onChange={(e) => setPassword({ ...password, new_password: e.target.value })} /></label><button className="mb-secondary"><KeyRound /> Cambiar contraseña</button></form></div><Notice value={notice} /></section>;
}

export function MarjoriePromoterApp({ onLogout }) {
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('home');
  const [notice, setNotice] = useState('');
  async function load() { setProfile(await api('/marjorie/me')); }
  useEffect(() => { load().catch(() => onLogout()); }, []);
  if (!profile) return <main className="mb-member-app"><p className="mb-loading">Preparando tu perfil…</p></main>;
  const nav = [['home', 'Inicio', Home], ['sales', 'Ventas', BarChart3], ['payments', 'Pagos', WalletCards], ['content', 'Contenido', ImageIcon], ['profile', 'Perfil', UserRound]];
  return <main className="mb-member-app"><header className="mb-member-top"><img src={LOGO} alt="Calzado Marjorie Botas" /><button onClick={onLogout}><LogOut /> Salir</button></header>{notice && <Notice value={notice} />}
    <div className="mb-member-body">{view === 'home' && <PromoterHome profile={profile} setNotice={setNotice} />}{view === 'sales' && <PromoterSales profile={profile} />}{view === 'payments' && <PromoterPayments profile={profile} />}{view === 'content' && <PromoterContent profile={profile} />}{view === 'profile' && <PromoterProfile profile={profile} reload={load} />}</div>
    <nav className="mb-member-nav">{nav.map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}><Icon /><span>{label}</span></button>)}</nav>
  </main>;
}

function AdminOverview({ dashboard, openPromoter }) {
  const stats = dashboard?.stats || {};
  const cards = [['Promotoras activas', stats.active, UsersRound], ['Nuevas solicitudes', stats.pending, ClipboardCheck], ['Pares vendidos', stats.pairs, ShoppingBag], ['Comisiones pendientes', money(stats.commissions_pending), DollarSign], ['Bonos pendientes', money(stats.bonuses_pending), Gift], ['Pagado en comisiones', money(stats.commissions_paid), WalletCards]];
  return <><section className="mba-stats">{cards.map(([label, value, Icon]) => <article key={label}><Icon /><span>{label}</span><strong>{value ?? 0}</strong></article>)}</section><section className="mba-split"><div className="mba-band"><div className="mba-heading"><div><span>AGENDA</span><h2>Pagos para hoy</h2></div></div>{dashboard?.payments_today?.map((item) => <article className="mba-payment-row" key={item.id}><div><strong>{item.name}</strong><span>{item.code} · Corte {item.cut.cut_number}</span></div><div><span>Comisión {money(item.commission)}</span><span>Bono {money(item.bonus)}</span><strong>{money(item.total)}</strong></div><button onClick={() => openPromoter(item.id)}>Ver detalle <ChevronRight /></button></article>)}{!dashboard?.payments_today?.length && <p className="mb-empty">No hay pagos vencidos para hoy.</p>}</div><div className="mba-band"><div className="mba-heading"><div><span>SEGUIMIENTO</span><h2>Alertas de rendimiento</h2></div></div>{dashboard?.alerts?.map((item) => <button className={`mba-alert-row ${item.level}`} key={item.id} onClick={() => openPromoter(item.id)}><span><strong>{item.name}</strong><small>{item.label}</small></span><ChevronRight /></button>)}{!dashboard?.alerts?.length && <p className="mb-empty">No hay alertas de rendimiento.</p>}</div></section></>;
}

function AdminPromoters({ rows, selectedId, setSelectedId }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all');
  const filtered = rows.filter((row) => (status === 'all' || row.status === status) && `${row.name} ${row.code || ''} ${row.cedula}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="mba-band"><div className="mba-heading"><div><span>PROGRAMA</span><h2>Promotoras</h2></div><div className="mba-filters"><label><Search /><input placeholder="Buscar nombre, código o cédula" value={search} onChange={(e) => setSearch(e.target.value)} /></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos los estados</option>{['pending', 'active', 'review', 'suspended', 'rejected', 'revoked'].map((item) => <option value={item} key={item}>{statusText[item]}</option>)}</select></div></div><div className="mba-promoter-list">{filtered.map((row) => <button key={row.id} className={Number(selectedId) === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}><span className="mba-list-avatar">{row.photo_url ? <img src={row.photo_url} alt="" /> : <UserRound />}</span><span><strong>{row.name}</strong><small>{row.code || 'Código pendiente'} · {row.city}</small></span><span className={`mb-status ${row.status}`}>{row.status_label}</span><span><strong>{row.cycle_pairs || 0}</strong><small>pares</small></span><span><strong>{money(row.pending_total)}</strong><small>pendiente</small></span><ChevronRight /></button>)}{!filtered.length && <p className="mb-empty">No hay resultados con estos filtros.</p>}</div></section>;
}

function BonusEditor({ detail, cut, save }) {
  const existing = detail.bonuses.find((item) => item.cycle_start === detail.cycle.start && Number(item.cut_number) === cut);
  const [form, setForm] = useState(existing || { active_page: false, published_content: false, stories_reels: false, correct_information: false, appropriate_content: false, evidence_url: '', observation: '', status: 'pending' });
  const fields = [['active_page', 'Página o red activa'], ['published_content', 'Publicó contenido'], ['stories_reels', 'Historias, reels o TikTok'], ['correct_information', 'Información correcta'], ['appropriate_content', 'Contenido adecuado']];
  return <article className="mba-bonus"><div><span>CORTE {cut}</span><strong>Bono digital {money(25)}</strong><small>{cut === 1 ? date(detail.cycle.first_cut) : date(detail.cycle.end)}</small></div>{fields.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{label}</label>)}<label>Evidencia o enlace<input value={form.evidence_url || ''} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} /></label><label>Observación<textarea value={form.observation || ''} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></label><div><button className="mb-primary" onClick={() => save(cut, { ...form, status: 'approved' })}><Check /> Aprobar $25</button><button className="mb-secondary" onClick={() => save(cut, { ...form, status: 'rejected' })}><X /> No aprobar</button></div></article>;
}

function AdminPromoterDetail({ detail, reload, close }) {
  const [notice, setNotice] = useState('');
  const [sale, setSale] = useState({ branch_client_id: '', customer_name: '', customer_whatsapp: '', pairs: 1, sale_date: today(), is_paid: true, is_delivered: true, notes: '' });
  const [edit, setEdit] = useState({ ...detail });
  async function action(path, options, message) { try { const result = await api(path, options); await reload(); setNotice(typeof message === 'function' ? message(result) : message); return result; } catch (err) { setNotice(err.message); return null; } }
  async function addSale(event) { event.preventDefault(); await action('/marjorie/admin/sales', { method: 'POST', body: JSON.stringify({ ...sale, promoter_id: detail.id }) }, 'Venta registrada y comisión recalculada'); }
  async function toggleSale(row, changes) { await action(`/marjorie/admin/sales/${row.id}`, { method: 'PATCH', body: JSON.stringify({ ...row, ...changes }) }, 'Venta actualizada'); }
  async function saveBonus(cut, form) { await action('/marjorie/admin/bonuses', { method: 'PUT', body: JSON.stringify({ ...form, promoter_id: detail.id, cycle_start: detail.cycle.start, cut_number: cut }) }, 'Bono actualizado'); }
  return <section className="mba-detail"><div className="mba-detail-top"><button className="mba-icon" onClick={close}><X /></button><div className="mba-person"><span>{detail.photo_url ? <img src={detail.photo_url} alt="" /> : <UserRound />}</span><div><small>{detail.code || 'SOLICITUD'}</small><h2>{detail.name}</h2><p>{detail.email} · {detail.whatsapp}</p></div></div><span className={`mb-status ${detail.status}`}>{detail.status_label}</span>{detail.status === 'pending' && <button className="mb-primary" onClick={() => action(`/marjorie/admin/promoters/${detail.id}/approve`, { method: 'POST' }, (result) => result.email_sent ? 'Promotora aprobada. Enviamos sus accesos al correo registrado.' : `Promotora aprobada, pero el correo no se pudo enviar: ${result.email_reason || 'revisa la configuración'}`)}>Aprobar solicitud</button>}</div><Notice value={notice} error={/no |error|revisa|superar|debe/i.test(notice)} />
    <section className="mba-detail-metrics"><Metric icon={CalendarDays} label="Ciclo actual" value={detail.cycle ? `${date(detail.cycle.start)} → ${date(detail.cycle.end)}` : 'Sin activar'} note={detail.cycle ? `${detail.cycle.days_remaining} días restantes` : ''} /><Metric icon={ShoppingBag} label="Pares válidos" value={detail.cycle_pairs} note={`Tarifa ${money(detail.cycle_rate)}`} /><Metric icon={DollarSign} label="Comisión acumulada" value={money(detail.cycle_commission)} note={`Pagado ${money(detail.total_paid)}`} /><Metric icon={Gift} label="Saldo pendiente" value={money(detail.pending_total)} note={`Próximo corte ${date(detail.payable_cut?.due_date)}`} /></section>
    <details className="mba-editor"><summary><Pencil /> Editar datos y estado</summary><form onSubmit={(e) => { e.preventDefault(); action(`/marjorie/admin/promoters/${detail.id}`, { method: 'PATCH', body: JSON.stringify(edit) }, 'Datos actualizados'); }}><div className="mb-form-grid"><label>Nombre<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label><label>Cédula<input value={edit.cedula} onChange={(e) => setEdit({ ...edit, cedula: e.target.value })} /></label><label>WhatsApp<input value={edit.whatsapp} onChange={(e) => setEdit({ ...edit, whatsapp: e.target.value })} /></label><label>Correo<input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label><label>Instagram<input value={edit.instagram} onChange={(e) => setEdit({ ...edit, instagram: e.target.value })} /></label><label>Ciudad<input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></label><label>Estado<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{['pending', 'active', 'review', 'suspended', 'revoked', 'rejected'].map((item) => <option key={item} value={item}>{statusText[item]}</option>)}</select></label><label>Observaciones<textarea value={edit.admin_notes || ''} onChange={(e) => setEdit({ ...edit, admin_notes: e.target.value })} /></label></div><button className="mb-primary"><Save /> Guardar cambios</button></form></details>
    {detail.activated_at && <><section className="mba-work-grid"><form className="mba-sale-form" onSubmit={addSale}><div className="mba-heading"><div><span>VENTA REFERIDA</span><h3>Registrar pares</h3></div></div><label>Local<select required value={sale.branch_client_id} onChange={(e) => setSale({ ...sale, branch_client_id: e.target.value })}><option value="">Seleccionar</option>{detail.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Cliente<input value={sale.customer_name} onChange={(e) => setSale({ ...sale, customer_name: e.target.value })} /></label><label>WhatsApp cliente<input value={sale.customer_whatsapp} onChange={(e) => setSale({ ...sale, customer_whatsapp: e.target.value })} /></label><div className="mb-form-grid"><label>Pares<input min="1" type="number" value={sale.pairs} onChange={(e) => setSale({ ...sale, pairs: e.target.value })} /></label><label>Fecha<input type="date" max={today()} value={sale.sale_date} onChange={(e) => setSale({ ...sale, sale_date: e.target.value })} /></label></div><label className="mb-check"><input type="checkbox" checked={sale.is_paid} onChange={(e) => setSale({ ...sale, is_paid: e.target.checked })} />Pagada</label><label className="mb-check"><input type="checkbox" checked={sale.is_delivered} onChange={(e) => setSale({ ...sale, is_delivered: e.target.checked })} />Entregada</label><button className="mb-primary"><Plus /> Registrar venta</button></form><div className="mba-bonuses"><div className="mba-heading"><div><span>CICLO ACTUAL</span><h3>Bonos digitales</h3></div></div><BonusEditor key={`${detail.id}-1-${detail.bonuses.length}`} detail={detail} cut={1} save={saveBonus} /><BonusEditor key={`${detail.id}-2-${detail.bonuses.length}`} detail={detail} cut={2} save={saveBonus} /></div></section>
    <section className="mba-band"><div className="mba-heading"><div><span>MOVIMIENTOS</span><h3>Historial de ventas</h3></div>{detail.payable_cut?.due_date <= today() && detail.payable_total > 0 && <button className="mb-primary" onClick={() => action(`/marjorie/admin/promoters/${detail.id}/pay`, { method: 'POST', body: JSON.stringify({}) }, 'Pago registrado')}>Pagar corte {detail.payable_cut.cut_number}: {money(detail.payable_total)}</button>}</div><div className="mba-sales-list">{detail.sales.map((row) => <article key={row.id}><div><strong>{row.customer_name}</strong><span>{row.branch_name} · {date(row.sale_date)}</span><small>{row.pairs} pares · {row.effective_pairs} válidos</small></div><label>Pagada<input type="checkbox" checked={Boolean(row.is_paid)} onChange={(e) => toggleSale(row, { is_paid: e.target.checked })} /></label><label>Entregada<input type="checkbox" checked={Boolean(row.is_delivered)} onChange={(e) => toggleSale(row, { is_delivered: e.target.checked })} /></label><label>Devueltos<input min="0" max={row.pairs} type="number" defaultValue={row.returned_pairs} onBlur={(e) => toggleSale(row, { returned_pairs: e.target.value })} /></label><button className={row.is_voided ? 'mb-secondary' : 'mba-danger'} onClick={() => toggleSale(row, { is_voided: !row.is_voided })}>{row.is_voided ? 'Restaurar' : 'Anular'}</button></article>)}{!detail.sales.length && <p className="mb-empty">No hay ventas registradas.</p>}</div></section></>}
  </section>;
}

function AdminContent({ data, reload }) {
  const [form, setForm] = useState({ title: '', content_type: 'image', asset_url: '', description: '', status: 'active' }); const [notice, setNotice] = useState('');
  async function submit(event) { event.preventDefault(); try { await api('/marjorie/admin/content', { method: 'POST', body: JSON.stringify(form) }); setForm({ title: '', content_type: 'image', asset_url: '', description: '', status: 'active' }); await reload(); setNotice('Material publicado'); } catch (err) { setNotice(err.message); } }
  async function review(item, status) { await api(`/marjorie/admin/content-requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await reload(); }
  return <section className="mba-content-layout"><form className="mba-band" onSubmit={submit}><div className="mba-heading"><div><span>BIBLIOTECA</span><h2>Publicar contenido</h2></div></div><label>Título<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Tipo<select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}>{['image', 'video', 'reel', 'promotion', 'text', 'link'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Archivo o enlace<input value={form.asset_url} onChange={(e) => setForm({ ...form, asset_url: e.target.value })} /></label>{form.content_type === 'image' && <label>Subir imagen<input type="file" accept="image/*" onChange={async (e) => { try { setForm({ ...form, asset_url: await imageData(e.target.files?.[0]) }); } catch (err) { setNotice(err.message); } }} /></label>}<label>Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><Notice value={notice} /><button className="mb-primary"><Plus /> Publicar</button></form><section className="mba-band"><div className="mba-heading"><div><span>LOCALES</span><h2>Solicitudes de autorización</h2></div></div><div className="mba-request-list">{data.requests.map((item) => <article key={item.id}><div><strong>{item.promoter_name}</strong><span>{item.request_type} · {item.branch_name}</span><small>{date(item.desired_date)} · {item.comment}</small></div><span className={`mb-status ${item.status}`}>{statusText[item.status] || item.status}</span>{item.status === 'pending' && <div><button className="mb-primary" onClick={() => review(item, 'approved')}><Check /></button><button className="mba-danger" onClick={() => review(item, 'rejected')}><X /></button></div>}</article>)}{!data.requests.length && <p className="mb-empty">No hay solicitudes.</p>}</div></section><section className="mba-band mba-library"><div className="mba-heading"><div><span>PUBLICADO</span><h2>Material disponible</h2></div></div>{data.library.map((item) => <article key={item.id}>{item.content_type === 'image' && item.asset_url ? <img src={item.asset_url} alt="" /> : <FileText />}<div><strong>{item.title}</strong><span>{item.content_type} · {item.status}</span><p>{item.description}</p></div><button className="mb-secondary" onClick={async () => { await api(`/marjorie/admin/content/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'active' ? 'inactive' : 'active' }) }); reload(); }}>{item.status === 'active' ? 'Ocultar' : 'Activar'}</button></article>)}</section></section>;
}

export function MarjoriePromotersAdmin({ embedded = false }) {
  const [view, setView] = useState('overview'); const [dashboard, setDashboard] = useState(null); const [promoters, setPromoters] = useState([]); const [content, setContent] = useState({ library: [], requests: [] }); const [selectedId, setSelectedId] = useState(null); const [detail, setDetail] = useState(null); const [error, setError] = useState(''); const [menu, setMenu] = useState(false);
  async function load() { try { const [nextDashboard, nextPromoters, nextContent] = await Promise.all([api('/marjorie/admin/dashboard'), api('/marjorie/admin/promoters'), api('/marjorie/admin/content')]); setDashboard(nextDashboard); setPromoters(nextPromoters); setContent(nextContent); if (selectedId) setDetail(await api(`/marjorie/admin/promoters/${selectedId}`)); setError(''); } catch (err) { setError(err.message); } }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (selectedId) api(`/marjorie/admin/promoters/${selectedId}`).then(setDetail).catch((err) => setError(err.message)); else setDetail(null); }, [selectedId]);
  const nav = [['overview', 'Resumen', BarChart3], ['promoters', 'Promotoras', UsersRound], ['content', 'Contenido', ImageIcon]];
  function openPromoter(id) { setSelectedId(id); setView('promoters'); }
  return <main className={`mba-app ${embedded ? 'embedded' : ''}`}><header className="mba-top"><div><img src={LOGO} alt="" /><span>Administración de Promotoras</span></div><button className="mba-menu" onClick={() => setMenu(!menu)}><Menu /> Opciones</button><nav className={menu ? 'open' : ''}>{nav.map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setMenu(false); }}><Icon />{label}{key === 'promoters' && dashboard?.stats?.pending > 0 && <span>{dashboard.stats.pending}</span>}</button>)}</nav></header><Notice value={error} error /><div className="mba-body">{view === 'overview' && <AdminOverview dashboard={dashboard} openPromoter={openPromoter} />}{view === 'promoters' && !detail && <AdminPromoters rows={promoters} selectedId={selectedId} setSelectedId={setSelectedId} />}{view === 'promoters' && detail && <AdminPromoterDetail key={`${detail.id}-${detail.updated_at}-${detail.sales.length}-${detail.bonuses.length}`} detail={detail} close={() => setSelectedId(null)} reload={async () => { await load(); setDetail(await api(`/marjorie/admin/promoters/${detail.id}`)); }} />}{view === 'content' && <AdminContent data={content} reload={load} />}</div></main>;
}
