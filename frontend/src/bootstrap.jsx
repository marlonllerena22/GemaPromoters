const studioHosts = new Set(['estudioscreativos.com', 'www.estudioscreativos.com']);
const studioPaths = new Set(['/estudio-creativo', '/ingresar']);
const isStudioEntry = studioHosts.has(window.location.hostname.toLowerCase()) || studioPaths.has(window.location.pathname);

if (isStudioEntry) {
  document.title = 'Estudios Creativos';
  import('./studio-entry.jsx');
} else {
  import('./main.jsx');
}
