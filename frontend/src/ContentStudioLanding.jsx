import React, { useEffect, useState } from 'react';
import {
  ArrowRight, Check, ChevronRight, Image as ImageIcon, Instagram,
  Mail, Menu, MessageCircle, ShieldCheck, ShoppingBag, Sparkles,
  Upload, UserRound, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio-landing.css';

const FALLBACK_PLANS = [
  { id: 'inicio', name: 'Inicio', photos: 10, price: 9.5, days: 8 },
  { id: 'emprendedor', name: 'Emprendedor', photos: 25, price: 20, days: 15 },
  { id: 'negocio', name: 'Negocio', photos: 60, price: 35, days: 30 },
  { id: 'pro', name: 'Pro', photos: 150, price: 60, days: 30 }
];

const HERO_MODES = ['fotografía de producto', 'contenido con modelos', 'publicidad para redes', 'catálogos profesionales'];
const INDUSTRIES = ['CALZADO', 'MODA', 'ACCESORIOS', 'BELLEZA', 'HOGAR', 'ALIMENTOS'];
const IS_STUDIO_DOMAIN = typeof window !== 'undefined' && ['estudioscreativos.com', 'www.estudioscreativos.com'].includes(window.location.hostname.toLowerCase());
const STUDIO_HOME = IS_STUDIO_DOMAIN ? '/' : '/estudio-creativo';
const STUDIO_LOGIN = IS_STUDIO_DOMAIN ? '/ingresar' : '/';

const FEATURES = [
  { id: 'editorial', label: 'Con modelos', title: 'Pon tu producto en una escena que se siente real.', copy: 'Elige una mujer, un hombre o un animal. Estudios Creativos adapta el entorno y conserva la forma, color y detalles del producto.', image: '/content-studio/guides/editorial.jpg' },
  { id: 'social', label: 'Marketing y anuncios', title: 'Crea piezas diseñadas para detener el scroll.', copy: 'Genera posts e historias con textos, beneficios reales, composición comercial y el tono de tu marca.', image: '/content-studio/guides/social.jpg' },
  { id: 'catalog', label: 'Catálogo', title: 'Convierte una foto sencilla en una imagen que vende.', copy: 'Fondos limpios, luz de estudio y presentación profesional para tiendas, catálogos y WhatsApp.', image: '/content-studio/guides/catalog.jpg' },
  { id: 'detail', label: 'Detalle premium', title: 'Acerca al cliente a cada textura y acabado.', copy: 'Resalta materiales, costuras y terminaciones con una fotografía de detalle cuidada.', image: '/content-studio/guides/detail.jpg' }
];

const formatPlanPrice = (price) => (Number(price) % 1 === 0 ? String(Number(price)) : Number(price).toFixed(2));

export default function ContentStudioLanding() {
  const [data, setData] = useState({ plans: FALLBACK_PLANS, contact: { phone_display: '098 376 3419', email: 'promoters.ecu@gmail.com' }, transfer: {} });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heroMode, setHeroMode] = useState(0);
  const [activeFeature, setActiveFeature] = useState('editorial');

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Estudios Creativos';
    return () => { document.title = previousTitle; };
  }, []);
  useEffect(() => { api('/content-studio/public').then(setData).catch(() => {}); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setHeroMode((current) => (current + 1) % HERO_MODES.length), 2600);
    return () => window.clearInterval(timer);
  }, []);

  const choosePlan = (plan) => { setSelectedPlan(plan); setMenuOpen(false); };
  const feature = FEATURES.find((item) => item.id === activeFeature) || FEATURES[0];

  return <div className="csl-page">
    <header className="csl-header">
      <a className="csl-logo" href={STUDIO_HOME}><span><WandSparkles size={18} /></span><strong>Estudios Creativos</strong></a>
      <button className="csl-menu" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir menú"><Menu /></button>
      <nav className={menuOpen ? 'open' : ''}>
        <a href="#funciones" onClick={() => setMenuOpen(false)}>Funciones</a>
        <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Cómo funciona</a>
        <a href="#planes" onClick={() => setMenuOpen(false)}>Planes</a>
        <a href="#contacto" onClick={() => setMenuOpen(false)}>Contacto</a>
      </nav>
      <a className="csl-login" href={STUDIO_LOGIN}>Iniciar sesión</a>
      <button className="csl-start" type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Probar Estudios Creativos</button>
    </header>

    <main>
      <section className="csl-hero">
        <div className="csl-hero-title">
          <h1>La herramienta de diseño con IA para</h1>
          <div className="csl-changing-line" aria-live="polite"><span key={HERO_MODES[heroMode]}>{HERO_MODES[heroMode]}</span></div>
          <p>Crea contenido profesional para tus productos sin aprender diseño ni escribir prompts.</p>
          <div className="csl-hero-actions">
            <button type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Empieza a crear <ArrowRight /></button>
            <button type="button" onClick={() => setExamplesOpen(true)}>Ver ejemplos</button>
          </div>
        </div>

        <div className="csl-app-stage">
          <div className="csl-app-window">
            <div className="csl-window-bar"><div><i /><i /><i /></div><span>ESTUDIOS CREATIVOS</span><strong>24 créditos</strong></div>
            <div className="csl-window-body">
              <aside><span className="active"><Sparkles /></span><span><ImageIcon /></span><span><ShoppingBag /></span><span><UserRound /></span></aside>
              <section className="csl-window-controls">
                <small>CREAR CONTENIDO</small><h2>Sube tu producto</h2>
                <div className="csl-window-upload"><Upload /><strong>Foto cargada</strong><span>Lista para crear</span></div>
                <div className="csl-window-types"><button className="active">Editorial</button><button>Redes</button><button>Catálogo</button><button>Detalle</button></div>
                <button className="csl-window-generate"><WandSparkles /> Generar imagen</button>
              </section>
              <section className="csl-window-results">
                <div className="csl-window-grid">{FEATURES.map((item) => <figure key={item.id}><img src={item.image} alt={item.label} /><figcaption>{item.label}</figcaption></figure>)}</div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section className="csl-industries"><span>Creado para negocios de todos los tamaños</span><div className="csl-industry-marquee"><div className="csl-industry-track">{[...INDUSTRIES, ...INDUSTRIES].map((industry, index) => <strong aria-hidden={index >= INDUSTRIES.length} key={`${industry}-${index}`}><i />{industry}</strong>)}</div></div></section>

      <section className="csl-features" id="funciones">
        <div className="csl-section-heading"><span>CONTENIDO PARA CADA NECESIDAD</span><h2>Crea contenido que respeta<br />tu producto y tu marca.</h2><p>Una herramienta sencilla para producir todo lo que tu negocio necesita.</p></div>
        <div className="csl-feature-tabs" role="tablist" aria-label="Tipos de contenido">{FEATURES.map((item) => <button type="button" role="tab" aria-selected={activeFeature === item.id} className={activeFeature === item.id ? 'active' : ''} onClick={() => setActiveFeature(item.id)} key={item.id}>{item.label}</button>)}</div>
        <article className="csl-feature-stage" key={feature.id}>
          <div><span>{feature.label}</span><h3>{feature.title}</h3><p>{feature.copy}</p><button type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Crear este contenido <ArrowRight /></button></div>
          <figure><img src={feature.image} alt={feature.title} /></figure>
        </article>
      </section>

      <section className="csl-how" id="como-funciona">
        <div className="csl-how-heading"><span>ASÍ DE FÁCIL</span><h2>De una foto a una campaña<br />en tres pasos.</h2></div>
        <div className="csl-how-grid">
          <article><small>01</small><span><Upload /></span><h3>Sube una foto</h3><p>Una imagen clara tomada desde cualquier celular es suficiente.</p></article>
          <article><small>02</small><span><Sparkles /></span><h3>Elige qué crear</h3><p>Selecciona modelo, redes, catálogo o detalle premium.</p></article>
          <article><small>03</small><span><Check /></span><h3>Descarga y publica</h3><p>Recibe el resultado terminado en alta calidad y con tu marca.</p></article>
        </div>
      </section>

      <section className="csl-brand-block">
        <div><span>IDENTIDAD DE MARCA</span><h2>Tu logo. Tus contactos.<br />Tu estilo.</h2><p>Guarda tus marcas y aplícalas cuando quieras. También puedes agregar WhatsApp y ubicación en una composición limpia.</p><button type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Empezar ahora <ArrowRight /></button></div>
        <div className="csl-brand-preview"><div><ShieldCheck /><strong>Tu identidad se mantiene</strong><small>Logo oficial y datos exactos</small></div><img src="/content-studio/guides/detail.jpg" alt="Detalle premium con identidad de marca" /></div>
      </section>

      <section className="csl-pricing" id="planes">
        <div className="csl-section-heading"><span>PLANES</span><h2>Elige cuántas imágenes necesitas.</h2><p>Pago único por transferencia. Sin cobros automáticos.</p></div>
        <div className="csl-plan-grid">{(data.plans || FALLBACK_PLANS).map((plan, index) => <article className={index === 1 ? 'featured' : ''} key={plan.id}>{index === 1 && <em>Más elegido</em>}<span>{plan.name}</span><div><strong>${formatPlanPrice(plan.price)}</strong><small>USD</small></div><h3>{plan.photos} imágenes</h3><p>Disponibles durante {plan.days} días</p><ul><li><Check /> Todos los tipos de contenido</li><li><Check /> Logos de tus marcas</li><li><Check /> Descarga en alta calidad</li><li><Check /> Historial de creaciones</li></ul><button type="button" onClick={() => choosePlan(plan)}>Elegir plan <ArrowRight /></button></article>)}</div>
      </section>

      <section className="csl-contact" id="contacto"><h2>Empieza a crear contenido<br />que se vea profesional.</h2><div><button type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Crear mis imágenes <ArrowRight /></button><a href={`https://wa.me/593${String(data.contact?.phone || '0983763419').replace(/\D/g, '').replace(/^0/, '')}`} target="_blank" rel="noreferrer"><MessageCircle /> Hablar por WhatsApp</a></div></section>
    </main>

    <footer className="csl-footer"><a className="csl-logo" href={STUDIO_HOME}><span><WandSparkles size={18} /></span><strong>Estudios Creativos</strong></a><p>Contenido profesional para negocios que quieren crecer.</p><div><a href="#planes">Planes</a><a href={STUDIO_LOGIN}>Iniciar sesión</a><a href={`mailto:${data.contact?.email}`}><Mail size={15} /> Contacto</a><a href="https://www.instagram.com" target="_blank" rel="noreferrer"><Instagram size={16} /></a></div></footer>
    {examplesOpen && <ExamplesModal onClose={() => setExamplesOpen(false)} />}
    {selectedPlan && <TransferCheckout plan={selectedPlan} transfer={data.transfer || {}} contact={data.contact || {}} onClose={() => setSelectedPlan(null)} />}
  </div>;
}

function ExamplesModal({ onClose }) {
  return <div className="csl-modal csl-examples-modal" role="dialog" aria-modal="true" aria-label="Ejemplos de resultados"><section><button className="csl-modal-close" type="button" onClick={onClose}><X /></button><span className="csl-modal-eyebrow">RESULTADOS REALES</span><h2>De la foto que tienes al contenido que quieres publicar.</h2><p>Dos ejemplos creados dentro de Estudios Creativos.</p><div className="csl-example-grid"><article className="csl-example-before-after"><div><figure><img src="/content-studio/results/botin-antes-nuevo.png" alt="Foto original del botín" /><figcaption>Foto subida</figcaption></figure><span><ArrowRight /></span><figure><img src="/content-studio/results/botin-despues-nuevo.png" alt="Resultado editorial con los botines" /><figcaption>Resultado creado</figcaption></figure></div><strong>Botines: de celular a editorial</strong><p>Una escena de moda que conserva el modelo y sus detalles.</p></article><article className="csl-example-before-after"><div><figure><img src="/content-studio/results/vaquita-antes.png" alt="Foto original de la vaquita que corre" /><figcaption>Foto subida</figcaption></figure><span><ArrowRight /></span><figure><img src="/content-studio/results/vaquita-resultado.webp" alt="Post creado de la vaquita que corre" /><figcaption>Resultado creado</figcaption></figure></div><strong>La vaquita que corre</strong><p>Un post para redes diseñado con texto, producto y estilo comercial.</p></article></div></section></div>;
}

function TransferCheckout({ plan, transfer, contact, onClose }) {
  const [form, setForm] = useState({ customer_name: '', business_name: '', whatsapp: '', email: '', username: '', password: '', plan_id: plan.id });
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { setOrder(await api('/content-studio/public/orders', { method: 'POST', body: JSON.stringify(form) })); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  const details = order?.transfer || transfer;
  return <div className="csl-modal" role="dialog" aria-modal="true" aria-label="Comprar plan"><section><button className="csl-modal-close" type="button" onClick={onClose}><X /></button>{!order ? <><span className="csl-modal-eyebrow">PLAN {plan.name.toUpperCase()}</span><h2>Activa tus {plan.photos} imágenes.</h2><p>Completa los datos de la cuenta. Después realiza la transferencia de <strong>${formatPlanPrice(plan.price)}</strong>.</p><form onSubmit={submit}><label>Nombre completo<input required value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} /></label><label>Nombre del negocio<input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} /></label><label>WhatsApp<input required inputMode="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} placeholder="098 376 3419" /></label><label>Correo electrónico<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Usuario para ingresar<input required pattern="[a-z0-9._-]{3,80}" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/\s+/g, '.') })} /></label><label>Contraseña<input required type="password" minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>{error && <div className="csl-form-error">{error}</div>}<button disabled={busy}>{busy ? 'Preparando transferencia...' : <>Continuar al pago <ArrowRight /></>}</button></form></> : <div className="csl-transfer-success"><span><Check /></span><small>SOLICITUD CREADA</small><h2>{order.order.order_number}</h2><p>Transfiere <strong>${Number(order.order.amount).toFixed(2)}</strong> y envíanos el comprobante para activar tu cuenta.</p>{details.account_number ? <dl><div><dt>Banco</dt><dd>{details.bank_name}</dd></div><div><dt>Beneficiario</dt><dd>{details.beneficiary}</dd></div><div><dt>{details.account_type || 'Cuenta'}</dt><dd>{details.account_number}</dd></div>{details.identification && <div><dt>Identificación</dt><dd>{details.identification}</dd></div>}</dl> : <div className="csl-bank-pending">Solicita los datos bancarios directamente por WhatsApp.</div>}<a href={details.whatsapp_url || 'https://wa.me/593983763419'} target="_blank" rel="noreferrer"><MessageCircle /> Enviar comprobante por WhatsApp</a><p className="csl-transfer-help">Confirmaremos el pago manualmente. Luego podrás ingresar con el usuario y contraseña que acabas de crear.</p><small>{contact.email}</small></div>}</section></div>;
}
