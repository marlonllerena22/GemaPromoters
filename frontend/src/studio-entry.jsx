import React, { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearToken, getToken, getUser, setToken, setUser } from './api.js';
import ContentStudioIntro from './ContentStudioIntro.jsx';
import './studio-base.css';

const ContentStudioApp = lazy(() => import('./ContentStudioApp.jsx'));
const ContentStudioLanding = lazy(() => import('./ContentStudioLanding.jsx'));
const ContentStudioAccess = lazy(() => import('./ContentStudioAccess.jsx'));

function StudioEntry() {
  const [token, saveToken] = useState(getToken());
  const [user, saveUser] = useState(getUser());
  const pathname = window.location.pathname;
  const isStudioDomain = ['estudioscreativos.com', 'www.estudioscreativos.com'].includes(window.location.hostname.toLowerCase());
  const isLandingRoute = pathname === '/estudio-creativo' || (isStudioDomain && pathname === '/');
  const isStudioUser = user?.establishment_module_type === 'content_studio'
    || String(user?.establishment_name || '').toUpperCase() === 'ESTUDIOS CREATIVOS';
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return isLandingRoute
        ? sessionStorage.getItem('estudios-intro-landing-v1') !== 'seen'
        : sessionStorage.getItem('estudios-intro-after-login') === 'pending';
    } catch { return isLandingRoute; }
  });

  function finishIntro() {
    try {
      if (isLandingRoute) sessionStorage.setItem('estudios-intro-landing-v1', 'seen');
      sessionStorage.removeItem('estudios-intro-after-login');
    } catch { /* The intro still works when browser storage is disabled. */ }
    setShowIntro(false);
  }

  let page;
  if (isLandingRoute) {
    page = <ContentStudioLanding />;
  } else if (pathname === '/ingresar' && token && isStudioUser) {
    page = <ContentStudioApp user={user} onLogout={() => {
      window.google?.accounts?.id?.disableAutoSelect?.();
      clearToken(); saveToken(null); saveUser(null);
    }} />;
  } else if (pathname === '/ingresar') {
    page = <ContentStudioAccess onAuthenticated={(nextToken, nextUser) => {
      setToken(nextToken); setUser(nextUser); saveToken(nextToken); saveUser(nextUser);
      setShowIntro(true);
    }} />;
  } else {
    page = <ContentStudioLanding />;
  }

  return <>{page}{showIntro && <ContentStudioIntro onComplete={finishIntro} />}</>;
}

createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div className="studio-route-loading" aria-label="Cargando" />}>
    <StudioEntry />
  </Suspense>
);
