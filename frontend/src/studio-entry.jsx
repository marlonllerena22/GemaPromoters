import React, { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearToken, getToken, getUser, setToken, setUser } from './api.js';
import './studio-base.css';

const ContentStudioApp = lazy(() => import('./ContentStudioApp.jsx'));
const ContentStudioLanding = lazy(() => import('./ContentStudioLanding.jsx'));
const ContentStudioAccess = lazy(() => import('./ContentStudioAccess.jsx'));

function StudioEntry() {
  const [token, saveToken] = useState(getToken());
  const [user, saveUser] = useState(getUser());
  const pathname = window.location.pathname;
  const isStudioDomain = ['estudioscreativos.com', 'www.estudioscreativos.com'].includes(window.location.hostname.toLowerCase());
  const isStudioUser = user?.establishment_module_type === 'content_studio'
    || String(user?.establishment_name || '').toUpperCase() === 'ESTUDIOS CREATIVOS';

  if (pathname === '/estudio-creativo' || (isStudioDomain && pathname === '/')) {
    return <ContentStudioLanding />;
  }

  if (pathname === '/ingresar' && token && isStudioUser) {
    return <ContentStudioApp user={user} onLogout={() => {
      window.google?.accounts?.id?.disableAutoSelect?.();
      clearToken(); saveToken(null); saveUser(null);
    }} />;
  }

  if (pathname === '/ingresar') {
    return <ContentStudioAccess onAuthenticated={(nextToken, nextUser) => {
      setToken(nextToken); setUser(nextUser); saveToken(nextToken); saveUser(nextUser);
    }} />;
  }

  return <ContentStudioLanding />;
}

createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div className="studio-route-loading" aria-label="Cargando" />}>
    <StudioEntry />
  </Suspense>
);
