import React, { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, Crown, Download, EyeOff, Gem, Image as ImageIcon,
  LayoutGrid, LogOut, MapPin, MessageCircle, Plus, Settings, Share2, ShoppingBag, Sparkles, Tag,
  Trash2, Upload, UserPlus, UserRound, UsersRound, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio.css';

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
const emptyForm = { preset: 'editorial', editorial_subject: 'female', logo_id: 'none', include_contact: false, social_format: 'post', social_style: 'editorial', product_name: '', product_features: '', creative_instruction: '' };
const PLAN_PACKAGES = [
  { id: 'inicio', name: 'Inicio', photos: 10, price: 9.5, days: 8 },
  { id: 'emprendedor', name: 'Emprendedor', photos: 25, price: 20, days: 15 },
  { id: 'negocio', name: 'Negocio', photos: 60, price: 35, days: 30 },
  { id: 'pro', name: 'Pro', photos: 150, price: 60, days: 30 }
];

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

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

export default function ContentStudioApp({ user, onLogout, embedded = false, establishmentId }) {
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
      logo_id: current.logo_id === 'none' || response.logos?.some((logo) => Number(logo.id) === Number(current.logo_id)) ? current.logo_id : 'none',
      include_contact: Boolean(current.include_contact && (response.settings?.contact_whatsapp || response.settings?.contact_location))
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
            <div><strong>ESTUDIO CREATIVO</strong><small>by Promoters</small></div>
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

function CreateView({ data, form, setForm, productImage, inputRef, chooseProduct, selectedPreset, generate, generating, generationProgress, result, newCreation, usagePercent, goToHistory, goToProfile }) {
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
        </div>
        <div className="cs-result-image"><img src={result.output_image_data} alt="Contenido generado" /></div>
      </section>
    );
  }
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  const firstLogo = data.logos?.[0];
  const hasContact = Boolean(data.settings?.contact_whatsapp || data.settings?.contact_location);
  return (
    <form onSubmit={generate}>
      <section className="cs-hero cs-create-heading">
        <div><span className="cs-eyebrow">Estudio creativo con IA</span><h1>Crear contenido</h1><p>Convierte tus productos en imágenes profesionales listas para publicar.</p></div>
        <button className="cs-credit-card" type="button" onClick={goToHistory}>
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
                <label><strong>Instrucción especial</strong><textarea maxLength="180" value={form.creative_instruction} onChange={(event) => setForm({ ...form, creative_instruction: event.target.value })} placeholder="Ej. Que se vea cálido, elegante y listo para regalar" /><small>Una idea sencilla sobre el ambiente, composición o tono.</small></label>
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
            {form.preset === 'social' && <div className="cs-social-options"><div><strong>Formato</strong><div className="cs-choice-row">{(data.social_formats || []).map((format) => <button type="button" key={format.id} className={form.social_format === format.id ? 'selected' : ''} onClick={() => setForm({ ...form, social_format: format.id })}><span>{format.id === 'post' ? '▣' : '▯'}</span><div><b>{format.id === 'post' ? 'Post' : 'Historia'}</b><small>{format.width} × {format.height}</small></div><Check size={16} /></button>)}</div></div><div><strong>Estilo del diseño</strong><div className="cs-social-style-grid">{(data.social_styles || []).map((style) => <button type="button" key={style.id} className={form.social_style === style.id ? 'selected' : ''} onClick={() => setForm({ ...form, social_style: style.id })}><b>{style.name}</b><small>{style.description}</small>{form.social_style === style.id && <Check size={16} />}</button>)}</div></div></div>}
          </section>

          <section className="cs-card cs-brand-section">
            <div className="cs-card-heading"><div><span className="cs-eyebrow">Paso 3</span><h2>¿Quieres incluir tu marca?</h2></div><p>Tú decides cómo generar tu contenido</p></div>
            <div className="cs-brand-mode">
              <button type="button" className={form.logo_id !== 'none' ? 'selected' : ''} onClick={() => firstLogo && setForm({ ...form, logo_id: firstLogo.id })}>
                <span><Tag size={23} /></span><div><strong>Con marca / logo</strong><small>Incluye tu logo en la imagen</small></div><i>{form.logo_id !== 'none' && <Check size={15} />}</i>
              </button>
              <button type="button" className={form.logo_id === 'none' ? 'selected' : ''} onClick={() => setForm({ ...form, logo_id: 'none' })}>
                <span><EyeOff size={23} /></span><div><strong>Sin marca / logo</strong><small>Genera una imagen limpia</small></div><i>{form.logo_id === 'none' && <Check size={15} />}</i>
              </button>
            </div>
            {form.logo_id !== 'none' && <div className="cs-available-brands"><div><strong>Selecciona una marca</strong><button type="button" onClick={goToProfile}><Settings size={15} /> Administrar logos</button></div><div className="cs-brand-picker">{(data.logos || []).map((logo) => <button type="button" key={logo.id} className={Number(form.logo_id) === Number(logo.id) ? 'selected' : ''} onClick={() => setForm({ ...form, logo_id: logo.id })}><img src={logo.image_data} alt={`Logo ${logo.name}`} /><span>{logo.name}</span>{Number(form.logo_id) === Number(logo.id) && <b><Check size={16} /></b>}</button>)}</div></div>}
            {!firstLogo && <button className="cs-add-first-brand" type="button" onClick={goToProfile}><Plus size={17} /> Agregar tu primer logo desde Perfil</button>}
            <div className="cs-contact-options">
              <div><strong>¿Quieres incluir medios de contacto?</strong><p>Se mostrarán abajo con los datos guardados en tu perfil.</p></div>
              <div className="cs-brand-mode">
                <button type="button" className={form.include_contact ? 'selected' : ''} disabled={!hasContact} onClick={() => hasContact && setForm({ ...form, include_contact: true })}><span><MessageCircle size={22} /></span><div><strong>Con contacto</strong><small>{hasContact ? [data.settings?.contact_whatsapp, data.settings?.contact_location].filter(Boolean).join(' · ') : 'Agrega WhatsApp o ubicación en Perfil'}</small></div><i>{form.include_contact && <Check size={15} />}</i></button>
                <button type="button" className={!form.include_contact ? 'selected' : ''} onClick={() => setForm({ ...form, include_contact: false })}><span><EyeOff size={22} /></span><div><strong>Sin contacto</strong><small>Imagen sin número ni ubicación</small></div><i>{!form.include_contact && <Check size={15} />}</i></button>
              </div>
              {!hasContact && <button className="cs-contact-profile-link" type="button" onClick={goToProfile}><Settings size={15} /> Agregar datos de contacto en Perfil</button>}
            </div>
          </section>
        </div>

        <aside className="cs-summary">
          <div className="cs-summary-visual">{productImage ? <img src={productImage} alt="Vista previa" /> : <ImageIcon size={36} />}</div>
          <span>Tu creación</span><h3>{selectedPreset?.name}</h3><p>{selectedPreset?.description}</p>
          <ul>{form.preset === 'editorial' && <li><UserRound size={15} /> Modelo: {EDITORIAL_SUBJECTS.find((item) => item.id === form.editorial_subject)?.name || 'Femenino'}</li>}{form.include_contact && <li><MessageCircle size={15} /> Contacto incluido al pie</li>}<li><Check size={15} /> Producto fiel al original</li><li><Check size={15} /> Acabado fotográfico realista</li><li><Check size={15} /> Alta calidad para publicar</li></ul>
          <button className="cs-generate" disabled={!productImage || generating || !data.generation_available}>{generating ? <><i /> Creando tu imagen...</> : <>Continuar <ChevronRight size={19} /></>}</button>
          {generating && <div className="cs-generation-progress" role="status" aria-live="polite"><div><i style={{ width: `${generationProgress.percent}%` }} /></div><span>{generationProgress.label}</span><strong>{generationProgress.percent}%</strong><small>Puedes cambiar de sección o recargar la página: la creación continuará en el servidor.</small></div>}
          {!data.generation_available && <small className="cs-api-note">{data.subscription?.active ? 'La interfaz está lista. Falta conectar la clave de OpenAI en el servidor.' : 'Tu plan necesita estar activo para crear imágenes.'}</small>}
        </aside>
      </div>
    </form>
  );
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
    {pendingOrders.length > 0 && <section className="cs-transfer-requests"><div className="cs-user-list-heading"><div><strong>Transferencias por confirmar</strong><small>{pendingOrders.length} {pendingOrders.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'} desde la landing</small></div></div>{pendingOrders.map((order) => <article key={order.id}><div><span>{order.order_number}</span><strong>{order.customer_name}</strong><small>{order.business_name} · {order.email} · {order.whatsapp}</small></div><div><strong>${Number(order.amount).toFixed(2)}</strong><small>{order.plan_name}: {order.monthly_limit} fotos / {order.duration_days} días</small></div><label>Referencia bancaria<input value={references[order.id] || ''} onChange={(event) => setReferences({ ...references, [order.id]: event.target.value })} placeholder="Número o referencia" /></label><div><button type="button" onClick={() => processOrder(order, 'confirm')}>Confirmar y activar</button><button type="button" onClick={() => processOrder(order, 'reject')}>Rechazar</button></div></article>)}</section>}
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
        <div className="cs-user-list-heading"><div><strong>{data.users?.length || 0} usuarios</strong><small>Clientes registrados en Estudio Creativo</small></div></div>
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
    {completed.length ? <div className="cs-history-grid">{completed.map((item) => <article key={item.id}><img src={item.output_image_data} alt={item.product_name || item.brand_name || 'Diseño'} /><div><span>{PRESET_NAMES[item.preset]}</span><strong>{item.product_name || item.brand_name || 'Creación'}</strong><small>{new Date(`${item.created_at.replace(' ', 'T')}`).toLocaleDateString('es-EC')}</small></div><div className="cs-history-actions"><button onClick={() => downloadDataImage(item.output_image_data, `${item.brand_name || 'contenido'}-${item.id}.webp`)}><Download size={17} /></button><button onClick={() => remove(item.id)}><Trash2 size={17} /></button></div></article>)}</div> : <div className="cs-empty-large"><LayoutGrid size={38} /><h3>Aquí aparecerán tus diseños</h3><p>{pending.length ? 'Tu primera imagen aparecerá aquí en cuanto termine.' : 'Crea tu primera imagen profesional para verla en esta galería.'}</p></div>}
  </section>;
}

function SettingsView({ data, scopeBody, onSaved, setError, user }) {
  const [form, setForm] = useState({ brand_name: data.settings?.brand_name || '', brand_tone: data.settings?.brand_tone || 'premium', contact_whatsapp: data.settings?.contact_whatsapp || '', contact_location: data.settings?.contact_location || '', plan_name: data.settings?.plan_name || 'Profesional', monthly_limit: data.settings?.monthly_limit || 80 });
  const [saving, setSaving] = useState(false);
  async function save(event) { event.preventDefault(); setSaving(true); try { const settings = await api('/content-studio/settings', { method: 'PUT', body: JSON.stringify({ ...scopeBody, ...form }) }); onSaved(settings); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Datos del negocio</span><h1>Identidad y contacto</h1><p>Guarda el WhatsApp y la ubicación que podrás incluir al pie de cualquier creación.</p></div><form className="cs-settings-card cs-card" onSubmit={save}><label>Nombre de la marca<input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder="Nombre que debe reconocer el estudio" /></label><label>Personalidad visual<select value={form.brand_tone} onChange={(e) => setForm({ ...form, brand_tone: e.target.value })}><option value="premium">Elegante y premium</option><option value="warm">Cercana y cálida</option><option value="modern">Moderna y limpia</option><option value="bold">Audaz y colorida</option></select></label><label><span className="cs-field-label"><MessageCircle size={15} /> WhatsApp</span><input maxLength="30" value={form.contact_whatsapp} onChange={(e) => setForm({ ...form, contact_whatsapp: e.target.value })} placeholder="Ej. 0983763419" /><small>Se mostrará exactamente como lo escribas.</small></label><label><span className="cs-field-label"><MapPin size={15} /> Ubicación</span><input maxLength="80" value={form.contact_location} onChange={(e) => setForm({ ...form, contact_location: e.target.value })} placeholder="Ej. Centro de Ambato" /><small>Puede ser ciudad, sector o dirección corta.</small></label>{user?.role === 'supreme' && <><label>Nombre del plan<input value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} /></label><label>Límite mensual<input type="number" min="1" max="10000" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} /></label></>}<div className="cs-subscription-note"><Sparkles size={20} /><div><strong>Contacto opcional en cada imagen</strong><p>Guardar estos datos no los agrega automáticamente. Tú eliges “Con contacto” o “Sin contacto” antes de crear.</p></div></div><button className="cs-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar datos'}</button></form></section>;
}
