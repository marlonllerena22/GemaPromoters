import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, Check, ChevronRight, CirclePause, CirclePlay, Clock3, MessageCircle, Phone, Send, Settings2, ShieldCheck, Sparkles, Store, UserRound, X } from 'lucide-react';
import { api } from './api.js';
import './content-studio-lumi.css';

const STATUS = {
  lumi_attending: { label: 'Lumi atendiendo', className: 'lumi' },
  waiting: { label: 'Esperando respuesta', className: 'waiting' },
  needs_attention: { label: 'Requiere atención', className: 'attention' },
  human: { label: 'Atendido por ti', className: 'human' }
};

const EMPTY_SETTINGS = {
  products_services: '', prices: '', business_hours: '', addresses: '', shipping: '', payment_methods: '',
  faqs: '', tone: 'Cercano, profesional y claro', welcome_message: ''
};

function statusFor(value) { return STATUS[value] || STATUS.waiting; }
function displayTime(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  return date.toLocaleDateString('es-EC') === new Date().toLocaleDateString('es-EC')
    ? date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}

function LumiAvatar({ small = false }) {
  return <span className={`lumi-avatar ${small ? 'small' : ''}`}><img src="/content-studio/brand/mascota-toque.webp" alt="Lumi" /></span>;
}

function Upgrade({ onUpgrade }) {
  return <section className="lumi-upgrade">
    <div className="lumi-upgrade-glow" />
    <div className="lumi-upgrade-brand"><LumiAvatar /><span>LUMI BUSINESS</span></div>
    <h1>Tu contenido y tus ventas,<br /><em>asistidos por IA.</em></h1>
    <p className="lumi-upgrade-lead">Crea contenido profesional y atiende a tus clientes en WhatsApp, incluso cuando estás ocupado.</p>
    <div className="lumi-upgrade-preview">
      <div><LumiAvatar small /><p><span>Lumi</span>¡Hola! Claro 😊 Tenemos entregas y puedo ayudarte a elegir la mejor opción.</p></div>
      <div className="lumi-preview-status"><i /> Lumi está atendiendo</div>
    </div>
    <div className="lumi-benefits">
      <article><span><Sparkles /></span><div><strong>Estudios Creativos avanzado</strong><p>Todo el nivel superior de generación de imágenes.</p></div></article>
      <article><span><MessageCircle /></span><div><strong>Asistente de Ventas Lumi</strong><p>Responde el WhatsApp del negocio con tu información.</p></div></article>
      <article><span><UserRound /></span><div><strong>Tú mantienes el control</strong><p>Revisa cada respuesta y toma cualquier conversación.</p></div></article>
    </div>
    <div className="lumi-price"><span>Plan mensual</span><strong><small>$</small>180</strong></div>
    <button className="lumi-main-button" type="button" onClick={onUpgrade}>Actualizar a Lumi Business <ChevronRight /></button>
    <small className="lumi-safe"><ShieldCheck /> Activación después de confirmar tu transferencia.</small>
  </section>;
}

export default function ContentStudioLumi({ onUpgrade, setGlobalError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const connectionRef = useRef({ code: '', waba_id: '', phone_number_id: '' });

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const response = await api('/content-studio/lumi');
      setData(response);
      if (!quiet) setSettings({ ...EMPTY_SETTINGS, ...(response.account?.settings || {}) });
      if (selected) setSelected(response.conversations?.find((item) => item.id === selected.id) || selected);
    } catch (error) { setGlobalError(error.message); }
    finally { if (!quiet) setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!data?.entitled) return undefined;
    const timer = window.setInterval(() => load({ quiet: true }), 12000);
    return () => window.clearInterval(timer);
  }, [data?.entitled, selected?.id]);
  useEffect(() => {
    if (!data?.connection_ready || !data?.embed || data.account?.connected) return;
    loadFacebookSdk(data.embed.app_id, data.embed.graph_version).catch(() => {});
  }, [data?.connection_ready, data?.embed?.app_id, data?.embed?.graph_version, data?.account?.connected]);

  async function saveSettings(event) {
    event?.preventDefault(); setSaving(true); setNotice('');
    try {
      const response = await api('/content-studio/lumi/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setData((current) => ({ ...current, account: response.account }));
      setNotice('Lumi ya conoce esta información.');
    } catch (error) { setGlobalError(error.message); }
    finally { setSaving(false); }
  }

  async function toggleActive() {
    if (!data.account?.connected) { setGlobalError('Conecta el WhatsApp Business antes de activar a Lumi.'); return; }
    const active = !data.account.active;
    try {
      const response = await api('/content-studio/lumi/settings', { method: 'PUT', body: JSON.stringify({ ...settings, active }) });
      setData((current) => ({ ...current, account: response.account }));
      setNotice(active ? 'Lumi está atendiendo.' : 'Lumi quedó en pausa.');
    } catch (error) { setGlobalError(error.message); }
  }

  async function openConversation(item) {
    setSelected(item); setView('conversation'); setThread(null);
    try { setThread(await api(`/content-studio/lumi/conversations/${item.id}/messages`)); }
    catch (error) { setGlobalError(error.message); }
  }

  async function changeOwner(action) {
    try {
      await api(`/content-studio/lumi/conversations/${selected.id}/${action}`, { method: 'POST', body: '{}' });
      await openConversation({ ...selected, status: action === 'take' ? 'human' : 'waiting' });
      await load({ quiet: true });
    } catch (error) { setGlobalError(error.message); }
  }

  async function sendReply(event) {
    event.preventDefault(); const body = reply.trim(); if (!body) return;
    setSaving(true);
    try {
      await api(`/content-studio/lumi/conversations/${selected.id}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
      setReply(''); await openConversation({ ...selected, status: 'human' }); await load({ quiet: true });
    } catch (error) { setGlobalError(error.message); }
    finally { setSaving(false); }
  }

  async function loadFacebookSdk(appId, version) {
    if (window.FB) {
      window.FB.init({ appId, cookie: true, xfbml: false, version });
      return;
    }
    await new Promise((resolve, reject) => {
      window.fbAsyncInit = () => { window.FB.init({ appId, cookie: true, xfbml: false, version }); resolve(); };
      const script = document.createElement('script'); script.id = 'facebook-jssdk'; script.async = true; script.defer = true;
      script.crossOrigin = 'anonymous'; script.src = 'https://connect.facebook.net/es_LA/sdk.js'; script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function connectWhatsApp() {
    if (!data.connection_ready || !data.embed) { setGlobalError('La conexión de WhatsApp está terminando de configurarse.'); return; }
    setSaving(true); connectionRef.current = { code: '', waba_id: '', phone_number_id: '' };
    const onMessage = (event) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      let payload = event.data;
      try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return; }
      if (payload?.type === 'WA_EMBEDDED_SIGNUP' && ['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(payload.event)) {
        connectionRef.current.waba_id = payload.data?.waba_id || '';
        connectionRef.current.phone_number_id = payload.data?.phone_number_id || '';
      }
    };
    window.addEventListener('message', onMessage);
    try {
      await loadFacebookSdk(data.embed.app_id, data.embed.graph_version);
      const auth = await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Meta no abrió la autorización. Actualiza la página e inténtalo otra vez.')), 20000);
        window.FB.login((response) => {
          window.clearTimeout(timer);
          resolve(response);
        }, {
          config_id: data.embed.config_id,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3'
          }
        });
      });
      connectionRef.current.code = auth?.authResponse?.code || '';
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      if (!connectionRef.current.code || !connectionRef.current.waba_id) throw new Error('Meta no devolvió todos los datos. Completa todas las pantallas e inténtalo otra vez.');
      await api('/content-studio/lumi/connect/complete', { method: 'POST', body: JSON.stringify(connectionRef.current) });
      setNotice('WhatsApp Business quedó conectado con Lumi.'); await load();
    } catch (error) { setGlobalError(error.message || 'No se pudo conectar WhatsApp Business.'); }
    finally { window.removeEventListener('message', onMessage); setSaving(false); }
  }

  const summary = useMemo(() => ({
    today: Number(data?.summary?.today || 0), attention: Number(data?.summary?.needs_attention || 0)
  }), [data]);

  if (loading) return <div className="lumi-loading"><LumiAvatar /><span>Cargando Lumi Business…</span></div>;
  if (!data?.entitled) return <Upgrade onUpgrade={() => onUpgrade('lumi')} />;

  if (view === 'conversation' && selected) {
    const status = statusFor(thread?.conversation?.status || selected.status);
    return <section className="lumi-conversation-page">
      <header><button type="button" onClick={() => { setView('dashboard'); setSelected(null); }}><ArrowLeft /></button><div className="lumi-customer-avatar">{String(selected.customer_name || 'C')[0]}</div><div><strong>{selected.customer_name || selected.customer_phone}</strong><span className={status.className}>{status.label}</span></div></header>
      <div className="lumi-chat-body">{thread ? thread.messages.map((message) => <div key={message.id} className={`lumi-message ${message.sender}`}>
        {message.sender === 'lumi' && <LumiAvatar small />}<div><small>{message.sender === 'customer' ? selected.customer_name || 'Cliente' : message.sender === 'human' ? 'Tú' : 'Lumi'}</small><p>{message.body}</p><time>{displayTime(message.created_at)}</time></div>
      </div>) : <div className="lumi-thread-loading">Cargando conversación…</div>}</div>
      <div className="lumi-takeover">
        {(thread?.conversation?.status || selected.status) !== 'human'
          ? <button type="button" onClick={() => changeOwner('take')}><UserRound /> Tomar conversación</button>
          : <button className="release" type="button" onClick={() => changeOwner('release')}><Bot /> Devolver a Lumi</button>}
        <p>{(thread?.conversation?.status || selected.status) === 'human' ? 'Lumi está en pausa solo en este chat.' : 'Puedes intervenir personalmente cuando quieras.'}</p>
      </div>
      {(thread?.conversation?.status || selected.status) === 'human' && <form className="lumi-reply" onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Escribe tu respuesta…" rows="1"/><button disabled={saving || !reply.trim()}><Send /></button></form>}
    </section>;
  }

  return <section className="lumi-dashboard">
    <header className="lumi-dashboard-head"><div><span className="cs-eyebrow">Lumi Business</span><h1>Tu asistente de ventas</h1><p>WhatsApp atendido con la información real de tu negocio.</p></div><LumiAvatar /></header>
    {notice && <div className="lumi-notice"><Check />{notice}<button onClick={() => setNotice('')}><X /></button></div>}
    {!data.account?.connected ? <section className="lumi-connect-card"><span><Phone /></span><div><small>PRIMER PASO</small><h2>Conecta tu WhatsApp Business</h2><p>Meta te pedirá elegir el número del negocio. Lumi solo responderá cuando tú lo actives.</p><button type="button" disabled={saving} onClick={connectWhatsApp}>{saving ? 'Conectando…' : 'Conectar WhatsApp Business'} <ChevronRight /></button></div></section> : <>
      <section className={`lumi-live-card ${data.account.active ? 'active' : ''}`}><div><span><i /> {data.account.active ? 'Lumi está activo' : 'Lumi está en pausa'}</span><strong>{data.account.phone_display}</strong><small>{data.account.business_name}</small></div><button type="button" onClick={toggleActive}>{data.account.active ? <CirclePause /> : <CirclePlay />} {data.account.active ? 'Pausar' : 'Activar'}</button></section>
      <div className="lumi-metrics"><article><MessageCircle /><strong>{summary.today}</strong><span>conversaciones<br/>atendidas hoy</span></article><article className={summary.attention ? 'attention' : ''}><UserRound /><strong>{summary.attention}</strong><span>necesitan<br/>tu atención</span></article></div>
    </>}
    <div className="lumi-tabs"><button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><MessageCircle /> Conversaciones</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings2 /> Información de Lumi</button></div>
    {view === 'dashboard' ? <section className="lumi-recents"><div className="lumi-section-title"><div><h2>Chats recientes</h2><p>Mira lo que preguntan tus clientes y cómo responde Lumi.</p></div></div>
      {data.conversations?.length ? data.conversations.map((item) => { const status = statusFor(item.status); return <button type="button" key={item.id} onClick={() => openConversation(item)} className="lumi-chat-row"><div className="lumi-customer-avatar">{String(item.customer_name || 'C')[0]}</div><div><strong>{item.customer_name || item.customer_phone}<time>{displayTime(item.last_message_at)}</time></strong><p>{item.last_message_preview || 'Conversación iniciada'}</p><span className={status.className}>{status.label}</span></div><ChevronRight /></button>; })
      : <div className="lumi-empty"><MessageCircle /><h3>Aquí aparecerán tus conversaciones</h3><p>Cuando un cliente escriba al WhatsApp conectado, verás el chat y las respuestas de Lumi en tiempo real.</p></div>}
    </section> : <form className="lumi-knowledge" onSubmit={saveSettings}>
      <div className="lumi-section-title"><div><h2>Lo que Lumi debe conocer</h2><p>Escribe como se lo explicarías a una persona nueva de tu equipo.</p></div><Store /></div>
      <label><span>Productos o servicios</span><small>Qué vendes y para quién.</small><textarea rows="4" value={settings.products_services} onChange={(e) => setSettings({ ...settings, products_services: e.target.value })} placeholder="Ej. Tenemos zapatos, carteras y accesorios…" /></label>
      <div className="lumi-fields-two"><label><span>Precios</span><textarea rows="3" value={settings.prices} onChange={(e) => setSettings({ ...settings, prices: e.target.value })} placeholder="Producto, precio y promociones vigentes" /></label><label><span>Horarios</span><textarea rows="3" value={settings.business_hours} onChange={(e) => setSettings({ ...settings, business_hours: e.target.value })} placeholder="Lunes a viernes…" /></label></div>
      <label><span>Direcciones</span><textarea rows="3" value={settings.addresses} onChange={(e) => setSettings({ ...settings, addresses: e.target.value })} placeholder="Locales y referencias para llegar" /></label>
      <div className="lumi-fields-two"><label><span>Envíos</span><textarea rows="3" value={settings.shipping} onChange={(e) => setSettings({ ...settings, shipping: e.target.value })} placeholder="Ciudades, costos y tiempos" /></label><label><span>Formas de pago</span><textarea rows="3" value={settings.payment_methods} onChange={(e) => setSettings({ ...settings, payment_methods: e.target.value })} placeholder="Transferencia, efectivo…" /></label></div>
      <label><span>Preguntas frecuentes</span><small>Incluye cambios, disponibilidad, reservas y políticas.</small><textarea rows="5" value={settings.faqs} onChange={(e) => setSettings({ ...settings, faqs: e.target.value })} placeholder="Pregunta: ¿Hacen cambios? Respuesta: …" /></label>
      <label><span>Tono de atención</span><input value={settings.tone} onChange={(e) => setSettings({ ...settings, tone: e.target.value })} placeholder="Cercano, profesional y claro" /></label>
      <label><span>Saludo preferido <em>Opcional</em></span><textarea rows="2" value={settings.welcome_message} onChange={(e) => setSettings({ ...settings, welcome_message: e.target.value })} placeholder="Si lo dejas vacío, Lumi creará uno natural." /></label>
      <button className="lumi-save" disabled={saving}>{saving ? 'Guardando…' : <><Check /> Guardar información</>}</button>
    </form>}
  </section>;
}
