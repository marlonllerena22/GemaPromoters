import React, { useEffect, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Check, Image as ImageIcon, Instagram,
  Mail, Menu, MessageCircle, ShieldCheck, Sparkles, Upload, WandSparkles, X
} from 'lucide-react';
import { api } from './api.js';
import './content-studio-landing.css';

const FALLBACK_PLANS = [
  { id: 'inicio', name: 'Inicio', photos: 10, price: 10, days: 8 },
  { id: 'emprendedor', name: 'Emprendedor', photos: 25, price: 20, days: 15 },
  { id: 'negocio', name: 'Negocio', photos: 60, price: 35, days: 30 },
  { id: 'pro', name: 'Pro', photos: 150, price: 60, days: 30 }
];

const CREATIONS = [
  { image: '/content-studio/guides/editorial.jpg', label: 'Editorial con modelo', className: 'editorial' },
  { image: '/content-studio/guides/catalog.jpg', label: 'Catálogo profesional', className: 'catalog' },
  { image: '/content-studio/guides/social.jpg', label: 'Contenido para redes', className: 'social' },
  { image: '/content-studio/guides/detail.jpg', label: 'Detalle premium', className: 'detail' }
];

export default function ContentStudioLanding() {
  const [data, setData] = useState({ plans: FALLBACK_PLANS, contact: { phone_display: '098 376 3419', email: 'promoters.ecu@gmail.com' }, transfer: {} });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api('/content-studio/public').then(setData).catch(() => {});
  }, []);

  function choosePlan(plan) {
    setSelectedPlan(plan);
    setMenuOpen(false);
  }

  return <div className="csl-page">
    <header className="csl-header">
      <a className="csl-logo" href="/estudio-creativo"><span><WandSparkles size={20} /></span><strong>ESTUDIO CREATIVO</strong></a>
      <button className="csl-menu" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir menú"><Menu /></button>
      <nav className={menuOpen ? 'open' : ''}>
        <a href="#resultados" onClick={() => setMenuOpen(false)}>Resultados</a>
        <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Cómo funciona</a>
        <a href="#planes" onClick={() => setMenuOpen(false)}>Planes</a>
        <a href="#contacto" onClick={() => setMenuOpen(false)}>Contacto</a>
      </nav>
      <a className="csl-login" href="/">Iniciar sesión</a>
      <button className="csl-start" type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Empezar <ArrowRight size={16} /></button>
    </header>

    <main>
      <section className="csl-hero">
        <div className="csl-hero-copy">
          <span className="csl-kicker"><Sparkles size={15} /> Fotografía de producto con IA</span>
          <h1><span>Una foto sencilla.</span><em>Contenido que vende.</em></h1>
          <p>Convierte la foto de cualquier producto en imágenes profesionales para catálogo, redes sociales y campañas, sin escribir prompts ni saber de diseño.</p>
          <div className="csl-hero-actions"><button type="button" onClick={() => choosePlan(data.plans?.[1] || FALLBACK_PLANS[1])}>Crear mis imágenes <ArrowRight /></button><a href="#resultados">Ver resultados</a></div>
          <div className="csl-trust"><span><Check /> Producto fiel al original</span><span><Check /> Listo para publicar</span><span><Check /> Sin conocimientos técnicos</span></div>
        </div>
        <div className="csl-hero-visual" aria-label="Ejemplos creados con Estudio Creativo">
          <div className="csl-orbit one"><Sparkles /></div><div className="csl-orbit two"><ImageIcon /></div>
          <article className="main"><img src="/content-studio/guides/editorial.jpg" alt="Editorial profesional creada con IA" /><span>Editorial con modelo</span></article>
          <article className="floating top"><img src="/content-studio/guides/catalog.jpg" alt="Foto profesional para catálogo" /></article>
          <article className="floating bottom"><img src="/content-studio/guides/detail.jpg" alt="Detalle premium de producto" /></article>
          <div className="csl-result-badge"><BadgeCheck /><div><strong>Resultado profesional</strong><small>en pocos minutos</small></div></div>
        </div>
      </section>

      <section className="csl-proof"><span>Creado para negocios de</span><div><strong>CALZADO</strong><strong>MODA</strong><strong>ACCESORIOS</strong><strong>BELLEZA</strong><strong>PRODUCTOS</strong></div></section>

      <section className="csl-results" id="resultados">
        <div className="csl-section-heading"><span>UN ESTUDIO EN TU NEGOCIO</span><h2>Todo el contenido que necesitas.</h2><p>Elige el resultado. La plataforma se encarga de la dirección creativa.</p></div>
        <div className="csl-gallery">{CREATIONS.map((item) => <article className={item.className} key={item.label}><img src={item.image} alt={item.label} /><div><strong>{item.label}</strong><span>Generar <ArrowRight /></span></div></article>)}</div>
      </section>

      <section className="csl-how" id="como-funciona">
        <div className="csl-how-visual"><img src="/content-studio/guides/catalog.jpg" alt="Producto preparado para catálogo" /><div><Upload /><strong>Sube cualquier producto</strong><small>Zapatos, carteras, ropa, cosméticos y más</small></div></div>
        <div className="csl-how-copy"><span>ASÍ DE FÁCIL</span><h2>De tu cámara a una campaña profesional.</h2><ol><li><b>01</b><div><strong>Sube la foto</strong><p>Una foto clara tomada desde tu celular es suficiente.</p></div></li><li><b>02</b><div><strong>Elige el tipo de contenido</strong><p>Modelo, catálogo, post para redes o detalle premium.</p></div></li><li><b>03</b><div><strong>Descarga y publica</strong><p>Recibe la imagen terminada en alta calidad.</p></div></li></ol></div>
      </section>

      <section className="csl-brand-feature">
        <div><span><ShieldCheck /></span><p>Tu producto conserva su diseño, materiales y detalles importantes.</p></div>
        <h2>Tu identidad.<br />Tu producto.<br /><em>Mejor presentado.</em></h2>
        <div><span><WandSparkles /></span><p>Guarda tus logos y aplícalos de forma profesional en cada creación.</p></div>
      </section>

      <section className="csl-pricing" id="planes">
        <div className="csl-section-heading"><span>PLANES SIMPLES</span><h2>Elige cuántas imágenes necesitas.</h2><p>Pago único por transferencia. Sin cobros automáticos.</p></div>
        <div className="csl-plan-grid">{(data.plans || FALLBACK_PLANS).map((plan, index) => <article className={index === 1 ? 'featured' : ''} key={plan.id}>{index === 1 && <em>Más elegido</em>}<span>{plan.name}</span><div><strong>${plan.price}</strong><small>USD</small></div><h3>{plan.photos} imágenes</h3><p>Disponibles durante {plan.days} días</p><ul><li><Check /> Todos los tipos de contenido</li><li><Check /> Logos de tus marcas</li><li><Check /> Descarga en alta calidad</li><li><Check /> Historial de creaciones</li></ul><button type="button" onClick={() => choosePlan(plan)}>Elegir plan <ArrowRight /></button></article>)}</div>
        <p className="csl-payment-note"><ShieldCheck /> Por ahora aceptamos únicamente transferencia bancaria. Tu cuenta se activa después de verificar el pago.</p>
      </section>

      <section className="csl-contact" id="contacto"><div><span>¿TIENES PREGUNTAS?</span><h2>Estamos para ayudarte.</h2></div><div><a href={`https://wa.me/593${String(data.contact?.phone || '0983763419').replace(/\D/g, '').replace(/^0/, '')}`} target="_blank" rel="noreferrer"><MessageCircle /> {data.contact?.phone_display || '098 376 3419'}</a><a href={`mailto:${data.contact?.email}`}><Mail /> {data.contact?.email}</a></div></section>
    </main>

    <footer className="csl-footer"><a className="csl-logo" href="/estudio-creativo"><span><WandSparkles size={20} /></span><strong>ESTUDIO CREATIVO</strong></a><p>Contenido profesional para marcas que quieren crecer.</p><div><a href="#planes">Planes</a><a href="/">Iniciar sesión</a><a href={`https://wa.me/593983763419`}><Instagram size={17} /> Contacto</a></div></footer>
    {selectedPlan && <TransferCheckout plan={selectedPlan} transfer={data.transfer || {}} contact={data.contact || {}} onClose={() => setSelectedPlan(null)} />}
  </div>;
}

function TransferCheckout({ plan, transfer, contact, onClose }) {
  const [form, setForm] = useState({ customer_name: '', business_name: '', whatsapp: '', email: '', username: '', password: '', plan_id: plan.id });
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { setOrder(await api('/content-studio/public/orders', { method: 'POST', body: JSON.stringify(form) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const details = order?.transfer || transfer;
  return <div className="csl-modal" role="dialog" aria-modal="true" aria-label="Comprar plan">
    <section>
      <button className="csl-modal-close" type="button" onClick={onClose}><X /></button>
      {!order ? <>
        <span className="csl-kicker">PLAN {plan.name.toUpperCase()}</span><h2>Activa tus {plan.photos} imágenes.</h2><p>Completa los datos de la cuenta. Después realiza la transferencia de <strong>${plan.price}</strong>.</p>
        <form onSubmit={submit}><label>Nombre completo<input required value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} /></label><label>Nombre del negocio<input value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} /></label><label>WhatsApp<input required inputMode="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} placeholder="098 376 3419" /></label><label>Correo electrónico<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Usuario para ingresar<input required pattern="[a-z0-9._-]{3,80}" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/\s+/g, '.') })} /></label><label>Contraseña<input required type="password" minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>{error && <div className="csl-form-error">{error}</div>}<button disabled={busy}>{busy ? 'Preparando transferencia...' : <>Continuar al pago <ArrowRight /></>}</button></form>
      </> : <div className="csl-transfer-success"><span><Check /></span><small>SOLICITUD CREADA</small><h2>{order.order.order_number}</h2><p>Transfiere <strong>${Number(order.order.amount).toFixed(2)}</strong> y envíanos el comprobante para activar tu cuenta.</p>{details.account_number ? <dl><div><dt>Banco</dt><dd>{details.bank_name}</dd></div><div><dt>Beneficiario</dt><dd>{details.beneficiary}</dd></div><div><dt>{details.account_type || 'Cuenta'}</dt><dd>{details.account_number}</dd></div>{details.identification && <div><dt>Identificación</dt><dd>{details.identification}</dd></div>}</dl> : <div className="csl-bank-pending">Solicita los datos bancarios directamente por WhatsApp.</div>}<a href={details.whatsapp_url || `https://wa.me/593983763419`} target="_blank" rel="noreferrer"><MessageCircle /> Enviar comprobante por WhatsApp</a><p className="csl-transfer-help">Confirmaremos el pago manualmente. Luego podrás ingresar con el usuario y contraseña que acabas de crear.</p><small>{contact.email}</small></div>}
    </section>
  </div>;
}
