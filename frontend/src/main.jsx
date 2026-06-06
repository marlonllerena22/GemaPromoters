import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
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
  }
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
  return `${type} desde ${location.commission_min_quantity || 1} entradas pagadas`;
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

  return <AdminApp onLogout={() => {
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

  async function remove(location) {
    const confirmed = window.confirm(`Eliminar la localidad "${location.name}"?`);
    if (!confirmed) {
      return;
    }

    setError('');
    try {
      await api(`/locations/${location.id}`, { method: 'DELETE' });
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

function AdminApp({ onLogout }) {
  const [view, setView] = useState('dashboard');
  const [data, setData] = useState({
    dashboard: null,
    promoters: [],
    sales: [],
    ranking: [],
    settlements: [],
    locations: [],
    levels: emptyLevels
  });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  async function loadAll() {
    setLoading(true);
    const [dashboard, promoters, sales, ranking, settlements, locations, levels] = await Promise.all([
      api('/dashboard'),
      api('/promoters'),
      api('/sales'),
      api('/ranking'),
      api('/settlements'),
      api('/locations'),
      api('/level-settings')
    ]);
    setData({ dashboard, promoters, sales, ranking, settlements, locations, levels });
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
    ['dashboard', 'Panel', BarChart3],
    ['promoters', 'Promotores', UsersRound],
    ['sales', 'Ventas', Ticket],
    ['ranking', 'Ranking', Medal],
    ['settlements', 'Liquidaciones', WalletCards],
    ['settings', 'Localidades', Settings],
    ['levels', 'Niveles', BadgeCheck]
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">G</div>
          <div>
            <strong>GemaPromoters</strong>
            <span>GEMASHOW</span>
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
            <p>GEMASHOW</p>
            <h2>{nav.find(([key]) => key === view)?.[1]}</h2>
          </div>
          {notice && <div className="alert success">{notice}</div>}
        </header>

        {loading ? (
          <div className="empty-state">Cargando informacion...</div>
        ) : (
          <>
            {view === 'dashboard' && <Dashboard stats={data.dashboard} sales={data.sales} />}
            {view === 'promoters' && (
              <Promoters promoters={data.promoters} onRefresh={refresh} />
            )}
            {view === 'sales' && (
              <Sales promoters={data.promoters} sales={data.sales} locations={data.locations} onRefresh={refresh} />
            )}
            {view === 'ranking' && <Ranking ranking={data.ranking} />}
            {view === 'settlements' && (
              <Settlements settlements={data.settlements} onRefresh={refresh} />
            )}
            {view === 'settings' && (
              <Locations locations={data.locations} onRefresh={refresh} />
            )}
            {view === 'levels' && (
              <Levels levels={data.levels} onRefresh={refresh} />
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
          columns={['Promotor', 'Cliente', 'Localidad', 'Total', 'Comision', 'Pago']}
          rows={sales.slice(0, 8).map((sale) => [
            sale.promoter_name,
            sale.customer,
            sale.location,
            money(sale.total),
            money(sale.commission),
            sale.payment_status === 'paid' ? 'Pagado' : 'Pendiente'
          ])}
        />
      </section>
    </div>
  );
}

function Promoters({ promoters, onRefresh }) {
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
      await api(editingId ? `/promoters/${editingId}` : '/promoters', {
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
    await api(`/promoters/${promoter.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: promoter.status === 'active' ? 'inactive' : 'active' })
    });
    onRefresh('Estado actualizado');
  }

  async function toggleSelling(promoter) {
    await api(`/promoters/${promoter.id}/selling`, {
      method: 'PATCH',
      body: JSON.stringify({ can_sell: !promoter.can_sell })
    });
    onRefresh(promoter.can_sell ? 'Venta deshabilitada' : 'Venta habilitada');
  }

  async function updateManualPoints(promoter, value) {
    await api(`/promoters/${promoter.id}/manual-points`, {
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

function Sales({ promoters, sales, locations, onRefresh }) {
  const [form, setForm] = useState(emptySale);
  const [error, setError] = useState('');
  const activePromoters = promoters.filter((promoter) => promoter.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const estimatedCommission = useMemo(
    () => estimateCommission(form, locations, sales, form.promoter_id),
    [form, locations, sales]
  );
  const activeLocations = locations.filter((location) => location.status === 'active');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/sales', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptySale);
      onRefresh('Venta registrada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function markPaid(saleId) {
    await api(`/sales/${saleId}/pay`, { method: 'PATCH' });
    onRefresh('Venta marcada como pagada');
  }

  async function removeSale(sale) {
    const confirmed = window.confirm(
      `Seguro quieres eliminar la venta de ${sale.customer}? No se podran recuperar los datos.`
    );
    if (!confirmed) {
      return;
    }

    await api(`/sales/${sale.id}`, { method: 'DELETE' });
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
            Estado de pago
            <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
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
          columns={['Promotor', 'Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Pago', 'Acciones']}
          rows={sales.map((sale) => [
            sale.promoter_name,
            sale.customer,
            sale.location,
            sale.quantity,
            money(sale.total),
            money(sale.commission),
            sale.payment_status === 'paid' ? 'Pagado' : 'Pendiente',
            <div className="row-actions compact-actions">
              {sale.payment_status !== 'paid' && (
                <button className="ghost-button" onClick={() => markPaid(sale.id)}>
                  <CheckCircle2 size={16} />
                  Pagar
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

function Settlements({ settlements, onRefresh }) {
  async function pay(promoterId) {
    await api(`/settlements/${promoterId}/pay`, { method: 'PATCH' });
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

function Locations({ locations, onRefresh }) {
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
      await api(editingId ? `/locations/${editingId}` : '/locations', {
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
            label="Puntos para nivel por entrada pagada"
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
                <small>{location.level_points ?? 1} puntos de nivel por entrada pagada</small>
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

function Levels({ levels, onRefresh }) {
  const [form, setForm] = useState(normalizeLevelForm(levels));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(normalizeLevelForm(levels));
  }, [levels]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/level-settings', {
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
  const [profile, setProfile] = useState(user);
  const [form, setForm] = useState(emptySale);
  const [profileForm, setProfileForm] = useState({ photo_url: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const activeLocations = locations.filter((location) => location.status === 'active');
  const estimatedTotal = useMemo(() => Number(form.quantity || 0) * Number(form.unit_price || 0), [form]);
  const estimatedCommission = useMemo(
    () => estimateCommission(form, locations, sales, user.id),
    [form, locations, sales, user.id]
  );

  async function loadData() {
    const [nextSales, nextLocations, nextProfile] = await Promise.all([
      api('/promoter/sales'),
      api('/locations'),
      api('/promoter/me')
    ]);
    setSales(nextSales);
    setLocations(nextLocations);
    setProfile(nextProfile);
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

  async function markPaid(saleId) {
    await api(`/promoter/sales/${saleId}/pay`, { method: 'PATCH' });
    await loadData();
    setNotice('Venta marcada como pagada');
    setTimeout(() => setNotice(''), 2400);
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
          <p>Promotor GEMASHOW</p>
          <h2>{profile?.name || user.name}</h2>
        </div>
        <button className="ghost-button" onClick={onLogout}>
          <LogOut size={18} />
          Salir
        </button>
      </header>
      {notice && <div className="alert success">{notice}</div>}
      <section className={`promoter-profile ${profile?.level?.key || 'starter'}`}>
        <div className="profile-photo">
          {profile?.photo_url ? <img src={profile.photo_url} alt={profile.name} /> : <UserRound size={42} />}
        </div>
        <div>
          <strong>{profile?.name || user.name}</strong>
          <span>{profile?.code || user.code}</span>
          <small>
            {profile?.level?.name || 'Inicial'} · {profile?.level?.levelPoints || 0} puntos · {profile?.level?.paidSales || 0} ventas pagadas
          </small>
        </div>
        <button className="ghost-button profile-edit-button" type="button" onClick={() => setProfileEditorOpen(!profileEditorOpen)}>
          <UserRound size={18} />
          {profileEditorOpen ? 'Cerrar perfil' : 'Editar perfil'}
        </button>
      </section>
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
            <label>
              Estado de pago
              <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
              </select>
            </label>
            <div className="computed">
              <span>Total {money(estimatedTotal)}</span>
              <strong>Comision {money(estimatedCommission)}</strong>
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
            columns={['Cliente', 'Localidad', 'Cantidad', 'Total', 'Comision', 'Pago', '']}
            rows={sales.map((sale) => [
              sale.customer,
              sale.location,
              sale.quantity,
              money(sale.total),
              money(sale.commission),
              sale.payment_status === 'paid' ? 'Pagado' : 'Pendiente',
              sale.payment_status === 'paid' ? '' : (
                <button className="ghost-button" onClick={() => markPaid(sale.id)}>
                  <CheckCircle2 size={16} />
                  Pagar
                </button>
              )
            ])}
          />
        </section>
      </div>
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
