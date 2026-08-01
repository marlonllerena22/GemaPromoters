const DEFAULT_API_URL =
  typeof window !== 'undefined' && window.location.hostname === 'promotersec.com'
    ? 'https://www.promotersec.com/api'
    : '/api';
const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

export function getToken() {
  return localStorage.getItem('gema_token');
}

export function setToken(token) {
  localStorage.setItem('gema_token', token);
}

export function getUser() {
  const raw = localStorage.getItem('gema_user');
  return raw ? JSON.parse(raw) : null;
}

export function setUser(user) {
  localStorage.setItem('gema_user', JSON.stringify(user));
}

export function clearToken() {
  localStorage.removeItem('gema_token');
  localStorage.removeItem('gema_user');
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'No se pudo completar la accion');
  }

  return data;
}

export async function downloadApiFile(path, filename) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'No se pudo descargar el archivo');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
