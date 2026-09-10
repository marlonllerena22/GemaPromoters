const studioHosts = new Set(['estudioscreativos.com', 'www.estudioscreativos.com']);
const studioPaths = new Set(['/estudio-creativo', '/ingresar', '/administracion', '/vendedores']);
const currentHost = window.location.hostname.toLowerCase();
const isLegacyStudioHost = new Set(['promotersec.com', 'www.promotersec.com']).has(currentHost);
const isStudioEntry = studioHosts.has(currentHost) || studioPaths.has(window.location.pathname);

function storedStudioSession() {
  try {
    const token = localStorage.getItem('gema_token');
    const user = JSON.parse(localStorage.getItem('gema_user') || 'null');
    const isStudioUser = user?.establishment_module_type === 'content_studio'
      || String(user?.establishment_name || '').toUpperCase() === 'ESTUDIOS CREATIVOS'
      || ['content_studio_user', 'content_studio_seller'].includes(user?.role);
    return token && isStudioUser ? { token, user } : null;
  } catch {
    return null;
  }
}

async function moveLegacyStudioSession(session) {
  const currentPath = window.location.pathname;
  const destination = currentPath === '/administracion' || ['admin', 'supreme'].includes(session.user?.role)
    ? '/administracion'
    : currentPath === '/vendedores' || session.user?.role === 'content_studio_seller'
      ? '/vendedores'
      : '/ingresar';
  const apiBase = currentHost === 'promotersec.com' ? 'https://www.promotersec.com/api' : '/api';
  try {
    const response = await fetch(`${apiBase}/content-studio/auth/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: '{}'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.code) throw new Error('No se pudo trasladar la sesión');
    window.location.replace(`https://estudioscreativos.com${destination}?handoff=${encodeURIComponent(payload.code)}`);
  } catch {
    // The old token may have expired. The destination will show the regular secure access.
    window.location.replace(`https://estudioscreativos.com${destination}`);
  }
}

const legacySession = isLegacyStudioHost ? storedStudioSession() : null;

if (legacySession) {
  void moveLegacyStudioSession(legacySession);
} else if (isStudioEntry) {
  document.title = 'Estudios Creativos';
  import('./studio-entry.jsx');
} else {
  import('./main.jsx');
}
