import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudOff, Eye, EyeOff, KeyRound, QrCode, ShieldCheck } from 'lucide-react';
import OfflineTicketScanner from './OfflineTicketScanner.jsx';
import { api, clearToken, getToken, getUser, setToken, setUser } from './api.js';

function allowed(user) {
  return user?.role === 'ticket_validator' || user?.role === 'supreme' ||
    (user?.role === 'admin' && (user?.establishment_module_type === 'ticketing' || String(user?.establishment_name || '').toUpperCase() === 'PROTICKETS'));
}

function ScannerLogin({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!navigator.onLine) throw new Error('Conéctate a internet para iniciar sesión por primera vez.');
      let payload = null; let lastError = null;
      for (const path of ['/auth/login', '/ticketing/validator/login']) {
        try {
          payload = await api(path, { method: 'POST', body: JSON.stringify(form) });
          break;
        } catch (requestError) { lastError = requestError; }
      }
      if (!payload) throw lastError || new Error('No se pudo iniciar sesión');
      if (!allowed(payload.user)) throw new Error('Esta cuenta no tiene permiso para validar boletos.');
      setToken(payload.token); setUser(payload.user); onLogin(payload.user);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  return <main className="pts-login">
    <section>
      <div className="pts-login-icon"><QrCode /></div>
      <small>PROTICKETS</small>
      <h1>Scanner offline</h1>
      <p>Inicia sesión con el usuario de validación. Después de descargar el evento podrás trabajar aunque no haya señal.</p>
      <div className="pts-login-promise"><ShieldCheck /><span><strong>Preparado para conciertos</strong><small>Boletos guardados, lecturas offline y sincronización automática.</small></span></div>
      <form onSubmit={submit}>
        <label>Usuario<input required autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label>Contraseña<span><input required autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></span></label>
        {!navigator.onLine && <div className="pts-login-offline"><CloudOff />Necesitas internet para el primer ingreso.</div>}
        {error && <div className="pts-login-error">{error}</div>}
        <button className="pts-login-submit" disabled={busy}><KeyRound />{busy ? 'Ingresando…' : 'Ingresar al scanner'}</button>
      </form>
    </section>
  </main>;
}

function ScannerRoot() {
  const [user, saveUser] = useState(() => getToken() ? getUser() : null);
  if (!user || !getToken() || !allowed(user)) {
    return <ScannerLogin onLogin={saveUser} />;
  }
  return <OfflineTicketScanner user={user} onLogout={() => { clearToken(); saveUser(null); }} />;
}

createRoot(document.getElementById('root')).render(<ScannerRoot />);
