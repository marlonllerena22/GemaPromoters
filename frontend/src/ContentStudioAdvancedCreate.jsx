import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Images, Layers3, LockKeyhole,
  Megaphone, Plus, Sparkles, Trash2, Upload, WandSparkles, X
} from 'lucide-react';
import './content-studio-advanced.css';

const MODES = [
  { id: 'carousel', name: 'Carrusel inteligente', description: 'Varias diapositivas para contar una historia y vender mejor.', plan: 'negocio', planName: 'Negocio', Icon: Layers3 },
  { id: 'collection', name: 'Colección completa', description: 'Varios productos con una misma estética visual.', plan: 'negocio', planName: 'Negocio', Icon: Images },
  { id: 'week', name: 'Semana lista', description: 'Publicaciones y copies preparados para varios días.', plan: 'pro', planName: 'Pro', Icon: CalendarDays },
  { id: 'campaign', name: 'Campaña completa', description: 'Piezas y copies coordinados para una acción comercial.', plan: 'pro', planName: 'Pro', Icon: Megaphone }
];

const TYPE_OPTIONS = {
  carousel: [
    ['automatic', '✨ Automático', 'El estudio decide la secuencia'], ['presentation', 'Presentación', 'Introduce el producto'],
    ['benefits', 'Beneficios', 'Explica ventajas reales'], ['product', 'Producto', 'Muestra detalles y usos'], ['promotion', 'Promoción', 'Lleva a una acción']
  ],
  collection: [
    ['automatic', '✨ Automático', 'La mejor narrativa para el conjunto'], ['presentation', 'Presentar colección', 'Una línea visual coherente'],
    ['launch', 'Lanzamiento', 'Crea expectativa'], ['promotion', 'Promoción', 'Orientada a conversión'], ['catalog', 'Catálogo', 'Cada producto es protagonista']
  ],
  week: [
    ['sell', 'Vender', 'Mensajes comerciales variados'], ['show', 'Mostrar productos', 'Descubrimiento y detalle'],
    ['promote', 'Promocionar', 'Impulsa una acción'], ['visit', 'Llevar al local', 'Motiva una visita']
  ],
  campaign: [
    ['launch', 'Lanzamiento', 'Presentación y expectativa'], ['offer', 'Oferta', 'Comunicación directa'],
    ['new_collection', 'Nueva colección', 'Historia visual coordinada'], ['promotion', 'Promoción', 'Piezas enfocadas en resultados']
  ]
};

const COUNT_OPTIONS = {
  carousel: [[3, '3 diapositivas'], [5, '5 diapositivas'], [7, '7 diapositivas']],
  week: [[3, '3 publicaciones'], [5, '5 publicaciones'], [7, '7 publicaciones']]
};

const FORMAT_OPTIONS = [
  ['post', 'Post vertical', '1080 × 1350'],
  ['story', 'Historia / Reel', '1080 × 1920']
];

const SLIDE_PURPOSES = [
  'portada que capte atención', 'presentación clara del producto', 'beneficio principal verificable',
  'detalle o forma de uso', 'beneficio complementario', 'prueba visual o estilo de vida', 'cierre con llamada a la acción'
];

function entitlementFor(data, mode) {
  if (['admin', 'supreme'].includes(data?.account?.role)) return true;
  const limit = Number(data?.settings?.monthly_limit || 0);
  return mode.plan === 'pro' ? limit >= 150 : limit >= 60;
}

function availableCredits(data) {
  return Math.max(0, Number(data?.available_credits ?? (Number(data?.settings?.monthly_limit || 0) - Number(data?.usage || 0))));
}

function compactInstruction(mode, type, position, total) {
  const selected = TYPE_OPTIONS[mode].find(([id]) => id === type)?.[1] || 'Automático';
  if (mode === 'carousel') return `Carrusel ${selected}. Diapositiva ${position} de ${total}: ${SLIDE_PURPOSES[position - 1] || 'cierre comercial'}. Mantén continuidad visual con toda la serie.`;
  if (mode === 'collection') return `Colección ${selected}. Pieza ${position} de ${total}. Mantén exactamente la misma dirección de arte, paleta, luz y tipografía en toda la colección.`;
  if (mode === 'week') return `Plan semanal para ${selected.toLowerCase()}. Publicación ${position} de ${total}. Crea una idea distinta, útil y coherente con el resto de la semana.`;
  return `Campaña ${selected}. Pieza ${position} de ${total}. Mantén identidad, paleta y concepto de campaña; asigna a esta pieza una función comercial distinta.`;
}

function sharedArtDirection(mode, type) {
  const direction = {
    presentation: 'editorial limpia, luz suave y jerarquía clara', benefits: 'gráfica informativa elegante y legible',
    product: 'fotografía de producto premium y detalles nítidos', promotion: 'campaña dinámica con contraste comercial',
    launch: 'lanzamiento contemporáneo con expectativa visual', catalog: 'catálogo limpio con fondo y luz constantes',
    sell: 'estilo comercial cálido y directo', show: 'producto protagonista con ambiente realista',
    promote: 'energía promocional elegante', visit: 'escena cercana que invite a visitar el local',
    offer: 'oferta visual fuerte, ordenada y profesional', new_collection: 'colección editorial contemporánea'
  }[type];
  return direction || `${mode === 'carousel' ? 'secuencia editorial' : 'serie visual'} premium, coherente y clara`;
}

export default function ContentStudioAdvancedCreate({ data, baseForm, currentProduct, prepareImage, onGenerate, openPlans }) {
  const [open, setOpen] = useState(false);
  const [modeId, setModeId] = useState('');
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [type, setType] = useState('');
  const [format, setFormat] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const mode = MODES.find((item) => item.id === modeId);
  const requiredProducts = ['carousel', 'campaign'].includes(modeId) ? 1 : 2;
  const productsReady = products.length >= requiredProducts;
  const totalCredits = modeId === 'collection' ? products.length : modeId === 'campaign' ? 4 : count;
  const choicesReady = productsReady && (modeId === 'collection' || modeId === 'campaign' || count > 0);
  const canConfirm = choicesReady && type && format && totalCredits > 0;
  const credits = availableCredits(data);
  const selectedTypeName = useMemo(() => TYPE_OPTIONS[modeId]?.find(([id]) => id === type)?.[1] || '', [modeId, type]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', close); };
  }, [open]);

  function reset(nextMode = '') {
    setModeId(nextMode); setProducts(currentProduct ? [currentProduct] : []); setCount(0); setType(''); setFormat(''); setError(''); setProgress({ done: 0, total: 0, label: '' });
  }

  async function chooseFiles(files) {
    setError('');
    try {
      const selected = Array.from(files || []).slice(0, modeId === 'carousel' ? 1 : 8);
      const images = await Promise.all(selected.map((file) => prepareImage(file)));
      setProducts((current) => modeId === 'carousel' ? images.slice(0, 1) : [...current, ...images].slice(0, 8));
    } catch (err) { setError(err.message); }
  }

  function selectMode(next) {
    if (!entitlementFor(data, next)) return;
    reset(next.id);
  }

  async function createBatch() {
    if (!canConfirm || busy) return;
    if (credits < totalCredits) { setOpen(false); openPlans(mode?.plan === 'pro' ? 'pro' : 'negocio'); return; }
    setBusy(true); setError(''); setProgress({ done: 0, total: totalCredits, label: 'Preparando el lote' });
    const groupId = globalThis.crypto?.randomUUID?.() || `ec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userContext = String(baseForm.creative_instruction || '').trim().slice(0, 90);
    const sharedDirection = sharedArtDirection(modeId, type);
    const jobs = Array.from({ length: totalCredits }, (_, index) => ({
      ...baseForm,
      preset: modeId === 'collection' && type === 'catalog' ? 'catalog' : 'social',
      social_style: type === 'promotion' || type === 'offer' ? 'playful' : type === 'benefits' ? 'product' : 'editorial',
      output_format: format,
      product_image: products[index % products.length],
      creative_instruction: `${userContext ? `Objetivo: ${userContext}. ` : ''}${compactInstruction(modeId, type, index + 1, totalCredits)} Dirección compartida: ${sharedDirection}.`.slice(0, 260),
      creation_group_id: groupId,
      creation_group_type: modeId,
      creation_group_position: index + 1
    }));
    try {
      await onGenerate(jobs, {
        mode: modeId,
        createCopies: ['week', 'campaign'].includes(modeId),
        onProgress: (next) => setProgress(next)
      });
      setOpen(false); reset();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const launcher = <button className="cs-more-create" type="button" onClick={() => { reset(); setOpen(true); }}><span><Sparkles /></span><div><strong>✨ Más formas de crear</strong><small>Contenido avanzado y en lote</small></div><ChevronRight /></button>;
  if (!open) return launcher;

  const panel = <div className="cs-advanced-create-overlay" role="dialog" aria-modal="true" aria-label="Más formas de crear">
    <button className="cs-advanced-create-backdrop" type="button" aria-label="Cerrar" onClick={() => setOpen(false)} />
    <section className="cs-advanced-create-panel">
      <header>
        <button type="button" aria-label={busy ? 'Cerrar y continuar en segundo plano' : modeId ? 'Volver' : 'Cerrar'} onClick={() => busy ? setOpen(false) : modeId ? reset() : setOpen(false)}>{modeId ? <ChevronLeft /> : <X />}</button>
        <div><span>ESTUDIOS CREATIVOS</span><h1>{mode?.name || 'Más formas de crear'}</h1><p>{mode?.description || 'Herramientas potentes que siguen siendo fáciles de usar.'}</p></div>
        <i><WandSparkles /></i>
      </header>

      {!mode && <div className="cs-advanced-mode-list">{MODES.map((item) => {
        const unlocked = entitlementFor(data, item);
        const Icon = item.Icon;
        return <article key={item.id} className={!unlocked ? 'locked' : ''}>
          <button type="button" onClick={() => selectMode(item)} disabled={!unlocked}><span><Icon /></span><div><strong>{item.name}</strong><small>{item.description}</small></div>{unlocked ? <ChevronRight /> : <LockKeyhole />}</button>
          {!unlocked && <div><span>Disponible desde el plan {item.planName}</span><button type="button" onClick={() => { setOpen(false); openPlans(item.plan); }}>Ver plan</button></div>}
        </article>;
      })}</div>}

      {mode && <div className="cs-advanced-flow">
        <div className="cs-flow-step active"><span>1</span><div><strong>{['carousel', 'campaign'].includes(modeId) ? 'Elige el producto' : 'Elige tus productos'}</strong><small>{modeId === 'carousel' ? 'Usaremos una foto para toda la secuencia.' : modeId === 'campaign' ? 'Agrega entre 1 y 8 fotografías.' : 'Agrega entre 2 y 8 fotografías.'}</small></div></div>
        <input ref={inputRef} hidden type="file" multiple={modeId !== 'carousel'} accept="image/png,image/jpeg,image/webp" onChange={(event) => { void chooseFiles(event.target.files); event.target.value = ''; }} />
        <div className="cs-advanced-products">{products.map((image, index) => <div key={`${image.slice(-30)}-${index}`}><img src={image} alt={`Producto ${index + 1}`} /><button type="button" aria-label={`Quitar producto ${index + 1}`} onClick={() => setProducts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button><small>{index + 1}</small></div>)}<button type="button" className="add" onClick={() => inputRef.current?.click()}><Upload /><strong>{products.length ? 'Agregar' : 'Subir foto'}</strong></button></div>

        {productsReady && COUNT_OPTIONS[modeId] && <><div className="cs-flow-step active"><span>2</span><div><strong>¿Cuántas piezas necesitas?</strong><small>El consumo cambia con la cantidad.</small></div></div><div className="cs-advanced-counts">{COUNT_OPTIONS[modeId].map(([value, label]) => <button key={value} type="button" className={count === value ? 'selected' : ''} onClick={() => { setCount(value); setType(''); setFormat(''); }}><strong>{value}</strong><small>{label.replace(/^\d+ /, '')}</small>{count === value && <Check />}</button>)}</div></>}

        {choicesReady && <><div className="cs-flow-step active"><span>{COUNT_OPTIONS[modeId] ? 3 : 2}</span><div><strong>{modeId === 'week' ? '¿Cuál es el objetivo?' : 'Elige el enfoque'}</strong><small>Desliza y toca una opción. Automático decide por ti.</small></div></div><div className="cs-advanced-choice-rail">{TYPE_OPTIONS[modeId].map(([id, name, description]) => <button key={id} type="button" className={type === id ? 'selected' : ''} onClick={() => { setType(id); setFormat(''); }}><i>{name.startsWith('✨') ? '✨' : name.slice(0, 1)}</i><strong>{name}</strong><small>{description}</small>{type === id && <Check />}</button>)}</div></>}

        {type && <><div className="cs-flow-step active"><span>{COUNT_OPTIONS[modeId] ? 4 : 3}</span><div><strong>Tamaño de publicación</strong><small>La escena se crea completa en el formato seleccionado.</small></div></div><div className="cs-advanced-formats">{FORMAT_OPTIONS.map(([id, name, size]) => <button key={id} type="button" className={format === id ? 'selected' : ''} onClick={() => setFormat(id)}><span>{id === 'story' ? '▯' : '▣'}</span><div><strong>{name}</strong><small>{size}</small></div>{format === id && <Check />}</button>)}</div></>}

        {canConfirm && <div className="cs-advanced-confirm"><div><span>Esta creación utilizará</span><strong>{totalCredits} créditos</strong><small>{selectedTypeName} · {FORMAT_OPTIONS.find(([id]) => id === format)?.[1]}</small></div><button type="button" disabled={busy} onClick={createBatch}>{busy ? 'Creando…' : credits < totalCredits ? 'Mejorar plan' : 'Crear contenido'}<ChevronRight /></button></div>}
        {busy && <div className="cs-advanced-batch-progress"><div><i style={{ width: `${Math.max(8, (progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div><strong>{progress.label || 'Creando el contenido'}</strong><small>{progress.done} de {progress.total} piezas listas. Puedes cerrar esta ventana: las imágenes enviadas seguirán procesándose.</small></div>}
        {error && <div className="cs-advanced-error">{error}</div>}
      </div>}
    </section>
  </div>;

  return <>{launcher}{createPortal(panel, document.body)}</>;
}
