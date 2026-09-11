import React, { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Building2, Check, ChevronDown, ChevronRight, CreditCard, Crown, Download, EyeOff,
  Gem, Image as ImageIcon, LayoutGrid, LogOut, Mail, MessageCircle, Plus, Settings,
  Share2, ShieldCheck, ShoppingBag, Sparkles, Tag, Trash2, Upload, UserPlus, UserRound,
  UsersRound, WandSparkles, X, BriefcaseBusiness, CalendarCheck, TrendingUp
} from 'lucide-react';
import { api, setUser } from './api.js';
import ContentStudioSocialPublisher, { SocialConnectionsSettings } from './ContentStudioSocial.jsx';
import './content-studio.css';
import './content-studio-magic-progress.css';
import './content-studio-brand-assets.css';

const PRESET_ICONS = { editorial: UserRound, catalog: ShoppingBag, social: Share2, detail: Gem };
const PRESET_GUIDES = {
  editorial: '/content-studio/guides/editorial.jpg',
  catalog: '/content-studio/guides/catalog.jpg',
  social: '/content-studio/guides/social.jpg',
  detail: '/content-studio/guides/detail.jpg'
};
const PRESET_NAMES = { editorial: 'Editorial', catalog: 'Catálogo', social: 'Post social', detail: 'Detalle' };
const EDITORIAL_SUBJECTS = [
  { id: 'female', name: 'Femenino', description: 'Mujer o niña según el producto', icon: '♀' },
  { id: 'male', name: 'Masculino', description: 'Hombre o niño según el producto', icon: '♂' },
  { id: 'animal', name: 'Animal', description: 'Animal adecuado al contexto', icon: '✦' }
];
const emptyForm = { preset: 'editorial', editorial_subject: 'female', logo_id: 'none', output_format: 'post', social_style: 'editorial', product_name: '', product_features: '', creative_instruction: '', contact_whatsapp: '', contact_location: '' };
const PLAN_PACKAGES = [
  { id: 'inicio', name: 'Inicio', photos: 10, price: 10, days: 8 },
  { id: 'emprendedor', name: 'Emprendedor', photos: 25, price: 20, days: 15 },
  { id: 'negocio', name: 'Negocio', photos: 60, price: 39, days: 30 },
  { id: 'pro', name: 'Pro', photos: 150, price: 69, days: 30 }
];

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function apiWithTimeout(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try { return await api(path, { ...options, signal: controller.signal }); }
  catch (error) {
    if (error.name === 'AbortError') throw new Error('El estudio tardó demasiado en responder. Revisa tu conexión e inténtalo nuevamente.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

function progressForElapsed(seconds, hasResearch = false) {
  if (seconds < 4) return { percent: 12, label: 'Preparando tus imágenes' };
  if (seconds < 15) return { percent: 28, label: hasResearch ? 'Investigando el contexto del producto' : 'Analizando el producto y la marca' };
  if (seconds < 35) return { percent: 48, label: 'Creando la composición' };
  if (seconds < 65) return { percent: 68, label: 'Cuidando el realismo y los detalles' };
  if (seconds < 100) return { percent: 84, label: 'Aplicando el acabado profesional' };
  return { percent: 94, label: 'Terminando tu imagen' };
}

async function imageFileToData(file, maxSide = 1800, quality = 0.9) {
  if (!file?.type?.startsWith('image/')) throw new Error('Selecciona un archivo de imagen');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const item = new Image();
    item.onload = () => resolve(item);
    item.onerror = () => reject(new Error('La imagen no es válida'));
    item.src = source;
  });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function downloadDataImage(data, name = 'contenido-creado.webp') {
  const link = document.createElement('a');
  link.href = data;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function ContentStudioApp({ user, onLogout, embedded = false, establishmentId, initialTab = 'create' }) {
  const scopeId = establishmentId || user?.establishment_id;
  const scopeQuery = scopeId ? `?establishment_id=${scopeId}` : '';
  const scopeBody = scopeId ? { establishment_id: Number(scopeId) } : {};
  const activeStorageKey = `content-studio-active-generation-${scopeId || 'current'}`;
  const isStudioAdmin = ['admin', 'supreme'].includes(user?.role);
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [productImage, setProductImage] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ percent: 0, label: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plansOpen, setPlansOpen] = useState(false);
  const [requestedPlan, setRequestedPlan] = useState(new URLSearchParams(window.location.search).get('plan') || (() => { try { return sessionStorage.getItem('estudios-requested-plan') || ''; } catch { return ''; } })());
  const inputRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const mountedRef = useRef(true);
  const loadedSections = useRef(new Set());

  const navigation = [
    ['create', 'Crear', Sparkles],
    ['history', 'Historial', LayoutGrid],
    ['profile', 'Perfil', UserRound],
    ['settings', 'Configuración', Settings]
  ];

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Estudios Creativos';
    return () => { document.title = previousTitle; };
  }, []);

  function rememberedGenerationId() {
    try { return Number(window.localStorage.getItem(activeStorageKey) || 0); } catch { return 0; }
  }
  function rememberGeneration(id) { try { window.localStorage.setItem(activeStorageKey, String(id)); } catch { /* server state remains authoritative */ } }
  function forgetGeneration() { try { window.localStorage.removeItem(activeStorageKey); } catch { /* optional */ } }

  async function loadCore({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const bootstrapRequest = apiWithTimeout(`/content-studio/bootstrap${scopeQuery}`);
      const logosRequest = apiWithTimeout(`/content-studio/logos${scopeQuery}`)
        .then((value) => ({ ok: true, value }), (reason) => ({ ok: false, reason }));
      const response = await bootstrapRequest;
      const next = { ...response, generations: response.generations || [], users: [], plan_orders: [], sellers: [], seller_period: null };
      setData((current) => ({ ...current, ...next }));
      void logosRequest.then((logosResult) => {
        if (!mountedRef.current) return;
        if (!logosResult.ok) {
          setError('El estudio abrió, pero no pudimos cargar tus logos. Puedes reintentar desde Configuración.');
          return;
        }
        const logosResponse = logosResult.value;
        const logos = logosResponse.logos || [];
        setData((current) => ({ ...current, logos }));
        setForm((current) => ({ ...current, logo_id: current.logo_id === 'none' || logos.some((logo) => Number(logo.id) === Number(current.logo_id)) ? current.logo_id : 'none' }));
      });
      const remembered = next.generations.find((item) => Number(item.id) === rememberedGenerationId());
      const pending = remembered?.status === 'processing' ? remembered : next.generations.find((item) => item.status === 'processing');
      if (pending) void monitorGeneration(pending).catch((err) => mountedRef.current && setError(err.message));
      if (requestedPlan) {
        setPlansOpen(true);
        try { sessionStorage.removeItem('estudios-requested-plan'); } catch { /* optional */ }
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (err) { setError(err.message); }
    finally { if (!quiet) setLoading(false); }
  }

  async function loadHistory(force = false) {
    if (!force && loadedSections.current.has('history')) return;
    setSectionLoading(true);
    try {
      const response = await apiWithTimeout(`/content-studio/generations${scopeQuery}`, {}, 25000);
      setData((current) => ({ ...current, generations: response.generations || [] }));
      loadedSections.current.add('history');
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(false); }
  }

  async function loadAdmin(force = false) {
    if (!isStudioAdmin || (!force && loadedSections.current.has('admin'))) return;
    setSectionLoading(true);
    try {
      const response = await apiWithTimeout(`/content-studio/admin${scopeQuery}`);
      setData((current) => ({ ...current, users: response.users || [], plan_orders: response.plan_orders || [], sellers: response.sellers || [], seller_period: response.seller_period || null }));
      loadedSections.current.add('admin');
    } catch (err) { setError(err.message); }
    finally { setSectionLoading(false); }
  }

  async function reload() {
    await loadCore({ quiet: true });
    if (tab === 'history') await loadHistory(true);
    if (tab === 'settings' && isStudioAdmin) await loadAdmin(true);
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadCore();
    return () => { mountedRef.current = false; activeGenerationRef.current = null; };
  }, [scopeId]);

  useEffect(() => {
    if (tab === 'history') void loadHistory();
    if (tab === 'settings' && isStudioAdmin) void loadAdmin();
  }, [tab]);

  async function chooseProduct(file) {
    setError('');
    try {
      setProductImage(await imageFileToData(file));
      setForm((current) => ({ ...current, product_name: '', product_features: '', creative_instruction: '' }));
      setResult(null);
    } catch (err) { setError(err.message); }
  }

  async function monitorGeneration(generation, startedAtOverride) {
    const generationId = Number(generation?.id || 0);
    if (!generationId || activeGenerationRef.current === generationId) return;
    activeGenerationRef.current = generationId;
    setGenerating(true);
    const parsedCreatedAt = generation?.created_at ? new Date(String(generation.created_at).replace(' ', 'T')).getTime() : NaN;
    const startedAt = startedAtOverride || (Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now());
    const hasResearch = Boolean(String(generation?.product_name || '').trim());
    let terminal = false;
    try {
      let completed;
      for (let attempt = 0; attempt < 240 && mountedRef.current && activeGenerationRef.current === generationId; attempt += 1) {
        const statusResponse = await api(`/content-studio/generations/${generationId}${scopeQuery}`);
        if (statusResponse.generation?.status === 'failed') { terminal = true; throw new Error(statusResponse.generation.error_message || 'No se pudo crear la imagen'); }
        if (statusResponse.generation?.status === 'completed') { terminal = true; completed = statusResponse; break; }
        await wait(2500);
        if (mountedRef.current) setGenerationProgress(progressForElapsed(Math.round((Date.now() - startedAt) / 1000), hasResearch));
      }
      if (!mountedRef.current || activeGenerationRef.current !== generationId) return;
      if (!completed) throw new Error('La creación sigue procesándose en el servidor. Puedes verla más tarde en Historial.');
      setGenerationProgress({ percent: 100, label: 'Tu imagen está lista' });
      setResult(completed.generation);
      setData((current) => {
        const usage = completed.usage;
        const limit = Number(current.settings?.monthly_limit || 0);
        return { ...current, usage, available_credits: Math.max(0, limit - usage), generation_available: current.subscription?.active && usage < limit, generations: [completed.generation, ...(current.generations || []).filter((item) => item.id !== completed.generation.id)].slice(0, 24) };
      });
      loadedSections.current.add('history');
      setNotice('Tu imagen profesional está lista');
      window.setTimeout(() => setNotice(''), 3000);
    } finally {
      if (terminal) forgetGeneration();
      if (activeGenerationRef.current === generationId) activeGenerationRef.current = null;
      if (mountedRef.current) { setGenerating(false); window.setTimeout(() => mountedRef.current && setGenerationProgress({ percent: 0, label: '' }), 700); }
    }
  }

  async function generate(event) {
    event.preventDefault(); setError('');
    if (!data?.subscription?.active || Number(data?.available_credits || 0) <= 0) { setPlansOpen(true); return; }
    if (!productImage) { setError('Primero sube la foto del producto'); return; }
    setGenerating(true); setGenerationProgress({ percent: 7, label: 'Enviando tu foto de forma segura' });
    try {
      const response = await api('/content-studio/generate', { method: 'POST', body: JSON.stringify({ ...scopeBody, ...form, product_image: productImage }) });
      const generation = response.generation;
      if (!generation?.id) throw new Error('No se pudo iniciar la creación');
      rememberGeneration(generation.id);
      setData((current) => ({ ...current, generations: [generation, ...(current.generations || []).filter((item) => item.id !== generation.id)].slice(0, 24) }));
      await monitorGeneration(generation, Date.now());
    } catch (err) {
      if (['PLAN_REQUIRED', 'CREDITS_EXHAUSTED'].includes(err.code)) setPlansOpen(true); else setError(err.message);
      setGenerating(false); setGenerationProgress({ percent: 0, label: '' });
    }
  }

  function newCreation() { setProductImage(''); setResult(null); setForm((current) => ({ ...emptyForm, logo_id: current.logo_id })); setTab('create'); }
  const selectedPreset = data?.presets?.find((item) => item.id === form.preset);
  const usagePercent = Math.min(100, (Number(data?.usage || 0) / Math.max(1, Number(data?.settings?.monthly_limit || 0))) * 100);

  return <div className={`cs-app ${embedded ? 'cs-embedded' : ''}`}>
    {!embedded && <header className="cs-header"><button className="cs-brand" type="button" onClick={newCreation} aria-label="Crear una nueva imagen"><span className="cs-brand-mascot"><img src="/content-studio/brand/mascota-toque.webp" alt="" /></span><div><img className="cs-brand-wordmark" src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="Estudios Creativos" /><small>Tu estudio con IA</small></div></button><nav>{navigation.map(([key,label,Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17}/>{label}</button>)}</nav></header>}
    <div className="cs-page">
      {embedded && <div className="cs-embedded-nav">{navigation.map(([key,label,Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17}/>{label}</button>)}</div>}
      {notice && <div className="cs-toast"><Check size={17}/>{notice}</div>}
      {error && <div className="cs-error"><span>{error}</span><button onClick={() => setError('')}><X size={17}/></button>{!data && <button className="cs-error-retry" onClick={() => loadCore()}>Reintentar</button>}</div>}
      {loading && !data ? <StudioShellSkeleton /> : data && <>
        {tab === 'create' && <CreateView data={data} form={form} setForm={setForm} productImage={productImage} inputRef={inputRef} chooseProduct={chooseProduct} selectedPreset={selectedPreset} generate={generate} generating={generating} result={result} generationProgress={generationProgress} newCreation={newCreation} usagePercent={usagePercent} goToHistory={() => setTab('history')} goToSettings={() => setTab('settings')} openPlans={() => setPlansOpen(true)} />}
        {tab === 'history' && (sectionLoading && !loadedSections.current.has('history') ? <SectionSkeleton title="Cargando tu historial" /> : <HistoryView data={data} scopeBody={scopeBody} reload={reload} setError={setError}/>) }
        {tab === 'profile' && <AccountProfile data={data} user={user} onLogout={onLogout} openPlans={() => setPlansOpen(true)} setData={setData} setError={setError}/>}
        {tab === 'settings' && <BusinessConfiguration data={data} scopeBody={scopeBody} reload={reload} setError={setError} user={user} isStudioAdmin={isStudioAdmin} sectionLoading={sectionLoading} onSaved={(settings) => setData((current) => ({...current,settings}))}/>}
      </>}
    </div>
    {!embedded && <nav className="cs-mobile-nav" aria-label="Navegación principal">{navigation.map(([key,label,Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={21}/><span>{label}</span></button>)}</nav>}
    {plansOpen && data && (
      <PlansModal plans={data.plans || PLAN_PACKAGES} initialPlan={requestedPlan} account={data.account || user} settings={data.settings} transfer={data.transfer} onClose={() => { setPlansOpen(false); setRequestedPlan(''); }} onRequested={(order) => { setNotice(`Solicitud ${order.order_number} enviada`); setPlansOpen(false); }}/>
    )}
  </div>;
}

function LegacyContentStudioApp({ user, onLogout, embedded = false, establishmentId }) {
  const scopeId = establishmentId || user?.establishment_id;
  const [tab, setTab] = useState('create');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [productImage, setProductImage] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ percent: 0, label: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);
  const activeGenerationRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Estudios Creativos';
    return () => { document.title = previousTitle; };
  }, []);

  const scopeQuery = scopeId ? `?establishment_id=${scopeId}` : '';
  const scopeBody = scopeId ? { establishment_id: Number(scopeId) } : {};
  const activeStorageKey = `content-studio-active-generation-${scopeId || 'current'}`;

  function rememberedGenerationId() {
    try { return Number(window.localStorage.getItem(activeStorageKey) || 0); }
    catch { return 0; }
  }

  function rememberGeneration(id) {
    try { window.localStorage.setItem(activeStorageKey, String(id)); }
    catch { /* The server queue still works when browser storage is unavailable. */ }
  }

  function forgetGeneration() {
    try { window.localStorage.removeItem(activeStorageKey); }
    catch { /* No action needed. */ }
  }

  async function load() {
    const response = await api(`/content-studio/bootstrap${scopeQuery}`);
    setData(response);
    setForm((current) => ({
      ...current,
      logo_id: current.logo_id === 'none' || response.logos?.some((logo) => Number(logo.id) === Number(current.logo_id)) ? current.logo_id : 'none'
    }));
    const remembered = response.generations?.find((item) => Number(item.id) === rememberedGenerationId());
    if (remembered?.status === 'completed') {
      setResult(remembered);
      forgetGeneration();
    } else if (remembered?.status === 'failed') {
      forgetGeneration();
    }
    const pending = remembered?.status === 'processing' ? remembered : response.generations?.find((item) => item.status === 'processing');
    if (pending) void monitorGeneration(pending).catch((err) => mountedRef.current && setError(err.message));
  }

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
    return () => {
      mountedRef.current = false;
      activeGenerationRef.current = null;
    };
  }, [scopeId]);

  const selectedPreset = data?.presets?.find((item) => item.id === form.preset);
  const usagePercent = Math.min(100, ((data?.usage || 0) / (data?.settings?.monthly_limit || 1)) * 100);
  const canManageLogos = data?.can_manage_logos === true;
  const isStudioAdmin = ['admin', 'supreme'].includes(user?.role);
  const navigation = [
    ['create', 'Crear', Sparkles],
    ['history', 'Historial', LayoutGrid],
    ...(isStudioAdmin ? [['users', 'Usuarios', UsersRound]] : []),
    ['profile', 'Perfil', UserRound]
  ];

  async function chooseProduct(file) {
    setError('');
    try { setProductImage(await imageFileToData(file)); setForm((current) => ({ ...current, product_name: '', product_features: '', creative_instruction: '' })); setResult(null); }
    catch (err) { setError(err.message); }
  }

  async function monitorGeneration(generation, startedAtOverride) {
    const generationId = Number(generation?.id || 0);
    if (!generationId || activeGenerationRef.current === generationId) return;
    activeGenerationRef.current = generationId;
    setGenerating(true);
    const parsedCreatedAt = generation?.created_at ? new Date(String(generation.created_at).replace(' ', 'T')).getTime() : NaN;
    const startedAt = startedAtOverride || (Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now());
    const hasResearch = Boolean(String(generation?.product_name || '').trim());
    setGenerationProgress(progressForElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000)), hasResearch));
    let terminal = false;
    try {
      let completed;
      for (let attempt = 0; attempt < 240 && mountedRef.current && activeGenerationRef.current === generationId; attempt += 1) {
        const statusResponse = await api(`/content-studio/generations/${generationId}${scopeQuery}`);
        if (statusResponse.generation?.status === 'failed') {
          terminal = true;
          throw new Error(statusResponse.generation.error_message || 'No se pudo crear la imagen');
        }
        if (statusResponse.generation?.status === 'completed') {
          terminal = true;
          completed = statusResponse;
          break;
        }
        await wait(2500);
        if (mountedRef.current) {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          setGenerationProgress(progressForElapsed(elapsed, hasResearch));
        }
      }
      if (!mountedRef.current || activeGenerationRef.current !== generationId) return;
      if (!completed) throw new Error('La creación sigue procesándose en el servidor. Puedes recargar o revisarla en Mis diseños más tarde.');
      setGenerationProgress({ percent: 100, label: 'Tu imagen está lista' });
      setResult(completed.generation);
      setData((current) => ({ ...current, usage: completed.usage, generations: [completed.generation, ...current.generations.filter((item) => item.id !== completed.generation.id)].slice(0, 24) }));
      setNotice('Tu imagen profesional está lista');
      window.setTimeout(() => setNotice(''), 3000);
    } finally {
      if (terminal) forgetGeneration();
      if (activeGenerationRef.current === generationId) activeGenerationRef.current = null;
      if (mountedRef.current) {
        setGenerating(false);
        window.setTimeout(() => mountedRef.current && setGenerationProgress({ percent: 0, label: '' }), 700);
      }
    }
  }

  async function generate(event) {
    event.preventDefault();
    setError('');
    if (!productImage) { setError('Primero sube la foto del producto'); return; }
    setGenerating(true);
    setGenerationProgress({ percent: 7, label: 'Enviando tu foto de forma segura' });
    try {
      const response = await api('/content-studio/generate', {
        method: 'POST', body: JSON.stringify({ ...scopeBody, ...form, product_image: productImage })
      });
      const generation = response.generation;
      if (!generation?.id) throw new Error('No se pudo iniciar la creación');
      rememberGeneration(generation.id);
      setData((current) => ({ ...current, generations: [generation, ...current.generations.filter((item) => item.id !== generation.id)].slice(0, 24) }));
      await monitorGeneration(generation, Date.now());
    } catch (err) {
      setError(err.message);
      setGenerating(false);
      setGenerationProgress({ percent: 0, label: '' });
    }
  }

  function newCreation() {
    setProductImage('');
    setResult(null);
    setForm((current) => ({ ...emptyForm, logo_id: current.logo_id }));
    setTab('create');
  }

  if (loading) return <div className="cs-loading"><Sparkles size={28} /> Preparando el estudio...</div>;

  return (
    <div className={`cs-app ${embedded ? 'cs-embedded' : ''}`}>
      {!embedded && (
        <header className="cs-header">
          <button className="cs-brand" type="button" onClick={newCreation}>
            <span><WandSparkles size={21} /></span>
            <div><strong>ESTUDIOS CREATIVOS</strong><small>Tu estudio con IA</small></div>
          </button>
          <nav>
            {navigation.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} /> {label}</button>)}
          </nav>
          <button className="cs-logout" type="button" onClick={onLogout}><LogOut size={17} /> Salir</button>
        </header>
      )}

      <div className="cs-page">
        {embedded && (
          <div className="cs-embedded-nav">
            {navigation.map(([key, label, Icon]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} /> {label}</button>
            ))}
          </div>
        )}
        {notice && <div className="cs-toast"><Check size={17} /> {notice}</div>}
        {error && <div className="cs-error"><span>{error}</span><button onClick={() => setError('')}><X size={17} /></button></div>}

        {tab === 'create' && (
          <CreateView
            data={data} form={form} setForm={setForm} productImage={productImage} inputRef={inputRef}
            chooseProduct={chooseProduct} selectedPreset={selectedPreset}
            generate={generate} generating={generating} result={result}
            generationProgress={generationProgress} newCreation={newCreation} usagePercent={usagePercent}
            goToHistory={() => setTab('history')} goToProfile={() => setTab('profile')}
          />
        )}
        {tab === 'history' && <HistoryView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'users' && isStudioAdmin && <UsersView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'profile' && <ProfileView data={data} scopeBody={scopeBody} reload={load} setError={setError} canManageLogos={canManageLogos} user={user} onSaved={(settings) => setData((current) => ({ ...current, settings }))} />}
      </div>

      {!embedded && (
        <nav className={`cs-mobile-nav ${isStudioAdmin ? 'admin' : ''}`} aria-label="Navegación principal">
          {navigation.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={21} /><span>{label}</span></button>)}
        </nav>
      )}
    </div>
  );
}

function CreateView({ data, form, setForm, productImage, inputRef, chooseProduct, selectedPreset, generate, generating, generationProgress, result, newCreation, usagePercent, goToHistory, goToSettings, openPlans }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  if (result) {
    return (
      <section className="cs-result-page">
        <div className="cs-result-copy">
          <span className="cs-eyebrow">Creación terminada</span>
          <h1>Lista para publicar.</h1>
          <p>Descárgala en alta calidad o crea una nueva versión con otro estilo.</p>
          <div className="cs-result-actions">
            <button className="cs-primary" onClick={() => downloadDataImage(result.output_image_data, `${result.brand_name || 'contenido'}-${result.id}.webp`)}><Download size={18} /> Descargar</button>
            <button className="cs-secondary" onClick={newCreation}><Plus size={18} /> Nueva creación</button>
          </div>
          <div className="cs-result-meta">{result.product_name && <span>{result.product_name}</span>}{result.brand_name && <span>{result.brand_name}</span>}<span>{PRESET_NAMES[result.preset]}</span><span>{result.aspect_ratio}</span></div>
          <ContentStudioSocialPublisher generation={result} />
        </div>
        <div className="cs-result-image"><img src={result.output_image_data} alt="Contenido generado" /></div>
      </section>
    );
  }
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  const needsPlan = !data.subscription?.active || available <= 0;
  const firstLogo = data.logos?.[0];
  return (
    <form onSubmit={generate}>
      <section className="cs-hero cs-create-heading">
        <div><span className="cs-eyebrow">Estudios Creativos con IA</span><h1>Crear contenido</h1><p>Convierte tus productos en imágenes profesionales listas para publicar.</p></div>
        <button className="cs-credit-card" type="button" onClick={needsPlan ? openPlans : goToHistory}>
          <span><Crown size={22} /></span>
          <div><strong>Créditos: {available}</strong><small>{data.usage} de {data.settings?.monthly_limit} creaciones utilizadas</small><i><b style={{ width: `${usagePercent}%` }} /></i></div>
          <ChevronRight size={20} />
        </button>
      </section>

      <div className="cs-workspace">
        <div className="cs-main-column">
          <section className="cs-card cs-upload-card">
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => chooseProduct(event.target.files?.[0])} />
            <button className={`cs-upload-showcase ${productImage ? 'has-image' : ''}`} type="button" onClick={() => inputRef.current?.click()}>
              <span className="cs-upload-art">
                {productImage ? <img src={productImage} alt="Producto seleccionado" /> : <><i /><ShoppingBag size={72} /><small>Cualquier producto funciona</small></>}
              </span>
              <span className="cs-upload-copy">
                <small>Paso 1</small><strong>{productImage ? 'Tu producto está listo' : 'Sube la foto de tu producto'}</strong>
                <em>JPG, PNG o WEBP</em>
                <b><Upload size={20} /> {productImage ? 'Cambiar foto' : 'Subir foto'}</b>
                <i>{productImage ? 'Puedes cambiarla antes de crear' : 'Una foto clara desde cualquier celular funciona'}</i>
              </span>
            </button>
            <div className={`cs-advanced-options ${advancedOpen ? 'open' : ''}`}>
              <button type="button" className="cs-advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}><span><Sparkles size={18} /></span><div><strong>Opciones avanzadas <em>Opcionales</em></strong><small>Agrega detalles si quieres orientar más la creación.</small></div><ChevronDown size={19} /></button>
              {advancedOpen && <div className="cs-advanced-fields">
                <label><strong>¿Qué es el producto?</strong><input maxLength="70" value={form.product_name} onChange={(event) => setForm({ ...form, product_name: event.target.value })} placeholder="Ej. Vaquita que corre viral" /><small>Lo investigaremos brevemente solo si lo escribes.</small></label>
                <label><strong>Características que deseas destacar</strong><input maxLength="150" value={form.product_features} onChange={(event) => setForm({ ...form, product_features: event.target.value })} placeholder="Ej. Suavidad, cierre lateral y tacón cómodo" /><small>Describe solo detalles reales del producto.</small></label>
                <label><strong>Cuéntame para qué necesitas esta foto</strong><textarea maxLength="260" value={form.creative_instruction} onChange={(event) => setForm({ ...form, creative_instruction: event.target.value })} placeholder="Es una cartera de mi local y quiero crear una publicación que motive a las personas a visitarnos." /><small>Mientras más contexto nos des, mejor podremos crearla para ti.</small></label>
                <div className="cs-advanced-contact-fields"><label><strong>WhatsApp para incluir</strong><input inputMode="tel" maxLength="30" value={form.contact_whatsapp} onChange={(event) => setForm({ ...form, contact_whatsapp: event.target.value })} placeholder="Ej. 0983763419" /><small>Opcional. La IA lo integrará al diseño.</small></label><label><strong>Ubicación para incluir</strong><input maxLength="80" value={form.contact_location} onChange={(event) => setForm({ ...form, contact_location: event.target.value })} placeholder="Ej. Centro de Ambato" /><small>Opcional. Se envía junto con la creación.</small></label></div>
              </div>}
            </div>
          </section>

          <section className="cs-card cs-content-card">
            <div className="cs-card-heading"><div><span className="cs-eyebrow">Paso 2</span><h2>Crear en base a</h2></div><p>Elige el tipo de contenido que necesitas</p></div>
            <div className="cs-preset-grid">
              {data.presets.map((preset) => {
                const PresetIcon = PRESET_ICONS[preset.id] || Sparkles;
                return <button type="button" key={preset.id} className={`cs-preset-card cs-preset-${preset.id} ${form.preset === preset.id ? 'selected' : ''}`} onClick={() => setForm({ ...form, preset: preset.id })}>
                  <span className="cs-preset-thumb"><img src={PRESET_GUIDES[preset.id]} alt={`Ejemplo de ${preset.name}`} /></span>
                  <span className="cs-preset-copy"><i><PresetIcon size={17} /></i><strong>{preset.name}</strong><small>{preset.description}</small></span>
                  <ChevronRight size={19} />
                </button>;
              })}
            </div>
            {form.preset === 'editorial' && <div className="cs-editorial-options"><strong>¿Quién aparecerá con el producto?</strong><p>La edad o el tipo se adaptará al contexto que escribas y a la foto.</p><div className="cs-editorial-subject-grid">{EDITORIAL_SUBJECTS.map((subject) => <button type="button" key={subject.id} className={form.editorial_subject === subject.id ? 'selected' : ''} onClick={() => setForm({ ...form, editorial_subject: subject.id })}><span>{subject.icon}</span><div><b>{subject.name}</b><small>{subject.description}</small></div><i>{form.editorial_subject === subject.id && <Check size={15} />}</i></button>)}</div></div>}
            <div className="cs-social-options cs-output-options"><div><strong>Tamaño de publicación</strong><p>Tu imagen se crea completa en este formato; no se recorta al descargar.</p><div className="cs-choice-row">{(data.output_formats || []).map((format) => <button type="button" key={format.id} className={form.output_format === format.id ? 'selected' : ''} onClick={() => setForm({ ...form, output_format: format.id })}><span>{format.id === 'story' ? '▯' : '▣'}</span><div><b>{format.label}</b><small>{format.width} × {format.height}</small></div><Check size={16} /></button>)}</div></div></div>
            {form.preset === 'social' && <div className="cs-social-options"><div><strong>Estilo del diseño</strong><div className="cs-social-style-grid">{(data.social_styles || []).map((style) => <button type="button" key={style.id} className={form.social_style === style.id ? 'selected' : ''} onClick={() => setForm({ ...form, social_style: style.id })}><b>{style.name}</b><small>{style.description}</small>{form.social_style === style.id && <Check size={16} />}</button>)}</div></div></div>}
          </section>

          <section className="cs-card cs-brand-section">
            <div className="cs-card-heading"><div><span className="cs-eyebrow">Paso 3</span><h2>¿Quieres incluir tu marca?</h2></div><p>Tú decides cómo generar tu contenido</p></div>
            <div className="cs-brand-mode">
              <button type="button" className={form.logo_id !== 'none' ? 'selected' : ''} onClick={() => firstLogo && setForm({ ...form, logo_id: firstLogo.id })}>
                <span><Tag size={23} /></span><div><strong>Con marca / logo</strong><small>La IA recibe tu logo y lo integra al crear</small></div><i>{form.logo_id !== 'none' && <Check size={15} />}</i>
              </button>
              <button type="button" className={form.logo_id === 'none' ? 'selected' : ''} onClick={() => setForm({ ...form, logo_id: 'none' })}>
                <span><EyeOff size={23} /></span><div><strong>Sin marca / logo</strong><small>Genera una imagen limpia</small></div><i>{form.logo_id === 'none' && <Check size={15} />}</i>
              </button>
            </div>
            {form.logo_id !== 'none' && <div className="cs-available-brands"><div><strong>Selecciona una marca</strong><button type="button" onClick={goToSettings}><Settings size={15} /> Administrar logos</button></div><div className="cs-brand-picker">{(data.logos || []).map((logo) => <button type="button" key={logo.id} className={Number(form.logo_id) === Number(logo.id) ? 'selected' : ''} onClick={() => setForm({ ...form, logo_id: logo.id })}><img src={logo.image_data} alt={`Logo ${logo.name}`} /><span>{logo.name}</span>{Number(form.logo_id) === Number(logo.id) && <b><Check size={16} /></b>}</button>)}</div></div>}
            {!firstLogo && <button className="cs-add-first-brand" type="button" onClick={goToSettings}><Plus size={17} /> Agregar tu primer logo desde Configuración</button>}
          </section>
        </div>

        <aside className="cs-summary">
          <div className="cs-summary-visual">{productImage ? <img src={productImage} alt="Vista previa" /> : <ImageIcon size={36} />}</div>
          <span>Tu creación</span><h3>{selectedPreset?.name}</h3><p>{selectedPreset?.description}</p>
          <ul>{form.preset === 'editorial' && <li><UserRound size={15} /> Modelo: {EDITORIAL_SUBJECTS.find((item) => item.id === form.editorial_subject)?.name || 'Femenino'}</li>}{(form.contact_whatsapp || form.contact_location) && <li><MessageCircle size={15} /> Contacto integrado al diseño</li>}<li><Check size={15} /> Producto fiel al original</li><li><Check size={15} /> Acabado fotográfico realista</li><li><Check size={15} /> Alta calidad para publicar</li></ul>
          <button className="cs-generate" disabled={generating || (!needsPlan && (!productImage || !data.generation_available))}>{generating ? <><i /> Creando tu imagen...</> : needsPlan ? <><CreditCard size={18}/> Elegir un plan</> : <>Continuar <ChevronRight size={19} /></>}</button>
          {generating && <MagicGenerationProgress progress={generationProgress} />}
          {!data.generation_available && <small className="cs-api-note">{data.subscription?.active ? 'La interfaz está lista. Falta conectar la clave de OpenAI en el servidor.' : 'Tu plan necesita estar activo para crear imágenes.'}</small>}
        </aside>
      </div>
    </form>
  );
}

function MagicGenerationProgress({ progress }) {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  return <div className="cs-magic-progress" role="status" aria-live="polite">
    <div className="cs-magic-progress-scene" aria-hidden="true">
      <span className="cs-magic-orb" />
      <span className="cs-magic-spark cs-magic-spark-one" />
      <span className="cs-magic-spark cs-magic-spark-two" />
      <span className="cs-magic-spark cs-magic-spark-three" />
      <img className="cs-magic-wizard cs-magic-wizard-touch" src="/content-studio/brand/mascota-toque.webp" alt="" />
      <img className="cs-magic-wizard cs-magic-wizard-wink" src="/content-studio/brand/mascota-regreso.webp" alt="" />
    </div>
    <div className="cs-magic-progress-copy"><span>{progress?.label || 'Preparando tu creación'}</span><strong>{percent}%</strong></div>
    <div className="cs-magic-track"><i style={{ width: `${percent}%` }} /></div>
    <small>Puedes cambiar de sección o recargar la página: la creación continuará en el servidor.</small>
  </div>;
}

function StudioShellSkeleton() {
  return <section className="cs-shell-skeleton" aria-label="Preparando el estudio"><div><i/><i/><i/></div><div className="cs-skeleton-grid"><span/><span/><span/></div><p>Preparando las herramientas esenciales…</p></section>;
}

function SectionSkeleton({ title }) {
  return <section className="cs-section-skeleton" aria-label={title}><h1>{title}</h1><div><i/><i/><i/><i/></div></section>;
}

function AccountProfile({ data, user, onLogout, openPlans, setData, setError }) {
  const account = data.account || user || {};
  const [form, setForm] = useState({ name: account.name || '', email: account.email || '' });
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  const methodLabels = { google: 'Google', magic_link: 'Enlace seguro por correo', password: 'Usuario y contraseña' };
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await api('/content-studio/me', { method: 'PUT', body: JSON.stringify(form) });
      setData((current) => ({ ...current, account: response.user }));
      setUser(response.user);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  async function changePassword(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api('/content-studio/me/password', { method:'PUT', body:JSON.stringify(passwords) });
      setPasswords({ current_password:'', new_password:'' }); setPasswordOpen(false);
    } catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  }
  return <section className="cs-account-page">
    <div className="cs-section-heading"><span className="cs-eyebrow">Tu cuenta</span><h1>Perfil</h1><p>Tu información personal, plan y formas de acceso.</p></div>
    <div className="cs-account-layout">
      <article className="cs-account-card cs-card"><div className="cs-account-avatar">{account.avatar_url ? <img src={account.avatar_url} alt="Foto de perfil" referrerPolicy="no-referrer"/> : <img className="cs-account-mascot" src="/content-studio/brand/mascota-regreso.webp" alt="Mascota de Estudios Creativos" />}</div><div><h2>{account.name || 'Tu cuenta'}</h2><p>{account.email || 'Correo pendiente'}</p></div></article>
      <article className="cs-account-plan cs-card"><span><Crown/></span><div><small>PLAN ACTUAL</small><h2>{data.settings?.plan_name || 'Sin plan'}</h2><p><strong>{available}</strong> creaciones disponibles</p><em className={data.subscription?.active ? 'active' : ''}>{data.subscription?.active ? `Activo${data.subscription.paid_until ? ` hasta ${new Date(`${data.subscription.paid_until}T12:00:00`).toLocaleDateString('es-EC')}` : ''}` : 'Aún no tienes un plan activo'}</em></div><button type="button" onClick={openPlans}>{data.subscription?.active ? 'Mejorar plan' : 'Elegir un plan'}</button></article>
    </div>
    {user?.role === 'content_studio_user' && <form className="cs-personal-form cs-card" onSubmit={save}><div><span><UserRound/></span><h2>Información personal</h2></div><label>Nombre<input value={form.name} onChange={(event) => setForm({...form,name:event.target.value})} maxLength="100" required/></label><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({...form,email:event.target.value})} placeholder="nombre@empresa.com" required/></label><button className="cs-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></form>}
    <section className="cs-access-methods cs-card"><div><span><ShieldCheck/></span><div><h2>Seguridad y acceso</h2><p>Estas son las formas habilitadas para entrar a tu cuenta.</p></div></div><ul>{(account.auth_methods || user?.auth_methods || ['password']).map((method) => <li key={method}><BadgeCheck/><span><strong>{methodLabels[method] || method}</strong><small>{method === 'magic_link' ? account.email || 'Agrega tu correo para usarlo' : 'Método activo'}</small></span></li>)}</ul>{(account.auth_methods || user?.auth_methods || []).includes('password') && <><button className="cs-password-toggle" type="button" onClick={() => setPasswordOpen((open)=>!open)}>Cambiar contraseña</button>{passwordOpen&&<form className="cs-password-form" onSubmit={changePassword}><input required type="password" autoComplete="current-password" value={passwords.current_password} onChange={(event)=>setPasswords({...passwords,current_password:event.target.value})} placeholder="Contraseña actual"/><input required minLength="8" type="password" autoComplete="new-password" value={passwords.new_password} onChange={(event)=>setPasswords({...passwords,new_password:event.target.value})} placeholder="Nueva contraseña (mínimo 8 caracteres)"/><button disabled={saving}>Guardar contraseña</button></form>}</>}<button className="cs-logout-profile" type="button" onClick={() => { window.google?.accounts?.id?.disableAutoSelect?.(); onLogout?.(); }}><LogOut/> Cerrar sesión</button></section>
  </section>;
}

function BusinessConfiguration({ data, scopeBody, reload, setError, user, isStudioAdmin, sectionLoading, onSaved }) {
  return <section className="cs-business-page">
    <div className="cs-section-heading"><span className="cs-eyebrow">Tu negocio</span><h1>Configuración</h1><p>Administra la identidad, las marcas y las preferencias de tus creaciones.</p></div>
    <SettingsView data={data} scopeBody={scopeBody} onSaved={onSaved} setError={setError} user={user}/>
    <div className="cs-settings-divider"><SocialConnectionsSettings user={user}/></div>
    <div className="cs-settings-divider"><LogosView data={data} scopeBody={scopeBody} reload={reload} setError={setError}/></div>
    {isStudioAdmin && <div className="cs-settings-divider">{sectionLoading && !data.users?.length ? <SectionSkeleton title="Cargando usuarios y transferencias"/> : <UsersView data={data} scopeBody={scopeBody} reload={reload} setError={setError}/>}</div>}
    {isStudioAdmin && <div className="cs-settings-divider">{sectionLoading && !data.sellers?.length ? <SectionSkeleton title="Cargando equipo comercial"/> : <SellersView data={data} scopeBody={scopeBody} reload={reload} setError={setError}/>}</div>}
  </section>;
}

function PlansModal({ plans, initialPlan, account, settings, transfer, onClose, onRequested }) {
  const normalizedPlans = plans.map((plan) => ({ ...plan, photos: Number(plan.photos ?? plan.monthly_limit), days: Number(plan.days ?? plan.duration_days) }));
  const [selected, setSelected] = useState(normalizedPlans.find((plan) => plan.id === initialPlan) || normalizedPlans[1] || normalizedPlans[0]);
  const [form, setForm] = useState({ business_name: settings?.brand_name || account?.business_name || '', whatsapp: settings?.contact_whatsapp || '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [onClose]);
  async function requestPlan(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { setResult(await api('/content-studio/plan-orders', { method:'POST', body:JSON.stringify({ plan_id:selected.id, ...form }) })); }
    catch(err){ setError(err.message); }
    finally{ setBusy(false); }
  }
  const bank = result?.transfer || transfer || {};
  return <div className="cs-plan-overlay" role="dialog" aria-modal="true" aria-label="Elegir plan"><section><button className="cs-plan-close" type="button" onClick={onClose}><X/></button>{!result ? <><span className="cs-eyebrow">Planes de Estudios Creativos</span><h1>Elige cómo quieres crear.</h1><p>Tu cuenta permanece activa. Los créditos se agregan cuando confirmemos la transferencia.</p><div className="cs-plan-options">{normalizedPlans.map((plan) => <button type="button" key={plan.id} className={selected?.id===plan.id?'selected':''} onClick={() => setSelected(plan)}><span>{plan.name}</span><strong>${Number(plan.price)%1===0?plan.price:Number(plan.price).toFixed(2)}</strong><small>{plan.photos} imágenes · {plan.days} días</small>{selected?.id===plan.id&&<Check/>}</button>)}</div><form onSubmit={requestPlan}><div><label>Negocio<input required value={form.business_name} onChange={(event)=>setForm({...form,business_name:event.target.value})} placeholder="Nombre de tu negocio"/></label><label>WhatsApp<input required inputMode="tel" value={form.whatsapp} onChange={(event)=>setForm({...form,whatsapp:event.target.value})} placeholder="098 376 3419"/></label></div><small>La confirmación se enviará a {account?.email || 'tu correo'}.</small>{error&&<div className="cs-plan-error">{error}</div>}<button disabled={busy}>{busy?'Creando solicitud…':`Solicitar ${selected?.photos || 0} imágenes`}</button></form></> : <div className="cs-plan-success"><span><Check/></span><small>SOLICITUD {result.order.order_number}</small><h1>Realiza tu transferencia.</h1><p>Cuando la confirmemos, tus {result.order.monthly_limit} créditos aparecerán automáticamente.</p><dl><div><dt>Total</dt><dd>${Number(result.order.amount).toFixed(2)}</dd></div><div><dt>Banco</dt><dd>{bank.bank_name || 'Datos por confirmar'}</dd></div>{bank.beneficiary&&<div><dt>Beneficiario</dt><dd>{bank.beneficiary}</dd></div>}{bank.account_number&&<div><dt>Cuenta</dt><dd>{bank.account_number} {bank.account_type}</dd></div>}</dl>{bank.whatsapp_url&&<a href={bank.whatsapp_url} target="_blank" rel="noreferrer"><MessageCircle/> Enviar comprobante por WhatsApp</a>}<button type="button" onClick={() => onRequested?.(result.order)}>Listo</button></div>}</section></div>;
}

function UsersView({ data, scopeBody, reload, setError }) {
  const [form, setForm] = useState({ name: '', business_name: '', username: '', password: '', package_id: 'emprendedor' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [references, setReferences] = useState({});
  const selectedPackage = PLAN_PACKAGES.find((item) => item.id === form.package_id) || PLAN_PACKAGES[1];

  async function createUser(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api('/content-studio/users', {
        method: 'POST',
        body: JSON.stringify({
          ...scopeBody,
          name: form.name,
          business_name: form.business_name || form.name,
          username: form.username,
          password: form.password,
          plan_name: selectedPackage.name,
          monthly_limit: selectedPackage.photos,
          duration_days: selectedPackage.days
        })
      });
      setMessage(`Cuenta creada. Usuario: ${form.username} · Contraseña: ${form.password}`);
      setForm({ name: '', business_name: '', username: '', password: '', package_id: 'emprendedor' });
      await reload();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function updateUser(item, changes, successMessage) {
    try {
      await api(`/content-studio/users/${item.id}`, {
        method: 'PUT', body: JSON.stringify({ ...scopeBody, ...changes })
      });
      setMessage(successMessage);
      await reload();
    } catch (err) { setError(err.message); }
  }

  async function renewUser(item) {
    const plan = PLAN_PACKAGES.find((candidate) => candidate.photos === Number(item.monthly_limit)) || PLAN_PACKAGES[1];
    await updateUser(item, {
      monthly_limit: plan.photos,
      plan_name: plan.name,
      renew_days: plan.days,
      status: 'active'
    }, `Plan de ${item.name} renovado por ${plan.days} días.`);
  }

  async function processOrder(order, action) {
    if (action === 'confirm' && !String(references[order.id] || '').trim()) {
      setError('Ingresa la referencia bancaria antes de confirmar el pago');
      return;
    }
    try {
      await api(`/content-studio/plan-orders/${order.id}/${action}`, {
        method: 'POST', body: JSON.stringify({ ...scopeBody, reference: references[order.id] || '' })
      });
      setMessage(action === 'confirm' ? `Pago ${order.order_number} confirmado y cuenta activada.` : `Solicitud ${order.order_number} rechazada.`);
      await reload();
    } catch (err) { setError(err.message); }
  }

  const pendingOrders = (data.plan_orders || []).filter((item) => item.status === 'pending');

  return <section className="cs-users-page">
    <div className="cs-section-heading"><span className="cs-eyebrow">Administración</span><h1>Usuarios y planes</h1><p>Crea cuentas, controla sus fotos disponibles y renueva su acceso.</p></div>
    {message && <div className="cs-admin-message"><Check size={18} /><span>{message}</span></div>}
    <section className="cs-transfer-requests"><div className="cs-user-list-heading"><div><strong>Transferencias por confirmar</strong><small>{pendingOrders.length ? `${pendingOrders.length} ${pendingOrders.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'} listas para revisar` : 'No hay transferencias pendientes'}</small></div><span className={pendingOrders.length ? 'cs-pending-count' : 'cs-pending-count clear'}>{pendingOrders.length}</span></div>{pendingOrders.length ? pendingOrders.map((order) => <article key={order.id}><div><span>{order.order_number}</span><strong>{order.customer_name}</strong><small>{order.business_name} · {order.email} · {order.whatsapp}</small>{order.seller_name && <em>Venta registrada por {order.seller_name} (@{order.seller_username})</em>}</div><div><strong>${Number(order.amount).toFixed(2)}</strong><small>{order.plan_name}: {order.monthly_limit} fotos / {order.duration_days} días</small></div><label>Referencia bancaria<input value={references[order.id] || ''} onChange={(event) => setReferences({ ...references, [order.id]: event.target.value })} placeholder="Número o referencia" /></label><div><button type="button" onClick={() => processOrder(order, 'confirm')}>Confirmar y activar</button><button type="button" onClick={() => processOrder(order, 'reject')}>Rechazar</button></div></article>) : <div className="cs-transfer-empty"><Check size={20}/><span>Cuando un cliente o vendedor registre una venta por transferencia, aparecerá aquí para confirmarla.</span></div>}</section>
    <div className="cs-users-layout">
      <form className="cs-user-form cs-card" onSubmit={createUser}>
        <div className="cs-user-form-title"><span><UserPlus size={21} /></span><div><h2>Crear usuario</h2><p>Entrega acceso con uno de tus planes.</p></div></div>
        <label>Nombre completo<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Norma Llamuca" /></label>
        <label>Nombre del negocio<input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} placeholder="Puede ser igual al nombre" /></label>
        <label>Usuario<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/\s+/g, '.') })} placeholder="nombre.apellido" /></label>
        <label>Contraseña temporal<input required minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>
        <label>Plan<select value={form.package_id} onChange={(event) => setForm({ ...form, package_id: event.target.value })}>{PLAN_PACKAGES.map((plan) => <option key={plan.id} value={plan.id}>{plan.photos} fotos · ${Number(plan.price) % 1 === 0 ? plan.price : Number(plan.price).toFixed(2)} · {plan.days} días</option>)}</select></label>
        <div className="cs-plan-preview"><Crown size={19} /><div><strong>{selectedPackage.name}</strong><small>{selectedPackage.photos} fotos durante {selectedPackage.days} días</small></div><b>${selectedPackage.price}</b></div>
        <button className="cs-primary" disabled={saving}>{saving ? 'Creando cuenta...' : <><UserPlus size={18} /> Crear cuenta</>}</button>
      </form>

      <div className="cs-user-list">
        <div className="cs-user-list-heading"><div><strong>{data.users?.length || 0} usuarios</strong><small>Clientes registrados en Estudios Creativos</small></div></div>
        {(data.users || []).map((item) => {
          const available = Math.max(0, Number(item.monthly_limit || 0) - Number(item.usage || 0));
          const active = item.status === 'active' && item.subscription_status !== 'inactive';
          return <article key={item.id} className={!active ? 'inactive' : ''}>
            <div className="cs-user-avatar">{String(item.name || 'U').slice(0, 1).toUpperCase()}</div>
            <div className="cs-user-identity"><strong>{item.name}</strong><span>@{item.username}</span><small>{item.business_name}</small></div>
            <div className="cs-user-quota"><strong>{available} disponibles</strong><span>{item.usage || 0} de {item.monthly_limit} usadas</span><i><b style={{ width: `${Math.min(100, (Number(item.usage || 0) / Math.max(1, Number(item.monthly_limit || 1))) * 100)}%` }} /></i></div>
            <div className="cs-user-validity"><span className={active ? 'active' : 'inactive'}>{active ? 'Activo' : 'Inactivo'}</span><small>Hasta {item.paid_until ? new Date(`${item.paid_until}T12:00:00`).toLocaleDateString('es-EC') : 'sin fecha'}</small></div>
            <div className="cs-user-actions"><button type="button" onClick={() => renewUser(item)}>Renovar plan</button><button type="button" onClick={() => updateUser(item, { status: item.status === 'active' ? 'inactive' : 'active' }, `${item.name} ${item.status === 'active' ? 'fue desactivado' : 'fue activado'}.`)}>{item.status === 'active' ? 'Desactivar' : 'Activar'}</button></div>
          </article>;
        })}
        {!data.users?.length && <div className="cs-empty-large"><UsersRound size={38} /><h3>Aún no hay usuarios</h3><p>Crea la primera cuenta desde el formulario.</p></div>}
      </div>
    </div>
  </section>;
}

function SellersView({ data, scopeBody, reload, setError }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const period = data.seller_period;
  async function createSeller(event) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      await api('/content-studio/sellers', { method: 'POST', body: JSON.stringify({ ...scopeBody, ...form }) });
      setMessage(`Vendedor creado: ${form.username}`);
      setForm({ name: '', username: '', password: '', email: '', phone: '' });
      await reload();
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  async function updateSeller(seller) {
    try {
      await api(`/content-studio/sellers/${seller.id}`, { method: 'PUT', body: JSON.stringify({ ...scopeBody, status: seller.status === 'active' ? 'inactive' : 'active' }) });
      await reload();
    } catch (error) { setError(error.message); }
  }
  const money = (value) => `$${Number(value || 0).toFixed(2)}`;
  return <section className="cs-sellers-page">
    <div className="cs-section-heading"><span className="cs-eyebrow">Equipo comercial</span><h1>Vendedores y bono quincenal</h1><p>Los incentivos se calculan solo con clientes pagados, activados y que ya usan el estudio.</p></div>
    {period && <div className="cs-seller-goals"><article><CalendarCheck/><div><small>ACTIVIDAD MÍNIMA</small><strong>{period.goals.activity.total} registros</strong><span>{period.goals.activity.visits} visitas · {period.goals.activity.demos} demos · {period.goals.activity.followups} seguimientos</span></div></article><article><TrendingUp/><div><small>VENTA AFIANZADA</small><strong>{money(period.goals.sales)}</strong><span>mínimo por quincena</span></div></article><article><Crown/><div><small>BONO QUINCENAL</small><strong>{money(period.goals.bonus)}</strong><span>{period.goals.upper_clients} clientes de $39 o $69</span></div></article></div>}
    {message && <div className="cs-admin-message"><Check size={18}/><span>{message}</span></div>}
    <div className="cs-sellers-layout">
      <form className="cs-user-form cs-card" onSubmit={createSeller}><div className="cs-user-form-title"><span><BriefcaseBusiness size={21}/></span><div><h2>Crear vendedor</h2><p>Podrá registrar visitas, pruebas, seguimientos y ventas.</p></div></div><label>Nombre completo<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Andrea Vendedor"/></label><label>Usuario<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/\s+/g, '.') })} placeholder="andrea.ventas"/></label><label>Contraseña temporal<input required minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres"/></label><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="opcional@correo.com"/></label><label>WhatsApp<input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="098 376 3419"/></label><button className="cs-primary" disabled={saving}>{saving ? 'Creando...' : <><UserPlus size={18}/> Crear vendedor</>}</button></form>
      <div className="cs-seller-list">{(data.sellers || []).length ? data.sellers.map((seller) => <article key={seller.id} className={seller.status !== 'active' ? 'inactive' : ''}><div className="cs-user-avatar">{seller.name.slice(0, 1).toUpperCase()}</div><div><strong>{seller.name}</strong><small>@{seller.username}</small><em>{seller.status === 'active' ? 'Activo' : 'Inactivo'}</em></div><div><b>{money(seller.charged_total)}</b><small>ventas afianzadas</small><span>{seller.affianzadas} clientes · {seller.upper_clients} superiores</span></div><div><b>{money(seller.total_earned)}</b><small>{seller.bonus_unlocked ? 'Bono $100 desbloqueado' : 'Incentivos individuales'}</small><span>{seller.activities}/{period?.goals.activity.total || 12} actividades</span></div><button type="button" onClick={() => updateSeller(seller)}>{seller.status === 'active' ? 'Desactivar' : 'Activar'}</button></article>) : <div className="cs-empty-large"><BriefcaseBusiness size={38}/><h3>Aún no hay vendedores</h3><p>Crea la primera cuenta para empezar a registrar actividad comercial.</p></div>}</div>
    </div>
  </section>;
}

function ProfileView({ data, scopeBody, reload, setError, canManageLogos, user, onSaved }) {
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  return <section className="cs-profile-page">
    <div className="cs-profile-hero">
      <div><span className="cs-eyebrow">Perfil y configuración</span><h1>Tu espacio creativo</h1><p>Administra las marcas que puedes usar y revisa la información de tu plan.</p></div>
      <div className="cs-profile-plan"><span><Crown size={22} /></span><div><small>{data.settings?.plan_name}</small><strong>{available} créditos disponibles</strong><em>{data.subscription?.active ? 'Plan activo' : 'Plan inactivo'}</em></div></div>
    </div>
    {canManageLogos ? <LogosView data={data} scopeBody={scopeBody} reload={reload} setError={setError} /> : <ReadOnlyLogos data={data} />}
    <div className="cs-profile-settings"><SettingsView data={data} scopeBody={scopeBody} onSaved={onSaved} setError={setError} user={user} /></div>
  </section>;
}

function ReadOnlyLogos({ data }) {
  return <section className="cs-library cs-readonly-logos">
    <div className="cs-section-heading"><span className="cs-eyebrow">Identidad visual</span><h1>Marcas disponibles</h1><p>Estas son las marcas que puedes elegir al crear una imagen.</p></div>
    {data.logos?.length ? <div className="cs-brand-profile-grid">{data.logos.map((logo) => <article key={logo.id}><img src={logo.image_data} alt={logo.name} /><strong>{logo.name}</strong></article>)}</div> : <div className="cs-empty-large"><ImageIcon size={36} /><h3>No hay logos guardados</h3><p>Puedes seguir creando contenido sin marca.</p></div>}
  </section>;
}

function LogosView({ data, scopeBody, reload, setError }) {
  const [draft, setDraft] = useState({ name: '', image: '' });
  const [saving, setSaving] = useState(false);
  const logoInputRef = useRef(null);
  async function selectFile(file) { try { const image = await imageFileToData(file, 1400, 0.9); setDraft((current) => ({ ...current, image })); } catch (err) { setError(err.message); } }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try { await api('/content-studio/logos', { method: 'POST', body: JSON.stringify({ ...scopeBody, ...draft }) }); setDraft({ name: '', image: '' }); await reload(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function remove(id) { try { await api(`/content-studio/logos/${id}${scopeBody.establishment_id ? `?establishment_id=${scopeBody.establishment_id}` : ''}`, { method: 'DELETE' }); await reload(); } catch (err) { setError(err.message); } }
  return <section className="cs-library"><div className="cs-section-heading"><span className="cs-eyebrow">Tus marcas</span><h1>Marcas y logos</h1><p>Agrega o elimina los logos que aparecerán como opciones al crear contenido.</p></div><div className="cs-library-layout"><form className="cs-reference-form cs-card" onSubmit={save}><h2>Agregar una marca</h2><input ref={logoInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onClick={(event) => { event.currentTarget.value = ''; }} onChange={(event) => selectFile(event.target.files?.[0])} /><button className="cs-ref-upload" type="button" onClick={() => logoInputRef.current?.click()}>{draft.image ? <img src={draft.image} alt="Logo seleccionado" /> : <><Upload size={23} /><strong>Seleccionar logo</strong><small>JPG, PNG o WEBP</small></>}</button>{draft.image && <button className="cs-change-reference" type="button" onClick={() => logoInputRef.current?.click()}><Upload size={16} /> Cambiar logo</button>}<label>Nombre de la marca<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Marjorie Botas" /></label><button className="cs-primary" disabled={saving || !draft.image || !draft.name.trim()}>{saving ? 'Guardando...' : <><Plus size={18} /> Guardar logo</>}</button></form><div className="cs-reference-list">{data.logos?.length ? data.logos.map((logo) => <article key={logo.id}><img src={logo.image_data} alt={logo.name} /><div><span>Marca</span><strong>{logo.name}</strong><p>Disponible para nuevas creaciones</p></div><button title="Eliminar logo" type="button" onClick={() => remove(logo.id)}><Trash2 size={17} /></button></article>) : <div className="cs-empty-large"><ImageIcon size={36} /><h3>No hay logos guardados</h3><p>Puedes crear sin logo o agregar una marca desde este formulario.</p></div>}</div></div></section>;
}

function HistoryView({ data, scopeBody, reload, setError }) {
  async function remove(id) { try { await api(`/content-studio/generations/${id}${scopeBody.establishment_id ? `?establishment_id=${scopeBody.establishment_id}` : ''}`, { method: 'DELETE' }); await reload(); } catch (err) { setError(err.message); } }
  const pending = data.generations.filter((item) => item.status === 'processing');
  const completed = data.generations.filter((item) => item.status === 'completed');
  return <section>
    <div className="cs-section-heading"><span className="cs-eyebrow">Tus resultados</span><h1>Mis diseños</h1><p>Todo tu contenido terminado, listo para volver a descargar.</p></div>
    {pending.length > 0 && <div className="cs-queue-banner" role="status"><span><Sparkles size={20} /></span><div><strong>{pending.length === 1 ? 'Tu imagen sigue en proceso' : `${pending.length} imágenes siguen en proceso`}</strong><small>Puedes cambiar de sección, cerrar o recargar la página. Aparecerá aquí cuando termine.</small></div></div>}
    {completed.length ? <div className="cs-history-grid">{completed.map((item) => <article key={item.id}><img src={item.output_image_data} alt={item.product_name || item.brand_name || 'Diseño'} /><div><span>{PRESET_NAMES[item.preset]}</span><strong>{item.product_name || item.brand_name || 'Creación'}</strong><small>{new Date(`${item.created_at.replace(' ', 'T')}`).toLocaleDateString('es-EC')}</small></div><div className="cs-history-actions"><ContentStudioSocialPublisher compact generation={item}/><button onClick={() => downloadDataImage(item.output_image_data, `${item.brand_name || 'contenido'}-${item.id}.webp`)}><Download size={17} /></button><button onClick={() => remove(item.id)}><Trash2 size={17} /></button></div></article>)}</div> : <div className="cs-empty-large"><LayoutGrid size={38} /><h3>Aquí aparecerán tus diseños</h3><p>{pending.length ? 'Tu primera imagen aparecerá aquí en cuanto termine.' : 'Crea tu primera imagen profesional para verla en esta galería.'}</p></div>}
  </section>;
}

function SettingsView({ data, scopeBody, onSaved, setError, user }) {
  const [form, setForm] = useState({ brand_name: data.settings?.brand_name || '', brand_tone: data.settings?.brand_tone || 'premium', plan_name: data.settings?.plan_name || 'Profesional', monthly_limit: data.settings?.monthly_limit || 80 });
  const [saving, setSaving] = useState(false);
  async function save(event) { event.preventDefault(); setSaving(true); try { const settings = await api('/content-studio/settings', { method: 'PUT', body: JSON.stringify({ ...scopeBody, ...form }) }); onSaved(settings); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Datos del negocio</span><h1>Identidad</h1><p>Configura el nombre y la personalidad visual de tu negocio.</p></div><form className="cs-settings-card cs-card" onSubmit={save}><label>Nombre de la marca<input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder="Nombre que debe reconocer el estudio" /></label><label>Personalidad visual<select value={form.brand_tone} onChange={(e) => setForm({ ...form, brand_tone: e.target.value })}><option value="premium">Elegante y premium</option><option value="warm">Cercana y cálida</option><option value="modern">Moderna y limpia</option><option value="bold">Audaz y colorida</option></select></label>{user?.role === 'supreme' && <><label>Nombre del plan<input value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} /></label><label>Límite mensual<input type="number" min="1" max="10000" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} /></label></>}<div className="cs-subscription-note"><Sparkles size={20} /><div><strong>Contacto por creación</strong><p>Agrega WhatsApp o ubicación solo cuando lo necesites desde Opciones avanzadas.</p></div></div><button className="cs-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar datos'}</button></form></section>;
}
