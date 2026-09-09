import React, { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronRight, Crown, Download, EyeOff, Gem, Home, Image as ImageIcon,
  LayoutGrid, LogOut, Plus, Settings, Share2, ShoppingBag, Sparkles, Tag,
  Trash2, Upload, UserRound, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio.css';

const PRESET_ICONS = { editorial: UserRound, catalog: ShoppingBag, social: Share2, detail: Gem };
const PRESET_NAMES = { editorial: 'Editorial', catalog: 'Catálogo', social: 'Post social', detail: 'Detalle' };
const emptyForm = { preset: 'editorial', logo_id: 'none', social_format: 'post', social_style: 'editorial' };

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function progressForElapsed(seconds) {
  if (seconds < 4) return { percent: 12, label: 'Preparando tus imágenes' };
  if (seconds < 15) return { percent: 28, label: 'Analizando el producto y la marca' };
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

  const scopeQuery = scopeId ? `?establishment_id=${scopeId}` : '';
  const scopeBody = scopeId ? { establishment_id: Number(scopeId) } : {};

  async function load() {
    const response = await api(`/content-studio/bootstrap${scopeQuery}`);
    setData(response);
    setForm((current) => ({ ...current, logo_id: current.logo_id === 'none' || response.logos?.some((logo) => Number(logo.id) === Number(current.logo_id)) ? current.logo_id : 'none' }));
  }

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [scopeId]);

  const selectedPreset = data?.presets?.find((item) => item.id === form.preset);
  const usagePercent = Math.min(100, ((data?.usage || 0) / (data?.settings?.monthly_limit || 1)) * 100);
  const canManageLogos = data?.can_manage_logos === true;

  async function chooseProduct(file) {
    setError('');
    try { setProductImage(await imageFileToData(file)); setResult(null); }
    catch (err) { setError(err.message); }
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
      const generationId = response.generation?.id;
      if (!generationId) throw new Error('No se pudo iniciar la creación');
      const startedAt = Date.now();
      let completed;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await wait(2500);
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        setGenerationProgress(progressForElapsed(elapsed));
        const statusResponse = await api(`/content-studio/generations/${generationId}${scopeQuery}`);
        if (statusResponse.generation?.status === 'failed') {
          throw new Error(statusResponse.generation.error_message || 'No se pudo crear la imagen');
        }
        if (statusResponse.generation?.status === 'completed') {
          completed = statusResponse;
          break;
        }
      }
      if (!completed) throw new Error('La creación está tardando más de lo esperado. Puedes revisarla en Mis diseños en unos minutos.');
      setGenerationProgress({ percent: 100, label: 'Tu imagen está lista' });
      setResult(completed.generation);
      setData((current) => ({ ...current, usage: completed.usage, generations: [completed.generation, ...current.generations.filter((item) => item.id !== completed.generation.id)].slice(0, 24) }));
      setNotice('Tu imagen profesional está lista');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); window.setTimeout(() => setGenerationProgress({ percent: 0, label: '' }), 700); }
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
            <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}><Sparkles size={17} /> Crear</button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><LayoutGrid size={17} /> Historial</button>
            <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><UserRound size={17} /> Perfil</button>
          </nav>
          <button className="cs-logout" type="button" onClick={onLogout}><LogOut size={17} /> Salir</button>
        </header>
      )}

      <div className="cs-page">
        {embedded && (
          <div className="cs-embedded-nav">
            {[['create', 'Crear', Sparkles], ['history', 'Historial', LayoutGrid], ['profile', 'Perfil', UserRound]].map(([key, label, Icon]) => (
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
        {tab === 'profile' && <ProfileView data={data} scopeBody={scopeBody} reload={load} setError={setError} canManageLogos={canManageLogos} user={user} onSaved={(settings) => setData((current) => ({ ...current, settings }))} />}
      </div>

      {!embedded && (
        <nav className="cs-mobile-nav" aria-label="Navegación principal">
          <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}><Home size={21} /><span>Crear</span></button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><LayoutGrid size={21} /><span>Historial</span></button>
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><UserRound size={21} /><span>Perfil</span></button>
        </nav>
      )}
    </div>
  );
}

function CreateView({ data, form, setForm, productImage, inputRef, chooseProduct, selectedPreset, generate, generating, generationProgress, result, newCreation, usagePercent, goToHistory, goToProfile }) {
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
          <div className="cs-result-meta">{result.brand_name && <span>{result.brand_name}</span>}<span>{PRESET_NAMES[result.preset]}</span><span>{result.aspect_ratio}</span></div>
        </div>
        <div className="cs-result-image"><img src={result.output_image_data} alt="Contenido generado" /></div>
      </section>
    );
  }
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  const firstLogo = data.logos?.[0];
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
          </section>

          <section className="cs-card cs-content-card">
            <div className="cs-card-heading"><div><span className="cs-eyebrow">Paso 2</span><h2>Crear en base a</h2></div><p>Elige el tipo de contenido que necesitas</p></div>
            <div className="cs-preset-grid">
              {data.presets.map((preset) => {
                const PresetIcon = PRESET_ICONS[preset.id] || Sparkles;
                return <button type="button" key={preset.id} className={`cs-preset-card cs-preset-${preset.id} ${form.preset === preset.id ? 'selected' : ''}`} onClick={() => setForm({ ...form, preset: preset.id })}>
                  <span className="cs-preset-thumb">{productImage ? <img src={productImage} alt="" /> : <PresetIcon size={48} strokeWidth={1.35} />}</span>
                  <span className="cs-preset-copy"><i><PresetIcon size={17} /></i><strong>{preset.name}</strong><small>{preset.description}</small></span>
                  <ChevronRight size={19} />
                </button>;
              })}
            </div>
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
          </section>
        </div>

        <aside className="cs-summary">
          <div className="cs-summary-visual">{productImage ? <img src={productImage} alt="Vista previa" /> : <ImageIcon size={36} />}</div>
          <span>Tu creación</span><h3>{selectedPreset?.name}</h3><p>{selectedPreset?.description}</p>
          <ul><li><Check size={15} /> Producto fiel al original</li><li><Check size={15} /> Acabado fotográfico realista</li><li><Check size={15} /> Alta calidad para publicar</li></ul>
          <button className="cs-generate" disabled={!productImage || generating || !data.generation_available}>{generating ? <><i /> Creando tu imagen...</> : <>Continuar <ChevronRight size={19} /></>}</button>
          {generating && <div className="cs-generation-progress" role="status" aria-live="polite"><div><i style={{ width: `${generationProgress.percent}%` }} /></div><span>{generationProgress.label}</span><strong>{generationProgress.percent}%</strong><small>Puedes dejar esta página abierta mientras terminamos.</small></div>}
          {!data.generation_available && <small className="cs-api-note">{data.subscription?.active ? 'La interfaz está lista. Falta conectar la clave de OpenAI en el servidor.' : 'Tu plan necesita estar activo para crear imágenes.'}</small>}
        </aside>
      </div>
    </form>
  );
}

function ProfileView({ data, scopeBody, reload, setError, canManageLogos, user, onSaved }) {
  const available = Math.max(0, Number(data.settings?.monthly_limit || 0) - Number(data.usage || 0));
  return <section className="cs-profile-page">
    <div className="cs-profile-hero">
      <div><span className="cs-eyebrow">Perfil y configuración</span><h1>Tu espacio creativo</h1><p>Administra las marcas que puedes usar y revisa la información de tu plan.</p></div>
      <div className="cs-profile-plan"><span><Crown size={22} /></span><div><small>{data.settings?.plan_name}</small><strong>{available} créditos disponibles</strong><em>{data.subscription?.active ? 'Plan activo' : 'Plan inactivo'}</em></div></div>
    </div>
    {canManageLogos ? <LogosView data={data} scopeBody={scopeBody} reload={reload} setError={setError} /> : <ReadOnlyLogos data={data} />}
    {user?.role === 'supreme' && <div className="cs-profile-settings"><SettingsView data={data} scopeBody={scopeBody} onSaved={onSaved} setError={setError} user={user} /></div>}
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
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Tus resultados</span><h1>Mis diseños</h1><p>Todo tu contenido terminado, listo para volver a descargar.</p></div>{data.generations.filter((item) => item.status === 'completed').length ? <div className="cs-history-grid">{data.generations.filter((item) => item.status === 'completed').map((item) => <article key={item.id}><img src={item.output_image_data} alt={item.brand_name || 'Diseño'} /><div><span>{PRESET_NAMES[item.preset]}</span><strong>{item.brand_name || 'Creación'}</strong><small>{new Date(`${item.created_at.replace(' ', 'T')}`).toLocaleDateString('es-EC')}</small></div><div className="cs-history-actions"><button onClick={() => downloadDataImage(item.output_image_data, `${item.brand_name || 'contenido'}-${item.id}.webp`)}><Download size={17} /></button><button onClick={() => remove(item.id)}><Trash2 size={17} /></button></div></article>)}</div> : <div className="cs-empty-large"><LayoutGrid size={38} /><h3>Aquí aparecerán tus diseños</h3><p>Crea tu primera imagen profesional para verla en esta galería.</p></div>}</section>;
}

function SettingsView({ data, scopeBody, onSaved, setError, user }) {
  const [form, setForm] = useState({ brand_name: data.settings?.brand_name || '', brand_tone: data.settings?.brand_tone || 'premium', plan_name: data.settings?.plan_name || 'Profesional', monthly_limit: data.settings?.monthly_limit || 80 });
  const [saving, setSaving] = useState(false);
  async function save(event) { event.preventDefault(); setSaving(true); try { const settings = await api('/content-studio/settings', { method: 'PUT', body: JSON.stringify({ ...scopeBody, ...form }) }); onSaved(settings); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Identidad del negocio</span><h1>Tu marca</h1><p>Estos datos se aplican automáticamente a cada creación.</p></div><form className="cs-settings-card cs-card" onSubmit={save}><label>Nombre de la marca<input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder="Nombre que debe reconocer el estudio" /></label><label>Personalidad visual<select value={form.brand_tone} onChange={(e) => setForm({ ...form, brand_tone: e.target.value })}><option value="premium">Elegante y premium</option><option value="warm">Cercana y cálida</option><option value="modern">Moderna y limpia</option><option value="bold">Audaz y colorida</option></select></label>{user?.role === 'supreme' && <><label>Nombre del plan<input value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} /></label><label>Límite mensual<input type="number" min="1" max="10000" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} /></label></>}<div className="cs-subscription-note"><Sparkles size={20} /><div><strong>Preparado para suscripciones</strong><p>El sistema ya mide cada creación por mes y respeta el límite asignado al plan.</p></div></div><button className="cs-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar identidad'}</button></form></section>;
}
