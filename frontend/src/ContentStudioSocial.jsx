import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, ExternalLink, Link2, LockKeyhole, Music2, Send, Trash2, WandSparkles, X } from 'lucide-react';
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
      if (event.origin !== window.location.origin || !['estudios-meta-connected', 'estudios-tiktok-connected'].includes(event.data?.type)) return;
      if (event.data.ok) void load(); else setError(event.data.message || 'No se pudo completar la conexión');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [enabled]);
  return { data, error, setError, loading, load };
}

async function openConnection(provider, setError) {
  setError('');
  const label = provider === 'tiktok' ? 'TikTok' : 'Meta';
  const popup = window.open('about:blank', `estudios-${provider}-connect-${Date.now()}`, 'popup,width=620,height=760');
  if (!popup) throw new Error(`Permite las ventanas emergentes para conectar ${label}`);
  try {
    const path = provider === 'tiktok' ? '/content-studio/social/tiktok/connect' : '/content-studio/social/connect';
    const response = await api(path, { method: 'POST', body: '{}' });
    popup.location.href = response.authorization_url;
  } catch (error) { popup.close(); throw error; }
}

function LockedSocial({ configured = true }) {
  return <div className="cs-social-locked"><span><LockKeyhole /></span><div><strong>Publicación directa desde el plan Negocio</strong><p>Con los planes de $39 y $69 podrás crear el copy y publicar en Facebook, Instagram y TikTok desde Estudios Creativos.</p>{!configured && <small>La integración se habilitará al terminar la configuración de la cuenta social.</small>}</div></div>;
}

function ConnectionList({ connections, provider, busy, disconnect }) {
  return <div className="cs-social-connections">{connections.map((connection) => <article key={connection.id}>
    <span className={provider === 'tiktok' ? 'cs-tiktok-mark' : 'cs-meta-mark'}>{provider === 'tiktok' ? '♪' : 'M'}</span>
    <div><strong>{provider === 'tiktok' ? connection.display_name : connection.page_name}</strong><small>{provider === 'tiktok' ? 'TikTok conectado' : 'Facebook conectado'}</small>{provider === 'meta' && (connection.has_instagram ? <em>@{connection.instagram_username || 'Instagram profesional'}</em> : <em className="missing">Sin Instagram profesional vinculado</em>)}</div>
    <button type="button" disabled={busy} onClick={() => disconnect(connection)} title="Desconectar"><Trash2 /></button>
  </article>)}</div>;
}

export function SocialConnectionsSettings({ user }) {
  const { data, error, setError, loading, load } = useSocialData(true);
  const [busy, setBusy] = useState('');
  async function connect(provider) {
    setBusy(`connect-${provider}`);
    try { await openConnection(provider, setError); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  async function disconnect(connection) {
    setBusy('disconnect'); setError('');
    try { await api(`/content-studio/social/connections/${connection.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const admin = ['admin', 'supreme'].includes(user?.role);
  return <section className="cs-social-settings">
    <div className="cs-section-heading"><span className="cs-eyebrow">Redes sociales</span><h1>Publica desde tu estudio</h1><p>Conecta las cuentas de tu negocio para publicar tus creaciones y su copy sin descargarlas primero.</p></div>
    <div className="cs-social-settings-card cs-card">
      {loading ? <div className="cs-social-loading"><i /><span>Revisando tus conexiones…</span></div> : !data?.entitled ? <LockedSocial configured={data?.configured || data?.tiktok_configured} /> : <>
        <div className="cs-social-settings-top"><div><strong>Facebook e Instagram</strong><p>Meta siempre mostrará su pantalla oficial antes de autorizar una cuenta.</p></div><button type="button" disabled={Boolean(busy) || !data?.configured} onClick={() => connect('meta')}><Link2 /> {busy === 'connect-meta' ? 'Abriendo…' : 'Conectar Meta'}</button></div>
        {!data?.configured && <div className="cs-social-setup-note"><AlertCircle /><div><strong>Meta pendiente de configuración</strong><p>Faltan las credenciales de la aplicación de Meta en el servidor.</p>{admin && data?.callback_url && <code>{data.callback_url}</code>}</div></div>}
        <ConnectionList connections={data?.connections || []} provider="meta" busy={Boolean(busy)} disconnect={disconnect}/>
        {data?.configured && !data?.connections?.length && <div className="cs-social-empty"><Link2 /><div><strong>Aún no conectaste una cuenta Meta</strong><p>Podrás elegir la Página de Facebook y el Instagram profesional que administras.</p></div></div>}
        <div className="cs-social-provider-divider"/>
        <div className="cs-social-settings-top cs-tiktok-settings-top"><div><strong><span className="cs-tiktok-inline">♪</span> TikTok</strong><p>Publica la foto con copy; TikTok elegirá música sugerida automáticamente.</p></div><button type="button" className="cs-tiktok-connect" disabled={Boolean(busy) || !data?.tiktok_configured} onClick={() => connect('tiktok')}><Music2 /> {busy === 'connect-tiktok' ? 'Abriendo…' : 'Conectar TikTok'}</button></div>
        {!data?.tiktok_configured && <div className="cs-social-setup-note"><AlertCircle /><div><strong>TikTok pendiente de configuración</strong><p>Faltan las credenciales de TikTok Content Posting API en el servidor.</p>{admin && data?.tiktok_callback_url && <code>{data.tiktok_callback_url}</code>}</div></div>}
        <ConnectionList connections={data?.tiktok_connections || []} provider="tiktok" busy={Boolean(busy)} disconnect={disconnect}/>
        {data?.tiktok_configured && !data?.tiktok_connections?.length && <div className="cs-social-empty"><Music2 /><div><strong>Aún no conectaste TikTok</strong><p>La autorización te pedirá permiso solo para publicar cuando tú lo indiques.</p></div></div>}
      </>}
      {error && <div className="cs-social-error"><AlertCircle /> {error}</div>}
    </div>
  </section>;
}

function MetaPublisher({ generation, data, setError }) {
  const [connectionId, setConnectionId] = useState('');
  const [copy, setCopy] = useState(generation?.social_copy || '');
  const [targets, setTargets] = useState(['facebook', 'instagram']);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState([]);
  const selected = useMemo(() => (data?.connections || []).find((item) => String(item.id) === String(connectionId)) || data?.connections?.[0], [data?.connections, connectionId]);
  useEffect(() => { if (!connectionId && data?.connections?.[0]) setConnectionId(String(data.connections[0].id)); }, [data?.connections, connectionId]);
  useEffect(() => { if (selected && !selected.has_instagram) setTargets((items) => items.filter((item) => item !== 'instagram')); }, [selected?.id]);
  const toggleTarget = (target) => setTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target]);
  async function generateCopy() { setBusy('copy'); setError(''); try { const response = await api('/content-studio/social/copy', { method: 'POST', body: JSON.stringify({ generation_id: generation.id }) }); setCopy(response.copy || ''); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  async function publish() { setBusy('publish'); setError(''); setResults([]); try { const response = await api('/content-studio/social/publish', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, connection_id: selected?.id, targets, copy }) }); setResults(response.results || []); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  if (!data?.configured) return null;
  return <section className="cs-social-network-panel"><div className="cs-social-network-title"><span className="cs-meta-mark">M</span><div><strong>Facebook e Instagram</strong><small>Comparte la foto en tus cuentas Meta.</small></div></div>{!data?.connections?.length ? <div className="cs-social-empty"><Link2 /><div><strong>Conecta Meta desde Configuración</strong><p>Después podrás seleccionar dónde publicar.</p></div></div> : <>
    <label className="cs-social-account">Cuenta<select value={selected?.id || ''} onChange={(event) => setConnectionId(event.target.value)}>{data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.page_name}{connection.instagram_username ? ` · @${connection.instagram_username}` : ''}</option>)}</select></label>
    <div className="cs-social-targets"><button type="button" className={targets.includes('facebook') ? 'selected' : ''} onClick={() => toggleTarget('facebook')}><span>f</span><div><strong>Facebook</strong><small>{selected?.page_name}</small></div>{targets.includes('facebook') && <CheckCircle2 />}</button><button type="button" disabled={!selected?.has_instagram} className={targets.includes('instagram') ? 'selected' : ''} onClick={() => selected?.has_instagram && toggleTarget('instagram')}><span>◎</span><div><strong>Instagram</strong><small>{selected?.has_instagram ? `@${selected.instagram_username || 'cuenta profesional'}` : 'No está vinculado'}</small></div>{targets.includes('instagram') && <CheckCircle2 />}</button></div>
    <CopyEditor generation={generation} copy={copy} setCopy={setCopy} busy={busy} generateCopy={generateCopy}/><button className="cs-social-publish" type="button" disabled={Boolean(busy) || !copy.trim() || !targets.length} onClick={publish}><Send /> {busy === 'publish' ? 'Publicando…' : `Publicar en ${targets.length === 2 ? 'Facebook e Instagram' : targets[0] === 'instagram' ? 'Instagram' : 'Facebook'}`}</button>
    <Results results={results}/></>}</section>;
}

function CopyEditor({ generation, copy, setCopy, busy, generateCopy, suffix = '' }) { return <div className="cs-social-copy"><div><label htmlFor={`copy-${generation.id}${suffix}`}>Copy de la publicación</label><button type="button" disabled={Boolean(busy)} onClick={generateCopy}><WandSparkles /> {busy === 'copy' ? 'Creando…' : copy ? 'Crear otro copy' : 'Crear copy con IA'}</button></div><textarea id={`copy-${generation.id}${suffix}`} maxLength="2200" value={copy} onChange={(event) => setCopy(event.target.value)} placeholder="Escribe aquí el texto que acompañará tu imagen…"/><small>{copy.length}/2200 caracteres · Puedes editarlo antes de publicar.</small></div>; }
function Results({ results }) { return results.length > 0 && <div className="cs-social-results">{results.map((result) => <div key={result.network} className={result.ok ? 'success' : 'failure'}>{result.ok ? <CheckCircle2 /> : <AlertCircle />}<span><strong>{result.network === 'instagram' ? 'Instagram' : result.network === 'tiktok' ? 'TikTok' : 'Facebook'}: {result.ok ? (result.status || 'publicado correctamente') : 'no se pudo publicar'}</strong>{result.error && <small>{result.error}</small>}</span>{result.permalink && <a href={result.permalink} target="_blank" rel="noreferrer"><ExternalLink /></a>}</div>)}</div>; }

function TikTokPublisher({ generation, data, setError }) {
  const [connectionId, setConnectionId] = useState(''); const [copy, setCopy] = useState(generation?.social_copy || ''); const [creator, setCreator] = useState(null); const [privacy, setPrivacy] = useState(''); const [commentsOff, setCommentsOff] = useState(false); const [music, setMusic] = useState(true); const [busy, setBusy] = useState(''); const [results, setResults] = useState([]);
  const selected = useMemo(() => (data?.tiktok_connections || []).find((item) => String(item.id) === String(connectionId)) || data?.tiktok_connections?.[0], [data?.tiktok_connections, connectionId]);
  useEffect(() => { if (!connectionId && data?.tiktok_connections?.[0]) setConnectionId(String(data.tiktok_connections[0].id)); }, [data?.tiktok_connections, connectionId]);
  useEffect(() => { if (!selected?.id) return; let active = true; setCreator(null); setPrivacy(''); api(`/content-studio/social/tiktok/creator-info/${selected.id}`).then((info) => { if (!active) return; setCreator(info); setPrivacy(info.privacy_level_options?.[0] || ''); setCommentsOff(Boolean(info.comment_disabled)); }).catch((err) => active && setError(err.message)); return () => { active = false; }; }, [selected?.id]);
  async function generateCopy() { setBusy('copy'); setError(''); try { const response = await api('/content-studio/social/copy', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, network: 'tiktok' }) }); setCopy(response.copy || ''); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  async function publish() { setBusy('publish'); setError(''); setResults([]); try { const response = await api('/content-studio/social/tiktok/publish', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, connection_id: selected?.id, copy, privacy_level: privacy, disable_comment: commentsOff, auto_add_music: music }) }); setResults([response.result]); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  if (!data?.tiktok_configured) return null;
  return <section className="cs-social-network-panel cs-tiktok-publisher"><div className="cs-social-network-title"><span className="cs-tiktok-mark">♪</span><div><strong>TikTok</strong><small>Foto con copy y música sugerida por TikTok.</small></div></div>{!data?.tiktok_connections?.length ? <div className="cs-social-empty"><Music2 /><div><strong>Conecta TikTok desde Configuración</strong><p>Después podrás publicar directamente desde tu creación.</p></div></div> : <>
    <label className="cs-social-account">Cuenta TikTok<select value={selected?.id || ''} onChange={(event) => setConnectionId(event.target.value)}>{data.tiktok_connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}</select></label>
    <CopyEditor generation={generation} suffix="-tiktok" copy={copy} setCopy={setCopy} busy={busy} generateCopy={generateCopy}/>
    <div className="cs-tiktok-options"><label>Privacidad<select value={privacy} onChange={(event) => setPrivacy(event.target.value)} disabled={!creator}>{creator?.privacy_level_options?.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label className="cs-tiktok-toggle"><input type="checkbox" checked={music} onChange={(event) => setMusic(event.target.checked)}/><span><Music2 /> TikTok elegirá la música</span><small>La podrá cambiar antes de publicar.</small></label><label className="cs-tiktok-toggle"><input type="checkbox" checked={commentsOff} onChange={(event) => setCommentsOff(event.target.checked)}/><span>Desactivar comentarios</span></label></div>
    <p className="cs-tiktok-note">La imagen se publicará como contenido generado con IA. TikTok puede requerir revisión y, mientras la app esté sin auditoría, limitar el público disponible.</p><button className="cs-social-publish cs-tiktok-publish" type="button" disabled={Boolean(busy) || !copy.trim() || !privacy} onClick={publish}><Music2 /> {busy === 'publish' ? 'Enviando a TikTok…' : 'Publicar en TikTok'}</button><Results results={results}/></>}</section>;
}

function PublisherPanel({ generation, onClose }) {
  const { data, error, setError, loading } = useSocialData(true);
  return <div className="cs-social-publisher">{onClose && <button className="cs-social-close" type="button" onClick={onClose} aria-label="Cerrar"><X /></button>}<div className="cs-social-publisher-heading"><span><Send /></span><div><small>PUBLICAR EN REDES</small><h2>Comparte esta creación</h2><p>Crea el texto, revísalo y publícalo directamente.</p></div></div>{loading ? <div className="cs-social-loading"><i /><span>Preparando tus redes…</span></div> : !data?.entitled ? <LockedSocial configured={data?.configured || data?.tiktok_configured} /> : <><MetaPublisher generation={generation} data={data} setError={setError}/><TikTokPublisher generation={generation} data={data} setError={setError}/>{!data?.configured && !data?.tiktok_configured && <div className="cs-social-setup-note"><AlertCircle /><div><strong>La publicación estará disponible pronto</strong><p>Solo falta terminar la configuración de las redes sociales.</p></div></div>}</>}{error && <div className="cs-social-error"><AlertCircle /> {error}<button type="button" onClick={() => setError('')}><X /></button></div>}</div>;
}

export default function ContentStudioSocialPublisher({ generation, compact = false }) { const [open, setOpen] = useState(!compact); if (!generation?.id) return null; if (compact && !open) return <button className="cs-history-share" type="button" onClick={() => setOpen(true)} title="Publicar en redes"><Send /></button>; const panel = <PublisherPanel generation={generation} onClose={compact ? () => setOpen(false) : null} />; return compact ? createPortal(<div className="cs-social-modal" role="dialog" aria-modal="true"><div className="cs-social-modal-backdrop" onClick={() => setOpen(false)} />{panel}</div>, document.body) : panel; }
