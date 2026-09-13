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

const tiktokPrivacyLabel = (value) => ({
  PUBLIC_TO_EVERYONE: 'Público',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos que se siguen',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Solo yo'
}[value] || value.replaceAll('_', ' '));

function TikTokPublisher({ generation, data, setError }) {
  const [connectionId, setConnectionId] = useState('');
  const [title, setTitle] = useState(generation?.product_name || generation?.brand_name || 'Nueva creación');
  const [copy, setCopy] = useState(generation?.social_copy || '');
  const [creator, setCreator] = useState(null);
  const [privacy, setPrivacy] = useState('');
  const [allowComment, setAllowComment] = useState(false);
  const [music, setMusic] = useState(true);
  const [commercial, setCommercial] = useState(false);
  const [ownBrand, setOwnBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);
  const [musicConsent, setMusicConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState([]);
  const selected = useMemo(() => (data?.tiktok_connections || []).find((item) => String(item.id) === String(connectionId)) || data?.tiktok_connections?.[0], [data?.tiktok_connections, connectionId]);
  useEffect(() => { if (!connectionId && data?.tiktok_connections?.[0]) setConnectionId(String(data.tiktok_connections[0].id)); }, [data?.tiktok_connections, connectionId]);
  useEffect(() => { if (!selected?.id) return; let active = true; setCreator(null); setPrivacy(''); setAllowComment(false); api(`/content-studio/social/tiktok/creator-info/${selected.id}`).then((info) => { if (!active) return; setCreator(info); }).catch((err) => active && setError(err.message)); return () => { active = false; }; }, [selected?.id]);
  useEffect(() => { if (privacy === 'SELF_ONLY' && brandedContent) setBrandedContent(false); }, [privacy, brandedContent]);
  async function generateCopy() { setBusy('copy'); setError(''); try { const response = await api('/content-studio/social/copy', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, network: 'tiktok' }) }); setCopy(response.copy || ''); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  async function pollStatus(publishId) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      const response = await api('/content-studio/social/tiktok/status', { method: 'POST', body: JSON.stringify({ connection_id: selected?.id, publish_id: publishId }) });
      setResults([response.result]);
      if (!response.result?.processing) return;
    }
  }
  async function publish() {
    setBusy('publish'); setError(''); setResults([]);
    try {
      const response = await api('/content-studio/social/tiktok/publish', { method: 'POST', body: JSON.stringify({ generation_id: generation.id, connection_id: selected?.id, title, copy, privacy_level: privacy, allow_comment: allowComment, auto_add_music: music, commercial_content: commercial, brand_organic: commercial && ownBrand, brand_content: commercial && brandedContent, music_consent: musicConsent }) });
      setResults([response.result]);
      if (response.result?.id) await pollStatus(response.result.id);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  const commercialIncomplete = commercial && !ownBrand && !brandedContent;
  const brandedPrivate = brandedContent && privacy === 'SELF_ONLY';
  const disabled = Boolean(busy) || !title.trim() || !copy.trim() || !privacy || !musicConsent || commercialIncomplete || brandedPrivate;
  if (!data?.tiktok_configured) return null;
  return <section className="cs-social-network-panel cs-tiktok-publisher"><div className="cs-social-network-title"><span className="cs-tiktok-mark">♪</span><div><strong>TikTok</strong><small>Foto con copy y música sugerida por TikTok.</small></div></div>{!data?.tiktok_connections?.length ? <div className="cs-social-empty"><Music2 /><div><strong>Conecta TikTok desde Configuración</strong><p>Después podrás publicar directamente desde tu creación.</p></div></div> : <>
    <div className="cs-tiktok-preview"><img src={generation.output_image_data} alt="Vista previa de la imagen que se publicará en TikTok"/><div><small>VISTA PREVIA</small><strong>{creator?.creator_nickname || selected?.display_name}</strong><span>{creator?.creator_username ? `@${creator.creator_username}` : 'Cuenta seleccionada'}</span></div></div>
    <label className="cs-social-account">Cuenta TikTok<select value={selected?.id || ''} onChange={(event) => setConnectionId(event.target.value)}>{data.tiktok_connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}</select></label>
    <label className="cs-tiktok-title">Título de la publicación<input maxLength="90" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Nueva colección"/><small>{title.length}/90 caracteres · Puedes editarlo antes de publicar.</small></label>
    <CopyEditor generation={generation} suffix="-tiktok" copy={copy} setCopy={setCopy} busy={busy} generateCopy={generateCopy}/>
    <div className="cs-tiktok-options"><label>Privacidad<select value={privacy} onChange={(event) => setPrivacy(event.target.value)} disabled={!creator}><option value="">Selecciona la privacidad</option>{creator?.privacy_level_options?.map((item) => <option key={item} value={item}>{tiktokPrivacyLabel(item)}</option>)}</select></label><label className="cs-tiktok-toggle"><input type="checkbox" checked={music} onChange={(event) => setMusic(event.target.checked)}/><span><Music2 /> TikTok elegirá la música</span><small>Podrás cambiarla luego desde TikTok.</small></label><label className="cs-tiktok-toggle"><input type="checkbox" checked={allowComment} onChange={(event) => setAllowComment(event.target.checked)} disabled={Boolean(creator?.comment_disabled)}/><span>Permitir comentarios</span><small>{creator?.comment_disabled ? 'Tu cuenta no permite comentarios.' : 'Actívalo si quieres recibir comentarios.'}</small></label></div>
    <div className="cs-tiktok-disclosure"><label className="cs-tiktok-toggle"><input type="checkbox" checked={commercial} onChange={(event) => { setCommercial(event.target.checked); if (!event.target.checked) { setOwnBrand(false); setBrandedContent(false); } }}/><span>Contenido comercial</span><small>Actívalo si promocionas una marca, producto o servicio.</small></label>{commercial && <div className="cs-tiktok-commercial-options"><label className="cs-tiktok-toggle"><input type="checkbox" checked={ownBrand} onChange={(event) => setOwnBrand(event.target.checked)}/><span>Mi negocio o mi marca</span><small>Se etiquetará como “Contenido promocional”.</small></label><label className="cs-tiktok-toggle"><input type="checkbox" checked={brandedContent} onChange={(event) => setBrandedContent(event.target.checked)} disabled={privacy === 'SELF_ONLY'}/><span>Otra marca o colaboración pagada</span><small>{privacy === 'SELF_ONLY' ? 'No está disponible con privacidad “Solo yo”.' : 'Se etiquetará como “Colaboración pagada”.'}</small></label>{commercialIncomplete && <p>Elige al menos una opción de contenido comercial.</p>}</div>}</div>
    <p className="cs-tiktok-note">{creator?.sandboxed ? 'Prueba de TikTok: selecciona “Solo yo”. La cuenta debe estar configurada como privada mientras la aplicación aún no está auditada.' : 'La imagen se identificará como contenido generado con IA. El procesamiento puede tardar unos minutos antes de aparecer en tu perfil.'}</p>
    <label className="cs-tiktok-consent"><input type="checkbox" checked={musicConsent} onChange={(event) => setMusicConsent(event.target.checked)}/><span>Al publicar, acepto la <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Confirmación de uso de música de TikTok</a>{brandedContent ? <> y la <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Política de contenido de marca</a></> : null}.</span></label>
    <button className="cs-social-publish cs-tiktok-publish" type="button" disabled={disabled} onClick={publish}><Music2 /> {busy === 'publish' ? 'TikTok está procesando…' : 'Publicar en TikTok'}</button><Results results={results}/></>}</section>;
}

function PublisherPanel({ generation, onClose }) {
  const { data, error, setError, loading } = useSocialData(true);
  return <div className="cs-social-publisher">{onClose && <button className="cs-social-close" type="button" onClick={onClose} aria-label="Cerrar"><X /></button>}<div className="cs-social-publisher-heading"><span><Send /></span><div><small>PUBLICAR EN REDES</small><h2>Comparte esta creación</h2><p>Crea el texto, revísalo y publícalo directamente.</p></div></div>{loading ? <div className="cs-social-loading"><i /><span>Preparando tus redes…</span></div> : !data?.entitled ? <LockedSocial configured={data?.configured || data?.tiktok_configured} /> : <><MetaPublisher generation={generation} data={data} setError={setError}/><TikTokPublisher generation={generation} data={data} setError={setError}/>{!data?.configured && !data?.tiktok_configured && <div className="cs-social-setup-note"><AlertCircle /><div><strong>La publicación estará disponible pronto</strong><p>Solo falta terminar la configuración de las redes sociales.</p></div></div>}</>}{error && <div className="cs-social-error"><AlertCircle /> {error}<button type="button" onClick={() => setError('')}><X /></button></div>}</div>;
}

export default function ContentStudioSocialPublisher({ generation, compact = false }) { const [open, setOpen] = useState(!compact); if (!generation?.id) return null; if (compact && !open) return <button className="cs-history-share" type="button" onClick={() => setOpen(true)} title="Publicar en redes"><Send /></button>; const panel = <PublisherPanel generation={generation} onClose={compact ? () => setOpen(false) : null} />; return compact ? createPortal(<div className="cs-social-modal" role="dialog" aria-modal="true"><div className="cs-social-modal-backdrop" onClick={() => setOpen(false)} />{panel}</div>, document.body) : panel; }
