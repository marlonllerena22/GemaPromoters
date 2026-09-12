import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, ExternalLink, Link2, LockKeyhole, RefreshCw, Send, Trash2, WandSparkles, X } from 'lucide-react';
import { api } from './api.js';
import './content-studio-social.css';

function useSocialData(enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  async function load() {
    if (!enabled) return;
    setLoading(true); setError('');
    try { setData(await api('/content-studio/social')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (enabled) void load(); }, [enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'estudios-meta-connected') return;
      if (event.data.ok) void load(); else setError(event.data.message || 'Meta no pudo completar la conexión');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [enabled]);
  return { data, error, setError, loading, load };
}

async function openMetaConnection(setError) {
  setError('');
  const popup = window.open('about:blank', `estudios-meta-connect-${Date.now()}`, 'popup,width=620,height=760');
  if (!popup) throw new Error('Permite las ventanas emergentes para conectar Meta');
  try {
    const response = await api('/content-studio/social/connect', { method: 'POST', body: '{}' });
    popup.location.href = response.authorization_url;
  } catch (error) {
    popup.close();
    throw error;
  }
}

function LockedSocial({ configured }) {
  return <div className="cs-social-locked"><span><LockKeyhole /></span><div><strong>Publicación directa desde el plan Negocio</strong><p>Con los planes de $39 y $69 podrás crear el copy y publicar en Facebook e Instagram desde Estudios Creativos.</p>{!configured && <small>La integración está preparada y se habilitará cuando Meta termine su configuración.</small>}</div></div>;
}

export function SocialConnectionsSettings({ user }) {
  const { data, error, setError, loading, load } = useSocialData(true);
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try { await openMetaConnection(setError); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function disconnect(connection) {
    setBusy(true); setError('');
    try { await api(`/content-studio/social/connections/${connection.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="cs-social-settings">
    <div className="cs-section-heading"><span className="cs-eyebrow">Redes sociales</span><h1>Facebook e Instagram</h1><p>Conecta las cuentas de tu negocio para publicar tus creaciones sin descargarlas primero.</p></div>
    <div className="cs-social-settings-card cs-card">
      {loading ? <div className="cs-social-loading"><i /><span>Revisando tus conexiones…</span></div> : <>
        {!data?.entitled ? <LockedSocial configured={data?.configured} /> : <>
          <div className="cs-social-settings-top"><div><strong>Cuentas conectadas</strong><p>Meta siempre te mostrará su pantalla oficial antes de autorizar una cuenta.</p></div><button type="button" disabled={busy || !data?.configured} onClick={connect}><Link2 /> {busy ? 'Abriendo…' : 'Conectar Meta'}</button></div>
          {!data?.configured && <div className="cs-social-setup-note"><AlertCircle /><div><strong>Integración lista para configurar</strong><p>Faltan las credenciales de la aplicación de Meta en el servidor.</p>{['admin', 'supreme'].includes(user?.role) && data?.callback_url && <code>{data.callback_url}</code>}</div></div>}
          <div className="cs-social-connections">{(data?.connections || []).map((connection) => <article key={connection.id}><span className="cs-meta-mark">M</span><div><strong>{connection.page_name}</strong><small>Facebook conectado</small>{connection.has_instagram ? <em>@{connection.instagram_username || 'Instagram profesional'}</em> : <em className="missing">Sin Instagram profesional vinculado</em>}</div><button type="button" disabled={busy} onClick={() => disconnect(connection)} title="Desconectar"><Trash2 /></button></article>)}</div>
          {data?.configured && !data?.connections?.length && <div className="cs-social-empty"><Link2 /><div><strong>Aún no conectaste una cuenta</strong><p>Podrás elegir la Página de Facebook y el Instagram profesional que administras.</p></div></div>}
        </>}
      </>}
      {error && <div className="cs-social-error"><AlertCircle /> {error}</div>}
    </div>
  </section>;
}

function PublisherPanel({ generation, onClose }) {
  const { data, error, setError, loading, load } = useSocialData(true);
  const [connectionId, setConnectionId] = useState('');
  const [copy, setCopy] = useState('');
  const [targets, setTargets] = useState(['facebook', 'instagram']);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState([]);
  const selected = useMemo(() => (data?.connections || []).find((item) => String(item.id) === String(connectionId)) || data?.connections?.[0], [data?.connections, connectionId]);
  useEffect(() => { if (!connectionId && data?.connections?.[0]) setConnectionId(String(data.connections[0].id)); }, [data?.connections, connectionId]);
  useEffect(() => { if (selected && !selected.has_instagram) setTargets((items) => items.filter((item) => item !== 'instagram')); }, [selected?.id]);
  function toggleTarget(target) {
    setTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target]);
  }
  async function connect() {
    setBusy('connect');
    try { await openMetaConnection(setError); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function generateCopy() {
    setBusy('copy'); setError(''); setResults([]);
    try {
      const response = await api('/content-studio/social/copy', { method: 'POST', body: JSON.stringify({ generation_id: generation.id }) });
      setCopy(response.copy || '');
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function publish() {
    setBusy('publish'); setError(''); setResults([]);
    try {
      const response = await api('/content-studio/social/publish', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, connection_id: selected?.id, targets, copy }) });
      setResults(response.results || []);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <div className="cs-social-publisher">
    {onClose && <button className="cs-social-close" type="button" onClick={onClose} aria-label="Cerrar"><X /></button>}
    <div className="cs-social-publisher-heading"><span><Send /></span><div><small>PUBLICAR EN REDES</small><h2>Comparte esta creación</h2><p>Crea el texto, revísalo y publícalo directamente.</p></div></div>
    {loading ? <div className="cs-social-loading"><i /><span>Preparando tus redes…</span></div> : !data?.entitled ? <LockedSocial configured={data?.configured} /> : !data?.configured ? <div className="cs-social-setup-note"><AlertCircle /><div><strong>La publicación estará disponible pronto</strong><p>Solo falta terminar la configuración de Meta.</p></div></div> : !data?.connections?.length ? <div className="cs-social-connect-first"><p>Conecta primero la Página de Facebook o Instagram de tu negocio.</p><button type="button" disabled={Boolean(busy)} onClick={connect}><Link2 /> {busy === 'connect' ? 'Abriendo Meta…' : 'Conectar Meta'}</button></div> : <>
      <label className="cs-social-account">Cuenta<select value={selected?.id || ''} onChange={(event) => setConnectionId(event.target.value)}>{data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.page_name}{connection.instagram_username ? ` · @${connection.instagram_username}` : ''}</option>)}</select></label>
      <div className="cs-social-targets"><button type="button" className={targets.includes('facebook') ? 'selected' : ''} onClick={() => toggleTarget('facebook')}><span>f</span><div><strong>Facebook</strong><small>{selected?.page_name}</small></div>{targets.includes('facebook') && <CheckCircle2 />}</button><button type="button" disabled={!selected?.has_instagram} className={targets.includes('instagram') ? 'selected' : ''} onClick={() => selected?.has_instagram && toggleTarget('instagram')}><span>◎</span><div><strong>Instagram</strong><small>{selected?.has_instagram ? `@${selected.instagram_username || 'cuenta profesional'}` : 'No está vinculado'}</small></div>{targets.includes('instagram') && <CheckCircle2 />}</button></div>
      <div className="cs-social-copy"><div><label htmlFor={`copy-${generation.id}`}>Copy de la publicación</label><button type="button" disabled={Boolean(busy)} onClick={generateCopy}><WandSparkles /> {busy === 'copy' ? 'Creando…' : copy ? 'Crear otro copy' : 'Crear copy con IA'}</button></div><textarea id={`copy-${generation.id}`} maxLength="2200" value={copy} onChange={(event) => setCopy(event.target.value)} placeholder="Escribe aquí el texto que acompañará tu imagen…"/><small>{copy.length}/2200 caracteres · Puedes editarlo antes de publicar.</small></div>
      <button className="cs-social-publish" type="button" disabled={Boolean(busy) || !copy.trim() || !targets.length} onClick={publish}><Send /> {busy === 'publish' ? 'Publicando…' : `Publicar en ${targets.length === 2 ? 'Facebook e Instagram' : targets[0] === 'instagram' ? 'Instagram' : 'Facebook'}`}</button>
      {results.length > 0 && <div className="cs-social-results">{results.map((result) => <div key={result.network} className={result.ok ? 'success' : 'failure'}>{result.ok ? <CheckCircle2 /> : <AlertCircle />}<span><strong>{result.network === 'instagram' ? 'Instagram' : 'Facebook'}: {result.ok ? 'publicado correctamente' : 'no se pudo publicar'}</strong>{result.error && <small>{result.error}</small>}</span>{result.permalink && <a href={result.permalink} target="_blank" rel="noreferrer"><ExternalLink /></a>}</div>)}</div>}
    </>}
    {error && <div className="cs-social-error"><AlertCircle /> {error}<button type="button" onClick={() => setError('')}><X /></button></div>}
  </div>;
}

export default function ContentStudioSocialPublisher({ generation, compact = false }) {
  const [open, setOpen] = useState(!compact);
  if (!generation?.id) return null;
  if (compact && !open) return <button className="cs-history-share" type="button" onClick={() => setOpen(true)} title="Publicar en redes"><Send /></button>;
  const panel = <PublisherPanel generation={generation} onClose={compact ? () => setOpen(false) : null} />;
  return compact ? createPortal(<div className="cs-social-modal" role="dialog" aria-modal="true"><div className="cs-social-modal-backdrop" onClick={() => setOpen(false)} />{panel}</div>, document.body) : panel;
}
