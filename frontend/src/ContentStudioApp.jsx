import React, { useEffect, useRef, useState } from 'react';
import {
  Check, Download, Image as ImageIcon, LayoutGrid, LogOut,
  Plus, Settings, Sparkles, Trash2, Upload, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio.css';

const PRESET_ICONS = { editorial: '01', catalog: '02', social: '03', detail: '04' };
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
            {canManageLogos && <button className={tab === 'logos' ? 'active' : ''} onClick={() => setTab('logos')}><ImageIcon size={17} /> Logos</button>}
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><LayoutGrid size={17} /> Mis diseños</button>
            {user?.role === 'supreme' && <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings size={17} /> Plan</button>}
          </nav>
          <button className="cs-logout" type="button" onClick={onLogout}><LogOut size={17} /> Salir</button>
        </header>
      )}

      <div className="cs-page">
        {embedded && (
          <div className="cs-embedded-nav">
            {[['create', 'Crear', Sparkles], ...(canManageLogos ? [['logos', 'Logos', ImageIcon]] : []), ['history', 'Mis diseños', LayoutGrid], ...(user?.role === 'supreme' ? [['settings', 'Plan', Settings]] : [])].map(([key, label, Icon]) => (
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
          />
        )}
        {tab === 'logos' && canManageLogos && <LogosView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'history' && <HistoryView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'settings' && user?.role === 'supreme' && <SettingsView data={data} scopeBody={scopeBody} onSaved={(settings) => setData((current) => ({ ...current, settings }))} setError={setError} user={user} />}
      </div>
    </div>
  );
}

function CreateView({ data, form, setForm, productImage, inputRef, chooseProduct, selectedPreset, generate, generating, generationProgress, result, newCreation, usagePercent }) {
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
  return (
    <form onSubmit={generate}>
      <section className="cs-hero">
        <div><span className="cs-eyebrow">Tu equipo creativo, en un clic</span><h1>Convierte una foto sencilla <br />en contenido que vende.</h1><p>Sube el producto, elige el resultado y nosotros cuidamos el realismo, el estilo y los detalles.</p></div>
        <div className="cs-plan-card"><div><span>{data.settings?.plan_name} · {data.subscription?.active ? 'Plan activo' : 'Plan inactivo'}</span><strong>{data.usage} de {data.settings?.monthly_limit}</strong><small>creaciones este mes</small></div><div className="cs-progress"><i style={{ width: `${usagePercent}%` }} /></div></div>
      </section>

      <div className="cs-workspace">
        <div className="cs-main-column">
          <section className="cs-card">
            <div className="cs-step-title"><span>1</span><div><h2>Sube tu producto</h2><p>Una foto clara desde cualquier celular funciona.</p></div></div>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => chooseProduct(event.target.files?.[0])} />
            {productImage ? (
              <div className="cs-product-preview"><img src={productImage} alt="Producto" /><button type="button" onClick={() => inputRef.current?.click()}><Upload size={17} /> Cambiar foto</button></div>
            ) : (
              <button className="cs-upload" type="button" onClick={() => inputRef.current?.click()}><span><Upload size={24} /></span><strong>Subir foto del producto</strong><small>JPG, PNG o WEBP</small></button>
            )}
          </section>

          <section className="cs-card">
            <div className="cs-step-title"><span>2</span><div><h2>¿Qué quieres crear?</h2><p>Elige una opción. No necesitas escribir prompts.</p></div></div>
            <div className="cs-preset-grid">
              {data.presets.map((preset) => <button type="button" key={preset.id} className={form.preset === preset.id ? 'selected' : ''} onClick={() => setForm({ ...form, preset: preset.id })}><b>{PRESET_ICONS[preset.id]}</b><div><strong>{preset.name}</strong><small>{preset.description}</small></div>{form.preset === preset.id && <Check size={18} />}</button>)}
            </div>
            {form.preset === 'social' && <div className="cs-social-options"><div><strong>Formato</strong><div className="cs-choice-row">{(data.social_formats || []).map((format) => <button type="button" key={format.id} className={form.social_format === format.id ? 'selected' : ''} onClick={() => setForm({ ...form, social_format: format.id })}><span>{format.id === 'post' ? '▣' : '▯'}</span><div><b>{format.id === 'post' ? 'Post' : 'Historia'}</b><small>{format.width} × {format.height}</small></div><Check size={16} /></button>)}</div></div><div><strong>Estilo del diseño</strong><div className="cs-social-style-grid">{(data.social_styles || []).map((style) => <button type="button" key={style.id} className={form.social_style === style.id ? 'selected' : ''} onClick={() => setForm({ ...form, social_style: style.id })}><b>{style.name}</b><small>{style.description}</small>{form.social_style === style.id && <Check size={16} />}</button>)}</div></div></div>}
          </section>

          <section className="cs-card">
            <div className="cs-step-title"><span>3</span><div><h2>Define la marca</h2><p>Elige la marca y aplicaremos automáticamente su identidad y su logo.</p></div></div>
            <div className="cs-brand-picker">
              <button type="button" className={form.logo_id === 'none' ? 'selected cs-no-logo' : 'cs-no-logo'} onClick={() => setForm({ ...form, logo_id: 'none' })}><ImageIcon size={35} /><span>Sin logo</span>{form.logo_id === 'none' && <b><Check size={16} /></b>}</button>
              {(data.logos || []).map((logo) => <button type="button" key={logo.id} className={Number(form.logo_id) === Number(logo.id) ? 'selected' : ''} onClick={() => setForm({ ...form, logo_id: logo.id })}><img src={logo.image_data} alt={`Logo ${logo.name}`} /><span>{logo.name}</span>{Number(form.logo_id) === Number(logo.id) && <b><Check size={16} /></b>}</button>)}
            </div>
          </section>
        </div>

        <aside className="cs-summary">
          <div className="cs-summary-visual">{productImage ? <img src={productImage} alt="Vista previa" /> : <ImageIcon size={36} />}</div>
          <span>Tu creación</span><h3>{selectedPreset?.name}</h3><p>{selectedPreset?.description}</p>
          <ul><li><Check size={15} /> Producto fiel al original</li><li><Check size={15} /> Acabado fotográfico realista</li><li><Check size={15} /> Alta calidad para publicar</li></ul>
          <button className="cs-generate" disabled={!productImage || generating || !data.generation_available}>{generating ? <><i /> Creando tu imagen...</> : <><WandSparkles size={19} /> Crear imagen profesional</>}</button>
          {generating && <div className="cs-generation-progress" role="status" aria-live="polite"><div><i style={{ width: `${generationProgress.percent}%` }} /></div><span>{generationProgress.label}</span><strong>{generationProgress.percent}%</strong><small>Puedes dejar esta página abierta mientras terminamos.</small></div>}
          {!data.generation_available && <small className="cs-api-note">{data.subscription?.active ? 'La interfaz está lista. Falta conectar la clave de OpenAI en el servidor.' : 'Tu plan necesita estar activo para crear imágenes.'}</small>}
        </aside>
      </div>
    </form>
  );
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
  return <section className="cs-library"><div className="cs-section-heading"><span className="cs-eyebrow">Identidad visual</span><h1>Logos de tus marcas</h1><p>Agrega o elimina las marcas disponibles al crear contenido. También puedes generar cualquier diseño sin logo.</p></div><div className="cs-library-layout"><form className="cs-reference-form cs-card" onSubmit={save}><h2>Agregar logo</h2><input ref={logoInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onClick={(event) => { event.currentTarget.value = ''; }} onChange={(event) => selectFile(event.target.files?.[0])} /><button className="cs-ref-upload" type="button" onClick={() => logoInputRef.current?.click()}>{draft.image ? <img src={draft.image} alt="Logo seleccionado" /> : <><Upload size={23} /><strong>Seleccionar logo</strong><small>JPG, PNG o WEBP</small></>}</button>{draft.image && <button className="cs-change-reference" type="button" onClick={() => logoInputRef.current?.click()}><Upload size={16} /> Cambiar logo</button>}<label>Nombre de la marca<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Marjorie Botas" /></label><button className="cs-primary" disabled={saving || !draft.image || !draft.name.trim()}>{saving ? 'Guardando...' : <><Plus size={18} /> Guardar logo</>}</button></form><div className="cs-reference-list">{data.logos?.length ? data.logos.map((logo) => <article key={logo.id}><img src={logo.image_data} alt={logo.name} /><div><span>Marca</span><strong>{logo.name}</strong><p>Disponible para nuevas creaciones</p></div><button title="Eliminar logo" type="button" onClick={() => remove(logo.id)}><Trash2 size={17} /></button></article>) : <div className="cs-empty-large"><ImageIcon size={36} /><h3>No hay logos guardados</h3><p>Puedes crear sin logo o agregar una marca desde este formulario.</p></div>}</div></div></section>;
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
