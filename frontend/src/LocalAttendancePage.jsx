import React, { useState } from 'react';
import { CheckCircle2, Clock, LogIn, LogOut, MapPin, MessageCircle } from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

async function attendanceApi(path, options = {}, token = '') {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'No se pudo completar la accion');
  return data;
}

export default function LocalAttendancePage() {
  const [token, setToken] = useState(() => localStorage.getItem('producalza_attendance_token') || '');
  const [staff, setStaff] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('producalza_attendance_staff') || 'null');
    } catch {
      return null;
    }
  });
  const [form, setForm] = useState({ username: '', password: '' });
  const [location, setLocation] = useState(staff?.default_location || staff?.locations?.[0] || '');
  const [lastMessage, setLastMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await attendanceApi('/producalza/local-attendance/login', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setToken(response.token);
      setStaff(response.staff);
      setLocation(response.staff.default_location || response.staff.locations?.[0] || '');
      localStorage.setItem('producalza_attendance_token', response.token);
      localStorage.setItem('producalza_attendance_staff', JSON.stringify(response.staff));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function mark(action) {
    setError('');
    setLoading(true);
    try {
      const response = await attendanceApi('/producalza/local-attendance/mark', {
        method: 'POST',
        body: JSON.stringify({ action, location })
      }, token);
      setLastMessage(response.message);
      await navigator.clipboard?.writeText(response.message).catch(() => {});
      if (response.whatsapp_url) window.open(response.whatsapp_url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken('');
    setStaff(null);
    setLastMessage('');
    localStorage.removeItem('producalza_attendance_token');
    localStorage.removeItem('producalza_attendance_staff');
  }

  if (!staff || !token) {
    return (
      <main className="attendance-page">
        <form className="attendance-card" onSubmit={login}>
          <div className="attendance-mark"><Clock size={28} /></div>
          <span>PRODUCALZA</span>
          <h1>Asistencia de locales</h1>
          <p>Ingresa con tu usuario para registrar entrada o salida.</p>
          {error && <div className="alert error">{error}</div>}
          <label>Usuario<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Contrasena<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <button className="prod-primary-button" disabled={loading}>
            <LogIn size={18} />
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="attendance-page">
      <section className="attendance-card attendance-panel">
        <div className="attendance-top">
          <div>
            <span>Asistencia</span>
            <h1>{staff.name}</h1>
            <p>{staff.establishment_display_name || 'PRODUCALZA'}</p>
          </div>
          <button className="prod-icon-button" onClick={logout} title="Salir"><LogOut size={18} /></button>
        </div>
        {error && <div className="alert error">{error}</div>}
        <label>
          <MapPin size={16} />
          Local
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            {(staff.locations || []).map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <div className="attendance-actions">
          <button className="prod-primary-button" disabled={loading || !location} onClick={() => mark('in')}>
            <LogIn size={18} />
            Ingreso
          </button>
          <button className="prod-secondary-button" disabled={loading || !location} onClick={() => mark('out')}>
            <LogOut size={18} />
            Salida
          </button>
        </div>
        {lastMessage && (
          <div className="attendance-result">
            <CheckCircle2 size={20} />
            <div>
              <strong>Registro guardado</strong>
              <p>{lastMessage}</p>
              <small><MessageCircle size={14} />El mensaje se copio para pegarlo en el grupo de WhatsApp.</small>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
