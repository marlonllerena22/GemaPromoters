import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Mail, Sparkles, X } from 'lucide-react';
import { api, setToken, setUser } from './api.js';
import './content-studio-access.css';

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

export default function ContentStudioAccess({ mode = 'page', onClose, onAuthenticated, initialEmailOpen = false }) {
  const [config, setConfig] = useState(null);
  const [emailOpen, setEmailOpen] = useState(initialEmailOpen);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [legacy, setLegacy] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(new URLSearchParams(window.location.search).get('magic')));
  const [error, setError] = useState('');
  const googleButtonRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Entrar · Estudios Creativos';
    return () => { document.title = previousTitle; };
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
    const magic = new URLSearchParams(window.location.search).get('magic');
    if (!magic) return;
    let active = true;
    setVerifying(true);
    api('/content-studio/auth/magic-link/verify', { method: 'POST', body: JSON.stringify({ token: magic }) })
      .then((data) => {
        if (!active) return;
        window.history.replaceState({}, '', window.location.pathname);
        complete(data);
      })
      .catch((err) => { if (active) { setError(err.message); setVerifying(false); setEmailOpen(true); } });
    return () => { active = false; };
  }, []);

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
      complete(data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const content = <section className="csa-card" aria-busy={busy || verifying}>
    {mode === 'modal' && <button className="csa-close" type="button" onClick={onClose} aria-label="Cerrar"><X /></button>}
    <a className="csa-brand" href="/"><span><Sparkles /></span><strong>Estudios Creativos</strong></a>
    {verifying ? <div className="csa-verifying"><i /><h1>Abriendo tu estudio</h1><p>Estamos validando tu enlace seguro.</p></div> : <>
      <div className="csa-heading"><span>BIENVENIDO</span><h1>Crea sin complicaciones.</h1><p>Entra o crea tu cuenta en pocos segundos.</p></div>
      {!sent ? <div className="csa-methods">
        <div className={`csa-google ${!config?.google_client_id ? 'disabled' : ''}`} ref={googleButtonRef}>{config && !config.google_client_id && <span>Google estará disponible cuando se configure el dominio</span>}</div>
        <div className="csa-divider"><span>o</span></div>
        {!emailOpen ? <button className="csa-email-button" type="button" onClick={() => setEmailOpen(true)}><Mail /> Continuar con correo</button> : <form className="csa-email-form" onSubmit={sendMagicLink}>
          <button className="csa-back" type="button" onClick={() => setEmailOpen(false)}><ArrowLeft /> Volver</button>
          <label>Tu correo<input autoFocus type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" /></label>
          <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviarme el enlace para entrar'}</button>
          <small>El enlace vence en 20 minutos y puede usarse una sola vez.</small>
        </form>}
        <button className="csa-legacy-toggle" type="button" onClick={() => setLegacyOpen((open) => !open)}><KeyRound /> ¿Tienes un acceso anterior?</button>
        {legacyOpen && <form className="csa-legacy-form" onSubmit={legacyLogin}><input required autoComplete="username" value={legacy.username} onChange={(event) => setLegacy({ ...legacy, username: event.target.value })} placeholder="Usuario" /><input required type="password" autoComplete="current-password" value={legacy.password} onChange={(event) => setLegacy({ ...legacy, password: event.target.value })} placeholder="Contraseña" /><button disabled={busy}>Entrar</button></form>}
      </div> : <div className="csa-sent"><span><CheckCircle2 /></span><h2>Revisa tu correo</h2><p>Enviamos un botón para entrar a <strong>{email}</strong>.</p><button type="button" onClick={() => { setSent(false); setEmailOpen(true); }}>Usar otro correo</button></div>}
      {error && <div className="csa-error" role="alert">{error}</div>}
      <p className="csa-terms">Al continuar aceptas el uso necesario de tus datos para mantener tu cuenta y tus creaciones.</p>
    </>}
  </section>;

  return mode === 'modal'
    ? <div className="csa-overlay" role="dialog" aria-modal="true" aria-label="Entrar a Estudios Creativos" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>{content}</div>
    : <main className="csa-page">{content}</main>;
}
