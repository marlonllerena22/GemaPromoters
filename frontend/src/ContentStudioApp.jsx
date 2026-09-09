import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, Download, Image as ImageIcon, Images, LayoutGrid, LogOut,
  Plus, Settings, Sparkles, Trash2, Upload, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio.css';

const PRESET_ICONS = { editorial: '01', catalog: '02', social: '03', detail: '04' };
const PRESET_NAMES = { editorial: 'Editorial', catalog: 'Catálogo', social: 'Post social', detail: 'Detalle' };
const CATEGORY_NAMES = { general: 'General', editorial: 'Editorial', catalog: 'Catálogo', social: 'Post social', detail: 'Detalle' };
const emptyForm = { preset: 'editorial', mood: 'light', product_name: '', brand_name: '', material: '', color: '', headline: '', reference_ids: [] };

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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  const scopeQuery = scopeId ? `?establishment_id=${scopeId}` : '';
  const scopeBody = scopeId ? { establishment_id: Number(scopeId) } : {};

  async function load() {
    const response = await api(`/content-studio/bootstrap${scopeQuery}`);
    setData(response);
    setForm((current) => ({ ...current, brand_name: current.brand_name || response.settings?.brand_name || '' }));
  }

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [scopeId]);

  const selectedPreset = data?.presets?.find((item) => item.id === form.preset);
  const recommendedRefs = useMemo(() => (data?.references || []).filter((item) => item.category === 'general' || item.category === form.preset), [data?.references, form.preset]);
  const usagePercent = Math.min(100, ((data?.usage || 0) / (data?.settings?.monthly_limit || 1)) * 100);
  const canManageReferences = data?.can_manage_references !== false;

  async function chooseProduct(file) {
    setError('');
    try { setProductImage(await imageFileToData(file)); setResult(null); }
    catch (err) { setError(err.message); }
  }

  function toggleReference(id) {
    setForm((current) => {
      const exists = current.reference_ids.includes(id);
      if (!exists && current.reference_ids.length >= 4) return current;
      return { ...current, reference_ids: exists ? current.reference_ids.filter((item) => item !== id) : [...current.reference_ids, id] };
    });
  }

  async function generate(event) {
    event.preventDefault();
    setError('');
    if (!productImage) { setError('Primero sube la foto del producto'); return; }
    setGenerating(true);
    try {
      const response = await api('/content-studio/generate', {
        method: 'POST', body: JSON.stringify({ ...scopeBody, ...form, product_image: productImage })
      });
      setResult(response.generation);
      setData((current) => ({ ...current, usage: response.usage, generations: [response.generation, ...current.generations].slice(0, 24) }));
      setNotice('Tu imagen profesional está lista');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); }
  }

  function newCreation() {
    setProductImage('');
    setResult(null);
    setForm((current) => ({ ...emptyForm, brand_name: current.brand_name }));
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
            {canManageReferences && <button className={tab === 'references' ? 'active' : ''} onClick={() => setTab('references')}><Images size={17} /> Referencias</button>}
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><LayoutGrid size={17} /> Mis diseños</button>
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings size={17} /> Marca</button>
          </nav>
          <button className="cs-logout" type="button" onClick={onLogout}><LogOut size={17} /> Salir</button>
        </header>
      )}

      <div className="cs-page">
        {embedded && (
          <div className="cs-embedded-nav">
            {[['create', 'Crear', Sparkles], ...(canManageReferences ? [['references', 'Referencias', Images]] : []), ['history', 'Mis diseños', LayoutGrid], ['settings', 'Marca', Settings]].map(([key, label, Icon]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} /> {label}</button>
            ))}
          </div>
        )}
        {notice && <div className="cs-toast"><Check size={17} /> {notice}</div>}
        {error && <div className="cs-error"><span>{error}</span><button onClick={() => setError('')}><X size={17} /></button></div>}

        {tab === 'create' && (
          <CreateView
            data={data} form={form} setForm={setForm} productImage={productImage} inputRef={inputRef}
            chooseProduct={chooseProduct} selectedPreset={selectedPreset} recommendedRefs={recommendedRefs}
            toggleReference={toggleReference} generate={generate} generating={generating} result={result}
            newCreation={newCreation} usagePercent={usagePercent} setTab={setTab} canManageReferences={canManageReferences}
          />
        )}
        {tab === 'references' && canManageReferences && <ReferencesView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'history' && <HistoryView data={data} scopeBody={scopeBody} reload={load} setError={setError} />}
        {tab === 'settings' && <SettingsView data={data} scopeBody={scopeBody} onSaved={(settings) => setData((current) => ({ ...current, settings }))} setError={setError} user={user} />}
      </div>
    </div>
  );
}

function CreateView({ data, form, setForm, productImage, inputRef, chooseProduct, selectedPreset, recommendedRefs, toggleReference, generate, generating, result, newCreation, usagePercent, setTab, canManageReferences }) {
  if (result) {
    return (
      <section className="cs-result-page">
        <div className="cs-result-copy">
          <span className="cs-eyebrow">Creación terminada</span>
          <h1>Lista para publicar.</h1>
          <p>Descárgala en alta calidad o crea una nueva versión con otro estilo.</p>
          <div className="cs-result-actions">
            <button className="cs-primary" onClick={() => downloadDataImage(result.output_image_data, `${result.product_name || 'contenido'}-${result.id}.webp`)}><Download size={18} /> Descargar</button>
            <button className="cs-secondary" onClick={newCreation}><Plus size={18} /> Nueva creación</button>
          </div>
          <div className="cs-result-meta"><span>{PRESET_NAMES[result.preset]}</span><span>{result.aspect_ratio}</span><span>{result.reference_ids?.length || 0} referencias</span></div>
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
              {data.presets.map((preset) => <button type="button" key={preset.id} className={form.preset === preset.id ? 'selected' : ''} onClick={() => setForm({ ...form, preset: preset.id, reference_ids: [] })}><b>{PRESET_ICONS[preset.id]}</b><div><strong>{preset.name}</strong><small>{preset.description}</small></div>{form.preset === preset.id && <Check size={18} />}</button>)}
            </div>
          </section>

          <section className="cs-card">
            <div className="cs-step-title"><span>3</span><div><h2>Define el estilo</h2><p>Solo necesitamos algunos datos sencillos.</p></div></div>
            <div className="cs-moods">
              {[['light', 'Minimal claro'], ['warm', 'Cálido premium'], ['urban', 'Urbano editorial'], ['color', 'Color de marca']].map(([key, label]) => <button type="button" key={key} className={form.mood === key ? 'selected' : ''} onClick={() => setForm({ ...form, mood: key })}><i className={`mood-${key}`} />{label}</button>)}
            </div>
            <div className="cs-fields">
              <label>Nombre del producto<input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="Ej. Bota Ámbar" /></label>
              <label>Marca<input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder="Ej. Marjorie Botas" /></label>
              <label>Material<input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Ej. Cuero natural" /></label>
              <label>Color<input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="Ej. Café miel" /></label>
              {form.preset === 'social' && <label className="wide">Texto principal<input value={form.headline} maxLength={80} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="Ej. Hechas para acompañarte" /><small>Escribe exactamente lo que debe aparecer.</small></label>}
            </div>
          </section>

          <section className="cs-card">
            <div className="cs-step-title"><span>4</span><div><h2>Inspírate en tu biblioteca <em>Opcional</em></h2><p>Usaremos el estilo y el realismo, sin copiar la foto.</p></div></div>
            {recommendedRefs.length ? <div className="cs-ref-picker">{recommendedRefs.map((reference) => <button type="button" key={reference.id} className={form.reference_ids.includes(reference.id) ? 'selected' : ''} onClick={() => toggleReference(reference.id)}><img src={reference.image_data} alt={reference.name} /><span>{reference.name}</span>{form.reference_ids.includes(reference.id) && <b><Check size={15} /></b>}</button>)}</div> : <div className="cs-empty-ref"><Images size={21} /><span><strong>{canManageReferences ? 'Añade tus primeras referencias' : 'Referencias en preparación'}</strong><small>{canManageReferences ? 'Guarda los estilos que representan a tu marca.' : 'El administrador publicará estilos para tus creaciones.'}</small></span></div>}
            <div className="cs-ref-foot"><span>{form.reference_ids.length}/4 seleccionadas</span>{canManageReferences && <button type="button" onClick={() => setTab('references')}>Administrar biblioteca</button>}</div>
          </section>
        </div>

        <aside className="cs-summary">
          <div className="cs-summary-visual">{productImage ? <img src={productImage} alt="Vista previa" /> : <ImageIcon size={36} />}</div>
          <span>Tu creación</span><h3>{selectedPreset?.name}</h3><p>{selectedPreset?.description}</p>
          <ul><li><Check size={15} /> Producto fiel al original</li><li><Check size={15} /> Acabado fotográfico realista</li><li><Check size={15} /> Alta calidad para publicar</li></ul>
          <button className="cs-generate" disabled={!productImage || generating || !data.generation_available}>{generating ? <><i /> Creando tu imagen...</> : <><WandSparkles size={19} /> Crear imagen profesional</>}</button>
          {!data.generation_available && <small className="cs-api-note">{data.subscription?.active ? 'La interfaz está lista. Falta conectar la clave de OpenAI en el servidor.' : 'Tu plan necesita estar activo para crear imágenes.'}</small>}
        </aside>
      </div>
    </form>
  );
}

function ReferencesView({ data, scopeBody, reload, setError }) {
  const [draft, setDraft] = useState({ name: '', category: 'general', notes: '', image: '' });
  const [saving, setSaving] = useState(false);
  async function selectFile(file) { try { const image = await imageFileToData(file, 1400, 0.86); setDraft((current) => ({ ...current, image })); } catch (err) { setError(err.message); } }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try { await api('/content-studio/references', { method: 'POST', body: JSON.stringify({ ...scopeBody, ...draft }) }); setDraft({ name: '', category: 'general', notes: '', image: '' }); await reload(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function remove(id) { try { await api(`/content-studio/references/${id}${scopeBody.establishment_id ? `?establishment_id=${scopeBody.establishment_id}` : ''}`, { method: 'DELETE' }); await reload(); } catch (err) { setError(err.message); } }
  return <section className="cs-library"><div className="cs-section-heading"><span className="cs-eyebrow">Dirección visual</span><h1>Biblioteca de referencias</h1><p>Guarda fotos que representen la luz, encuadre y calidad que buscas. Nunca se usarán para copiar productos, personas o marcas.</p></div><div className="cs-library-layout"><form className="cs-reference-form cs-card" onSubmit={save}><h2>Nueva referencia</h2><label className="cs-ref-upload">{draft.image ? <img src={draft.image} alt="Referencia" /> : <><Upload size={23} /><strong>Subir una foto</strong><small>Pinterest, campaña o inspiración propia</small></>}<input type="file" hidden accept="image/*" onChange={(e) => selectFile(e.target.files?.[0])} /></label><label>Nombre<input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej. Luz natural editorial" /></label><label>Úsala para<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{Object.entries(CATEGORY_NAMES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Qué te gusta de ella <small>Opcional</small><textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Ej. La luz suave y el fondo neutro" /></label><button className="cs-primary" disabled={saving || !draft.image}>{saving ? 'Guardando...' : <><Plus size={18} /> Guardar referencia</>}</button></form><div className="cs-reference-list">{data.references.length ? data.references.map((reference) => <article key={reference.id}><img src={reference.image_data} alt={reference.name} /><div><span>{CATEGORY_NAMES[reference.category]}</span><strong>{reference.name}</strong><p>{reference.notes || 'Referencia visual guardada'}</p></div><button title="Eliminar" onClick={() => remove(reference.id)}><Trash2 size={17} /></button></article>) : <div className="cs-empty-large"><Images size={36} /><h3>Tu biblioteca está vacía</h3><p>Sube referencias para mantener una identidad visual constante.</p></div>}</div></div></section>;
}

function HistoryView({ data, scopeBody, reload, setError }) {
  async function remove(id) { try { await api(`/content-studio/generations/${id}${scopeBody.establishment_id ? `?establishment_id=${scopeBody.establishment_id}` : ''}`, { method: 'DELETE' }); await reload(); } catch (err) { setError(err.message); } }
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Tus resultados</span><h1>Mis diseños</h1><p>Todo tu contenido terminado, listo para volver a descargar.</p></div>{data.generations.filter((item) => item.status === 'completed').length ? <div className="cs-history-grid">{data.generations.filter((item) => item.status === 'completed').map((item) => <article key={item.id}><img src={item.output_image_data} alt={item.product_name || 'Diseño'} /><div><span>{PRESET_NAMES[item.preset]}</span><strong>{item.product_name || 'Creación sin nombre'}</strong><small>{new Date(`${item.created_at.replace(' ', 'T')}`).toLocaleDateString('es-EC')}</small></div><div className="cs-history-actions"><button onClick={() => downloadDataImage(item.output_image_data, `${item.product_name || 'contenido'}-${item.id}.webp`)}><Download size={17} /></button><button onClick={() => remove(item.id)}><Trash2 size={17} /></button></div></article>)}</div> : <div className="cs-empty-large"><LayoutGrid size={38} /><h3>Aquí aparecerán tus diseños</h3><p>Crea tu primera imagen profesional para verla en esta galería.</p></div>}</section>;
}

function SettingsView({ data, scopeBody, onSaved, setError, user }) {
  const [form, setForm] = useState({ brand_name: data.settings?.brand_name || '', brand_tone: data.settings?.brand_tone || 'premium', plan_name: data.settings?.plan_name || 'Profesional', monthly_limit: data.settings?.monthly_limit || 80 });
  const [saving, setSaving] = useState(false);
  async function save(event) { event.preventDefault(); setSaving(true); try { const settings = await api('/content-studio/settings', { method: 'PUT', body: JSON.stringify({ ...scopeBody, ...form }) }); onSaved(settings); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <section><div className="cs-section-heading"><span className="cs-eyebrow">Identidad del negocio</span><h1>Tu marca</h1><p>Estos datos se aplican automáticamente a cada creación.</p></div><form className="cs-settings-card cs-card" onSubmit={save}><label>Nombre de la marca<input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} placeholder="Nombre que debe reconocer el estudio" /></label><label>Personalidad visual<select value={form.brand_tone} onChange={(e) => setForm({ ...form, brand_tone: e.target.value })}><option value="premium">Elegante y premium</option><option value="warm">Cercana y cálida</option><option value="modern">Moderna y limpia</option><option value="bold">Audaz y colorida</option></select></label>{user?.role === 'supreme' && <><label>Nombre del plan<input value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} /></label><label>Límite mensual<input type="number" min="1" max="10000" value={form.monthly_limit} onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })} /></label></>}<div className="cs-subscription-note"><Sparkles size={20} /><div><strong>Preparado para suscripciones</strong><p>El sistema ya mide cada creación por mes y respeta el límite asignado al plan.</p></div></div><button className="cs-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar identidad'}</button></form></section>;
}
