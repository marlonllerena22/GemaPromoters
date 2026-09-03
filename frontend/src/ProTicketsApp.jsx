import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Plus,
  QrCode,
  Save,
  Search,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  Trash2,
  Upload,
  UserRound,
  X
} from 'lucide-react';
import { API_URL, getToken } from './api.js';
import './protickets.css';

const CUSTOMER_TOKEN_KEY = 'protickets_customer_token';
const CUSTOMER_KEY = 'protickets_customer';

const emptyEvent = {
  title: '',
  slug: '',
  subtitle: '',
  description: '',
  venue: '',
  city: '',
  address: '',
  event_date: '',
  doors_time: '',
  hero_image_url: '',
  card_image_url: '',
  hero_display_mode: 'cover',
  organizer: '',
  terms: '',
  bendo_payment_url: '',
  status: 'draft',
  featured: false,
  sales_enabled: false,
  payment_enabled: false,
  is_past: false
};

const emptyTicketType = {
  name: '',
  description: '',
  price: 0,
  service_fee: 0,
  stock: 0,
  max_per_order: 6,
  status: 'active',
  sort_order: 0
};

const emptyBanner = {
  image_url: '',
  mobile_image_url: '',
  title: '',
  subtitle: '',
  cta_label: 'Ver evento',
  cta_url: '',
  status: 'active',
  show_overlay: true,
  sort_order: 0
};

function readCustomer() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveCustomerSession(payload) {
  localStorage.setItem(CUSTOMER_TOKEN_KEY, payload.token);
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(payload.customer));
}

function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
}

async function ticketingApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = options.admin ? getToken() : localStorage.getItem(CUSTOMER_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}/ticketing${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'No se pudo completar la accion');
  return data;
}

function money(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function formatDate(value, withTime = false) {
  if (!value) return 'Fecha por confirmar';
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'long',
    ...(withTime ? { timeStyle: 'short' } : {})
  }).format(date);
}

function statusLabel(status) {
  return ({
    draft: 'Borrador',
    published: 'Publicado',
    sold_out: 'Agotado',
    archived: 'Archivado',
    pending: 'Pendiente',
    paid: 'Pagado',
    rejected: 'Rechazado',
    expired: 'Expirado',
    refunded: 'Reembolsado',
    valid: 'Vigente',
    used: 'Utilizada',
    void: 'Anulada'
  })[status] || status;
}

function fileToDataUrl(file, callback) {
  if (!file) return;
  if (!file.type.startsWith('image/')) throw new Error('Selecciona una imagen valida');
  if (file.size > 7 * 1024 * 1024) throw new Error('La imagen no puede superar 7 MB');
  const reader = new FileReader();
  reader.onload = () => callback(String(reader.result || ''));
  reader.readAsDataURL(file);
}

function Logo({ compact = false }) {
  return (
    <a className={`pt-logo ${compact ? 'compact' : ''}`} href="/tickets" aria-label="ProTickets inicio">
      <img src="/protickets/protickets-logo.png" alt="ProTickets" />
    </a>
  );
}

function PublicHeader({ customer, onAccount }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="pt-header">
      <Logo />
      <button className="pt-menu" type="button" aria-label="Abrir menu" onClick={() => setOpen((value) => !value)}>
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? 'open' : ''}>
        <a href="/tickets#eventos" onClick={() => setOpen(false)}>Eventos</a>
        <a href="/tickets/mi-cuenta" onClick={() => setOpen(false)}>Mis entradas</a>
        <button className="pt-account-button" type="button" onClick={() => { setOpen(false); onAccount(); }}>
          <UserRound size={18} />
          {customer ? customer.name.split(' ')[0] : 'Ingresar'}
        </button>
      </nav>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="pt-footer">
      <Logo compact />
      <div>
        <strong>Compra simple. Acceso seguro.</strong>
        <span>Entradas digitales con codigo unico para cada asistente.</span>
      </div>
      <span>ProTickets Ecuador</span>
    </footer>
  );
}

function GoogleButton({ clientId, onSuccess, onError }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    function render() {
      if (cancelled || !ref.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: onSuccess });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
    }
    if (window.google?.accounts?.id) render();
    else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = render;
      script.onerror = () => onError?.('No se pudo cargar Google');
      document.head.appendChild(script);
    }
    return () => { cancelled = true; };
  }, [clientId, onSuccess, onError]);
  if (!clientId) return null;
  return <div className="pt-google-button" ref={ref} />;
}

function AccountDialog({ open, googleClientId, onClose, onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', cedula: '', phone: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'forgot-password') {
        const payload = await ticketingApi('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: form.email }) });
        setMessage(payload.message);
        return;
      }
      const payload = await ticketingApi(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) });
      saveCustomerSession(payload);
      onAuthenticated(payload.customer);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function googleSuccess(response) {
    setBusy(true);
    setError('');
    try {
      const payload = await ticketingApi('/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      saveCustomerSession(payload);
      onAuthenticated(payload.customer);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pt-auth-modal" role="dialog" aria-modal="true" aria-label="Cuenta ProTickets">
        <button className="pt-icon-button close" type="button" aria-label="Cerrar" onClick={onClose}><X /></button>
        <Logo compact />
        <p className="pt-eyebrow">TU CUENTA</p>
        <h2>{mode === 'login' ? 'Bienvenido de vuelta' : mode === 'register' ? 'Crea tu cuenta' : 'Recupera tu acceso'}</h2>
        <p>{mode === 'login' ? 'Ingresa para comprar y consultar tus entradas.' : mode === 'register' ? 'Tus entradas quedaran vinculadas a este correo.' : 'Te enviaremos un enlace seguro para crear una contrasena nueva.'}</p>
        {mode !== 'forgot-password' && <GoogleButton clientId={googleClientId} onSuccess={googleSuccess} onError={setError} />}
        {mode !== 'forgot-password' && googleClientId && <div className="pt-divider"><span>o continua con correo</span></div>}
        <form onSubmit={submit}>
          {mode === 'register' && (
            <>
              <label>Nombres completos<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <div className="pt-form-row">
                <label>Cedula<input value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} /></label>
                <label>Celular<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              </div>
            </>
          )}
          <label>Correo electronico<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          {mode !== 'forgot-password' && <label>Contrasena<input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>}
          {mode === 'login' && <button className="pt-forgot-link" type="button" onClick={() => { setMode('forgot-password'); setError(''); setMessage(''); }}>Olvide mi contrasena</button>}
          {error && <div className="pt-alert error">{error}</div>}
          {message && <div className="pt-alert success">{message}</div>}
          <button className="pt-primary wide" disabled={busy} type="submit">
            {busy ? 'Procesando...' : mode === 'login' ? 'Ingresar' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}
            <ArrowRight size={18} />
          </button>
        </form>
        <button className="pt-text-button" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>
          {mode === 'login' ? 'No tengo cuenta. Registrarme' : 'Volver al ingreso'}
        </button>
      </section>
    </div>
  );
}

function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 8) return setError('La contrasena debe tener al menos 8 caracteres');
    if (password !== confirmation) return setError('Las contrasenas no coinciden');
    setBusy(true);
    try {
      const payload = await ticketingApi('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      setMessage(payload.message);
      setPassword('');
      setConfirmation('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-reset-page">
      <section className="pt-reset-card">
        <div className="pt-reset-icon"><KeyRound /></div>
        <p className="pt-eyebrow">SEGURIDAD DE CUENTA</p>
        <h1>Nueva contrasena</h1>
        <p>Crea una clave de al menos 8 caracteres para volver a ingresar a ProTickets.</p>
        {!token ? <div className="pt-alert error">Este enlace de recuperacion no es valido.</div> : !message && (
          <form onSubmit={submit}>
            <label>Nueva contrasena<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirmar contrasena<input required type="password" minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {error && <div className="pt-alert error">{error}</div>}
            <button className="pt-primary wide" disabled={busy} type="submit">{busy ? 'Actualizando...' : 'Guardar nueva contrasena'}<ArrowRight size={18} /></button>
          </form>
        )}
        {message && <div className="pt-alert success">{message}</div>}
        <a className="pt-text-button" href="/tickets">Volver a ProTickets</a>
      </section>
    </main>
  );
}

function EventCard({ event }) {
  const salesEnabled = Boolean(Number(event.sales_enabled));
  const isPast = Boolean(Number(event.is_past));
  const eventState = isPast ? 'Evento pasado' : event.status === 'sold_out' ? 'Agotado' : salesEnabled ? 'Disponible' : 'Proximamente';
  return (
    <article className="pt-event-card">
      <a className="pt-event-image" href={`/tickets/evento/${event.slug}`}>
        <img src={event.card_image_url || event.hero_image_url || '/protickets/kris-r-hero.png'} alt={event.title} />
        <span className={`pt-status ${isPast ? 'past' : salesEnabled ? event.status : 'upcoming'}`}>{eventState}</span>
      </a>
      <div className="pt-event-card-body">
        <span>{event.city || 'Ecuador'}</span>
        <h3>{event.title}</h3>
        <p><CalendarDays size={17} /> {formatDate(event.event_date)}</p>
        <p><MapPin size={17} /> {event.venue || 'Lugar por confirmar'}</p>
        <div>
          <strong>{Number(event.min_price || 0) > 0 ? `Desde ${money(event.min_price)}` : 'Precio por confirmar'}</strong>
          <a className="pt-round-link" href={`/tickets/evento/${event.slug}`} aria-label={`Ver ${event.title}`}><ArrowRight /></a>
        </div>
      </div>
    </article>
  );
}

function HomePage({ data }) {
  const banner = data.banners?.[0];
  const heroEvent = data.events?.find((event) => Number(event.id) === Number(banner?.event_id))
    || data.events?.find((event) => event.featured)
    || data.events?.[0];
  const desktopImage = banner?.image_url || heroEvent?.hero_image_url || '/protickets/kris-r-hero.png';
  const mobileImage = banner?.mobile_image_url || desktopImage;
  const showOverlay = banner?.show_overlay !== 0;
  const availableEvents = data.events?.filter((event) => !Number(event.is_past)) || [];
  const pastEvents = data.events?.filter((event) => Number(event.is_past)) || [];
  return (
    <>
      <section className={`pt-hero ${showOverlay ? 'with-overlay' : 'artwork-only'}`}>
        <picture className="pt-hero-media">
          <source media="(max-width: 760px)" srcSet={mobileImage} />
          <img src={desktopImage} alt={banner?.title || heroEvent?.title || 'Evento ProTickets'} />
        </picture>
        {showOverlay && <div className="pt-hero-shade" />}
        {showOverlay ? (
          <div className="pt-hero-content">
            <span className="pt-live-tag">EVENTO DESTACADO</span>
            <h1>{banner?.title || heroEvent?.title || 'Vive el evento'}</h1>
            <p>{banner?.subtitle || heroEvent?.subtitle || 'Compra tus entradas de forma simple y segura.'}</p>
            {heroEvent && (
              <a className="pt-primary" href={banner?.cta_url || `/tickets/evento/${heroEvent.slug}`}>
                <Ticket size={20} /> {banner?.cta_label || 'Comprar entradas'}
              </a>
            )}
          </div>
        ) : heroEvent && (
          <a className="pt-artwork-cta" href={banner?.cta_url || `/tickets/evento/${heroEvent.slug}`}>
            <Eye size={18} /> {banner?.cta_label || 'Ver evento'}
          </a>
        )}
      </section>
      <section className="pt-section" id="eventos">
        <div className="pt-section-heading">
          <div><p className="pt-eyebrow">AGENDA</p><h2>Eventos disponibles</h2></div>
          <span>{availableEvents.length} {availableEvents.length === 1 ? 'evento' : 'eventos'}</span>
        </div>
        {availableEvents.length ? <div className="pt-event-grid">{availableEvents.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="pt-empty"><CalendarDays /><h3>Muy pronto</h3><p>Estamos preparando nuevos eventos para ti.</p></div>}
      </section>
      {pastEvents.length > 0 && (
        <section className="pt-section pt-past-section">
          <div className="pt-section-heading">
            <div><p className="pt-eyebrow">HISTORIAL</p><h2>Eventos pasados</h2></div>
            <span>{pastEvents.length} {pastEvents.length === 1 ? 'evento' : 'eventos'}</span>
          </div>
          <div className="pt-event-grid">{pastEvents.map((event) => <EventCard key={event.id} event={event} />)}</div>
        </section>
      )}
      <section className="pt-trust-band">
        <div><ShieldCheck /><strong>Compra protegida</strong><span>Pedido identificado y confirmacion controlada.</span></div>
        <div><QrCode /><strong>Entrada digital</strong><span>Recibe un codigo unico directamente en tu correo.</span></div>
        <div><CreditCard /><strong>Pago seguro con PayPhone</strong><span>Paga con tarjeta o saldo PayPhone desde su plataforma protegida.</span></div>
      </section>
    </>
  );
}

function EventPage({ slug, customer, onRequireAccount }) {
  const [event, setEvent] = useState(null);
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [order, setOrder] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [waitingForAccount, setWaitingForAccount] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ticketingApi(`/public/events/${encodeURIComponent(slug)}`)
      .then((result) => {
        setEvent(result);
        setSelected(Number(result.sales_enabled) && !Number(result.is_past)
          ? result.ticket_types?.find((type) => type.status === 'active' && (!Number(result.payment_enabled) || type.available > 0)) || null
          : null);
      })
      .catch((err) => setError(err.message));
  }, [slug]);

  useEffect(() => {
    if (customer && waitingForAccount) {
      setWaitingForAccount(false);
      setCheckoutOpen(true);
    }
  }, [customer, waitingForAccount]);

  function continueToCheckout() {
    if (!customer) {
      setWaitingForAccount(true);
      onRequireAccount();
      return;
    }
    if (!selected) return setError('Selecciona una localidad disponible');
    setCheckoutOpen(true);
  }

  async function reserve(customerData) {
    if (!customer) return onRequireAccount();
    if (!selected) return setError('Selecciona una localidad disponible');
    setBusy(true);
    setError('');
    try {
      const nextOrder = await ticketingApi('/orders', { method: 'POST', body: JSON.stringify({ ticket_type_id: selected.id, quantity, customer: customerData }) });
      setCheckoutOpen(false);
      setOrder(nextOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeReservedOrder() {
    if (!order || !window.confirm('Quitar esta reserva pendiente?')) return;
    setBusy(true);
    setError('');
    try {
      await ticketingApi(`/me/orders/${order.id}`, { method: 'DELETE' });
      setOrder(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !event) return <div className="pt-page-state"><Ticket /><h2>{error}</h2><a href="/tickets">Volver al inicio</a></div>;
  if (!event) return <div className="pt-page-state">Cargando evento...</div>;

  const salesEnabled = Boolean(Number(event.sales_enabled));
  const paymentEnabled = Boolean(Number(event.payment_enabled));
  const isPast = Boolean(Number(event.is_past));
  const subtotal = selected ? Number(selected.price) * quantity : 0;
  const serviceFee = subtotal * Number(event.service_fee_rate ?? 0.1);
  const total = subtotal + serviceFee;
  return (
    <>
      <section className={`pt-event-hero ${event.hero_display_mode === 'contain' ? 'contained' : 'covered'}`}>
        <img src={event.hero_image_url || '/protickets/kris-r-hero.png'} alt={event.title} />
        <div className="pt-event-hero-shade" />
        <a className="pt-back-link" href="/tickets"><ArrowLeft /> Todos los eventos</a>
        <div className="pt-event-hero-copy">
          <span>{event.organizer || 'ProTickets presenta'}</span>
          <h1>{event.title}</h1>
          <p>{event.subtitle}</p>
        </div>
      </section>
      <main className="pt-event-layout">
        <section className="pt-event-info">
          <div className="pt-event-facts">
            <div><CalendarDays /><span>Fecha<strong>{formatDate(event.event_date)}</strong></span></div>
            <div><MapPin /><span>Lugar<strong>{event.venue || 'Por confirmar'}, {event.city}</strong></span></div>
          </div>
          <div className="pt-copy-block"><p className="pt-eyebrow">EL EVENTO</p><h2>Todo lo que debes saber</h2><p>{event.description || 'Muy pronto publicaremos todos los detalles.'}</p></div>
          {event.address && <div className="pt-copy-block"><p className="pt-eyebrow">UBICACION</p><h2>{event.venue}</h2><p>{event.address}</p></div>}
          {event.terms && <details className="pt-terms"><summary>Terminos de la entrada</summary><p>{event.terms}</p></details>}
        </section>
        <aside className="pt-checkout">
          <p className="pt-eyebrow">SELECCIONA TU ENTRADA</p>
          <h2>Localidades</h2>
          <div className="pt-ticket-options">
            {event.ticket_types.map((type) => {
              const available = salesEnabled && !isPast && type.status === 'active' && (!paymentEnabled || Number(type.available) > 0);
              return (
                <button key={type.id} disabled={!available} className={selected?.id === type.id ? 'selected' : ''} type="button" onClick={() => { setSelected(type); setQuantity(1); }}>
                  <span><strong>{type.name}</strong>{type.description && <small>{type.description}</small>}<small className="pt-ticket-state">{isPast ? 'Evento finalizado' : !salesEnabled ? 'No disponible' : !paymentEnabled ? 'Preventa' : available ? `${type.available} disponibles` : 'Agotado'}</small></span>
                  <span><strong>{money(type.price)}</strong><small>+ {money(Number(type.price) * Number(event.service_fee_rate ?? 0.1))} servicio</small></span>
                </button>
              );
            })}
          </div>
          {selected && (
            <div className="pt-selection-controls">
              <label className="pt-quantity">Cantidad
                <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
                  {Array.from({ length: Math.min(Number(selected.max_per_order || 6), Number(selected.available || 0)) }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <button className="pt-remove-selection" type="button" onClick={() => { setSelected(null); setQuantity(1); setError(''); }}><Trash2 size={16} /> Quitar seleccion</button>
            </div>
          )}
          {isPast && <div className="pt-alert info">Este evento ya finalizo y se conserva en el historial de ProTickets.</div>}
          {!isPast && salesEnabled && !paymentEnabled && <div className="pt-alert info">Puedes escoger tus entradas y completar el checkout. El boton final de pago se habilitara proximamente.</div>}
          {!isPast && !salesEnabled && <div className="pt-alert info">La seleccion de entradas todavia no esta habilitada.</div>}
          <div className="pt-price-breakdown"><span>Subtotal<strong>{money(subtotal)}</strong></span><span>Tarifa de servicio<strong>{money(serviceFee)}</strong></span></div>
          <div className="pt-order-total"><span>Total</span><strong>{money(total)}</strong></div>
          {error && <div className="pt-alert error">{error}</div>}
          <button className="pt-primary wide" type="button" disabled={!selected || busy || isPast || !salesEnabled} onClick={continueToCheckout}>
            <ShoppingBag size={19} /> {isPast ? 'Evento finalizado' : !salesEnabled ? 'Venta no disponible' : customer ? 'Continuar al checkout' : 'Ingresar para continuar'}
          </button>
          <p className="pt-checkout-note"><Clock3 size={15} /> La reserva se mantiene durante 10 minutos.</p>
        </aside>
      </main>
      {checkoutOpen && <CheckoutDialog customer={customer} selected={selected} quantity={quantity} subtotal={subtotal} serviceFee={serviceFee} total={total} paymentEnabled={paymentEnabled} busy={busy} error={error} onConfirm={reserve} onClose={() => setCheckoutOpen(false)} />}
      {order && <OrderDialog order={order} busy={busy} error={error} onDelete={removeReservedOrder} onClose={() => setOrder(null)} />}
    </>
  );
}

function CheckoutDialog({ customer, selected, quantity, subtotal, serviceFee, total, paymentEnabled, busy, error, onConfirm, onClose }) {
  const [form, setForm] = useState({ name: '', email: customer?.email || '', cedula: '', phone: '' });

  function fillFromAccount() {
    setForm({
      name: customer?.name || '',
      email: customer?.email || '',
      cedula: customer?.cedula || '',
      phone: customer?.phone || ''
    });
  }

  function submit(event) {
    event.preventDefault();
    if (paymentEnabled) onConfirm(form);
  }

  return (
    <div className="pt-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pt-checkout-modal" role="dialog" aria-modal="true" aria-label="Checkout de entradas">
        <button className="pt-icon-button close" type="button" aria-label="Cerrar" onClick={onClose}><X /></button>
        <p className="pt-eyebrow">CHECKOUT</p>
        <h2>Datos del comprador</h2>
        <p>La entrada quedara vinculada a tu cuenta de ProTickets.</p>
        <button className="pt-account-fill" type="button" onClick={fillFromAccount}><UserRound size={18} /> Completar con los datos de mi cuenta</button>
        <form onSubmit={submit}>
          <label>Nombres completos<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Correo electronico<input required readOnly type="email" value={form.email} /></label>
          <div className="pt-form-row">
            <label>Cedula<input required value={form.cedula} onChange={(event) => setForm({ ...form, cedula: event.target.value })} /></label>
            <label>Celular<input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          </div>
          <div className="pt-checkout-summary">
            <div className="pt-checkout-item"><span><Ticket size={18} /> {selected?.name} x{quantity}</span><strong>{money(subtotal)}</strong></div>
            <div className="pt-checkout-fee"><span>Tarifa de servicio</span><strong>{money(serviceFee)}</strong></div>
            <div className="pt-checkout-final"><span>Total</span><strong>{money(total)}</strong></div>
          </div>
          {!paymentEnabled && <div className="pt-alert info">Tu seleccion esta lista. El pago en linea se habilitara proximamente.</div>}
          {error && <div className="pt-alert error">{error}</div>}
          <button className="pt-primary wide" disabled={!paymentEnabled || busy} type="submit"><CreditCard size={19} /> {busy ? 'Procesando...' : paymentEnabled ? 'Confirmar e ir a pagar' : 'Pago proximamente'}</button>
        </form>
      </section>
    </div>
  );
}

function OrderDialog({ order, busy, error, onDelete, onClose }) {
  return (
    <div className="pt-modal-backdrop">
      <section className="pt-order-modal">
        <button className="pt-icon-button close" type="button" onClick={onClose}><X /></button>
        <div className="pt-success-icon"><Check /></div>
        <p className="pt-eyebrow">RESERVA CREADA</p>
        <h2>{order.order_number}</h2>
        <p>Tu entrada queda pendiente hasta confirmar el pago.</p>
        <div className="pt-receipt">
          <span>{order.event_title}</span>
          {order.items?.map((item) => <strong key={item.id}>{item.ticket_name} x{item.quantity}</strong>)}
          <div><span>Total</span><strong>{money(order.total)}</strong></div>
        </div>
        {order.payment_url ? (
          <a className="pt-primary wide" href={order.payment_url}><CreditCard /> Pagar ahora con PayPhone</a>
        ) : (
          <div className="pt-alert info">El administrador asignara el enlace de pago a este pedido.</div>
        )}
        {error && <div className="pt-alert error">{error}</div>}
        <button className="pt-danger-outline wide" type="button" disabled={busy} onClick={onDelete}><Trash2 size={17} /> Quitar reserva</button>
        <a className="pt-secondary wide" href="/tickets/mi-cuenta">Ver mis pedidos</a>
      </section>
    </div>
  );
}

function AccountPage({ customer, onRequireAccount, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState(null);
  const paymentResult = new URLSearchParams(window.location.search).get('payment');
  const emailResult = new URLSearchParams(window.location.search).get('email');
  const [paymentNoticeOpen, setPaymentNoticeOpen] = useState(paymentResult === 'success');
  useEffect(() => {
    if (!customer) return;
    ticketingApi('/me/orders').then(setOrders).catch((err) => setError(err.message));
  }, [customer]);

  async function removePendingOrder(order) {
    if (!window.confirm(`Quitar la reserva ${order.order_number}?`)) return;
    setRemovingId(order.id);
    setError('');
    try {
      await ticketingApi(`/me/orders/${order.id}`, { method: 'DELETE' });
      setOrders((current) => current.filter((item) => item.id !== order.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  function acknowledgePayment() {
    setPaymentNoticeOpen(false);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('payment');
    cleanUrl.searchParams.delete('email');
    cleanUrl.searchParams.delete('order');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  if (!customer) return <div className="pt-page-state"><UserRound /><h2>Consulta tus entradas</h2><p>Ingresa con la cuenta que utilizaste para comprar.</p><button className="pt-primary" onClick={onRequireAccount}>Ingresar</button></div>;
  return (
    <main className="pt-account-page">
      {paymentNoticeOpen && (
        <div className="pt-modal-backdrop">
          <section className="pt-order-modal pt-payment-success-modal" role="alertdialog" aria-modal="true" aria-labelledby="pt-payment-success-title">
            <div className="pt-success-icon"><CheckCircle2 /></div>
            <p className="pt-eyebrow">PAGO CONFIRMADO</p>
            <h2 id="pt-payment-success-title">Tu compra fue realizada con exito</h2>
            {emailResult === 'pending' ? (
              <p>Tus entradas ya estan disponibles en esta pagina. El envio por correo no pudo completarse, pero puedes abrirlas directamente desde tus pedidos.</p>
            ) : (
              <p>Enviamos tus entradas al correo electronico registrado. Revisa tu bandeja de entrada y, si no las encuentras, verifica tambien las carpetas de Spam o Correo no deseado.</p>
            )}
            <button className="pt-primary wide" type="button" autoFocus onClick={acknowledgePayment}><Check size={18} /> OK</button>
          </section>
        </div>
      )}
      <header><div><p className="pt-eyebrow">MI CUENTA</p><h1>Hola, {customer.name.split(' ')[0]}</h1><p>{customer.email}</p></div><button className="pt-secondary" type="button" onClick={onLogout}><LogOut /> Cerrar sesion</button></header>
      <section>
        <div className="pt-section-heading"><div><h2>Pedidos y entradas</h2><p>Todo lo que has comprado con ProTickets.</p></div></div>
        {paymentResult === 'failed' && <div className="pt-alert error">No pudimos confirmar el pago. No se emitieron entradas ni se desconto inventario.</div>}
        {paymentResult === 'cancelled' && <div className="pt-alert info">El pago fue cancelado. Tu pedido sigue pendiente mientras la reserva este vigente.</div>}
        {error && <div className="pt-alert error">{error}</div>}
        {!orders.length ? <div className="pt-empty"><Ticket /><h3>Aun no tienes pedidos</h3><a className="pt-primary" href="/tickets#eventos">Explorar eventos</a></div> : (
          <div className="pt-orders-list">{orders.map((order) => (
            <article key={order.id}>
              <img src={order.card_image_url || '/protickets/kris-r-hero.png'} alt="" />
              <div className="pt-order-main"><span className={`pt-order-status ${order.payment_status}`}>{statusLabel(order.payment_status)}</span><h3>{order.event_title}</h3><p>{order.order_number} · {formatDate(order.created_at, true)}</p><strong>{order.items?.map((item) => `${item.ticket_name} x${item.quantity}`).join(', ')}</strong></div>
              <div className="pt-order-actions"><strong>{money(order.total)}</strong>{order.payment_status === 'pending' && order.payment_url && <a className="pt-primary" href={order.payment_url}>Pagar <ExternalLink /></a>}{order.payment_status === 'pending' && <button className="pt-remove-order" type="button" disabled={removingId === order.id} onClick={() => removePendingOrder(order)}><Trash2 /> {removingId === order.id ? 'Quitando...' : 'Quitar'}</button>}</div>
              {order.payment_status === 'paid' && order.tickets?.length > 0 && <div className="pt-ticket-links">{order.tickets.map((ticket, index) => <a href={`/tickets/entrada/${ticket.code}`} key={ticket.id}><QrCode /> Entrada {index + 1}: {ticket.ticket_name}</a>)}</div>}
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}

function TicketPage({ code }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { ticketingApi(`/public/tickets/${encodeURIComponent(code)}`).then(setTicket).catch((err) => setError(err.message)); }, [code]);
  if (error) return <div className="pt-page-state"><X /><h2>{error}</h2></div>;
  if (!ticket) return <div className="pt-page-state">Consultando entrada...</div>;
  return (
    <main className="pt-digital-ticket-page">
      <section className={`pt-digital-ticket ${ticket.status}`}>
        <Logo compact />
        <span className="pt-eyebrow">ENTRADA DIGITAL</span>
        <h1>{ticket.event_title}</h1>
        <div className="pt-ticket-owner"><span>Asistente</span><strong>{ticket.customer_name}</strong></div>
        <div className="pt-ticket-meta"><span><CalendarDays />{formatDate(ticket.event_date)}</span><span><MapPin />{ticket.venue}, {ticket.city}</span></div>
        <div className="pt-ticket-code"><QrCode /><strong>{ticket.ticket_name}</strong><code>{ticket.code}</code></div>
        <div className={`pt-validity ${ticket.status}`}><ShieldCheck />{ticket.status === 'valid' ? 'Entrada valida' : ticket.status === 'used' ? 'Entrada ya utilizada' : 'Entrada anulada'}</div>
      </section>
    </main>
  );
}

export function ProTicketsPublicSite() {
  const [data, setData] = useState({ brand: {}, events: [], banners: [], google_client_id: '' });
  const [customer, setCustomer] = useState(readCustomer());
  const [accountOpen, setAccountOpen] = useState(false);
  const [error, setError] = useState('');
  const path = window.location.pathname;

  useEffect(() => { ticketingApi('/public/home').then(setData).catch((err) => setError(err.message)); }, []);

  const route = useMemo(() => {
    if (path === '/tickets/restablecer-contrasena') return { type: 'reset-password' };
    if (path.startsWith('/tickets/evento/')) return { type: 'event', value: decodeURIComponent(path.split('/').pop()) };
    if (path.startsWith('/tickets/entrada/')) return { type: 'ticket', value: decodeURIComponent(path.split('/').pop()) };
    if (path === '/tickets/mi-cuenta') return { type: 'account' };
    return { type: 'home' };
  }, [path]);

  function logout() {
    clearCustomerSession();
    setCustomer(null);
  }

  return (
    <div className="pt-public-site">
      <PublicHeader customer={customer} onAccount={() => customer ? (window.location.href = '/tickets/mi-cuenta') : setAccountOpen(true)} />
      {error && route.type !== 'reset-password' ? <div className="pt-page-state"><X /><h2>{error}</h2></div> : (
        <>
          {route.type === 'home' && <HomePage data={data} />}
          {route.type === 'event' && <EventPage slug={route.value} customer={customer} onRequireAccount={() => setAccountOpen(true)} />}
          {route.type === 'account' && <AccountPage customer={customer} onRequireAccount={() => setAccountOpen(true)} onLogout={logout} />}
          {route.type === 'ticket' && <TicketPage code={route.value} />}
          {route.type === 'reset-password' && <ResetPasswordPage />}
        </>
      )}
      <PublicFooter />
      <AccountDialog open={accountOpen} googleClientId={data.google_client_id} onClose={() => setAccountOpen(false)} onAuthenticated={setCustomer} />
    </div>
  );
}

function AdminImageField({ label, hint, value, onChange }) {
  const [error, setError] = useState('');
  return (
    <label className="pta-image-field">
      {label}
      {hint && <small className="pta-field-hint">{hint}</small>}
      <input value={value || ''} placeholder="URL o imagen seleccionada" onChange={(e) => onChange(e.target.value)} />
      <span className="pta-upload"><Upload size={17} /> Elegir desde el dispositivo<input type="file" accept="image/*" onChange={(e) => { try { fileToDataUrl(e.target.files?.[0], onChange); setError(''); } catch (err) { setError(err.message); } }} /></span>
      {value && <img src={value} alt="Vista previa" />}
      {error && <small className="pta-error">{error}</small>}
    </label>
  );
}

function EventEditor({ eventId, onSaved, onCancel }) {
  const [form, setForm] = useState(emptyEvent);
  const [types, setTypes] = useState([]);
  const [newType, setNewType] = useState(emptyTicketType);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!eventId) { setForm(emptyEvent); setTypes([]); return; }
    ticketingApi(`/admin/events/${eventId}`, { admin: true }).then((data) => {
      setForm({
        ...emptyEvent,
        ...data,
        featured: Boolean(data.featured),
        sales_enabled: Boolean(data.sales_enabled),
        payment_enabled: Boolean(data.payment_enabled),
        is_past: Boolean(data.is_past)
      });
      setTypes(data.ticket_types || []);
    }).catch((err) => setError(err.message));
  }, [eventId]);

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await ticketingApi(eventId ? `/admin/events/${eventId}` : '/admin/events', { admin: true, method: eventId ? 'PUT' : 'POST', body: JSON.stringify(form) });
      onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveType(type) {
    try {
      await ticketingApi(`/admin/ticket-types/${type.id}`, { admin: true, method: 'PUT', body: JSON.stringify(type) });
      onSaved(false);
    } catch (err) { setError(err.message); }
  }

  async function addType(event) {
    event.preventDefault();
    try {
      const created = await ticketingApi(`/admin/events/${eventId}/ticket-types`, { admin: true, method: 'POST', body: JSON.stringify(newType) });
      setTypes([...types, created]); setNewType(emptyTicketType);
    } catch (err) { setError(err.message); }
  }

  async function removeType(type) {
    if (!window.confirm(`Eliminar la localidad ${type.name}?`)) return;
    try { await ticketingApi(`/admin/ticket-types/${type.id}`, { admin: true, method: 'DELETE' }); setTypes(types.filter((item) => item.id !== type.id)); } catch (err) { setError(err.message); }
  }

  return (
    <section className="pta-editor">
      <header><div><p>GESTION DE EVENTO</p><h2>{eventId ? 'Editar evento' : 'Nuevo evento'}</h2></div><button className="pta-icon" type="button" onClick={onCancel}><X /></button></header>
      <form className="pta-form" onSubmit={save}>
        <div className="pta-grid two"><label>Nombre del evento<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Enlace corto<input value={form.slug} placeholder="se-genera-automaticamente" onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label></div>
        <label>Frase destacada<input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></label>
        <label>Descripcion<textarea rows="5" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="pta-grid three"><label>Fecha y hora<input type="datetime-local" value={form.event_date ? String(form.event_date).slice(0, 16) : ''} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></label><label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label><label>Lugar<input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></label></div>
        <label>Direccion<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <div className="pta-grid two"><label>Organizador<input value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></label><label>Enlace de pago alternativo (opcional)<input type="url" placeholder="https://..." value={form.bendo_payment_url} onChange={(e) => setForm({ ...form, bendo_payment_url: e.target.value })} /></label></div>
        <div className="pta-grid two"><AdminImageField label="Portada dentro del evento" hint="Recomendado: cuadrada 1:1, por ejemplo 1200 x 1200 px" value={form.hero_image_url} onChange={(hero_image_url) => setForm({ ...form, hero_image_url, card_image_url: form.card_image_url || hero_image_url })} /><AdminImageField label="Portada en la pagina principal" hint="Recomendado: horizontal 16:9, por ejemplo 1600 x 900 px" value={form.card_image_url} onChange={(card_image_url) => setForm({ ...form, card_image_url })} /></div>
        <label>Ajuste de la portada interna<select value={form.hero_display_mode} onChange={(e) => setForm({ ...form, hero_display_mode: e.target.value })}><option value="cover">Llenar el espacio</option><option value="contain">Mostrar imagen completa</option></select></label>
        <label>Terminos y condiciones<textarea rows="4" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></label>
        <div className="pta-grid three"><label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="sold_out">Agotado</option><option value="archived">Archivado</option></select></label><label className="pta-check"><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Mostrar como evento destacado</label><label className="pta-check"><input type="checkbox" checked={form.is_past} onChange={(e) => setForm({ ...form, is_past: e.target.checked, featured: e.target.checked ? false : form.featured, sales_enabled: e.target.checked ? false : form.sales_enabled, payment_enabled: e.target.checked ? false : form.payment_enabled })} /> Marcar como evento pasado</label></div>
        <div className="pta-grid two"><label className="pta-check sales"><input type="checkbox" checked={form.sales_enabled} disabled={form.is_past} onChange={(e) => setForm({ ...form, sales_enabled: e.target.checked })} /> Habilitar seleccion de entradas</label><label className="pta-check sales"><input type="checkbox" checked={form.payment_enabled} disabled={form.is_past} onChange={(e) => setForm({ ...form, payment_enabled: e.target.checked })} /> Habilitar boton final de pago</label></div>
        {form.is_past && <div className="pta-alert info">Este evento aparecera en Eventos pasados y no permitira seleccionar entradas.</div>}
        {!form.is_past && form.sales_enabled && !form.payment_enabled && <div className="pta-alert info">Los clientes podran elegir entradas, ingresar a su cuenta y completar el checkout, pero el boton final de pago quedara bloqueado.</div>}
        {!form.is_past && !form.sales_enabled && <div className="pta-alert info">El evento sera visible con sus precios, pero no permitira seleccionar entradas.</div>}
        {error && <div className="pta-alert error">{error}</div>}
        <div className="pta-actions"><button className="pta-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="pta-primary" disabled={busy}><Save />{busy ? 'Guardando...' : 'Guardar evento'}</button></div>
      </form>
      {eventId && (
        <section className="pta-types">
          <div className="pta-section-title"><div><p>INVENTARIO</p><h3>Localidades y precios</h3></div></div>
          <div className="pta-type-list">{types.map((type, index) => (
            <article key={type.id}>
              <div className="pta-grid type"><label>Localidad<input value={type.name} onChange={(e) => setTypes(types.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></label><label>Precio<input type="number" min="0" step="0.01" value={type.price} onChange={(e) => setTypes(types.map((item, i) => i === index ? { ...item, price: e.target.value } : item))} /></label><label>Servicio<input readOnly value={money(Number(type.price || 0) * 0.1)} title="Se calcula automaticamente" /></label><label>Stock<input type="number" min={type.sold || 0} value={type.stock} onChange={(e) => setTypes(types.map((item, i) => i === index ? { ...item, stock: e.target.value } : item))} /></label><label>Maximo<input type="number" min="1" value={type.max_per_order} onChange={(e) => setTypes(types.map((item, i) => i === index ? { ...item, max_per_order: e.target.value } : item))} /></label><label>Estado<select value={type.status} onChange={(e) => setTypes(types.map((item, i) => i === index ? { ...item, status: e.target.value } : item))}><option value="active">Activa</option><option value="inactive">Inactiva</option><option value="sold_out">Agotada</option></select></label></div>
              <div className="pta-row-actions"><span>{type.sold || 0} vendidas</span><button type="button" onClick={() => saveType(type)}><Save /> Guardar</button><button className="danger" type="button" onClick={() => removeType(type)}><Trash2 /></button></div>
            </article>
          ))}</div>
          <form className="pta-new-type" onSubmit={addType}><input required placeholder="Nueva localidad" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} /><input type="number" min="0" step="0.01" placeholder="Precio" value={newType.price} onChange={(e) => setNewType({ ...newType, price: e.target.value })} /><input type="number" min="0" placeholder="Stock" value={newType.stock} onChange={(e) => setNewType({ ...newType, stock: e.target.value })} /><button className="pta-secondary"><Plus /> Agregar localidad</button></form>
        </section>
      )}
    </section>
  );
}

function OrdersAdmin({ orders, onRefresh }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filtered = orders.filter((order) => (filter === 'all' || order.payment_status === filter) && `${order.order_number} ${order.customer_name} ${order.customer_email}`.toLowerCase().includes(query.toLowerCase()));

  async function updateLink(order) {
    const paymentUrl = window.prompt('Enlace de pago', order.payment_url || '');
    if (paymentUrl === null) return;
    await ticketingApi(`/admin/orders/${order.id}/payment-link`, { admin: true, method: 'PUT', body: JSON.stringify({ payment_url: paymentUrl }) });
    onRefresh('Enlace actualizado');
  }

  async function process(order, action) {
    const message = action === 'confirm' ? 'Confirmar este pago y emitir las entradas?' : 'Rechazar este pedido?';
    if (!window.confirm(message)) return;
    try {
      const result = await ticketingApi(`/admin/orders/${order.id}/${action}`, { admin: true, method: 'POST' });
      onRefresh(action === 'confirm' ? (result.email?.sent ? 'Pago confirmado y entradas enviadas' : 'Pago confirmado; revisa la configuracion de correo') : 'Pedido rechazado');
    } catch (error) { window.alert(error.message); }
  }

  return (
    <section className="pta-section">
      <div className="pta-section-title"><div><p>VENTAS</p><h2>Pedidos</h2></div><div className="pta-filters"><label><Search /><input placeholder="Buscar cliente o pedido" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos</option><option value="pending">Pendientes</option><option value="paid">Pagados</option><option value="rejected">Rechazados</option><option value="expired">Expirados</option></select></div></div>
      <div className="pta-order-list">{filtered.map((order) => (
        <article key={order.id}>
          <div><span className={`pta-pill ${order.payment_status}`}>{statusLabel(order.payment_status)}</span><h3>{order.customer_name}</h3><p>{order.customer_email}</p></div>
          <div><small>Pedido</small><strong>{order.order_number}</strong><span>{order.detail}</span></div>
          <div><small>Total</small><strong>{money(order.total)}</strong><span>{formatDate(order.created_at, true)}</span></div>
          <div className="pta-order-buttons"><button type="button" onClick={() => updateLink(order)}><CreditCard /> Editar enlace</button>{order.payment_status === 'pending' && <><button className="confirm" type="button" onClick={() => process(order, 'confirm')}><Check /> Confirmar pago</button><button className="danger" type="button" onClick={() => process(order, 'reject')}><X /></button></>}</div>
        </article>
      ))}{!filtered.length && <div className="pta-empty">No hay pedidos con estos filtros.</div>}</div>
    </section>
  );
}

function BannersAdmin({ banners, onRefresh }) {
  const [editing, setEditing] = useState(null);
  const form = editing || emptyBanner;
  function setForm(next) { setEditing(next); }
  async function submit(event) {
    event.preventDefault();
    const isEdit = Boolean(form.id);
    try { await ticketingApi(isEdit ? `/admin/banners/${form.id}` : '/admin/banners', { admin: true, method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(form) }); setEditing(null); onRefresh('Banner guardado'); } catch (error) { window.alert(error.message); }
  }
  async function remove(id) { if (!window.confirm('Eliminar este banner?')) return; await ticketingApi(`/admin/banners/${id}`, { admin: true, method: 'DELETE' }); onRefresh('Banner eliminado'); }
  return (
    <div className="pta-split">
      <section className="pta-section"><div className="pta-section-title"><div><p>PORTADA</p><h2>Banners publicos</h2></div></div><div className="pta-banner-list">{banners.map((banner) => <article key={banner.id}><img src={banner.image_url} alt="" /><div><span className={`pta-pill ${banner.status}`}>{banner.status === 'active' ? 'Activo' : 'Inactivo'}</span><h3>{banner.title || 'Sin titulo'}</h3><p>{banner.subtitle}</p></div><div><button type="button" onClick={() => setEditing({ ...banner })}><Edit3 /></button><button className="danger" type="button" onClick={() => remove(banner.id)}><Trash2 /></button></div></article>)}</div></section>
      <section className="pta-section"><div className="pta-section-title"><div><p>PUBLICIDAD</p><h2>{form.id ? 'Editar banner' : 'Nuevo banner'}</h2></div></div><form className="pta-form" onSubmit={submit}><AdminImageField label="Banner para computadora" hint="Recomendado: horizontal 16:9, por ejemplo 1920 x 1080 px" value={form.image_url} onChange={(image_url) => setForm({ ...form, image_url })} /><AdminImageField label="Banner para celular" hint="Recomendado: vertical 2:3, por ejemplo 1080 x 1620 px" value={form.mobile_image_url} onChange={(mobile_image_url) => setForm({ ...form, mobile_image_url })} /><label>Titulo<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Texto corto<input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></label><div className="pta-grid two"><label>Texto del boton<input value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} /></label><label>Enlace<input value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} /></label></div><label className="pta-check"><input type="checkbox" checked={form.show_overlay !== false && form.show_overlay !== 0} onChange={(e) => setForm({ ...form, show_overlay: e.target.checked })} /> Mostrar titulo y texto encima del banner</label><div className="pta-grid two"><label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label><label>Orden<input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></label></div><div className="pta-actions">{editing && <button className="pta-secondary" type="button" onClick={() => setEditing(null)}>Cancelar</button>}<button className="pta-primary"><Save /> Guardar banner</button></div></form></section>
    </div>
  );
}

function ValidatorAdmin() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  async function validate(event) { event.preventDefault(); setResult(null); try { setResult(await ticketingApi('/admin/tickets/validate', { admin: true, method: 'POST', body: JSON.stringify({ code }) })); setCode(''); } catch (error) { setResult({ valid: false, message: error.message }); } }
  return <section className="pta-validator"><QrCode /><p>CONTROL DE ACCESO</p><h2>Validar entrada</h2><span>Escribe o escanea el codigo presentado por el asistente.</span><form onSubmit={validate}><input autoFocus required placeholder="PT-XXXXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /><button className="pta-primary"><ShieldCheck /> Validar acceso</button></form>{result && <div className={`pta-validation-result ${result.valid ? 'valid' : 'invalid'}`}>{result.valid ? <CheckCircle2 /> : <X />}<strong>{result.message}</strong>{result.ticket?.customer_name && <span>{result.ticket.customer_name} · {result.ticket.ticket_name}</span>}</div>}</section>;
}

function DashboardAdmin({ data, setView, editEvent }) {
  return (
    <>
      <section className="pta-stats"><article><span>Ingresos confirmados</span><strong>{money(data.stats?.revenue)}</strong><CreditCard /></article><article><span>Pedidos pendientes</span><strong>{data.stats?.pending_orders || 0}</strong><Clock3 /></article><article><span>Entradas vigentes</span><strong>{data.stats?.valid_tickets || 0}</strong><Ticket /></article><article><span>Eventos</span><strong>{data.stats?.events || 0}</strong><CalendarDays /></article></section>
      <div className="pta-split dashboard"><section className="pta-section"><div className="pta-section-title"><div><p>EVENTOS</p><h2>Actividad publicada</h2></div><button className="pta-secondary" onClick={() => setView('events')}>Administrar</button></div><div className="pta-event-list">{data.events?.map((event) => <article key={event.id}><img src={event.card_image_url || event.hero_image_url} alt="" /><div><span className={`pta-pill ${event.status}`}>{statusLabel(event.status)}</span><h3>{event.title}</h3><p>{formatDate(event.event_date)} · {event.city}</p><span>{event.available_tickets || 0} entradas disponibles</span></div><button className="pta-icon" onClick={() => editEvent(event.id)}><Edit3 /></button></article>)}</div></section><section className="pta-section"><div className="pta-section-title"><div><p>POR CONFIRMAR</p><h2>Pagos recientes</h2></div><button className="pta-secondary" onClick={() => setView('orders')}>Ver pedidos</button></div><div className="pta-mini-orders">{data.orders?.filter((order) => order.payment_status === 'pending').slice(0, 6).map((order) => <article key={order.id}><div><strong>{order.customer_name}</strong><span>{order.detail}</span></div><strong>{money(order.total)}</strong></article>)}{!data.orders?.some((order) => order.payment_status === 'pending') && <div className="pta-empty">No hay pagos pendientes.</div>}</div></section></div>
    </>
  );
}

export default function ProTicketsApp({ embedded = false, onLogout }) {
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({ events: [], banners: [], orders: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [editingEventId, setEditingEventId] = useState(null);
  const [showEventEditor, setShowEventEditor] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function load(message = '') {
    setLoading(true);
    try { setData(await ticketingApi('/admin/overview', { admin: true })); if (message) { setNotice(message); window.setTimeout(() => setNotice(''), 3000); } } catch (error) { setNotice(error.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function editEvent(id) { setEditingEventId(id); setShowEventEditor(true); setView('events'); }
  function newEvent() { setEditingEventId(null); setShowEventEditor(true); setView('events'); }
  async function savedEvent(close = true) { await load('Evento actualizado'); if (close) setShowEventEditor(false); }

  const nav = [['dashboard', 'Resumen', LayoutDashboard], ['events', 'Eventos', CalendarDays], ['orders', 'Pedidos', ShoppingBag], ['banners', 'Banners', ImageIcon], ['validate', 'Validar QR', QrCode]];
  const content = (
    <div className="pta-workspace">
      <header className="pta-topbar"><div><p>PROTICKETS</p><h1>{nav.find(([key]) => key === view)?.[1]}</h1></div><div>{notice && <span className="pta-notice">{notice}</span>}<a className="pta-secondary" href="/tickets" target="_blank" rel="noreferrer"><Eye /> Ver pagina publica</a>{view === 'events' && !showEventEditor && <button className="pta-primary" onClick={newEvent}><Plus /> Nuevo evento</button>}<button className="pta-mobile-menu" onClick={() => setMenuOpen((value) => !value)}><Menu /></button></div></header>
      {loading ? <div className="pta-empty large">Cargando ProTickets...</div> : <>
        {view === 'dashboard' && <DashboardAdmin data={data} setView={setView} editEvent={editEvent} />}
        {view === 'events' && (showEventEditor ? <EventEditor eventId={editingEventId} onSaved={savedEvent} onCancel={() => setShowEventEditor(false)} /> : <section className="pta-section"><div className="pta-section-title"><div><p>CATALOGO</p><h2>Todos los eventos</h2></div></div><div className="pta-event-table">{data.events.map((event) => <article key={event.id}><img src={event.card_image_url || event.hero_image_url} alt="" /><div><span className={`pta-pill ${event.status}`}>{statusLabel(event.status)}</span><h3>{event.title}</h3><p>{formatDate(event.event_date)} · {event.venue}, {event.city}</p></div><div><strong>{event.available_tickets || 0}</strong><span>disponibles</span></div><button className="pta-secondary" onClick={() => editEvent(event.id)}><Edit3 /> Editar</button></article>)}</div></section>)}
        {view === 'orders' && <OrdersAdmin orders={data.orders} onRefresh={load} />}
        {view === 'banners' && <BannersAdmin banners={data.banners} onRefresh={load} />}
        {view === 'validate' && <ValidatorAdmin />}
      </>}
    </div>
  );

  if (embedded) return <div className="pta-embedded">{content}</div>;
  return (
    <main className="pta-app">
      <aside className={menuOpen ? 'open' : ''}><Logo /> <nav>{nav.map(([key, label, Icon]) => <button className={view === key ? 'active' : ''} key={key} onClick={() => { setView(key); setMenuOpen(false); setShowEventEditor(false); }}><Icon />{label}</button>)}</nav><button className="pta-logout" onClick={onLogout}><LogOut /> Cerrar sesion</button></aside>
      {content}
    </main>
  );
}
