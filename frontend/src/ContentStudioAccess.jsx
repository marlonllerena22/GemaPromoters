import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, X } from 'lucide-react';
import { api, setToken, setUser } from './api.js';
import { applyContentStudioTheme, getContentStudioTheme } from './content-studio-theme.js';
import './content-studio-access.css';
import './content-studio-brand-assets.css';

let googleScriptPromise;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-estudios-google]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.google), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client?hl=es';
      script.async = true;
      script.defer = true;
      script.dataset.estudiosGoogle = 'true';
      script.onload = () => resolve(window.google);
      script.onerror = () => reject(new Error('No se pudo cargar el acceso con Google'));
      document.head.appendChild(script);
    });
  }
  return googleScriptPromise;
}

export default function ContentStudioAccess({ mode = 'page', onClose, onAuthenticated, initialEmailOpen = false, adminOnly = false, sellerOnly = false }) {
  const [config, setConfig] = useState(null);
  const [emailOpen, setEmailOpen] = useState(initialEmailOpen);
  const legacyOnly = adminOnly || sellerOnly;
  const [legacyOpen, setLegacyOpen] = useState(legacyOnly);
  const [email, setEmail] = useState('');
  const [legacy, setLegacy] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('magic') || params.get('handoff'));
  });
  const [error, setError] = useState('');
  const googleButtonRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Entrar · Estudios Creativos';
    const stopWatchingTheme = applyContentStudioTheme(getContentStudioTheme());
    return () => { document.title = previousTitle; stopWatchingTheme(); };
  }, []);

  function complete(data) {
    setToken(data.token);
    setUser(data.user);
    try { sessionStorage.setItem('estudios-intro-after-login', 'pending'); } catch { /* optional */ }
    onAuthenticated?.(data.token, data.user);
  }

  useEffect(() => {
    let active = true;
    api('/content-studio/auth/config').then((response) => active && setConfig(response)).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magic = params.get('magic');
    const handoff = params.get('handoff');
    if (!magic && !handoff) return;
    let active = true;
    setVerifying(true);
    const endpoint = handoff ? '/content-studio/auth/handoff/verify' : '/content-studio/auth/magic-link/verify';
    const body = handoff ? { code: handoff } : { token: magic };
    api(endpoint, { method: 'POST', body: JSON.stringify(body) })
      .then((data) => {
        if (!active) return;
        window.history.replaceState({}, '', window.location.pathname);
        complete(data);
      })
      .catch((err) => { if (active) { setError(err.message); setVerifying(false); setEmailOpen(!legacyOnly); } });
    return () => { active = false; };
  }, [legacyOnly]);

  useEffect(() => {
    if (!config?.google_client_id || !googleButtonRef.current || verifying) return undefined;
    let active = true;
    loadGoogleIdentity().then(() => {
      if (!active || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: config.google_client_id,
        callback: async ({ credential }) => {
          setBusy(true); setError('');
          try { complete(await api('/content-studio/auth/google', { method: 'POST', body: JSON.stringify({ credential }) })); }
          catch (err) { setError(err.message); }
          finally { setBusy(false); }
        },
        auto_select: true,
        cancel_on_tap_outside: false,
        context: 'signin',
        itp_support: true,
        use_fedcm_for_prompt: true
      });
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
        shape: 'rectangular', logo_alignment: 'left', width: Math.min(390, Math.max(260, googleButtonRef.current.clientWidth))
      });
      window.google.accounts.id.prompt();
    }).catch((err) => active && setError(err.message));
    return () => { active = false; window.google?.accounts?.id?.cancel?.(); };
  }, [config?.google_client_id, verifying]);

  useEffect(() => {
    if (mode !== 'modal') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event) => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', close); };
  }, [mode, onClose]);

  async function sendMagicLink(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/content-studio/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) });
      setSent(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function legacyLogin(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(legacy) });
      if (data.user?.establishment_module_type !== 'content_studio') throw new Error('Este acceso no pertenece a Estudios Creativos');
      if (adminOnly && !['admin', 'supreme'].includes(data.user?.role)) throw new Error('Este acceso es solo para la administración del estudio');
      if (sellerOnly && data.user?.role !== 'content_studio_seller') throw new Error('Este acceso es solo para vendedores de Estudios Creativos');
      complete(data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const content = <section className="csa-card" aria-busy={busy || verifying}>
    {mode === 'modal' && <button className="csa-close" type="button" onClick={onClose} aria-label="Cerrar"><X /></button>}
    <a className="csa-brand" href="/"><span className="csa-brand-mascot"><img src="/content-studio/brand/mascota-toque.webp" alt="" /></span><img className="csa-brand-wordmark" src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="Estudios Creativos" /></a>
    {verifying ? <div className="csa-verifying"><i /><h1>Abriendo tu estudio</h1><p>Estamos validando tu enlace seguro.</p></div> : <>
      <div className="csa-heading"><span>{adminOnly ? 'ADMINISTRACIÓN' : sellerOnly ? 'EQUIPO COMERCIAL' : 'BIENVENIDO'}</span><h1>{adminOnly ? 'Gestiona tu estudio.' : sellerOnly ? 'Impulsa tu quincena.' : 'Crea sin complicaciones.'}</h1><p>{adminOnly ? 'Acceso exclusivo para administrar usuarios, planes y solicitudes.' : sellerOnly ? 'Registra visitas, pruebas, seguimientos y ventas de Estudios Creativos.' : 'Entra o crea tu cuenta en pocos segundos.'}</p></div>
      {!sent ? <div className="csa-methods">
        {!legacyOnly && <><div className={`csa-google ${!config?.google_client_id ? 'disabled' : ''}`} ref={googleButtonRef}>{config && !config.google_client_id && <span>Google estará disponible cuando se configure el dominio</span>}</div>
        <div className="csa-divider"><span>o</span></div>
        {!emailOpen ? <button className="csa-email-button" type="button" onClick={() => setEmailOpen(true)}><Mail /> Continuar con correo</button> : <form className="csa-email-form" onSubmit={sendMagicLink}>
          <button className="csa-back" type="button" onClick={() => setEmailOpen(false)}><ArrowLeft /> Volver</button>
          <label>Tu correo<input autoFocus type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" /></label>
          <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviarme el enlace para entrar'}</button>
          <small>El enlace vence en 20 minutos y puede usarse una sola vez.</small>
        </form>}
        <button className="csa-legacy-toggle" type="button" onClick={() => setLegacyOpen((open) => !open)}><KeyRound /> ¿Tienes un acceso anterior?</button></>}
        {legacyOpen && <form className="csa-legacy-form" onSubmit={legacyLogin}><input required autoFocus={legacyOnly} autoComplete="username" value={legacy.username} onChange={(event) => setLegacy({ ...legacy, username: event.target.value })} placeholder="Usuario" /><label className="csa-password-field"><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={legacy.password} onChange={(event) => setLegacy({ ...legacy, password: event.target.value })} placeholder="Contraseña" /><button type="button" className="csa-password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword}>{showPassword ? <EyeOff /> : <Eye />}</button></label><button disabled={busy}>{adminOnly ? 'Entrar a la administración' : sellerOnly ? 'Entrar al portal de ventas' : 'Entrar'}</button></form>}
      </div> : <div className="csa-sent"><span><CheckCircle2 /></span><h2>Revisa tu correo</h2><p>Enviamos un botón para entrar a <strong>{email}</strong>.</p><button type="button" onClick={() => { setSent(false); setEmailOpen(true); }}>Usar otro correo</button></div>}
      {error && <div className="csa-error" role="alert">{error}</div>}
      <p className="csa-terms">Al continuar aceptas el uso necesario de tus datos para mantener tu cuenta y tus creaciones.</p>
    </>}
  </section>;

  return mode === 'modal'
    ? <div className="csa-overlay" role="dialog" aria-modal="true" aria-label="Entrar a Estudios Creativos" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>{content}</div>
    : <main className="csa-page">{content}</main>;
}
