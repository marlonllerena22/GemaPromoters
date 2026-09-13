import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, DollarSign, EyeOff, Images, Layers3, LockKeyhole,
  MapPin, Megaphone, Palette, Percent, Phone, Sparkles, Tag, Trash2, Upload, UserRound, Users, WandSparkles, X
} from 'lucide-react';
import './content-studio-advanced.css';

const MODES = [
  { id: 'carousel', name: 'Carrusel inteligente', description: 'Varias diapositivas para contar una historia y vender mejor.', badges: ['2–5 piezas', 'Copy incluido'], previews: ['serum', 'coffee', 'handbag'], plan: 'negocio', planName: 'Negocio', Icon: Layers3 },
  { id: 'collection', name: 'Colección completa', description: 'Varios productos con una misma estética visual.', badges: ['Hasta 5 productos', 'Estilo unificado'], previews: ['handbag', 'serum', 'candle', 'coffee'], plan: 'negocio', planName: 'Negocio', Icon: Images },
  { id: 'week', name: 'Semana lista', description: 'Publicaciones y copies preparados para varios días.', badges: ['2–5 días', 'Copy incluido'], previews: ['coffee', 'candle', 'serum'], plan: 'pro', planName: 'Pro', Icon: CalendarDays },
  { id: 'campaign', name: 'Campaña completa', description: 'Piezas y copies coordinados para una acción comercial.', badges: ['Post + historia', 'Copy por pieza'], previews: ['serum', 'handbag'], plan: 'pro', planName: 'Pro', Icon: Megaphone }
];

const TYPE_OPTIONS = {
  carousel: [
    ['automatic', '✨ Automático', 'El estudio decide la secuencia'], ['sell', 'Vender', 'Guía hacia una acción comercial'],
    ['presentation', 'Presentar', 'Introduce el producto'], ['launch', 'Lanzamiento', 'Crea expectativa'], ['informational', 'Informativo', 'Explica beneficios reales']
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
  carousel: [[2, '2 diapositivas'], [3, '3 diapositivas'], [4, '4 diapositivas'], [5, '5 diapositivas']],
  week: [[2, '2 publicaciones'], [3, '3 publicaciones'], [4, '4 publicaciones'], [5, '5 publicaciones']],
  campaign: [[2, '2 piezas'], [3, '3 piezas'], [4, '4 piezas'], [5, '5 piezas']]
};

const FORMAT_OPTIONS = [
  ['post', 'Post vertical', '1080 × 1350'],
  ['story', 'Historia / Reel', '1080 × 1920']
];

const MIXED_FORMAT = ['mixed', 'Post + historia', 'Alterna ambos formatos'];
const VISUAL_STYLES = [
  ['automatic', '✨ Automático'], ['premium', 'Elegante'], ['warm', 'Cálido'], ['bold', 'Colorido'], ['minimal', 'Minimalista']
];
const PERSON_OPTIONS = [
  ['none', 'Sin persona', EyeOff], ['person', 'Con persona', UserRound], ['mixed', 'Variado', Users]
];
const GUIDE_IMAGES = ['serum', 'coffee', 'handbag', 'candle'].map((name) => `/content-studio/advanced/${name}.webp`);
const STRUCTURE_LABELS = {
  carousel: ['Portada', 'Producto', 'Beneficio', 'Detalle', 'Cierre / CTA'],
  collection: ['Producto', 'Uso', 'Detalle', 'Ambiente', 'Colección'],
  week: ['Descubrir', 'Uso real', 'Beneficio', 'Marca', 'Vender'],
  campaign: ['Impacto', 'Producto', 'Beneficio', 'Promoción', 'Cierre / CTA']
};

const EXTRAS_TITLES = {
  carousel: 'Completa tu carrusel',
  collection: 'Completa tu colección',
  week: 'Completa tu semana',
  campaign: 'Completa tu campaña'
};

const SERIES_ROLES = {
  carousel: [
    'an attention-grabbing hero cover with a wide product-led composition',
    'a real-use or lifestyle scene from a clearly different camera angle',
    'a benefit-led composition using only visible or user-supplied facts',
    'a refined detail view that highlights true materials and construction',
    'a confident closing composition with a clear commercial call to action'
  ],
  collection: [
    'a clean hero presentation with the complete product as protagonist',
    'an alternate angle or arrangement that clearly differs from the hero image',
    'a tactile detail composition focused on real materials and finish',
    'a lifestyle or contextual scene that demonstrates the product naturally',
    'a polished collection closing image with balanced group identity'
  ],
  week: [
    'a discovery-focused hero image with a memorable visual hook',
    'a practical real-use scene with a different setting and camera distance',
    'a benefit or craftsmanship story based only on verified visible details',
    'a warm brand-building composition that feels editorial rather than repetitive',
    'a direct commercial closing image that invites the intended user action'
  ],
  campaign: [
    'a high-impact awareness image that introduces the campaign concept',
    'a product-first image from a new angle with different visual hierarchy',
    'a benefit-led image with a distinct setting and graphic rhythm',
    'an offer or action image with strong but uncluttered commercial hierarchy',
    'a premium closing image that reinforces the product and next action'
  ]
};

function entitlementFor(data, mode) {
  if (['admin', 'supreme'].includes(data?.account?.role)) return true;
  if (data?.feature_access?.advanced_all_plans) return true;
  const limit = Number(data?.settings?.monthly_limit || 0);
  return mode.plan === 'pro' ? limit >= 150 : limit >= 60;
}

function availableCredits(data) {
  return Math.max(0, Number(data?.available_credits ?? (Number(data?.settings?.monthly_limit || 0) - Number(data?.usage || 0))));
}

function distributedIndex(position, total) {
  const patterns = { 2: [0, 4], 3: [0, 2, 4], 4: [0, 1, 2, 4], 5: [0, 1, 2, 3, 4] };
  return patterns[total]?.[position - 1] ?? Math.min(4, position - 1);
}

function seriesDirection(mode, type, position, total) {
  const selected = TYPE_OPTIONS[mode].find(([id]) => id === type)?.[1] || 'Automático';
  const roleIndex = distributedIndex(position, total);
  const role = SERIES_ROLES[mode]?.[roleIndex] || SERIES_ROLES.campaign[roleIndex];
  return `Create ${role}. The selected approach is ${selected}. Make this image materially different from the other images in framing, camera angle, product scale, supporting elements and message hierarchy while preserving one coherent brand palette and art direction across the set.`;
}

function sharedArtDirection(mode, type) {
  const direction = {
    presentation: 'editorial limpia, luz suave y jerarquía clara', benefits: 'gráfica informativa elegante y legible',
    product: 'fotografía de producto premium y detalles nítidos', promotion: 'campaña dinámica con contraste comercial',
    launch: 'lanzamiento contemporáneo con expectativa visual', catalog: 'catálogo limpio con fondo y luz constantes',
    sell: 'estilo comercial cálido y directo', show: 'producto protagonista con ambiente realista',
    promote: 'energía promocional elegante', visit: 'escena cercana que invite a visitar el local',
    offer: 'oferta visual fuerte, ordenada y profesional', new_collection: 'colección editorial contemporánea',
    informational: 'composición informativa clara con beneficios verificables'
  }[type];
  return direction || `${mode === 'carousel' ? 'secuencia editorial' : 'serie visual'} premium, coherente y clara`;
}

export default function ContentStudioAdvancedCreate({ data, baseForm, currentProduct, prepareImage, onGenerate, openPlans, updateBaseForm, launchKey = 0, inline = false }) {
  const [open, setOpen] = useState(false);
  const [modeId, setModeId] = useState('');
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [type, setType] = useState('');
  const [format, setFormat] = useState('');
  const [promotionPercent, setPromotionPercent] = useState('');
  const [promotionDetails, setPromotionDetails] = useState('');
  const [headline, setHeadline] = useState('');
  const [benefits, setBenefits] = useState('');
  const [priceDetails, setPriceDetails] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [dailyTopics, setDailyTopics] = useState('');
  const [validity, setValidity] = useState('');
  const [audience, setAudience] = useState('');
  const [visualStyle, setVisualStyle] = useState('automatic');
  const [visualDirection, setVisualDirection] = useState('');
  const [personMode, setPersonMode] = useState('none');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const mode = MODES.find((item) => item.id === modeId);
  const requiredProducts = modeId === 'collection' ? 2 : 1;
  const productsReady = products.length >= requiredProducts;
  const totalCredits = modeId === 'collection' ? products.length : count;
  const choicesReady = productsReady && (modeId === 'collection' || count > 0);
  const canConfirm = choicesReady && type && format && totalCredits > 0;
  const credits = availableCredits(data);
  const selectedTypeName = useMemo(() => TYPE_OPTIONS[modeId]?.find(([id]) => id === type)?.[1] || '', [modeId, type]);
  const showPromotion = Boolean(modeId);
  const formats = ['week', 'campaign'].includes(modeId) ? [...FORMAT_OPTIONS, MIXED_FORMAT] : FORMAT_OPTIONS;
  const updateOptions = (changes) => updateBaseForm?.(changes);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', close); };
  }, [open]);

  useEffect(() => {
    if (!launchKey) return;
    reset();
    setOpen(true);
  }, [launchKey]);

  function reset(nextMode = '') {
    setModeId(nextMode); setProducts(currentProduct ? [currentProduct] : []); setCount(0); setType(''); setFormat('');
    setPromotionPercent(''); setPromotionDetails(''); setHeadline(''); setBenefits(''); setPriceDetails(''); setCollectionName('');
    setDailyTopics(''); setValidity(''); setAudience(''); setVisualStyle('automatic'); setVisualDirection(''); setPersonMode('none');
    setError(''); setProgress({ done: 0, total: 0, label: '' });
  }

  async function chooseFiles(files) {
    setError('');
    try {
      const selected = Array.from(files || []).slice(0, modeId === 'carousel' ? 1 : 5);
      const images = await Promise.all(selected.map((file) => prepareImage(file)));
      setProducts((current) => modeId === 'carousel' ? images.slice(0, 1) : [...current, ...images].slice(0, 5));
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
    const userContext = String(baseForm.creative_instruction || '').trim().slice(0, 260);
    const sharedDirection = sharedArtDirection(modeId, type);
    const batchBrief = [
      collectionName && `Nombre de la colección: ${collectionName}`,
      headline && `Mensaje principal: ${headline}`,
      benefits && `Beneficios o características confirmadas: ${benefits}`,
      priceDetails && `Precio o precios confirmados: ${priceDetails}`,
      dailyTopics && `Temas sugeridos por el usuario: ${dailyTopics}`,
      validity && `Vigencia confirmada: ${validity}`,
      audience && `Público objetivo: ${audience}`,
      `Presencia de personas: ${personMode === 'person' ? 'usar una persona de manera natural' : personMode === 'mixed' ? 'variar entre piezas con persona y sin persona' : 'no incluir personas'}`,
      `Estilo visual: ${visualStyle === 'automatic' ? 'elegir automáticamente según el producto' : visualStyle}`,
      visualDirection && `Fondo o dirección visual solicitada: ${visualDirection}`
    ].filter(Boolean).join('. ');
    const jobs = Array.from({ length: totalCredits }, (_, index) => ({
      ...baseForm,
      preset: modeId === 'collection' && type === 'catalog' && personMode === 'none' ? 'catalog' : 'social',
      social_style: visualStyle === 'bold' ? 'playful' : visualStyle === 'minimal' ? 'product' : type === 'promotion' || type === 'offer' ? 'playful' : type === 'benefits' ? 'product' : 'editorial',
      output_format: format === 'mixed' ? (index % 2 === 0 ? 'post' : 'story') : format,
      product_image: products[index % products.length],
      creative_instruction: userContext,
      series_direction: `${seriesDirection(modeId, type, index + 1, totalCredits)} Shared direction: ${sharedDirection}.`,
      promotion_percent: Number(promotionPercent) || 0,
      promotion_details: String(promotionDetails || '').trim(),
      batch_brief: batchBrief,
      person_mode: personMode === 'mixed' ? (index % 2 === 0 ? 'person' : 'none') : personMode,
      creation_group_id: groupId,
      creation_group_type: modeId,
      creation_group_position: index + 1
    }));
    try {
      await onGenerate(jobs, {
        mode: modeId,
        createCopies: modeId !== 'collection',
        onProgress: (next) => setProgress(next)
      });
      setOpen(false); reset();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const launcher = <button className={`cs-more-create ${inline ? 'cs-more-create-inline' : ''}`} type="button" onClick={() => { reset(); setOpen(true); }}><span><Sparkles /></span><div><strong>{inline ? 'Abrir herramientas de creación en lote' : '✨ Más formas de crear'}</strong><small>{inline ? 'Carruseles, colecciones, semanas y campañas.' : 'Contenido avanzado y en lote'}</small></div><ChevronRight /></button>;
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
          <button type="button" onClick={() => selectMode(item)} disabled={!unlocked}>
            <span><Icon /></span><div><strong>{item.name}</strong><small>{item.description}</small><div className="cs-mode-badges">{item.badges.map((badge) => <b key={badge}>{badge}</b>)}</div></div>
            <div className={`cs-mode-preview cs-mode-preview-${item.previews.length}`}>{item.previews.map((name, index) => <img key={name} src={`/content-studio/advanced/${name}.webp`} alt="" style={{ '--preview-index': index }}/>)}</div>
            {unlocked ? <ChevronRight /> : <LockKeyhole />}
          </button>
          {!unlocked && <div><span>Disponible desde el plan {item.planName}</span><button type="button" onClick={() => { setOpen(false); openPlans(item.plan); }}>Ver plan</button></div>}
        </article>;
      })}</div>}

      {mode && <div className="cs-advanced-flow">
        <div className="cs-flow-step active"><span>1</span><div><strong>{modeId === 'carousel' ? 'Elige el producto' : 'Elige tus productos'}</strong><small>{modeId === 'carousel' ? 'Usaremos una foto para toda la secuencia.' : modeId === 'collection' ? 'Agrega entre 2 y 5 fotografías.' : 'Agrega entre 1 y 5 fotografías.'}</small></div></div>
        <input ref={inputRef} hidden type="file" multiple={modeId !== 'carousel'} accept="image/png,image/jpeg,image/webp" onChange={(event) => { void chooseFiles(event.target.files); event.target.value = ''; }} />
        <div className="cs-advanced-products">{products.map((image, index) => <div key={`${image.slice(-30)}-${index}`}><img src={image} alt={`Producto ${index + 1}`} /><button type="button" aria-label={`Quitar producto ${index + 1}`} onClick={() => setProducts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button><small>{index + 1}</small></div>)}<button type="button" className="add" onClick={() => inputRef.current?.click()}><Upload /><strong>{products.length ? 'Agregar' : 'Subir foto'}</strong></button></div>

        {productsReady && COUNT_OPTIONS[modeId] && <><div className="cs-flow-step active"><span>2</span><div><strong>¿Cuántas piezas necesitas?</strong><small>El consumo cambia con la cantidad. Máximo 5.</small></div></div><div className="cs-advanced-counts">{COUNT_OPTIONS[modeId].map(([value, label]) => <button key={value} type="button" className={count === value ? 'selected' : ''} onClick={() => { setCount(value); setType(''); setFormat(''); setPromotionPercent(''); setPromotionDetails(''); }}><strong>{value}</strong><small>{label.replace(/^\d+ /, '')}</small>{count === value && <Check />}</button>)}</div></>}

        {choicesReady && <section className="cs-series-preview"><div><strong>Así se construirá tu {modeId === 'week' ? 'semana' : modeId === 'collection' ? 'colección' : modeId === 'campaign' ? 'campaña' : 'carrusel'}</strong><small>Una identidad consistente con una composición diferente en cada pieza.</small></div><div>{Array.from({ length: totalCredits }, (_, index) => { const roleIndex = distributedIndex(index + 1, totalCredits); return <article key={index}><img src={GUIDE_IMAGES[roleIndex % GUIDE_IMAGES.length]} alt=""/><span>{String(index + 1).padStart(2, '0')}</span><b>{STRUCTURE_LABELS[modeId][roleIndex]}</b></article>; })}</div></section>}

        {choicesReady && <><div className="cs-flow-step active"><span>{COUNT_OPTIONS[modeId] ? 3 : 2}</span><div><strong>{modeId === 'week' ? '¿Cuál es el objetivo?' : 'Elige el enfoque'}</strong><small>Desliza y toca una opción. Automático decide por ti.</small></div></div><div className="cs-advanced-choice-rail">{TYPE_OPTIONS[modeId].map(([id, name, description]) => <button key={id} type="button" className={type === id ? 'selected' : ''} onClick={() => { setType(id); setFormat(''); setPromotionPercent(''); setPromotionDetails(''); }}><i>{name.startsWith('✨') ? '✨' : name.slice(0, 1)}</i><strong>{name}</strong><small>{description}</small>{type === id && <Check />}</button>)}</div></>}

        {type && <><div className="cs-flow-step active"><span>{COUNT_OPTIONS[modeId] ? 4 : 3}</span><div><strong>Tamaño de publicación</strong><small>La escena se crea completa en el formato seleccionado.</small></div></div><div className="cs-advanced-formats">{formats.map(([id, name, size]) => <button key={id} type="button" className={format === id ? 'selected' : ''} onClick={() => setFormat(id)}><span>{id === 'story' ? '▯' : id === 'mixed' ? '▣▯' : '▣'}</span><div><strong>{name}</strong><small>{size}</small></div>{format === id && <Check />}</button>)}</div></>}

        {format && <section className="cs-advanced-extras">
          <div className="cs-advanced-extras-heading"><span><WandSparkles /></span><div><strong>{EXTRAS_TITLES[modeId]}</strong><small>Opcional · fácil de cambiar</small></div></div>
          {modeId === 'collection' && <label className="cs-advanced-text-field"><span>Nombre de la colección <em>Opcional</em></span><input maxLength="80" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} placeholder="Ej. Esenciales de verano"/></label>}
          <label className="cs-advanced-objective"><span>{modeId === 'carousel' ? 'Objetivo del carrusel' : modeId === 'week' ? 'Objetivo de contenido' : 'Objetivo comercial'}</span><textarea maxLength="260" value={baseForm.creative_instruction || ''} onChange={(event) => updateOptions({ creative_instruction: event.target.value })} placeholder={modeId === 'week' ? 'Ej. Mantener activa mi cuenta y presentar diferentes usos del producto.' : 'Ej. Presentar esta colección y motivar visitas al local.'}/><small>La IA lo usa para orientar toda la serie sin copiar instrucciones internas.</small></label>
          {['carousel', 'collection', 'campaign'].includes(modeId) && <label className="cs-advanced-text-field"><span>{modeId === 'collection' ? 'Texto común de la campaña' : 'Mensaje principal'} <em>Opcional</em></span><input maxLength="120" value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder={modeId === 'collection' ? 'Déjalo vacío para que la IA lo proponga' : 'Ej. Descubre una nueva forma de disfrutar tu producto'}/></label>}
          {modeId === 'carousel' && <label className="cs-advanced-objective"><span>Beneficios o características <em>Opcional</em></span><textarea maxLength="220" value={benefits} onChange={(event) => setBenefits(event.target.value)} placeholder="Ej. Ligero, artesanal y fácil de combinar"/><small>Escribe solo características reales del producto.</small></label>}
          {modeId === 'week' && <label className="cs-advanced-objective"><span>Tema de cada día <em>Opcional</em></span><textarea maxLength="300" value={dailyTopics} onChange={(event) => setDailyTopics(event.target.value)} placeholder="Ej. Día 1: presentación · Día 2: uso real · Día 3: promoción"/><small>Si lo dejas vacío, la IA crea un calendario variado automáticamente.</small></label>}
          {modeId === 'campaign' && <div className="cs-advanced-two-fields"><label className="cs-advanced-text-field"><span>Fecha o vigencia <em>Opcional</em></span><input maxLength="80" value={validity} onChange={(event) => setValidity(event.target.value)} placeholder="Ej. Válido hasta el domingo"/></label><label className="cs-advanced-text-field"><span>Público objetivo <em>Opcional</em></span><input maxLength="100" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Ej. Mujeres emprendedoras de 25 a 45 años"/></label></div>}

          <div className="cs-advanced-option-heading"><Users /><div><strong>¿Quieres incluir personas?</strong><small>La IA las integra únicamente cuando ayudan a mostrar el producto.</small></div></div>
          <div className="cs-advanced-person-options">{PERSON_OPTIONS.map(([id, label, Icon]) => <button type="button" key={id} className={personMode === id ? 'selected' : ''} onClick={() => setPersonMode(id)}><Icon/><span>{label}</span>{personMode === id && <Check/>}</button>)}</div>

          <div className="cs-advanced-option-heading"><Palette /><div><strong>Estilo visual y fondo</strong><small>Mantendremos esta estética en todas las piezas.</small></div></div>
          <div className="cs-advanced-style-options">{VISUAL_STYLES.map(([id, label]) => <button type="button" key={id} className={visualStyle === id ? 'selected' : ''} onClick={() => setVisualStyle(id)}>{label}{visualStyle === id && <Check/>}</button>)}</div>
          <label className="cs-advanced-text-field"><span>Fondo o ambiente que imaginas <em>Opcional</em></span><input maxLength="120" value={visualDirection} onChange={(event) => setVisualDirection(event.target.value)} placeholder="Ej. Fondo claro con madera y luz natural"/></label>

          <label className="cs-advanced-text-field"><span><DollarSign/> {modeId === 'collection' ? 'Precio individual o lista de precios' : 'Precio'} <em>Opcional</em></span><input maxLength="220" value={priceDetails} onChange={(event) => setPriceDetails(event.target.value)} placeholder={modeId === 'collection' ? 'Ej. Vela $12 · Taza $15' : 'Ej. $24,99'}/><small>Solo se mostrará exactamente el precio que escribas.</small></label>
          {showPromotion && <div className="cs-advanced-promotion-fields"><label className="cs-advanced-discount"><span><Percent /> Descuento <em>Opcional</em></span><div><input type="number" inputMode="numeric" min="1" max="90" value={promotionPercent} onChange={(event) => { const value = event.target.value.replace(/\D/g, '').slice(0, 2); setPromotionPercent(value ? String(Math.min(90, Number(value))) : ''); }} placeholder="20"/><b>%</b></div><small>Solo mostraremos el porcentaje exacto.</small></label><label className="cs-advanced-promotion-detail"><span>Promoción o condición <em>Opcional</em></span><input maxLength="100" value={promotionDetails} onChange={(event) => setPromotionDetails(event.target.value)} placeholder="Ej. Solo este fin de semana"/><small>Déjalo vacío si prefieres un mensaje comercial sin promoción.</small></label></div>}
          <div className="cs-advanced-brand-title"><Tag /><div><strong>Marca / logo</strong><small>Usaremos el archivo original dentro de cada diseño.</small></div></div>
          <div className="cs-advanced-brand-options">
            <button type="button" className={String(baseForm.logo_id) === 'none' ? 'selected' : ''} onClick={() => updateOptions({ logo_id: 'none' })}><span><EyeOff /></span><strong>Sin logo</strong>{String(baseForm.logo_id) === 'none' && <Check />}</button>
            {(data.logos || []).map((logo) => <button type="button" key={logo.id} className={Number(baseForm.logo_id) === Number(logo.id) ? 'selected' : ''} onClick={() => updateOptions({ logo_id: logo.id })}><img src={logo.image_data} alt=""/><strong>{logo.name}</strong>{Number(baseForm.logo_id) === Number(logo.id) && <Check />}</button>)}
          </div>
          {!(data.logos || []).length && <small className="cs-advanced-no-logo">Puedes agregar un logo desde Marca y volver a esta pantalla.</small>}
          <div className="cs-advanced-contact-title"><Phone /><div><strong>WhatsApp y dirección</strong><small>Se guardan para tus próximas creaciones.</small></div></div>
          <div className="cs-advanced-contact-grid">
            <label><span>WhatsApp <em>Opcional</em></span><div><Phone /><input inputMode="tel" autoComplete="tel" maxLength="30" value={baseForm.contact_whatsapp || ''} onChange={(event) => updateOptions({ contact_whatsapp: event.target.value })} placeholder="0999999999"/></div></label>
            <label><span>Dirección o ubicación <em>Opcional</em></span><div><MapPin /><input maxLength="80" value={baseForm.contact_location || ''} onChange={(event) => updateOptions({ contact_location: event.target.value })} placeholder="Ej. Centro de Ambato"/></div></label>
          </div>
        </section>}

        {canConfirm && <div className="cs-advanced-confirm"><div><span>Esta creación utilizará</span><strong>{totalCredits} créditos</strong><small>{selectedTypeName} · {formats.find(([id]) => id === format)?.[1]}</small></div><button type="button" disabled={busy} onClick={createBatch}>{busy ? 'Creando…' : credits < totalCredits ? 'Mejorar plan' : 'Crear contenido'}<ChevronRight /></button></div>}
        {busy && <div className="cs-advanced-batch-progress"><div><i style={{ width: `${Math.max(8, (progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div><strong>{progress.label || 'Creando el contenido'}</strong><small>{progress.done} de {progress.total} piezas listas. Puedes cerrar esta ventana: las imágenes enviadas seguirán procesándose.</small></div>}
        {error && <div className="cs-advanced-error">{error}</div>}
      </div>}
    </section>
  </div>;

  return <>{launcher}{createPortal(panel, document.body)}</>;
}
