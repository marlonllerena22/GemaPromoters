import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Link as LinkIcon,
  Lock,
  LogOut,
  Medal,
  Plus,
  Search,
  Share2,
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
import ProducalzaApp from './ProducalzaApp.jsx';
import LocalAttendancePage from './LocalAttendancePage.jsx';
import './styles.css';

const emptyPromoter = {
  name: '',
  cedula: '',
  email: '',
  whatsapp: '',
  instagram: '',
  photo_url: '',
  referral_code: '',
  branch_id: '',
  code: '',
  username: '',
  password: '',
  status: 'active'
};

const emptyLevels = {
  bronze: 1,
  silver: 10,
  gold: 25,
  benefits: {
    bronze: ['Acceso a preventas internas', 'Material digital GEMASHOW', 'Reconocimiento como Bronze promoter'],
    silver: ['Prioridad en localidades de alta demanda', 'Bonos especiales por metas', 'Insignia Silver en el perfil'],
    gold: ['Beneficios VIP de promotor top', 'Prioridad maxima en cupos', 'Reconocimiento Gold GEMASHOW']
  },
  commissions: {
    starter: 0,
    bronze: 2,
    silver: 5,
    gold: 10
  },
  referralPoints: 3
};

const levelOrder = {
  starter: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
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

const emptyWithdrawal = {
  bank: '',
  account_holder: '',
  account_number: '',
  cedula: ''
};

const emptyEstablishment = {
  name: '',
  display_name: '',
  business_type: 'event',
  module_type: 'promoters',
  code_prefix: '',
  theme: '',
  logo_url: '',
  admin_username: '',
  admin_password: '',
  status: 'active',
  promoter_sales_enabled: true
};

const emptyBranch = {
  name: '',
  address: '',
  status: 'active'
};

const emptyRegister = {
  establishment_id: '',
  name: '',
  cedula: '',
  email: '',
  whatsapp: '',
  instagram: '',
  referral_code: ''
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
    gold: levels.gold ?? levels.diamond ?? emptyLevels.gold,
    referral_points: levels.referralPoints ?? emptyLevels.referralPoints,
    bronze_commission: levels.commissions?.bronze ?? emptyLevels.commissions.bronze,
    silver_commission: levels.commissions?.silver ?? emptyLevels.commissions.silver,
    gold_commission: levels.commissions?.gold ?? levels.commissions?.diamond ?? emptyLevels.commissions.gold,
    bronze_benefits: benefitsText(levels.benefits?.bronze || emptyLevels.benefits.bronze),
    silver_benefits: benefitsText(levels.benefits?.silver || emptyLevels.benefits.silver),
    gold_benefits: benefitsText(levels.benefits?.gold || levels.benefits?.diamond || emptyLevels.benefits.gold)
  };
}

function levelCatalogFromProfile(level) {
  const catalog = level?.catalog || [];
  if (catalog.length) {
    return catalog;
  }

  return [
    { key: 'bronze', name: 'Bronze', min: level?.settings?.bronze || 1, benefits: emptyLevels.benefits.bronze },
    { key: 'silver', name: 'Silver', min: level?.settings?.silver || 10, benefits: emptyLevels.benefits.silver },
    { key: 'gold', name: 'Gold', min: level?.settings?.gold || level?.settings?.diamond || 25, benefits: emptyLevels.benefits.gold }
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

function estimateCommission(form, promoters, levels, promoterId = form.promoter_id) {
  if (form.payment_status !== 'paid') {
    return 0;
  }

  const promoter = promoters.find((item) => String(item.id) === String(promoterId));
  const levelKey = promoter?.level?.key || 'starter';
  const rate = Number(levels?.commissions?.[levelKey] || 0);
  return Number(form.quantity || 0) * Number(form.unit_price || 0) * (rate / 100);
}

function paymentLabel(status) {
  return status === 'paid' ? 'Confirmada' : 'Por confirmar';
}

function saleOrderNumber(sale) {
  return sale.order_number || `PED-${String(sale.id || '').padStart(6, '0')}`;
}

function receiptWhatsappUrl(promoterName, sale) {
  const message = `Hola, soy *${promoterName}*. Envio el comprobante de pago del pedido *${saleOrderNumber(sale)}*. Quedo atento/a a la confirmacion del administrador. Muchas gracias.`;
  return `https://wa.me/593990465362?text=${encodeURIComponent(message)}`;
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

  if (window.location.pathname === '/registro') {
    return <RegisterPage />;
  }

  if (window.location.pathname === '/asistencia-locales' || window.location.pathname === '/asistencia') {
    return <LocalAttendancePage />;
  }

  if (!token) {
    return <Login onLogin={(nextToken, nextUser) => {
      saveToken(nextToken);
      saveUser(nextUser);
    }} />;
  }

  if (user?.role === 'promoter') {
    return <PromoterAppPremium user={user} onLogout={() => {
      clearToken();
      saveToken(null);
      saveUser(null);
    }} />;
  }

  const isProductionSession =
    ['production_admin', 'production_vendor'].includes(user?.role) ||
    user?.establishment_module_type === 'production' ||
    String(user?.establishment_name || '').toUpperCase() === 'PRODUCALZA';

  if (isProductionSession) {
    return <ProducalzaApp user={user} onLogout={() => {
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
  const savedCredentials = (() => {
    try {
      return JSON.parse(localStorage.getItem('promoters_remember_credentials') || '{}');
    } catch {
      return {};
    }
  })();
  const [form, setForm] = useState({ username: savedCredentials.username || '', password: savedCredentials.password || '' });
  const [rememberMe, setRememberMe] = useState(Boolean(savedCredentials.username && savedCredentials.password));
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const paths = ['/auth/login', '/auth/promoter-login'];
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
      if (rememberMe) {
        localStorage.setItem('promoters_remember_credentials', JSON.stringify(form));
      } else {
        localStorage.removeItem('promoters_remember_credentials');
      }
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand-row">
          <div className="brand-mark">P</div>
          <div>
            <span className="login-eyebrow">Plataforma oficial</span>
            <h1>PROMOTERS</h1>
          </div>
        </div>
        <p>Acceso unificado para administradores, promotores y negocios aliados.</p>
        <div className="login-premium-note">
          <Sparkles size={18} />
          El sistema reconoce tu cuenta y abre tu espacio automaticamente.
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
          <label className="remember-control">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            Recordar mis datos en este dispositivo
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <KeyRound size={18} />
            Entrar
          </button>
        </form>
        <div className="login-secondary-actions">
          <a href="/registro">Quiero registrarme como promotor</a>
          <a href="/verificar">Verificar codigo de promotor</a>
        </div>
      </section>
    </main>
  );
}

function RegisterPage() {
  const [form, setForm] = useState(emptyRegister);
  const [establishments, setEstablishments] = useState([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const selectedEstablishment = establishments.find((item) => String(item.id) === String(form.establishment_id)) || establishments[0];

  useEffect(() => {
    api('/public-establishments')
      .then((rows) => {
        setEstablishments(rows);
        if (rows.length) {
          const defaultEstablishment =
            rows.find((item) =>
              item.theme === 'digitalesclub' ||
              item.code_prefix === 'DGCLUB' ||
              /digitales/i.test(`${item.display_name || ''} ${item.name || ''}`)
            ) || rows[0];
          setForm((current) => ({
            ...current,
            establishment_id: current.establishment_id || String(defaultEstablishment.id)
          }));
        }
      })
      .catch(() => setEstablishments([]));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    try {
      const response = await api('/promoter-register', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setResult(response);
      setForm({ ...emptyRegister, establishment_id: form.establishment_id });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="register-shell">
      <section className="register-panel">
        <div className="login-brand-row">
          <div className="brand-mark">P</div>
          <div>
            <span className="login-eyebrow">Registro oficial</span>
            <h1>PROMOTERS</h1>
          </div>
        </div>
        <p>Crea tu cuenta de promotor {selectedEstablishment?.display_name || selectedEstablishment?.name || 'PROMOTERS'}. Tus accesos se enviaran al correo registrado.</p>
        <form className="form-grid" onSubmit={submit}>
          {establishments.length > 1 && (
            <label>
              Marca
              <select value={form.establishment_id} onChange={(event) => setForm({ ...form, establishment_id: event.target.value })}>
                {establishments.map((establishment) => (
                  <option value={establishment.id} key={establishment.id}>
                    {establishment.display_name || establishment.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Input label="Nombre completo" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input label="Cedula" value={form.cedula} onChange={(cedula) => setForm({ ...form, cedula })} />
          <Input type="email" label="Correo electronico" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <Input label="WhatsApp" value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
          <Input label="Instagram" value={form.instagram} onChange={(instagram) => setForm({ ...form, instagram })} />
          <Input label="Codigo de referido (opcional)" value={form.referral_code} onChange={(referral_code) => setForm({ ...form, referral_code })} />
          {error && <div className="alert error">{error}</div>}
          {result && (
            <div className={result.email_sent ? 'alert success' : 'alert warning'}>
              {result.message} Usuario generado: {result.username}
            </div>
          )}
          <button className="primary-button" type="submit">
            <UserRound size={18} />
            Crear mi cuenta
          </button>
        </form>
        <div className="login-secondary-actions">
          <a href="/">Ya tengo cuenta</a>
          <a href="/verificar">Verificar codigo</a>
        </div>
      </section>
    </main>
  );
}

function AdminApp({ user, onLogout }) {
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({
    dashboard: null,
    establishments: [],
    branches: [],
    events: [],
    promoters: [],
    sales: [],
    ranking: [],
    withdrawals: [],
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
    const nextEstablishment = establishments.find((item) => String(item.id) === String(establishmentId));
    if (nextEstablishment?.module_type === 'production') {
      if (view !== 'establishments') {
        setView('production');
      }
      if (establishmentId && String(establishmentId) !== String(selectedEstablishmentId)) {
        setSelectedEstablishmentId(String(establishmentId));
      }
      setSelectedEventId('');
      setData((current) => ({
        ...current,
        establishments,
        branches: [],
        events: [],
        promoters: [],
        sales: [],
        ranking: [],
        withdrawals: [],
        locations: [],
        banners: []
      }));
      setLoading(false);
      return;
    }
    if (view === 'production') {
      setView('dashboard');
    }
    if (nextEstablishment?.business_type === 'commercial' && view === 'events') {
      setView('branches');
    }
    if (nextEstablishment?.business_type !== 'commercial' && view === 'branches') {
      setView('dashboard');
    }
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

    const [dashboard, promoters, sales, ranking, withdrawals, locations, levels, banners, branches] = await Promise.all([
      api(withScope('/dashboard', eventId, establishmentId)),
      api(withScope('/promoters', eventId, establishmentId)),
      api(withScope('/sales', eventId, establishmentId)),
      api(withScope('/ranking', eventId, establishmentId)),
      api(withScope('/withdrawals', eventId, establishmentId)),
      api(withScope('/locations', eventId, establishmentId)),
      api(withScope('/level-settings', eventId, establishmentId)),
      api(withScope('/event-banners', eventId, establishmentId)),
      api(withScope('/branches', '', establishmentId))
    ]);
    setData({ dashboard, establishments, branches, events, promoters, sales, ranking, withdrawals, locations, levels, banners });
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

  const currentEstablishment = data.establishments.find((item) => String(item.id) === String(selectedEstablishmentId));
  const isCommercialBusiness = currentEstablishment?.business_type === 'commercial';
  const isProductionBusiness = currentEstablishment?.module_type === 'production';
  const canSwitchBusiness = user?.role === 'supreme' && data.establishments.length > 1;
  const nav = isProductionBusiness ? [
    ...(user?.role === 'supreme' ? [['establishments', 'Negocios', Building2]] : []),
    ['production', 'Producalza', Settings]
  ] : [
    ...(user?.role === 'supreme' ? [['establishments', 'Negocios', Building2]] : []),
    ['dashboard', 'Panel', BarChart3],
    ...(!isCommercialBusiness ? [['events', 'Eventos', CalendarDays]] : []),
    ...(isCommercialBusiness ? [['branches', 'Sucursales', Building2]] : []),
    ['promoters', 'Promotores', UsersRound],
    ['sales', 'Ventas', Ticket],
    ['ranking', 'Ranking', Medal],
    ['withdrawals', 'Retiros', CreditCard],
    ['settings', 'Localidades', Settings],
    ['levels', 'Niveles', BadgeCheck],
    ['banners', 'Banners', Sparkles]
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
          <div className="sidebar-brand">
          <div className="brand-mark small">P</div>
          <div>
            <strong>PROMOTERS</strong>
            <span>{user?.role === 'supreme' ? 'Administrador supremo' : user?.establishment_display_name || currentEstablishment?.display_name || 'Negocio'}</span>
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
            <p>{currentEstablishment?.display_name || 'PROMOTERS'}</p>
            <h2>{nav.find(([key]) => key === view)?.[1]}</h2>
          </div>
          {canSwitchBusiness && (
            <label className="event-selector">
              Negocio
              <select value={selectedEstablishmentId} onChange={(e) => loadAll('', e.target.value)}>
                {data.establishments.map((establishment) => (
                  <option value={establishment.id} key={establishment.id}>
                    {establishment.display_name || establishment.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isCommercialBusiness && !isProductionBusiness && (
            <label className="event-selector">
              Evento
              <select value={selectedEventId} onChange={(e) => loadAll(e.target.value)}>
                {data.events.map((event) => (
                  <option value={event.id} key={event.id}>{event.name}</option>
                ))}
              </select>
            </label>
          )}
          {notice && <div className="alert success">{notice}</div>}
        </header>

        {loading ? (
          <div className="empty-state">Cargando informacion...</div>
        ) : (
          <>
            {view === 'establishments' && (
              <Establishments establishments={data.establishments} onRefresh={refresh} />
            )}
            {view === 'production' && isProductionBusiness && (
              <ProducalzaApp
                embedded
                establishmentId={selectedEstablishmentId}
                user={{ ...user, establishment_id: Number(selectedEstablishmentId), role: user.role === 'supreme' ? 'supreme' : 'admin' }}
              />
            )}
            {view === 'dashboard' && !isProductionBusiness && <Dashboard stats={data.dashboard} sales={data.sales} />}
            {view === 'branches' && isCommercialBusiness && (
              <Branches branches={data.branches} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'events' && !isCommercialBusiness && (
              <Events events={data.events} selectedEventId={selectedEventId} establishmentId={selectedEstablishmentId} onSelect={(eventId) => loadAll(eventId)} onRefresh={refresh} />
            )}
            {view === 'promoters' && (
              <Promoters promoters={data.promoters} branches={data.branches} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'sales' && (
              <Sales promoters={data.promoters} sales={data.sales} locations={data.locations} levels={data.levels} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
            )}
            {view === 'ranking' && <Ranking ranking={data.ranking} />}
            {view === 'withdrawals' && (
              <Withdrawals withdrawals={data.withdrawals} promoters={data.promoters} eventId={selectedEventId} establishmentId={selectedEstablishmentId} onRefresh={refresh} />
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
          columns={['Pedido', 'Promotor', 'Cliente', 'Localidad', 'Total', 'Comision', 'Estado']}
          rows={sales.slice(0, 8).map((sale) => [
            saleOrderNumber(sale),
            sale.promoter_name,
            sale.customer,
            sale.location,
            money(sale.total),
            money(sale.commission),
            sale.deleted_at ? 'Eliminada' : paymentLabel(sale.payment_status)
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
      business_type: establishment.business_type || 'event',
      module_type: establishment.module_type || 'promoters',
      code_prefix: establishment.code_prefix || '',
      theme: establishment.theme || '',
      logo_url: establishment.logo_url || '',
      admin_username: establishment.admin_username || '',
      admin_password: establishment.admin_password || '',
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
      onRefresh(editingId ? 'Negocio actualizado' : 'Negocio creado');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar negocio' : 'Nuevo negocio'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Nombre interno" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input label="Nombre visible" value={form.display_name} onChange={(display_name) => setForm({ ...form, display_name })} />
          <Input label="Prefijo de usuarios" value={form.code_prefix} onChange={(code_prefix) => setForm({ ...form, code_prefix })} />
          <Input label="Tema visual" value={form.theme} onChange={(theme) => setForm({ ...form, theme })} />
          <Input label="Logo URL" value={form.logo_url} onChange={(logo_url) => setForm({ ...form, logo_url })} />
          <label>
            Modulo del negocio
            <select
              value={form.module_type}
              onChange={(e) => {
                const module_type = e.target.value;
                setForm({
                  ...form,
                  module_type,
                  business_type: module_type === 'production' ? 'commercial' : form.business_type,
                  promoter_sales_enabled: module_type === 'production' ? false : form.promoter_sales_enabled
                });
              }}
            >
              <option value="promoters">Promotores, eventos o local comercial</option>
              <option value="production">Produccion y pedidos</option>
            </select>
          </label>
          <label>
            Tipo de negocio
            <select
              value={form.business_type}
              disabled={form.module_type === 'production'}
              onChange={(e) => {
                const business_type = e.target.value;
                setForm({
                  ...form,
                  business_type,
                  promoter_sales_enabled: business_type === 'event' ? form.promoter_sales_enabled : false
                });
              }}
            >
              <option value="event">Evento o concierto</option>
              <option value="commercial">Local comercial</option>
            </select>
          </label>
          <Input label="Usuario administrador del negocio" value={form.admin_username} onChange={(admin_username) => setForm({ ...form, admin_username })} />
          <Input label="Contrasena administrador del negocio" value={form.admin_password} onChange={(admin_password) => setForm({ ...form, admin_password })} />
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
              disabled={form.business_type === 'commercial' || form.module_type === 'production'}
              onChange={(e) => setForm({ ...form, promoter_sales_enabled: e.target.checked })}
            />
            {form.module_type === 'production'
              ? 'Produccion: usuarios, clientes y pedidos propios'
              : form.business_type === 'commercial'
                ? 'Local comercial: ventas solo por administrador'
                : 'Promotores pueden registrar ventas desde su cuenta'}
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
          <h3>Negocios PROMOTERS</h3>
        </div>
        <div className="list">
          {establishments.map((establishment) => (
            <article className="person-row" key={establishment.id}>
              <div>
                <strong>{establishment.display_name || establishment.name}</strong>
                <span>{establishment.status === 'active' ? 'Activo' : 'Inactivo'} · {establishment.promoter_sales_enabled ? 'Promotores venden' : 'Ventas solo por admin'}</span>
                <small>{establishment.name} · Prefijo {establishment.code_prefix || 'PROMO'}</small>
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

function Branches({ branches, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptyBranch);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  function edit(branch) {
    setEditingId(branch.id);
    setForm({
      name: branch.name,
      address: branch.address || '',
      status: branch.status
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api(withScope(editingId ? `/branches/${editingId}` : '/branches', '', establishmentId), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyBranch);
      setEditingId(null);
      onRefresh(editingId ? 'Sucursal actualizada' : 'Sucursal creada');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title">
          <h3>{editingId ? 'Editar sucursal' : 'Nueva sucursal'}</h3>
        </div>
        <form className="form-grid" onSubmit={submit}>
          <Input label="Nombre de sucursal" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Input label="Direccion opcional" value={form.address} onChange={(address) => setForm({ ...form, address })} />
          <label>
            Estado
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" type="submit">
            <Building2 size={18} />
            Guardar sucursal
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h3>Sucursales</h3>
        </div>
        <div className="list">
          {branches.map((branch) => (
            <article className="person-row" key={branch.id}>
              <div>
                <strong>{branch.name}</strong>
                <span>{branch.status === 'active' ? 'Activa' : 'Inactiva'}</span>
                <small>{branch.address || 'Sin direccion'}</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(branch)}>Editar</button>
              </div>
            </article>
          ))}
          {!branches.length && <div className="empty-state">Sin sucursales registradas</div>}
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

function Promoters({ promoters, branches, establishmentId, onRefresh }) {
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
      email: promoter.email || '',
      whatsapp: promoter.whatsapp,
      instagram: promoter.instagram || '',
      photo_url: promoter.photo_url || '',
      referral_code: promoter.referrer_code || '',
      branch_id: promoter.branch_id || '',
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

  async function removePromoter(promoter) {
    const confirmed = window.confirm(`Seguro quieres eliminar la cuenta de ${promoter.name}? El promotor no podra ingresar ni vender, pero el historial se conserva.`);
    if (!confirmed) {
      return;
    }

    await api(withScope(`/promoters/${promoter.id}`, '', establishmentId), { method: 'DELETE' });
    onRefresh('Promotor eliminado');
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
          <Input type="email" label="Correo electronico" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <Input label="WhatsApp" value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
          <Input label="Instagram" value={form.instagram} onChange={(instagram) => setForm({ ...form, instagram })} />
          <Input
            label="Referido por codigo de promotor"
            value={form.referral_code}
            onChange={(referral_code) => setForm({ ...form, referral_code })}
          />
          {!!branches.length && (
            <label>
              Sucursal
              <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">Sin sucursal</option>
                {branches.map((branch) => (
                  <option value={branch.id} key={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
          )}
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
                <small>{promoter.email || 'Sin correo registrado'}</small>
                <small>{promoter.photo_url ? 'Foto configurada' : 'Sin foto de perfil'}</small>
                {promoter.branch_name && <small>Sucursal: {promoter.branch_name}</small>}
                <small>Usuario: {promoter.username || promoter.code} · Clave: {promoter.password || promoter.cedula}</small>
                <small>{promoter.can_sell ? 'Puede vender' : 'Venta deshabilitada'} · {promoter.manual_points || 0} puntos manuales</small>
                <small>Referido por: {promoter.referrer_code ? `${promoter.referrer_code} - ${promoter.referrer_name}` : 'Sin referido'}</small>
                <small>Referidos logrados: {promoter.referral_count || 0} · {promoter.referral_points_earned || 0} puntos</small>
                <small>{promoter.instagram || 'Sin Instagram'} · {promoter.registered_at}</small>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => edit(promoter)}>Editar</button>
                <button className="danger-button" onClick={() => removePromoter(promoter)}>Eliminar</button>
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

function Sales({ promoters, sales, locations, levels, eventId, establishmentId, onRefresh }) {
  const [form, setForm] = useState(emptySale);
  const [promoterCode, setPromoterCode] = useState('');
  const [promoterFilter, setPromoterFilter] = useState('');
  const [error, setError] = useState('');
  const activePromoters = promoters.filter((promoter) => promoter.status === 'active');
  const filteredSales = promoterFilter ? sales.filter((sale) => String(sale.promoter_id) === String(promoterFilter)) : sales;
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const estimatedCommission = useMemo(
    () => estimateCommission(form, promoters, levels, form.promoter_id),
    [form, promoters, levels]
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
      `Seguro quieres eliminar la venta de ${sale.customer}? La venta quedara archivada y sus datos se conservaran en la base.`
    );
    if (!confirmed) {
      return;
    }

    await api(withScope(`/sales/${sale.id}`, eventId, establishmentId), { method: 'DELETE' });
    onRefresh('Venta archivada');
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
        <label className="filter-control">
          Filtrar por promotor
          <select value={promoterFilter} onChange={(event) => setPromoterFilter(event.target.value)}>
            <option value="">Todos los promotores</option>
            {promoters.map((promoter) => (
              <option value={promoter.id} key={promoter.id}>{promoter.name} - {promoter.code}</option>
            ))}
          </select>
        </label>
        <DataTable
          columns={['Pedido', 'Promotor', 'Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Estado', 'Acciones']}
          rows={filteredSales.map((sale) => [
            saleOrderNumber(sale),
            sale.promoter_name,
            sale.customer,
            sale.location,
            sale.quantity,
            money(sale.total),
            money(sale.commission),
            sale.deleted_at ? 'Eliminada' : paymentLabel(sale.payment_status),
            <div className="row-actions compact-actions">
              {!sale.deleted_at && sale.payment_status !== 'paid' && (
                <button className="ghost-button" onClick={() => confirmSale(sale.id)}>
                  <CheckCircle2 size={16} />
                  Confirmar
                </button>
              )}
              {sale.deleted_at ? (
                <small>Archivada: {sale.deleted_at}</small>
              ) : (
                <button className="danger-button" onClick={() => removeSale(sale)}>
                  Eliminar
                </button>
              )}
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

function Withdrawals({ withdrawals, promoters, eventId, establishmentId, onRefresh }) {
  const [promoterFilter, setPromoterFilter] = useState('');
  const filteredWithdrawals = promoterFilter
    ? withdrawals.filter((row) => String(row.promoter_id) === String(promoterFilter))
    : withdrawals;

  async function markPaid(withdrawalId) {
    const confirmed = window.confirm('Seguro quieres marcar este retiro como realizado? Se marcaran las comisiones del promotor como pagadas.');
    if (!confirmed) {
      return;
    }
    await api(withScope(`/withdrawals/${withdrawalId}/pay`, eventId, establishmentId), { method: 'PATCH' });
    onRefresh('Retiro marcado como realizado');
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h3>Solicitudes de retiro</h3>
      </div>
      <label className="filter-control">
        Filtrar por promotor
        <select value={promoterFilter} onChange={(event) => setPromoterFilter(event.target.value)}>
          <option value="">Todos los promotores</option>
          {promoters.map((promoter) => (
            <option value={promoter.id} key={promoter.id}>{promoter.name} - {promoter.code}</option>
          ))}
        </select>
      </label>
      <DataTable
        columns={['Promotor', 'Monto', 'Banco', 'Titular', 'Cuenta', 'Cedula', 'Estado', 'Accion']}
        rows={filteredWithdrawals.map((row) => [
          `${row.promoter_name} (${row.promoter_code})`,
          money(row.amount),
          row.bank,
          row.account_holder,
          row.account_number,
          row.cedula,
          row.status === 'paid' ? 'Realizado' : 'Pendiente',
          <button className="ghost-button" disabled={row.status === 'paid'} onClick={() => markPaid(row.id)}>
            <CheckCircle2 size={16} />
            Realizado
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
        <Input type="number" label="Bronze desde puntos" value={form.bronze} onChange={(bronze) => setForm({ ...form, bronze })} />
        <Input type="number" label="Silver desde puntos" value={form.silver} onChange={(silver) => setForm({ ...form, silver })} />
        <Input type="number" label="Gold desde puntos" value={form.gold} onChange={(gold) => setForm({ ...form, gold })} />
        <Input type="number" label="Comision Bronze %" value={form.bronze_commission} onChange={(bronze_commission) => setForm({ ...form, bronze_commission })} />
        <Input type="number" label="Comision Silver %" value={form.silver_commission} onChange={(silver_commission) => setForm({ ...form, silver_commission })} />
        <Input type="number" label="Comision Gold %" value={form.gold_commission} onChange={(gold_commission) => setForm({ ...form, gold_commission })} />
        <Input
          type="number"
          label="Puntos por referido"
          value={form.referral_points}
          onChange={(referral_points) => setForm({ ...form, referral_points })}
        />
        <label>
          Beneficios Bronze
          <textarea
            value={form.bronze_benefits}
            onChange={(e) => setForm({ ...form, bronze_benefits: e.target.value })}
            rows={5}
            placeholder="Un beneficio por linea"
          />
        </label>
        <label>
          Beneficios Silver
          <textarea
            value={form.silver_benefits}
            onChange={(e) => setForm({ ...form, silver_benefits: e.target.value })}
            rows={5}
            placeholder="Un beneficio por linea"
          />
        </label>
        <label>
          Beneficios Gold
          <textarea
            value={form.gold_benefits}
            onChange={(e) => setForm({ ...form, gold_benefits: e.target.value })}
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
          <strong>Bronze</strong>
          <span>Desde {form.bronze} puntos</span>
          <span>{form.bronze_commission}% de comision</span>
          <ul>
            {benefitsText(form.bronze_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </article>
        <article className="level-card silver">
          <strong>Silver</strong>
          <span>Desde {form.silver} puntos</span>
          <span>{form.silver_commission}% de comision</span>
          <ul>
            {benefitsText(form.silver_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </article>
        <article className="level-card gold">
          <strong>Gold</strong>
          <span>Desde {form.gold} puntos</span>
          <span>{form.gold_commission}% de comision</span>
          <ul>
            {benefitsText(form.gold_benefits).split('\n').filter(Boolean).map((benefit) => <li key={benefit}>{benefit}</li>)}
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
  const [withdrawals, setWithdrawals] = useState([]);
  const [profile, setProfile] = useState(user);
  const [form, setForm] = useState(emptySale);
  const [profileForm, setProfileForm] = useState({ photo_url: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [withdrawalForm, setWithdrawalForm] = useState(emptyWithdrawal);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [withdrawalPanelOpen, setWithdrawalPanelOpen] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const canRegisterSales = Boolean(profile?.status === 'active' && profile?.establishment?.promoter_sales_enabled && profile?.can_sell);
  const activeLocations = locations.filter((location) => location.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const confirmedCommission = useMemo(
    () => sales
      .filter((sale) => sale.payment_status === 'paid' && Number(sale.commission_paid || 0) === 0)
      .reduce((sum, sale) => sum + Number(sale.commission || 0), 0),
    [sales]
  );

  async function loadData() {
    const [nextSales, nextLocations, nextProfile, nextBanners, nextWithdrawals] = await Promise.all([
      api('/promoter/sales'),
      api('/locations'),
      api('/promoter/me'),
      api('/promoter/banners'),
      api('/promoter/withdrawals')
    ]);
    setSales(nextSales);
    setLocations(nextLocations);
    setProfile(nextProfile);
    setBanners(nextBanners);
    setWithdrawals(nextWithdrawals);
    setProfileForm({ photo_url: nextProfile.photo_url || '' });
  }

  useEffect(() => {
    loadData().catch(() => onLogout());
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const createdSale = await api('/promoter/sales', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptySale);
      await loadData();
      setNotice(`Venta registrada. Pedido ${saleOrderNumber(createdSale)}`);
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
      setProfileEditorOpen(false);
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
      setProfileEditorOpen(false);
      setNotice('Foto actualizada');
      setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setProfileError(err.message);
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    setWithdrawalError('');
    try {
      const response = await api('/promoter/withdrawals', {
        method: 'POST',
        body: JSON.stringify(withdrawalForm)
      });
      setWithdrawalForm(emptyWithdrawal);
      setWithdrawalPanelOpen(false);
      await loadData();
      setNotice(response.message || 'Solicitud enviada. Sera acreditado en 24 a 48 horas.');
      setTimeout(() => setNotice(''), 4200);
    } catch (err) {
      setWithdrawalError(err.message);
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

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
      setTimeout(() => setNotice(''), 2200);
    } catch {
      setNotice('No se pudo copiar automaticamente');
      setTimeout(() => setNotice(''), 2200);
    }
  }

  async function shareReferral() {
    const shareData = {
      title: 'Promotor oficial GEMASHOW',
      text: `Codigo de promotor: ${profile?.code || user.code}`,
      url: referralLink
    };

    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await copyText(referralLink, 'Link copiado para compartir');
  }

  const levelPoints = Number(profile?.level?.levelPoints || 0);
  const settings = profile?.level?.settings || {};
  const bronzeMin = Number(settings.bronze || 1);
  const silverMin = Number(settings.silver || 10);
  const goldMin = Number(settings.gold || settings.diamond || 25);
  const premiumRanks = [
    { key: 'bronze', name: 'Bronze', min: bronzeMin, benefits: profile?.level?.settings?.benefits?.bronze || ['Acceso a beneficios iniciales', 'Material oficial GEMASHOW'] },
    { key: 'silver', name: 'Silver', min: silverMin, benefits: profile?.level?.settings?.benefits?.silver || ['Prioridad en campanas', 'Bonos especiales por metas'] },
    { key: 'gold', name: 'Gold', min: goldMin, benefits: profile?.level?.settings?.benefits?.gold || profile?.level?.settings?.benefits?.diamond || ['Beneficios VIP', 'Prioridad maxima en cupos'] }
  ];
  const currentRank = premiumRanks.reduce(
    (rank, item) => (levelPoints >= item.min ? item : rank),
    { key: 'starter', name: 'Starter', min: 0, benefits: ['Completa tus primeras ventas confirmadas'] }
  );
  const nextRank = premiumRanks.find((item) => levelPoints < item.min);
  const previousMin = currentRank.min || 0;
  const nextMin = nextRank?.min || currentRank.min || 1;
  const progress = nextRank ? Math.min(100, Math.round(((levelPoints - previousMin) / Math.max(1, nextMin - previousMin)) * 100)) : 100;
  const progressText = nextRank
    ? `Te faltan ${Math.max(0, nextRank.min - levelPoints)} puntos para llegar a ${nextRank.name}.`
    : 'Ya estas en el rango mas alto disponible.';
  const referralLink = `${window.location.origin}/verificar?codigo=${encodeURIComponent(profile?.code || user.code || '')}`;
  const nextCut = new Date();
  nextCut.setMonth(nextCut.getMonth() + 1, 0);
  const nextCutText = nextCut.toLocaleDateString('es-EC', { day: '2-digit', month: 'long' });
  const paymentStatus = confirmedCommission > 0 ? 'Pendiente' : 'Al dia';
  const featuredBanner = banners[0];

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
            columns={['Pedido', 'Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Estado', 'Comprobante']}
            rows={sales.map((sale) => [
              saleOrderNumber(sale),
              sale.customer,
              sale.location,
              sale.quantity,
              money(sale.total),
              money(sale.commission),
              paymentLabel(sale.payment_status),
              sale.payment_status !== 'paid' ? (
                <a className="ghost-button" href={receiptWhatsappUrl(profile?.name || user.name, sale)} target="_blank" rel="noreferrer">
                  <Share2 size={16} />
                  Enviar comprobante
                </a>
              ) : 'Confirmado'
            ])}
          />
        </section>
      </div>
      )}
    </main>
  );
}

function PromoterAppPremium({ user, onLogout }) {
  const [sales, setSales] = useState([]);
  const [locations, setLocations] = useState([]);
  const [banners, setBanners] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [profile, setProfile] = useState(user);
  const [form, setForm] = useState(emptySale);
  const [profileForm, setProfileForm] = useState({ photo_url: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [withdrawalForm, setWithdrawalForm] = useState(emptyWithdrawal);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [withdrawalPanelOpen, setWithdrawalPanelOpen] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const canRegisterSales = Boolean(profile?.status === 'active' && profile?.establishment?.promoter_sales_enabled && profile?.can_sell);
  const activeLocations = locations.filter((location) => location.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const confirmedCommission = useMemo(
    () => sales
      .filter((sale) => sale.payment_status === 'paid' && Number(sale.commission_paid || 0) === 0)
      .reduce((sum, sale) => sum + Number(sale.commission || 0), 0),
    [sales]
  );

  async function loadData() {
    const [nextSales, nextLocations, nextProfile, nextBanners, nextWithdrawals] = await Promise.all([
      api('/promoter/sales'),
      api('/locations'),
      api('/promoter/me'),
      api('/promoter/banners'),
      api('/promoter/withdrawals')
    ]);
    setSales(nextSales);
    setLocations(nextLocations);
    setProfile(nextProfile);
    setBanners(nextBanners);
    setWithdrawals(nextWithdrawals);
    setProfileForm({ photo_url: nextProfile.photo_url || '' });
  }

  useEffect(() => {
    loadData().catch(() => onLogout());
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const createdSale = await api('/promoter/sales', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptySale);
      await loadData();
      setNotice(`Venta registrada. Pedido ${saleOrderNumber(createdSale)}`);
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
      setProfileEditorOpen(false);
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
      setProfileEditorOpen(false);
      setNotice('Foto actualizada');
      setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setProfileError(err.message);
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    setWithdrawalError('');
    try {
      const response = await api('/promoter/withdrawals', {
        method: 'POST',
        body: JSON.stringify(withdrawalForm)
      });
      setWithdrawalForm(emptyWithdrawal);
      setWithdrawalPanelOpen(false);
      await loadData();
      setNotice(response.message || 'Solicitud enviada. Sera acreditado en 24 a 48 horas.');
      setTimeout(() => setNotice(''), 4200);
    } catch (err) {
      setWithdrawalError(err.message);
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

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setNotice('No se pudo copiar automaticamente');
    }
    setTimeout(() => setNotice(''), 2200);
  }

  function openWithdrawalPanel() {
    setWithdrawalError('');
    setWithdrawalPanelOpen(true);
    setTimeout(() => document.getElementById('solicitar-retiro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function shareReferral() {
    if (navigator.share) {
      await navigator.share({
        title: `Promotor oficial ${brandName}`,
        text: `Codigo de promotor: ${profile?.code || user.code}`,
        url: referralLink
      });
      return;
    }
    await copyText(referralLink, 'Link copiado para compartir');
  }

  const levelPoints = Number(profile?.level?.levelPoints || 0);
  const settings = profile?.level?.settings || {};
  const brandName = profile?.establishment?.display_name || profile?.establishment?.name || 'PROMOTERS';
  const brandTheme = profile?.establishment?.theme || 'gemashow';
  const brandLogo = profile?.establishment?.logo_url || '';
  const bronzeMin = Number(settings.bronze || 1);
  const silverMin = Number(settings.silver || 10);
  const goldMin = Number(settings.gold || settings.diamond || 25);
  const premiumRanks = [
    { key: 'bronze', name: 'Bronze', min: bronzeMin, benefits: settings.benefits?.bronze || ['Acceso a beneficios iniciales', `Material oficial ${brandName}`] },
    { key: 'silver', name: 'Silver', min: silverMin, benefits: settings.benefits?.silver || ['Prioridad en campanas', 'Bonos especiales por metas'] },
    { key: 'gold', name: 'Gold', min: goldMin, benefits: settings.benefits?.gold || settings.benefits?.diamond || ['Beneficios VIP', 'Prioridad maxima en cupos'] }
  ];
  const currentRank = premiumRanks.reduce(
    (rank, item) => (levelPoints >= item.min ? item : rank),
    { key: 'starter', name: 'Starter', min: 0, benefits: ['Completa tus primeras ventas confirmadas'] }
  );
  const nextRank = premiumRanks.find((item) => levelPoints < item.min);
  const previousMin = currentRank.min || 0;
  const nextMin = nextRank?.min || currentRank.min || 1;
  const progress = nextRank ? Math.min(100, Math.round(((levelPoints - previousMin) / Math.max(1, nextMin - previousMin)) * 100)) : 100;
  const progressText = nextRank
    ? `Te faltan ${Math.max(0, nextRank.min - levelPoints)} puntos para llegar a ${nextRank.name}.`
    : 'Ya estas en el rango mas alto disponible.';
  const referralLink = `${window.location.origin}/verificar?codigo=${encodeURIComponent(profile?.code || user.code || '')}`;
  const nextCut = new Date();
  nextCut.setMonth(nextCut.getMonth() + 1, 0);
  const nextCutText = nextCut.toLocaleDateString('es-EC', { day: '2-digit', month: 'long' });
  const pendingWithdrawal = withdrawals.find((item) => item.status === 'pending');
  const latestPaidWithdrawal = withdrawals.find((item) => item.status === 'paid');
  const paymentStatus = pendingWithdrawal ? 'Pendiente' : confirmedCommission > 0 ? 'Disponible' : 'Al dia';
  const lastWithdrawalText = latestPaidWithdrawal
    ? `${money(latestPaidWithdrawal.amount)} el ${latestPaidWithdrawal.paid_at || latestPaidWithdrawal.requested_at}`
    : 'sin retiros registrados';
  const featuredBanner = banners[0];

  return (
    <main className={`promoter-premium theme-${brandTheme}`}>
      <header className="promoter-premium-topbar">
        <div className="promoter-brand-lockup">
          {brandLogo && <img src={brandLogo} alt={brandName} />}
          <div>
            <span>PROMOTERS / {brandName}</span>
            <h1>Perfil de promotor</h1>
          </div>
        </div>
        <button className="premium-ghost-button" onClick={onLogout}>
          <LogOut size={18} />
          Salir
        </button>
      </header>
      {notice && <div className="premium-alert">{notice}</div>}
      {profile?.status !== 'active' && (
        <div className="premium-alert warning">
          Tu cuenta esta pendiente de aprobacion. Puedes revisar tu perfil, beneficios y codigo, pero aun no puedes registrar ventas.
        </div>
      )}

      <section className="promoter-premium-hero">
        <article className="premium-profile-card">
          <div className="premium-profile-main">
            <div className="premium-profile-photo">
              {profile?.photo_url ? <img src={profile.photo_url} alt={profile.name} /> : <UserRound size={48} />}
            </div>
            <div>
              <span className="premium-kicker">Promotor oficial</span>
              <h2>{profile?.name || user.name}</h2>
              <div className="premium-profile-meta">
                <span className={profile?.status === 'active' ? 'status-pill active' : 'status-pill inactive'}>
                  {profile?.status === 'active' ? 'Activo' : 'Pendiente'}
                </span>
              </div>
            </div>
          </div>
          <button
            className="premium-secondary-button"
            type="button"
            onClick={() => {
              const nextOpen = !profileEditorOpen;
              setProfileEditorOpen(nextOpen);
              if (nextOpen) {
                setTimeout(() => document.getElementById('editar-perfil')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
              }
            }}
          >
            <UserRound size={18} />
            {profileEditorOpen ? 'Cerrar perfil' : 'Editar perfil'}
          </button>
        </article>

        <article className="premium-ad-card">
          {featuredBanner ? (
            <>
              <img src={featuredBanner.image_url} alt={featuredBanner.title || `Anuncio ${brandName}`} />
              <div>
                <span>Anuncio destacado</span>
                <strong>{featuredBanner.title || profile?.activeEvent?.name || `Evento activo ${brandName}`}</strong>
              </div>
            </>
          ) : (
            <div>
              <span>Anuncio destacado</span>
              <strong>{profile?.activeEvent?.name || `Campana activa ${brandName}`}</strong>
              <small>Promociones, avisos y eventos importantes para tu equipo.</small>
            </div>
          )}
        </article>
      </section>

      <section className="premium-action-grid">
        {canRegisterSales && (
          <article className="premium-commission-card">
            <span>Comision disponible</span>
            <strong>{showCommission ? money(confirmedCommission) : '••••••'}</strong>
            <small>Solo cuenta ventas confirmadas por el administrador.</small>
            <div className="premium-inline-actions">
              <button className="premium-secondary-button" type="button" onClick={() => setShowCommission(!showCommission)}>
                {showCommission ? <EyeOff size={17} /> : <Eye size={17} />}
                {showCommission ? 'Ocultar' : 'Mostrar'}
              </button>
              <button className="premium-primary-button" type="button" disabled={confirmedCommission <= 0 || Boolean(pendingWithdrawal)} onClick={openWithdrawalPanel}>
                <CreditCard size={17} />
                {pendingWithdrawal ? 'Retiro pendiente' : 'Retiro'}
              </button>
            </div>
          </article>
        )}

        {canRegisterSales && (
          <article className="premium-main-actions">
            <button className="premium-primary-button large" type="button" onClick={() => document.getElementById('registrar-venta')?.scrollIntoView({ behavior: 'smooth' })}>
              <Ticket size={20} />
              Registrar venta
            </button>
            <button className="premium-secondary-button large" type="button" onClick={() => document.getElementById('mis-ventas')?.scrollIntoView({ behavior: 'smooth' })}>
              <WalletCards size={20} />
              Ver mis ventas
            </button>
          </article>
        )}

        <article className="premium-payment-card">
          <span>Estado de pagos</span>
          <strong>{paymentStatus}</strong>
          <small>Ultimo retiro: {lastWithdrawalText}</small>
          <small>Proximo corte: {nextCutText}</small>
        </article>
      </section>

      {withdrawalPanelOpen && (
        <section className="premium-card withdrawal-panel" id="solicitar-retiro">
          <div className="panel-title">
            <h3>Solicitar retiro</h3>
          </div>
          <p>Completa los datos de tu cuenta. El administrador revisara la solicitud y la acreditacion se realizara en 24 a 48 horas.</p>
          <form className="form-grid" onSubmit={submitWithdrawal}>
            <Input label="Banco" value={withdrawalForm.bank} onChange={(bank) => setWithdrawalForm({ ...withdrawalForm, bank })} />
            <Input label="Nombre del titular" value={withdrawalForm.account_holder} onChange={(account_holder) => setWithdrawalForm({ ...withdrawalForm, account_holder })} />
            <Input label="Numero de cuenta" value={withdrawalForm.account_number} onChange={(account_number) => setWithdrawalForm({ ...withdrawalForm, account_number })} />
            <Input label="Cedula" value={withdrawalForm.cedula} onChange={(cedula) => setWithdrawalForm({ ...withdrawalForm, cedula })} />
            <div className="withdrawal-summary">
              <span>Monto solicitado</span>
              <strong>{money(confirmedCommission)}</strong>
            </div>
            {withdrawalError && <div className="alert error">{withdrawalError}</div>}
            <div className="premium-inline-actions">
              <button className="premium-primary-button" type="submit">
                <CreditCard size={17} />
                Enviar solicitud
              </button>
              <button className="premium-secondary-button" type="button" onClick={() => setWithdrawalPanelOpen(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {profileEditorOpen && (
        <section className="premium-card profile-editor-panel" id="editar-perfil">
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
              <Input type="password" label="Contrasena actual" value={passwordForm.currentPassword} onChange={(currentPassword) => setPasswordForm({ ...passwordForm, currentPassword })} />
              <Input type="password" label="Nueva contrasena" value={passwordForm.newPassword} onChange={(newPassword) => setPasswordForm({ ...passwordForm, newPassword })} />
              {passwordError && <div className="alert error">{passwordError}</div>}
              <button className="primary-button" type="submit">
                <KeyRound size={18} />
                Guardar contrasena
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="premium-rank-layout">
        <article className={`premium-rank-card ${currentRank.key}`}>
          <div className="premium-rank-header">
            <div>
              <span>Nivel actual</span>
              <h3>{currentRank.name}</h3>
            </div>
            <Medal size={34} />
          </div>
          <ul>
            {currentRank.benefits.map((benefit) => (
              <li key={benefit}><CheckCircle2 size={16} /> {benefit}</li>
            ))}
          </ul>
        </article>

        <article className="premium-progress-card">
          <div className="premium-progress-top">
            <span>Progreso al siguiente rango</span>
            <strong>{levelPoints} puntos</strong>
          </div>
          <div className="premium-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{progressText}</small>
          <div className="premium-rank-strip">
            {premiumRanks.map((rank) => (
              <span className={currentRank.key === rank.key ? 'current' : ''} key={rank.key}>{rank.name}</span>
            ))}
          </div>
        </article>
      </section>

      <section className="premium-code-card">
        <div>
          <span>Codigo personal</span>
          <strong>{profile?.code || user.code}</strong>
        </div>
        <div className="premium-inline-actions">
          <button className="premium-secondary-button" type="button" onClick={() => copyText(profile?.code || user.code, 'Codigo copiado')}>
            <Copy size={17} />
            Copiar codigo
          </button>
          <button className="premium-primary-button" type="button" onClick={() => copyText(referralLink, 'Enlace de verificacion copiado')}>
            <LinkIcon size={17} />
            Copiar enlace de verificacion
          </button>
          <button className="premium-secondary-button" type="button" onClick={shareReferral}>
            <Share2 size={17} />
            Compartir
          </button>
        </div>
      </section>

      {canRegisterSales && (
        <div className="premium-sales-layout">
          <section className="premium-card" id="registrar-venta">
            <div className="panel-title">
              <h3>Registrar venta</h3>
            </div>
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
                    <option value={location.name} key={location.id}>{location.name} - {money(location.price)}</option>
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
          <section className="premium-card" id="mis-ventas">
            <div className="panel-title">
              <h3>Mis ventas</h3>
            </div>
            <DataTable
              columns={['Pedido', 'Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Estado', 'Comprobante']}
              rows={sales.map((sale) => [
                saleOrderNumber(sale),
                sale.customer,
                sale.location,
                sale.quantity,
                money(sale.total),
                money(sale.commission),
                paymentLabel(sale.payment_status),
                sale.payment_status !== 'paid' ? (
                  <a className="ghost-button" href={receiptWhatsappUrl(profile?.name || user.name, sale)} target="_blank" rel="noreferrer">
                    <Share2 size={16} />
                    Enviar comprobante
                  </a>
                ) : 'Confirmado'
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
        <div className="brand-mark">P</div>
        <h1>Verificacion PROMOTERS</h1>
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
          result.registered ? (
            <div className={`verify-member-card theme-${result.promoter.establishment_theme || 'gemashow'} ${result.active === false ? 'inactive' : result.promoter.level?.key || 'starter'}`}>
              <div className="verify-card-top">
                <div>
                  <span>PROMOTERS / {result.promoter.establishment_display_name || result.promoter.establishment_name}</span>
                  <h2>{result.message}</h2>
                </div>
                {result.promoter.establishment_logo_url ? (
                  <img className="verify-brand-logo" src={result.promoter.establishment_logo_url} alt={result.promoter.establishment_display_name || result.promoter.establishment_name} />
                ) : result.active === false ? <Lock size={30} /> : <BadgeCheck size={30} />}
              </div>
              <div className="verify-card-main">
                <div className="verify-photo">
                  {result.promoter.photo_url ? <img src={result.promoter.photo_url} alt={result.promoter.name} /> : <UserRound size={48} />}
                </div>
                <div>
                  <small>{result.active === false ? 'Afiliado pendiente de activacion' : 'Afiliado verificado'}</small>
                  <strong>{result.promoter.name}</strong>
                  <span>{result.active === false ? 'Promotor inactivo' : result.promoter.level?.name || 'Starter'}</span>
                </div>
              </div>
              <div className="verify-card-details">
                <p>{result.promoter.instagram || 'Sin Instagram'}</p>
                <p>WhatsApp: {result.promoter.whatsapp}</p>
                <p>Codigo: {result.promoter.code}</p>
                {result.active === false && <p>Este codigo existe, pero aun no esta autorizado para vender.</p>}
              </div>
            </div>
          ) : (
            <div className="verify-result bad">
              <h2>{result.message}</h2>
            </div>
          )
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
