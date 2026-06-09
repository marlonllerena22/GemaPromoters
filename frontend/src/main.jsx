import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Medal,
  Plus,
  Search,
  Sparkles,
  Settings,
  Ticket,
  ToggleLeft,
  ToggleRight,
  UserRound,
  UsersRound,
  WalletCards
} from 'lucide-react';
import { api, clearToken, getToken, getUser, setToken, setUser } from './api.js';
import './styles.css';

const emptyPromoter = {
  name: '',
  cedula: '',
  whatsapp: '',
  instagram: '',
  photo_url: '',
  referral_code: '',
  code: '',
  username: '',
  password: '',
  status: 'active'
};

const emptyLevels = {
  bronze: 1,
  silver: 10,
  diamond: 25,
  benefits: {
    bronze: ['Acceso a preventas internas', 'Material digital GEMASHOW', 'Reconocimiento como promotor Bronce'],
    silver: ['Prioridad en localidades de alta demanda', 'Bonos especiales por metas', 'Insignia Plata en el perfil'],
    diamond: ['Beneficios VIP de promotor top', 'Prioridad maxima en cupos', 'Reconocimiento Diamante GEMASHOW']
  },
  referralPoints: 3
};

const levelOrder = {
  starter: 0,
  bronze: 1,
  silver: 2,
  diamond: 3
};

const emptySale = {
  promoter_id: '',
  customer: '',
  customer_whatsapp: '',
  location: '',
  quantity: 1,
  unit_price: 0,
  sale_date: new Date().toISOString().slice(0, 10),
  payment_status: 'pending'
};

const emptyLocation = {
  name: '',
  price: 0,
  commission_type: 'percent',
  commission_value: 3,
  commission_min_quantity: 1,
  level_points: 1,
  status: 'active'
};

const emptyEvent = {
  name: '',
  description: '',
  status: 'active'
};

const emptyBanner = {
  image_url: '',
  title: '',
  sort_order: 0,
  status: 'active'
};

const emptyEstablishment = {
  name: '',
  display_name: '',
  status: 'active',
  promoter_sales_enabled: true
};

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function benefitsText(items) {
  return Array.isArray(items) ? items.join('\n') : String(items || '');
}

function normalizeLevelForm(levels = emptyLevels) {
  return {
    bronze: levels.bronze ?? emptyLevels.bronze,
    silver: levels.silver ?? emptyLevels.silver,
    diamond: levels.diamond ?? emptyLevels.diamond,
    referral_points: levels.referralPoints ?? emptyLevels.referralPoints,
    bronze_benefits: benefitsText(levels.benefits?.bronze || emptyLevels.benefits.bronze),
    silver_benefits: benefitsText(levels.benefits?.silver || emptyLevels.benefits.silver),
    diamond_benefits: benefitsText(levels.benefits?.diamond || emptyLevels.benefits.diamond)
  };
}

function levelCatalogFromProfile(level) {
  const catalog = level?.catalog || [];
  if (catalog.length) {
    return catalog;
  }

  return [
    { key: 'bronze', name: 'Bronce', min: level?.settings?.bronze || 1, benefits: emptyLevels.benefits.bronze },
    { key: 'silver', name: 'Plata', min: level?.settings?.silver || 10, benefits: emptyLevels.benefits.silver },
    { key: 'diamond', name: 'Diamante', min: level?.settings?.diamond || 25, benefits: emptyLevels.benefits.diamond }
  ];
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }

    if (!file.type.startsWith('image/')) {
      reject(new Error('Selecciona un archivo de imagen'));
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('La imagen debe pesar maximo 8 MB'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 720;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function commissionLabel(location) {
  if (!location) {
    return 'Sin regla';
  }

  const value = Number(location.commission_value || 0);
  const type = location.commission_type === 'fixed' ? `${money(value)} por entrada` : `${value}%`;
  return `${type} desde ${location.commission_min_quantity || 1} entradas confirmadas`;
}

function estimateCommission(form, locations, sales, promoterId = form.promoter_id) {
  if (form.payment_status !== 'paid') {
    return 0;
  }

  const location = locations.find((item) => item.name === form.location);
  if (!location) {
    return Number(form.quantity || 0) * Number(form.unit_price || 0) * 0.03;
  }

  const threshold = Math.max(1, Number(location.commission_min_quantity || 1));
  const previousPaidTickets = sales
    .filter((sale) =>
      sale.payment_status === 'paid' &&
      sale.location === form.location &&
      (!promoterId || String(sale.promoter_id) === String(promoterId))
    )
    .reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);
  const nextPaidTickets = previousPaidTickets + Number(form.quantity || 0);
  const before = Math.max(0, previousPaidTickets - threshold + 1);
  const after = Math.max(0, nextPaidTickets - threshold + 1);
  const commissionableTickets = after - before;

  if (location.commission_type === 'fixed') {
    return commissionableTickets * Number(location.commission_value || 0);
  }

  return commissionableTickets * Number(form.unit_price || 0) * (Number(location.commission_value || 0) / 100);
}

function paymentLabel(status) {
  return status === 'paid' ? 'Confirmada' : 'Por confirmar';
}

function withEvent(path, eventId) {
  const separator = path.includes('?') ? '&' : '?';
  return eventId ? `${path}${separator}event_id=${eventId}` : path;
}

function withScope(path, eventId, establishmentId) {
  let nextPath = withEvent(path, eventId);
  const separator = nextPath.includes('?') ? '&' : '?';
  return establishmentId ? `${nextPath}${separator}establishment_id=${establishmentId}` : nextPath;
}

function App() {
  const [token, saveToken] = useState(getToken());
  const [user, saveUser] = useState(getUser());

  if (window.location.pathname === '/verificar') {
    return <VerifyPage />;
  }

  if (!token) {
    return <Login onLogin={(nextToken, nextUser) => {
      saveToken(nextToken);
      saveUser(nextUser);
    }} />;
  }

  if (user?.role === 'promoter') {
    return <PromoterApp user={user} onLogout={() => {
      clearToken();
      saveToken(null);
      saveUser(null);
    }} />;
  }

  return <AdminApp user={user} onLogout={() => {
    clearToken();
    saveToken(null);
    saveUser(null);
  }} />;
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('admin');
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const paths = mode === 'admin' ? ['/auth/login', '/auth/promoter-login'] : ['/auth/promoter-login', '/auth/login'];
      let data = null;
      let lastError = null;

      for (const path of paths) {
        try {
          data = await api(path, {
            method: 'POST',
            body: JSON.stringify(form)
          });
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!data) {
        throw lastError;
      }

      setToken(data.token);
      setUser(data.user);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">G</div>
        <h1>GemaPromoters</h1>
        <p>{mode === 'admin' ? 'Administrador de promotores GEMASHOW' : 'Acceso para registrar ventas'}</p>
        <div className="segmented">
          <button
            type="button"
            className={mode === 'admin' ? 'selected' : ''}
            onClick={() => {
              setMode('admin');
              setForm({ username: '', password: '' });
            }}
          >
            Admin
          </button>
          <button
            type="button"
            className={mode === 'promoter' ? 'selected' : ''}
            onClick={() => {
              setMode('promoter');
              setForm({ username: '', password: '' });
            }}
          >
            Promotor
          </button>
        </div>
        <form onSubmit={submit} className="form-grid">
          <label>
            Usuario
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Contrasena
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            {mode === 'admin' ? <BadgeCheck size={18} /> : <KeyRound size={18} />}
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminApp({ user, onLogout }) {
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({
    dashboard: null,
    establishments: [],
    events: [],
    promoters: [],
    sales: [],
    ranking: [],
    settlements: [],
    locations: [],
    levels: emptyLevels,
    banners: []
  });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selectedEstablishmentId, setSelectedEstablishmentId] = useState(user?.establishment_id ? String(user.establishment_id) : '');
  const [selectedEventId, setSelectedEventId] = useState('');

  async function loadAll(nextEventId = selectedEventId, nextEstablishmentId = selectedEstablishmentId) {
    setLoading(true);
    const establishments = await api('/establishments');
    const defaultEstablishment = establishments.find((item) => item.name === 'GEMASHOW') || establishments[0];
    const establishmentId = nextEstablishmentId || defaultEstablishment?.id || '';
    if (establishmentId && String(establishmentId) !== String(selectedEstablishmentId)) {
      setSelectedEstablishmentId(String(establishmentId));
    }

    const events = await api(establishmentId ? `/events?establishment_id=${establishmentId}` : '/events');
    const activeEvent = events.find((event) => event.is_active) || events[0];
    const eventExists = events.some((event) => String(event.id) === String(nextEventId));
    const eventId = eventExists ? nextEventId : activeEvent?.id || '';

    if (eventId && String(eventId) !== String(selectedEventId)) {
      setSelectedEventId(String(eventId));
    }

    const [dashboard, promoters, sales, ranking, settlements, locations, levels, banners] = await Promise.all([
      api(withScope('/dashboard', eventId, establishmentId)),
      api(withScope('/promoters', eventId, establishmentId)),
      api(withScope('/sales', eventId, establishmentId)),
      api(withScope('/ranking', eventId, establishmentId)),
      api(withScope('/settlements', eventId, establishmentId)),
      api(withScope('/locations', eventId, establishmentId)),
      api(withScope('/level-settings', eventId, establishmentId)),
      api(withScope('/event-banners', eventId, establishmentId))
    ]);
    setData({ dashboard, establishments, events, promoters, sales, ranking, settlements, locations, levels, banners });
    setLoading(false);
  }

  useEffect(() => {
    loadAll().catch((err) => {
      onLogout();
    });
  }, []);

  async function refresh(message) {
    await loadAll();
    setNotice(message);
    setTimeout(() => setNotice(''), 2400);
  }

  const nav = [
    ...(user?.role === 'supreme' ? [['establishments', 'Establecimientos', Building2]] : []),
    ['dashboard', 'Panel', BarChart3],
    ['events', 'Eventos', CalendarDays],
    ['promoters', 'Promotores', UsersRound],
    ['sales', 'Ventas', Ticket],
    ['ranking', 'Ranking', Medal],
    ['settlements', 'Liquidaciones', WalletCards],
    ['settings', 'Localidades', Settings],
    ['levels', 'Niveles', BadgeCheck],
    ['banners', 'Banners', Sparkles]
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">G</div>
          <div>
            <strong>GemaPromoters</strong>
            <span>{user?.role === 'supreme' ? 'PROMOTERS' : 'GEMASHOW'}</span>
          </div>
        </div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <a className="public-link" href="/verificar" target="_blank" rel="noreferrer">
          <Search size={17} />
          Verificar codigo
        </a>
        <button className="logout" onClick={onLogout}>
          <LogOut size={18} />
          Salir
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>{data.establishments.find((item) => String(item.id) === String(selectedEstablishmentId))?.display_name || 'PROMOTERS'}</p>
            <h2>{nav.find(([key]) => key === view)?.[1]}</h2>
          </div>
          {user?.role === 'supreme' && (
            <label className="event-selector">
              Establecimiento
              <select value={selectedEstablishmentId} onChange={(e) => loadAll('', e.target.value)}>
                {data.establishments.map((establishment) => (
                  <option value={establishment.id} key={establishment.id}>
                    {establishment.display_name || establishment.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="event-selector">
            Evento
            <select value={selectedEventId} onChange={(e) => loadAll(e.target.value)}>
              {data.events.map((event) => (
                <option value={event.id} key={event.id}>{event.name}</option>
              ))}
            </select>
          </label>
          {notice && <div className="alert success">{notice}</div>}
        </header>

        {loading ? (
          <div className="empty-state">Cargando informacion...</div>
        ) : (
          <>
            {view === 'establishments' && (
              <Establishments establishments={data.establishments} onRefresh={refresh} />
            )}
            {view === 'dashboard' && <Dashboard stats={data.dashboard} sales={data.sales} />}
            {view === 'events' && (
              <Events events={data.events} selectedEventId={selectedEventId} establishmentId={selectedEstablishmentId} onSelect={(eventId) => loadAll(eventId)} onRefresh={refresh} />
            )}
            {view === 'promoters' && (
              <Promoters promoters={data.promoters} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'sales' && (
              <Sales promoters={data.promoters} sales={data.sales} locations={data.locations} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'ranking' && <Ranking ranking={data.ranking} />}
            {view === 'settlements' && (
              <Settlements settlements={data.settlements} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'settings' && (
              <Locations locations={data.locations} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'levels' && (
              <Levels levels={data.levels} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'banners' && (
              <Banners banners={data.banners} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function Dashboard({ stats, sales }) {
  const cards = [
    ['Promotores activos', stats.activePromoters, UsersRound],
    ['Total vendido', money(stats.totalSold), CircleDollarSign],
    ['Comisiones', money(stats.totalCommissions), WalletCards],
    ['Ventas del dia', money(stats.todaySales), CalendarDays]
  ];

  return (
    <div className="stack">
      <section className="metric-grid">
        {cards.map(([label, value, Icon]) => (
          <article className="metric-card" key={label}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Ultimas ventas</h3>
        </div>
        <DataTable
          columns={['Promotor', 'Cliente', 'Localidad', 'Total', 'Comision', 'Estado']}
          rows={sales.slice(0, 8).map((sale) => [
            sale.promoter_name,
            sale.customer,
            sale.location,
            money(sale.total),
            money(sale.commission),
            paymentLabel(sale.payment_status)
          ])}
        />
      </section>
    </div>
  );
}

function Establishments({ establishments, onRefresh }) {
  const [form, setForm] = useState(emptyEstablishment);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  function edit(establishment) {
    setEditingId(establishment.id);
    setForm({
      name: establishment.name,
      display_name: establishment.display_name || establishment.name,
      status: establishment.status,
      promoter_sales_enabled: Boolean(establishment.promoter_sales_enabled)
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(editingId ? `/establishments/${editingId}` : '/establishments', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyEstablishment);
      setEditingId(null);
      onRefresh(editingId ? 'Establecimiento actualizado' : 'Establecimiento creado');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar establecimiento' : 'Nuevo establecimiento'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Nombre interno" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input label="Nombre visible" value={form.display_name} onChange={(display_name) => setForm({ ...form, display_name })} />
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={form.promoter_sales_enabled}
              onChange={(e) => setForm({ ...form, promoter_sales_enabled: e.target.checked })}
            />
            Promotores pueden registrar ventas desde su cuenta
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Building2 size={18} />
            Guardar
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Establecimientos PROMOTERS</h3>
        </div>
        <div className="list">
          {establishments.map((establishment) => (
            <article className="person-row" key={establishment.id}>
              <div>
                <strong>{establishment.display_name || establishment.name}</strong>
                <span>{establishment.status === 'active' ? 'Activo' : 'Inactivo'} · {establishment.promoter_sales_enabled ? 'Promotores venden' : 'Ventas solo por admin'}</span>
                <small>{establishment.name}</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(establishment)}>Editar</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Events({ events, selectedEventId, establishmentId, onSelect, onRefresh }) {
  const [form, setForm] = useState(emptyEvent);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  function edit(event) {
    setEditingId(event.id);
    setForm({
      name: event.name,
      description: event.description || '',
      status: event.status
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope(editingId ? `/events/${editingId}` : '/events', '', establishmentId), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyEvent);
      setEditingId(null);
      onRefresh(editingId ? 'Evento actualizado' : 'Evento creado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function activate(eventId) {
    await api(withScope(`/events/${eventId}/active`, '', establishmentId), { method: 'PATCH' });
    await onSelect(String(eventId));
    onRefresh('Evento activo actualizado');
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar evento' : 'Nuevo evento'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Nombre del evento" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label>
            Descripcion
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <CalendarDays size={18} />
            {editingId ? 'Guardar' : 'Crear evento'}
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Eventos</h3>
        </div>
        <div className="list">
          {events.map((event) => (
            <article className="person-row" key={event.id}>
              <div>
                <strong>{event.name}</strong>
                <span>{event.status === 'active' ? 'Activo' : 'Inactivo'} · {event.is_active ? 'Evento visible para promotores' : 'No visible'}</span>
                <small>{event.description || 'Sin descripcion'}</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => onSelect(String(event.id))}>Seleccionar</button>
                <button className="ghost-button" onClick={() => edit(event)}>Editar</button>
                <button className="ghost-button" disabled={event.is_active || event.status !== 'active'} onClick={() => activate(event.id)}>
                  Activar
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Promoters({ promoters, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptyPromoter);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function pickPhoto(file) {
    setError('');
    try {
      const photo_url = await imageFileToDataUrl(file);
      setForm({ ...form, photo_url });
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(promoter) {
    setEditingId(promoter.id);
    setForm({
      name: promoter.name,
      cedula: promoter.cedula,
      whatsapp: promoter.whatsapp,
      instagram: promoter.instagram || '',
      photo_url: promoter.photo_url || '',
      referral_code: promoter.referrer_code || '',
      code: promoter.code,
      username: promoter.username || promoter.code,
      password: promoter.password || promoter.cedula,
      status: promoter.status
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope(editingId ? `/promoters/${editingId}` : '/promoters', '', establishmentId), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyPromoter);
      setEditingId(null);
      onRefresh(editingId ? 'Promotor actualizado' : 'Promotor creado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggle(promoter) {
    await api(withScope(`/promoters/${promoter.id}/status`, '', establishmentId), {
      method: 'PATCH',
      body: JSON.stringify({ status: promoter.status === 'active' ? 'inactive' : 'active' })
    });
    onRefresh('Estado actualizado');
  }

  async function toggleSelling(promoter) {
    await api(withScope(`/promoters/${promoter.id}/selling`, '', establishmentId), {
      method: 'PATCH',
      body: JSON.stringify({ can_sell: !promoter.can_sell })
    });
    onRefresh(promoter.can_sell ? 'Venta deshabilitada' : 'Venta habilitada');
  }

  async function updateManualPoints(promoter, value) {
    await api(withScope(`/promoters/${promoter.id}/manual-points`, '', establishmentId), {
      method: 'PATCH',
      body: JSON.stringify({ manual_points: value })
    });
    onRefresh('Puntos actualizados');
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar promotor' : 'Nuevo promotor'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Nombre" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input label="Cedula" value={form.cedula} onChange={(cedula) => setForm({ ...form, cedula })} />
          <Input label="WhatsApp" value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
          <Input label="Instagram" value={form.instagram} onChange={(instagram) => setForm({ ...form, instagram })} />
          <Input
            label="Referido por codigo de promotor"
            value={form.referral_code}
            onChange={(referral_code) => setForm({ ...form, referral_code })}
          />
          <label>
            Foto de perfil opcional
            <input type="file" accept="image/*" onChange={(event) => pickPhoto(event.target.files?.[0])} />
          </label>
          {form.photo_url && (
            <div className="photo-preview">
              <img src={form.photo_url} alt="Vista previa" />
              <button type="button" className="ghost-button" onClick={() => setForm({ ...form, photo_url: '' })}>
                Quitar foto
              </button>
            </div>
          )}
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          {!editingId && (
            <div className="computed">
              <span>El codigo, usuario y contrasena se crean automaticamente.</span>
              <strong>La contrasena inicial sera la cedula.</strong>
            </div>
          )}
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Plus size={18} />
            {editingId ? 'Guardar' : 'Crear'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>Promotores</h3>
        </div>
        <div className="list">
          {promoters.map((promoter) => (
            <article className="person-row" key={promoter.id}>
              <div>
                <strong>{promoter.name}</strong>
                <span>{promoter.code} · {promoter.whatsapp}</span>
                <small>{promoter.photo_url ? 'Foto configurada' : 'Sin foto de perfil'}</small>
                <small>Usuario: {promoter.username || promoter.code} · Clave: {promoter.password || promoter.cedula}</small>
                <small>{promoter.can_sell ? 'Puede vender' : 'Venta deshabilitada'} · {promoter.manual_points || 0} puntos manuales</small>
                <small>Referido por: {promoter.referrer_code ? `${promoter.referrer_code} - ${promoter.referrer_name}` : 'Sin referido'}</small>
                <small>Referidos logrados: {promoter.referral_count || 0} · {promoter.referral_points_earned || 0} puntos</small>
                <small>{promoter.instagram || 'Sin Instagram'} · {promoter.registered_at}</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(promoter)}>Editar</button>
                <button className="ghost-button" onClick={() => toggleSelling(promoter)}>
                  {promoter.can_sell ? 'Bloquear venta' : 'Habilitar venta'}
                </button>
                <input
                  className="points-input"
                  min="0"
                  type="number"
                  title="Puntos manuales"
                  defaultValue={promoter.manual_points || 0}
                  onBlur={(event) => updateManualPoints(promoter, event.target.value)}
                />
                <button className="icon-button" title="Cambiar estado" onClick={() => toggle(promoter)}>
                  {promoter.status === 'active' ? <ToggleRight /> : <ToggleLeft />}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Sales({ promoters, sales, locations, eventId, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptySale);
  const [promoterCode, setPromoterCode] = useState('');
  const [error, setError] = useState('');
  const activePromoters = promoters.filter((promoter) => promoter.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const estimatedCommission = useMemo(
    () => estimateCommission(form, locations, sales, form.promoter_id),
    [form, locations, sales]
  );
  const activeLocations = locations.filter((location) => location.status === 'active');

  function selectByCode(value) {
    setPromoterCode(value);
    const lookup = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const promoter = activePromoters.find((item) => item.code.replace(/[^a-z0-9]/gi, '').toUpperCase() === lookup);
    if (promoter) {
      setForm({ ...form, promoter_id: promoter.id });
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope('/sales', eventId, establishmentId), {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptySale);
      setPromoterCode('');
      onRefresh('Venta registrada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmSale(saleId) {
    await api(withScope(`/sales/${saleId}/pay`, eventId, establishmentId), { method: 'PATCH' });
    onRefresh('Venta confirmada');
  }

  async function removeSale(sale) {
    const confirmed = window.confirm(
      `Seguro quieres eliminar la venta de ${sale.customer}? No se podran recuperar los datos.`
    );
    if (!confirmed) {
      return;
    }

    await api(withScope(`/sales/${sale.id}`, eventId, establishmentId), { method: 'DELETE' });
    onRefresh('Venta eliminada definitivamente');
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>Registrar venta</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Promotor
            <select value={form.promoter_id} onChange={(e) => setForm({ ...form, promoter_id: e.target.value })}>
              <option value="">Seleccionar</option>
              {activePromoters.map((promoter) => (
                <option value={promoter.id} key={promoter.id}>{promoter.name} · {promoter.code}</option>
              ))}
            </select>
          </label>
          <Input label="Codigo de promotor" value={promoterCode} onChange={selectByCode} />
          <Input label="Cliente" value={form.customer} onChange={(customer) => setForm({ ...form, customer })} />
          <Input label="WhatsApp cliente" value={form.customer_whatsapp} onChange={(customer_whatsapp) => setForm({ ...form, customer_whatsapp })} />
          <label>
            Localidad
            <select
              value={form.location}
              onChange={(e) => {
                const selected = activeLocations.find((location) => location.name === e.target.value);
                setForm({ ...form, location: e.target.value, unit_price: selected ? selected.price : form.unit_price });
              }}
            >
              <option value="">Seleccionar</option>
              {activeLocations.map((location) => (
                <option value={location.name} key={location.id}>{location.name} · {money(location.price)}</option>
              ))}
            </select>
          </label>
          <Input type="number" label="Cantidad" value={form.quantity} onChange={(quantity) => setForm({ ...form, quantity })} />
          <Input type="number" label="Precio unitario" value={form.unit_price} onChange={(unit_price) => setForm({ ...form, unit_price })} />
          <Input type="date" label="Fecha" value={form.sale_date} onChange={(sale_date) => setForm({ ...form, sale_date })} />
          <label>
            Estado
            <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
              <option value="pending">Por confirmar</option>
              <option value="paid">Confirmada por admin</option>
            </select>
          </label>
          <div className="computed">
            <span>Total {money(estimatedTotal)}</span>
            <strong>Comision {money(estimatedCommission)}</strong>
          </div>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Ticket size={18} />
            Registrar
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h3>Ventas</h3>
        </div>
        <DataTable
          columns={['Promotor', 'Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Estado', 'Acciones']}
          rows={sales.map((sale) => [
            sale.promoter_name,
            sale.customer,
            sale.location,
            sale.quantity,
            money(sale.total),
            money(sale.commission),
            paymentLabel(sale.payment_status),
            <div className="row-actions compact-actions">
              {sale.payment_status !== 'paid' && (
                <button className="ghost-button" onClick={() => confirmSale(sale.id)}>
                  <CheckCircle2 size={16} />
                  Confirmar
                </button>
              )}
              <button className="danger-button" onClick={() => removeSale(sale)}>
                Eliminar
              </button>
            </div>
          ])}
        />
      </section>
    </div>
  );
}

function Ranking({ ranking }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>Ranking por total vendido</h3>
      </div>
      <div className="ranking-list">
        {ranking.map((row, index) => (
          <article className="ranking-row" key={row.id}>
            <strong>#{index + 1}</strong>
            <div>
              <h4>{row.name}</h4>
              <span>{row.code} · {row.sales_count} ventas</span>
            </div>
            <div>
              <b>{money(row.total_sold)}</b>
              <span>{money(row.total_commission)} comision</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Settlements({ settlements, eventId, establishmentId, onRefresh }) {
  async function pay(promoterId) {
    await api(withScope(`/settlements/${promoterId}/pay`, eventId, establishmentId), { method: 'PATCH' });
    onRefresh('Comisiones marcadas como pagadas');
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>Liquidaciones</h3>
      </div>
      <DataTable
        columns={['Promotor', 'Vendido', 'Debe entregar', 'Por pagar', 'Pagado', '']}
        rows={settlements.map((row) => [
          `${row.name} (${row.code})`,
          money(row.total_sold),
          money(row.amount_to_deliver),
          money(row.pending_commission),
          money(row.paid_commission),
          <button className="ghost-button" disabled={row.pending_commission <= 0} onClick={() => pay(row.id)}>
            <CheckCircle2 size={16} />
            Pagar
          </button>
        ])}
      />
    </section>
  );
}

function Locations({ locations, eventId, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptyLocation);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  function edit(location) {
    setEditingId(location.id);
    setForm({
      name: location.name,
      price: location.price,
      commission_type: location.commission_type || 'percent',
      commission_value: location.commission_value ?? 3,
      commission_min_quantity: location.commission_min_quantity || 1,
      level_points: location.level_points ?? 1,
      status: location.status
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope(editingId ? `/locations/${editingId}` : '/locations', eventId, establishmentId), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyLocation);
      setEditingId(null);
      onRefresh(editingId ? 'Localidad actualizada' : 'Localidad creada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(location) {
    const confirmed = window.confirm(`Eliminar la localidad "${location.name}"?`);
    if (!confirmed) {
      return;
    }

    setError('');
    try {
      await api(withScope(`/locations/${location.id}`, eventId, establishmentId), { method: 'DELETE' });
      if (editingId === location.id) {
        setEditingId(null);
        setForm(emptyLocation);
      }
      onRefresh('Localidad eliminada');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar localidad' : 'Nueva localidad'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Localidad" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input type="number" label="Precio" value={form.price} onChange={(price) => setForm({ ...form, price })} />
          <label>
            Tipo de comision
            <select
              value={form.commission_type}
              onChange={(e) => setForm({ ...form, commission_type: e.target.value })}
            >
              <option value="percent">Porcentaje</option>
              <option value="fixed">Valor por entrada</option>
            </select>
          </label>
          <Input
            type="number"
            label={form.commission_type === 'fixed' ? 'Comision por entrada' : 'Porcentaje de comision'}
            value={form.commission_value}
            onChange={(commission_value) => setForm({ ...form, commission_value })}
          />
          <Input
            type="number"
            label="Comision desde cuantas entradas"
            value={form.commission_min_quantity}
            onChange={(commission_min_quantity) => setForm({ ...form, commission_min_quantity })}
          />
          <Input
            type="number"
            label="Puntos para nivel por entrada confirmada"
            value={form.level_points}
            onChange={(level_points) => setForm({ ...form, level_points })}
          />
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Plus size={18} />
            Guardar
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Localidades y precios</h3>
        </div>
        <div className="list">
          {locations.map((location) => (
            <article className="person-row" key={location.id}>
              <div>
                <strong>{location.name}</strong>
                <span>{money(location.price)} · {location.status === 'active' ? 'Activa' : 'Inactiva'}</span>
                <small>{commissionLabel(location)}</small>
                <small>{location.level_points ?? 1} puntos de nivel por entrada confirmada</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(location)}>Editar</button>
                <button className="danger-button" onClick={() => remove(location)}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Levels({ levels, eventId, establishmentId, onRefresh }) {
  const [form, setForm] = useState(normalizeLevelForm(levels));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(normalizeLevelForm(levels));
  }, [levels]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope('/level-settings', eventId, establishmentId), {
        method: 'PUT',
        body: JSON.stringify(form)
      });
      onRefresh('Niveles actualizados');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>Niveles de promotores</h3>
      </div>
      <form className="form-grid level-grid" onSubmit={submit}>
        <Input type="number" label="Bronce desde puntos" value={form.bronze} onChange={(bronze) => setForm({ ...form, bronze })} />
        <Input type="number" label="Plata desde puntos" value={form.silver} onChange={(silver) => setForm({ ...form, silver })} />
        <Input type="number" label="Diamante desde puntos" value={form.diamond} onChange={(diamond) => setForm({ ...form, diamond })} />
        <Input
          type="number"
          label="Puntos por referido"
          value={form.referral_points}
          onChange={(referral_points) => setForm({ ...form, referral_points })}
        />
        <label>
          Beneficios Bronce
          <textarea
            value={form.bronze_benefits}
            onChange={(e) => setForm({ ...form, bronze_benefits: e.target.value })}
            rows={5}
            placeholder="Un beneficio por linea"
          />
        </label>
        <label>
          Beneficios Plata
          <textarea
            value={form.silver_benefits}
            onChange={(e) => setForm({ ...form, silver_benefits: e.target.value })}
            rows={5}
            placeholder="Un beneficio por linea"
          />
        </label>
        <label>
          Beneficios Diamante
          <textarea
            value={form.diamond_benefits}
            onChange={(e) => setForm({ ...form, diamond_benefits: e.target.value })}
            rows={5}
            placeholder="Un beneficio por linea"
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button" type="submit">
          <BadgeCheck size={18} />
          Guardar niveles
        </button>
      </form>
      <div className="level-preview">
        <article className="level-card bronze">
          <strong>Bronce</strong>
          <span>Desde {form.bronze} puntos</span>
          <ul>
            {benefitsText(form.bronze_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </article>
        <article className="level-card silver">
          <strong>Plata</strong>
          <span>Desde {form.silver} puntos</span>
          <ul>
            {benefitsText(form.silver_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </article>
        <article className="level-card diamond">
          <strong>Diamante</strong>
          <span>Desde {form.diamond} puntos</span>
          <ul>
            {benefitsText(form.diamond_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </article>
      </div>
    </section>
  );
}

function Banners({ banners, eventId, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptyBanner);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function pickBanner(file) {
    setError('');
    try {
      const image_url = await imageFileToDataUrl(file);
      setForm({ ...form, image_url });
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(banner) {
    setEditingId(banner.id);
    setForm({
      image_url: banner.image_url,
      title: banner.title || '',
      sort_order: banner.sort_order || 0,
      status: banner.status
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope(editingId ? `/event-banners/${editingId}` : '/event-banners', eventId, establishmentId), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyBanner);
      setEditingId(null);
      onRefresh(editingId ? 'Banner actualizado' : 'Banner creado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(banner) {
    const confirmed = window.confirm('Eliminar este banner?');
    if (!confirmed) {
      return;
    }

    await api(withScope(`/event-banners/${banner.id}`, eventId, establishmentId), { method: 'DELETE' });
    onRefresh('Banner eliminado');
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar banner' : 'Nuevo banner'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Foto del banner
            <input type="file" accept="image/*" onChange={(event) => pickBanner(event.target.files?.[0])} />
          </label>
          <Input label="Titulo opcional" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <Input type="number" label="Orden" value={form.sort_order} onChange={(sort_order) => setForm({ ...form, sort_order })} />
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          {form.image_url && (
            <div className="banner-preview">
              <img src={form.image_url} alt="Vista previa del banner" />
              {form.title && <strong>{form.title}</strong>}
            </div>
          )}
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Sparkles size={18} />
            Guardar banner
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Banners del evento</h3>
        </div>
        <div className="banner-list">
          {banners.map((banner) => (
            <article className={`banner-admin-card ${banner.status}`} key={banner.id}>
              <img src={banner.image_url} alt={banner.title || 'Banner'} />
              <div>
                <strong>{banner.title || 'Banner sin titulo'}</strong>
                <span>{banner.status === 'active' ? 'Activo' : 'Inactivo'} · Orden {banner.sort_order || 0}</span>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(banner)}>Editar</button>
                <button className="danger-button" onClick={() => remove(banner)}>Eliminar</button>
              </div>
            </article>
          ))}
          {!banners.length && <div className="empty-state">Sin banners para este evento</div>}
        </div>
      </section>
    </div>
  );
}

function PromoterBenefits({ level }) {
  const catalog = levelCatalogFromProfile(level);
  const currentRank = levelOrder[level?.key || 'starter'] || 0;

  return (
    <section className="benefits-showcase">
      <div className="benefits-heading">
        <div>
          <span>Club de beneficios</span>
          <h3>Tu progreso GEMASHOW</h3>
        </div>
        <div className={`benefits-rank ${level?.key || 'starter'}`}>
          <Sparkles size={18} />
          {level?.name || 'Inicial'}
        </div>
      </div>
      <div className="benefits-grid">
        {catalog.map((item) => {
          const unlocked = currentRank >= (levelOrder[item.key] || 0);
          return (
            <article className={`benefit-tier ${item.key} ${unlocked ? 'unlocked' : 'locked'}`} key={item.key}>
              <div className="benefit-tier-top">
                <div>
                  <strong>{item.name}</strong>
                  <span>Desde {item.min} puntos</span>
                </div>
                <div className="benefit-icon">
                  {unlocked ? <BadgeCheck size={20} /> : <Lock size={20} />}
                </div>
              </div>
              <ul>
                {(item.benefits || []).map((benefit) => (
                  <li key={benefit}>
                    {unlocked ? <CheckCircle2 size={16} /> : <Lock size={15} />}
                    <span>{unlocked ? benefit : 'Beneficio bloqueado'}</span>
                  </li>
                ))}
              </ul>
              {!unlocked && <small>Sube de nivel para desbloquear estos beneficios.</small>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PromoterApp({ user, onLogout }) {
  const [sales, setSales] = useState([]);
  const [locations, setLocations] = useState([]);
  const [banners, setBanners] = useState([]);
  const [profile, setProfile] = useState(user);
  const [form, setForm] = useState(emptySale);
  const [profileForm, setProfileForm] = useState({ photo_url: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const canRegisterSales = Boolean(profile?.establishment?.promoter_sales_enabled && profile?.can_sell);
  const activeLocations = locations.filter((location) => location.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const confirmedCommission = useMemo(
    () => sales
      .filter((sale) => sale.payment_status === 'paid')
      .reduce((sum, sale) => sum + Number(sale.commission || 0), 0),
    [sales]
  );

  async function loadData() {
    const [nextSales, nextLocations, nextProfile, nextBanners] = await Promise.all([
      api('/promoter/sales'),
      api('/locations'),
      api('/promoter/me'),
      api('/promoter/banners')
    ]);
    setSales(nextSales);
    setLocations(nextLocations);
    setProfile(nextProfile);
    setBanners(nextBanners);
    setProfileForm({ photo_url: nextProfile.photo_url || '' });
  }

  useEffect(() => {
    loadData().catch(() => onLogout());
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/promoter/sales', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptySale);
      await loadData();
      setNotice('Venta registrada');
      setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError('');
    try {
      await api('/promoter/password', {
        method: 'PATCH',
        body: JSON.stringify(passwordForm)
      });
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setNotice('Contrasena actualizada');
      setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setPasswordError(err.message);
    }
  }

  async function updateProfile(event) {
    event.preventDefault();
    setProfileError('');
    try {
      const nextProfile = await api('/promoter/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm)
      });
      setProfile(nextProfile);
      setNotice('Foto actualizada');
      setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setProfileError(err.message);
    }
  }

  async function pickProfilePhoto(file) {
    setProfileError('');
    try {
      const photo_url = await imageFileToDataUrl(file);
      setProfileForm({ ...profileForm, photo_url });
    } catch (err) {
      setProfileError(err.message);
    }
  }

  return (
    <main className="content promoter-content">
      <header className="topbar">
        <div>
          <p>{profile?.establishment?.display_name || profile?.establishment?.name || 'PROMOTERS'}</p>
          <h2>{profile?.activeEvent?.name || 'Evento activo'}</h2>
        </div>
        <button className="ghost-button" onClick={onLogout}>
          <LogOut size={18} />
          Salir
        </button>
      </header>
      {notice && <div className="alert success">{notice}</div>}
      {!!banners.length && (
        <section className="promoter-banners">
          {banners.map((banner) => (
            <article className="promoter-banner" key={banner.id}>
              <img src={banner.image_url} alt={banner.title || 'Banner del evento'} />
              {banner.title && <strong>{banner.title}</strong>}
            </article>
          ))}
        </section>
      )}
      <section className={`promoter-profile ${profile?.level?.key || 'starter'}`}>
        <div className="profile-photo">
          {profile?.photo_url ? <img src={profile.photo_url} alt={profile.name} /> : <UserRound size={42} />}
        </div>
        <div>
          <strong>{profile?.name || user.name}</strong>
          <span>{profile?.code || user.code}</span>
          <small>
            {profile?.level?.name || 'Inicial'} · {profile?.level?.levelPoints || 0} puntos · {profile?.level?.paidSales || 0} ventas confirmadas
          </small>
        </div>
        <button className="ghost-button profile-edit-button" type="button" onClick={() => setProfileEditorOpen(!profileEditorOpen)}>
          <UserRound size={18} />
          {profileEditorOpen ? 'Cerrar perfil' : 'Editar perfil'}
        </button>
      </section>
      {canRegisterSales && (
      <section className="commission-summary-card">
        <div>
          <span>Comision confirmada</span>
          <strong>{showCommission ? money(confirmedCommission) : '••••••'}</strong>
          <small>Solo cuenta ventas aprobadas por el administrador.</small>
        </div>
        <button className="ghost-button" type="button" onClick={() => setShowCommission(!showCommission)}>
          {showCommission ? <EyeOff size={18} /> : <Eye size={18} />}
          {showCommission ? 'Ocultar' : 'Mostrar'}
        </button>
      </section>
      )}
      {profileEditorOpen && (
        <section className="panel profile-editor-panel">
          <div className="panel-title">
            <h3>Editar perfil</h3>
          </div>
          <div className="profile-editor-grid">
            <form className="form-grid" onSubmit={updateProfile}>
              <label>
                Elegir foto desde el dispositivo
                <input type="file" accept="image/*" onChange={(event) => pickProfilePhoto(event.target.files?.[0])} />
              </label>
              {profileForm.photo_url && (
                <div className="photo-preview">
                  <img src={profileForm.photo_url} alt="Vista previa" />
                  <button type="button" className="ghost-button" onClick={() => setProfileForm({ photo_url: '' })}>
                    Quitar foto
                  </button>
                </div>
              )}
              {profileError && <div className="alert error">{profileError}</div>}
              <button className="primary-button" type="submit">
                <UserRound size={18} />
                Guardar foto
              </button>
            </form>
            <form className="form-grid" onSubmit={changePassword}>
              <Input
                type="password"
                label="Contrasena actual"
                value={passwordForm.currentPassword}
                onChange={(currentPassword) => setPasswordForm({ ...passwordForm, currentPassword })}
              />
              <Input
                type="password"
                label="Nueva contrasena"
                value={passwordForm.newPassword}
                onChange={(newPassword) => setPasswordForm({ ...passwordForm, newPassword })}
              />
              {passwordError && <div className="alert error">{passwordError}</div>}
              <button className="primary-button" type="submit">
                <KeyRound size={18} />
                Guardar contrasena
              </button>
            </form>
          </div>
        </section>
      )}
      <PromoterBenefits level={profile?.level} />
      {canRegisterSales && (
      <div className="two-column">
        <section className="panel">
          <div className="panel-title">
            <h3>Registrar venta</h3>
          </div>
          {!profile?.can_sell && (
            <div className="alert error">Tu cuenta no esta habilitada para registrar ventas.</div>
          )}
          <form className="form-grid" onSubmit={submit}>
            <Input label="Cliente" value={form.customer} onChange={(customer) => setForm({ ...form, customer })} />
            <Input label="WhatsApp cliente" value={form.customer_whatsapp} onChange={(customer_whatsapp) => setForm({ ...form, customer_whatsapp })} />
            <label>
              Localidad
              <select
                value={form.location}
                onChange={(e) => {
                  const selected = activeLocations.find((location) => location.name === e.target.value);
                  setForm({ ...form, location: e.target.value, unit_price: selected ? selected.price : form.unit_price });
                }}
              >
                <option value="">Seleccionar</option>
                {activeLocations.map((location) => (
                  <option value={location.name} key={location.id}>{location.name} · {money(location.price)}</option>
                ))}
              </select>
            </label>
            <Input type="number" label="Cantidad" value={form.quantity} onChange={(quantity) => setForm({ ...form, quantity })} />
            <Input type="date" label="Fecha" value={form.sale_date} onChange={(sale_date) => setForm({ ...form, sale_date })} />
            <div className="computed">
              <span>Total {money(estimatedTotal)}</span>
              <strong>La comision se genera cuando el admin confirme la venta.</strong>
            </div>
            {error && <div className="alert error">{error}</div>}
            <button className="primary-button" type="submit" disabled={!profile?.can_sell}>
              <Ticket size={18} />
              Registrar
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">
            <h3>Mis ventas</h3>
          </div>
          <DataTable
            columns={['Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Estado']}
            rows={sales.map((sale) => [
              sale.customer,
              sale.location,
              sale.quantity,
              money(sale.total),
              money(sale.commission),
              paymentLabel(sale.payment_status)
            ])}
          />
        </section>
      </div>
      )}
    </main>
  );
}

function VerifyPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function verify(event) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const data = await api('/verify', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      setResult(data);
    } catch {
      setResult({ registered: false, message: 'Codigo no registrado' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="verify-shell">
      <section className="verify-panel">
        <div className="brand-mark">G</div>
        <h1>Verificacion GEMASHOW</h1>
        <form onSubmit={verify} className="verify-form">
          <input
            placeholder="Codigo de promotor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button className="primary-button" disabled={!code.trim() || loading}>
            <Search size={18} />
            Verificar
          </button>
        </form>
        {result && (
          <div className={result.registered ? `verify-result ok premium ${result.promoter.level?.key || 'starter'}` : 'verify-result bad'}>
            {result.registered && (
              <div className="verify-photo">
                {result.promoter.photo_url ? <img src={result.promoter.photo_url} alt={result.promoter.name} /> : <UserRound size={48} />}
              </div>
            )}
            <h2>{result.message}</h2>
            {result.registered && (
              <>
                <div className="verify-level">
                  <strong>{result.promoter.level?.name || 'Inicial'}</strong>
                  <span>{result.promoter.level?.description || 'Promotor oficial GEMASHOW'}</span>
                </div>
                <p><UserRound size={17} /> {result.promoter.name}</p>
                <p>{result.promoter.instagram || 'Sin Instagram'}</p>
                <p>WhatsApp: {result.promoter.whatsapp}</p>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DataTable({ columns, rows }) {
  if (!rows.length) {
    return <div className="empty-state">Sin registros todavia</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
