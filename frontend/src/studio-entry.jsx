import React, { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearToken, getToken, getUser, setToken, setUser } from './api.js';
import ContentStudioIntro from './ContentStudioIntro.jsx';
import './studio-base.css';
import './content-studio-brand-assets.css';

const ContentStudioApp = lazy(() => import('./ContentStudioApp.jsx'));
const ContentStudioLanding = lazy(() => import('./ContentStudioLanding.jsx'));
const ContentStudioAccess = lazy(() => import('./ContentStudioAccess.jsx'));
const ContentStudioSellerApp = lazy(() => import('./ContentStudioSellerApp.jsx'));

function StudioEntry() {
  const [token, saveToken] = useState(getToken());
  const [user, saveUser] = useState(getUser());
  const pathname = window.location.pathname;
  const hostname = window.location.hostname.toLowerCase();
  const isStudioDomain = ['estudioscreativos.com', 'www.estudioscreativos.com'].includes(hostname);
  const isLocalStudio = ['localhost', '127.0.0.1'].includes(hostname);
  const isAdminRoute = pathname === '/administracion';
  const isSellerRoute = pathname === '/vendedores';
  const isLandingRoute = pathname === '/estudio-creativo' || (isStudioDomain && pathname === '/');
  const authParams = new URLSearchParams(window.location.search);
  const hasAuthCallback = authParams.has('magic') || authParams.has('handoff');
  const isStudioUser = user?.establishment_module_type === 'content_studio'
    || String(user?.establishment_name || '').toUpperCase() === 'ESTUDIOS CREATIVOS'
    || ['content_studio_user', 'content_studio_seller'].includes(user?.role);
  const isSeller = user?.role === 'content_studio_seller';
  const studioLandingPath = isStudioDomain ? '/' : '/estudio-creativo';
  const [allowAuthenticatedLanding] = useState(() => {
    if (!isLandingRoute) return false;
    try {
      const requested = sessionStorage.getItem('estudios-public-landing') === 'requested';
      sessionStorage.removeItem('estudios-public-landing');
      return requested;
    } catch { return false; }
  });
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

  function logoutToLanding() {
    window.google?.accounts?.id?.disableAutoSelect?.();
    clearToken();
    saveToken(null);
    saveUser(null);
    window.location.replace(studioLandingPath);
  }

  // Browser history can restore the public page that existed before login.
  // Keep active sessions in their workspace unless the user requested the
  // public page explicitly from their profile.
  if (isLandingRoute && token && isStudioUser && !allowAuthenticatedLanding) {
    window.location.replace(isSeller ? '/vendedores' : '/ingresar');
    return null;
  }

  // A studio session must be created on its own domain, never under Promoters.
  if (!isStudioDomain && !isLocalStudio && (pathname === '/ingresar' || isAdminRoute || isSellerRoute)) {
    const route = isAdminRoute ? '/administracion' : isSellerRoute ? '/vendedores' : '/ingresar';
    window.location.replace(`https://estudioscreativos.com${route}${window.location.search || ''}`);
    return null;
  }

  // Seller credentials are also accepted by the general access form. Always move
  // that role to its dedicated portal before the creation app requests user-only data.
  if (token && isSeller && !isSellerRoute && !hasAuthCallback && (pathname === '/ingresar' || isAdminRoute)) {
    window.location.replace(`/vendedores${window.location.search || ''}`);
    return null;
  }

  let page;
  if (isLandingRoute) {
    page = <ContentStudioLanding allowAuthenticatedSession={allowAuthenticatedLanding} />;
  } else if (isSellerRoute && token && isSeller) {
    page = <ContentStudioSellerApp user={user} onLogout={logoutToLanding} />;
  } else if (isSellerRoute) {
    page = <ContentStudioAccess sellerOnly onAuthenticated={(nextToken, nextUser) => {
      setToken(nextToken); setUser(nextUser); saveToken(nextToken); saveUser(nextUser);
    }} />;
  } else if ((pathname === '/ingresar' || isAdminRoute) && token && isStudioUser && !isSeller && !hasAuthCallback && (!isAdminRoute || ['admin', 'supreme'].includes(user?.role))) {
    page = <ContentStudioApp user={user} initialTab={isAdminRoute ? 'settings' : 'create'} onLogout={logoutToLanding} />;
  } else if (pathname === '/ingresar' || isAdminRoute) {
    page = <ContentStudioAccess adminOnly={isAdminRoute} onAuthenticated={(nextToken, nextUser) => {
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
