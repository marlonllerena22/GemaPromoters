const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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
