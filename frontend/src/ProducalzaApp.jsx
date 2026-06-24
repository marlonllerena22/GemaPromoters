import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Check,
  ChevronLeft,
  ClipboardList,
  Factory,
  FilePlus2,
  Filter,
  LogOut,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  BarChart3,
  Trash2,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react';
import { api } from './api.js';

const SIZES = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const ORDER_STATUS_LABELS = {
  draft: 'Borrador',
  received: 'Recibido',
  reviewed: 'Revisado',
  in_production: 'En produccion',
  finished: 'Terminado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};
const MODEL_STATUS_LABELS = {
  received: 'Recibido',
  reviewed: 'Revisado',
  in_production: 'En produccion',
  cut: 'Cortado',
  stitched: 'Aparado',
  assembled: 'Armado',
  finished: 'Terminado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};
const PROCESS_FIELDS = [
  ['process_cut', 'C', 'Cortado'],
  ['process_prepared', 'P', 'Preparado'],
  ['process_stitched', 'A', 'Aparado'],
  ['process_assembled', 'A', 'Armado'],
  ['process_planted', 'P', 'Plantado'],
  ['process_finished', 'T', 'Terminado']
];

const emptyClient = {
  name: '',
  business_name: '',
  tax_id: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  brand: '',
  payment_method: '',
  bank_reference: '',
  classification: '',
  general_notes: ''
};

const emptyUser = {
  name: '',
  username: '',
  password: '',
  role: 'vendor',
  can_view_all_orders: false,
  status: 'active'
};

const emptyVisit = {
  visit_date: new Date().toISOString().slice(0, 10),
  visited_by_user_id: '',
  visitor_name: '',
  visit_type: 'visit',
  result: '',
  next_visit_date: '',
  order_id: '',
  pairs: '',
  notes: ''
};

const VISIT_TYPE_LABELS = {
  visit: 'Visita presencial',
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  follow_up: 'Seguimiento',
  collection: 'Cobranza',
  delivery: 'Entrega',
  other: 'Otro'
};

function emptyModel() {
  return {
    model_code: '',
    color: '',
    material: '',
    notes: '',
    plant_area: '',
    status: 'received',
    sizes: Object.fromEntries(SIZES.map((size) => [size, 0]))
  };
}

function emptyOrder() {
  return {
    client_id: '',
    seller_user_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    brand: '',
    payment_method: '',
    bank_reference: '',
    general_notes: '',
    status: 'draft',
    models: [emptyModel()]
  };
}

function withBusiness(path, establishmentId) {
  if (!establishmentId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}establishment_id=${establishmentId}`;
}

function totalModel(model) {
  return SIZES.reduce((sum, size) => sum + Number(model.sizes?.[size] || 0), 0);
}

function displayDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-EC');
}

export default function ProducalzaApp({ user, onLogout, embedded = false, establishmentId = '' }) {
  const [view, setView] = useState('dashboard');
  const [bootstrap, setBootstrap] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [production, setProduction] = useState([]);
  const [clientActivity, setClientActivity] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printState, setPrintState] = useState(null);
  const isAdmin = ['admin', 'supreme', 'production_admin'].includes(user?.role);
  const scope = (path) => withBusiness(path, establishmentId || user?.establishment_id);

  async function loadBase() {
    setLoading(true);
    setError('');
    try {
      const [nextBootstrap, nextDashboard, nextClients, nextOrders, nextProduction, nextClientActivity] = await Promise.all([
        api(scope('/producalza/bootstrap')),
        api(scope('/producalza/dashboard')),
        api(scope('/producalza/clients')),
        api(scope('/producalza/orders')),
        api(scope('/producalza/production')),
        isAdmin ? api(scope('/producalza/client-activity-report')) : Promise.resolve([])
      ]);
      setBootstrap(nextBootstrap);
      setDashboard(nextDashboard);
      setClients(nextClients);
      setOrders(nextOrders);
      setProduction(nextProduction);
      setClientActivity(nextClientActivity);
      setUsers(nextBootstrap.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
  }, [establishmentId]);

  async function refresh(message) {
    await loadBase();
    if (message) {
      setNotice(message);
      setTimeout(() => setNotice(''), 2600);
    }
  }

  async function openOrder(orderId) {
    try {
      const order = await api(scope(`/producalza/orders/${orderId}`));
      setSelectedOrder(order);
      setView('order-detail');
    } catch (err) {
      setError(err.message);
    }
  }

  async function editOrder(orderId) {
    try {
      const order = await api(scope(`/producalza/orders/${orderId}`));
      setEditingOrder(order);
      setView('new-order');
    } catch (err) {
      setError(err.message);
    }
  }

  async function preparePrint(orderId, type, modelId = null) {
    const order = selectedOrder?.id === orderId
      ? selectedOrder
      : await api(scope(`/producalza/orders/${orderId}`));
    setPrintState({ order, type, modelId });
    setTimeout(() => window.print(), 120);
  }

  const nav = [
    ['dashboard', 'Panel', Boxes],
    ['orders', 'Pedidos', ClipboardList],
    ['new-order', 'Crear pedido', FilePlus2],
    ['clients', 'Clientes', UsersRound],
    ['production', 'Produccion', Factory],
    ...(isAdmin ? [['reports', 'Reportes', BarChart3]] : []),
    ...(isAdmin ? [['users', 'Usuarios', UserPlus]] : [])
  ];

  const currentLabel = nav.find(([key]) => key === view)?.[1]
    || (view === 'order-detail' ? 'Detalle del pedido' : 'Producalza');

  const content = loading ? (
    <div className="prod-empty">Cargando Producalza...</div>
  ) : (
    <>
      {error && <div className="alert error prod-alert">{error}</div>}
      {notice && <div className="alert success prod-alert">{notice}</div>}
      {view === 'dashboard' && <ProductionDashboard data={dashboard} orders={orders} onOpen={openOrder} />}
      {view === 'orders' && (
        <OrdersList
          orders={orders}
          users={users}
          isAdmin={isAdmin}
          scope={scope}
          onOpen={openOrder}
          onEdit={editOrder}
          onRefresh={refresh}
          setError={setError}
          setOrders={setOrders}
        />
      )}
      {view === 'new-order' && (
        <OrderForm
          clients={clients}
          users={users}
          isAdmin={isAdmin}
          scope={scope}
          initialOrder={editingOrder}
          onCancel={() => {
            setEditingOrder(null);
            setView('orders');
          }}
          onSaved={async (order) => {
            setEditingOrder(null);
            await refresh(order.status === 'draft' ? 'Borrador guardado' : 'Pedido enviado a revision');
            setSelectedOrder(order);
            setView('order-detail');
          }}
          setError={setError}
        />
      )}
      {view === 'order-detail' && selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          isAdmin={isAdmin}
          onBack={() => setView('orders')}
          onEdit={() => editOrder(selectedOrder.id)}
          onPrint={(type, modelId) => preparePrint(selectedOrder.id, type, modelId)}
        />
      )}
      {view === 'clients' && (
        <ClientsView
          clients={clients}
          isAdmin={isAdmin}
          users={users}
          scope={scope}
          onOpenOrder={openOrder}
          onRefresh={refresh}
          setError={setError}
        />
      )}
      {view === 'production' && (
        <ProductionBoard
          items={production}
          isAdmin={isAdmin}
          scope={scope}
          onOpen={openOrder}
          onRefresh={refresh}
          setError={setError}
          onPrint={preparePrint}
        />
      )}
      {view === 'reports' && isAdmin && <ProductionReports dashboard={dashboard} orders={orders} clientActivity={clientActivity} />}
      {view === 'users' && isAdmin && (
        <UsersView users={users} scope={scope} onRefresh={refresh} setError={setError} />
      )}
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="producalza-embedded">
          <div className="prod-tabs" role="navigation">
            {nav.map(([key, label, Icon]) => (
              <button
                key={key}
                className={view === key || (key === 'orders' && view === 'order-detail') ? 'active' : ''}
                onClick={() => {
                  if (key === 'new-order') setEditingOrder(null);
                  setView(key);
                }}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
          {content}
        </div>
      ) : (
        <main className="prod-shell">
          <aside className="prod-sidebar">
            <div className="prod-brand">
              <div className="prod-brand-mark">P</div>
              <div>
                <strong>PRODUCALZA</strong>
                <span>Pedidos y produccion</span>
              </div>
            </div>
            <nav>
              {nav.map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={view === key || (key === 'orders' && view === 'order-detail') ? 'active' : ''}
                  onClick={() => {
                    if (key === 'new-order') setEditingOrder(null);
                    setView(key);
                  }}
                >
                  <Icon size={19} />
                  {label}
                </button>
              ))}
            </nav>
            {onLogout && (
              <button className="prod-logout" onClick={onLogout}>
                <LogOut size={18} />
                Salir
              </button>
            )}
          </aside>
          <section className="prod-main">
            <header className="prod-topbar">
              <div>
                <span>PRODUCALZA</span>
                <h1>{currentLabel}</h1>
              </div>
              <div className="prod-user-chip">
                <strong>{user?.name || user?.username}</strong>
                <span>{isAdmin ? 'Administrador' : 'Vendedor'}</span>
              </div>
            </header>
            {content}
          </section>
        </main>
      )}
      <PrintLayouts state={printState} />
    </>
  );
}

function ProductionDashboard({ data, orders, onOpen }) {
  const metrics = [
    ['Pedidos nuevos', data?.new_orders || 0, ClipboardList],
    ['En produccion', data?.in_production || 0, Factory],
    ['Terminados', data?.finished || 0, PackageCheck],
    ['Pares pendientes', data?.pending_pairs || 0, Boxes]
  ];
  return (
    <div className="prod-stack">
      <section className="prod-metrics">
        {metrics.map(([label, value, Icon]) => (
          <article key={label}>
            <Icon size={21} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <div className="prod-dashboard-grid">
        <section className="prod-panel">
          <div className="prod-panel-title">
            <div><span>Actividad reciente</span><h2>Ultimos pedidos</h2></div>
          </div>
          <div className="prod-list">
            {orders.slice(0, 7).map((order) => (
              <button className="prod-order-row" key={order.id} onClick={() => onOpen(order.id)}>
                <div>
                  <strong>{order.order_number}</strong>
                  <span>{order.client_name} · {order.model_count} modelos</span>
                </div>
                <div>
                  <b>{order.total_pairs} pares</b>
                  <StatusBadge status={order.status} />
                </div>
              </button>
            ))}
            {!orders.length && <div className="prod-empty">Todavia no hay pedidos.</div>}
          </div>
        </section>
        <section className="prod-panel">
          <div className="prod-panel-title">
            <div><span>Resumen</span><h2>Pares por vendedor</h2></div>
          </div>
          <div className="prod-seller-list">
            {(data?.by_seller || []).map((seller) => (
              <div key={seller.seller_name}>
                <span>{seller.seller_name}</span>
                <strong>{seller.total_pairs} pares</strong>
              </div>
            ))}
            {!data?.by_seller?.length && <div className="prod-empty">Sin movimiento registrado.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function OrdersList({ orders, users, isAdmin, scope, onOpen, onEdit, onRefresh, setError, setOrders }) {
  const [filters, setFilters] = useState({ search: '', status: '', seller_id: '', date_from: '', date_to: '' });

  async function applyFilters() {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
    try {
      setOrders(await api(scope(`/producalza/orders?${query.toString()}`)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(order) {
    if (!window.confirm(`Seguro que deseas eliminar el pedido ${order.order_number}? Quedara registrado en el historial interno.`)) return;
    try {
      await api(scope(`/producalza/orders/${order.id}`), { method: 'DELETE' });
      onRefresh('Pedido eliminado');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="prod-stack">
      <section className="prod-filterbar">
        <label className="prod-search">
          <Search size={17} />
          <input
            placeholder="Buscar cliente o numero de pedido"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        {isAdmin && (
          <select value={filters.seller_id} onChange={(event) => setFilters({ ...filters, seller_id: event.target.value })}>
            <option value="">Todos los vendedores</option>
            {users.map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
          </select>
        )}
        <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <button className="prod-secondary-button" onClick={applyFilters}><Filter size={17} />Filtrar</button>
      </section>
      <section className="prod-panel">
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Fecha</th><th>Modelos</th><th>Pares</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><button className="prod-link-button" onClick={() => onOpen(order.id)}>{order.order_number}</button></td>
                  <td><strong>{order.client_name}</strong><small>{order.city}</small></td>
                  <td>{order.seller_name || 'Sin asignar'}</td>
                  <td>{displayDate(order.order_date)}</td>
                  <td>{order.model_count}</td>
                  <td>{order.total_pairs}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>
                    <div className="prod-row-actions">
                      <button title="Editar pedido" onClick={() => onEdit(order.id)}><Pencil size={16} /></button>
                      {isAdmin && <button className="danger" title="Eliminar pedido" onClick={() => remove(order)}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!orders.length && <div className="prod-empty">No existen pedidos con esos filtros.</div>}
        </div>
      </section>
    </div>
  );
}

function OrderForm({ clients, users, isAdmin, scope, initialOrder, onCancel, onSaved, setError }) {
  const [form, setForm] = useState(() => initialOrder ? orderToForm(initialOrder) : emptyOrder());
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState(emptyClient);
  const [localClients, setLocalClients] = useState(clients);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initialOrder ? orderToForm(initialOrder) : emptyOrder());
  }, [initialOrder]);

  function updateModel(index, patch) {
    setForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model)
    }));
  }

  function updateSize(index, size, value) {
    const quantity = Math.max(0, Number(value || 0));
    updateModel(index, { sizes: { ...form.models[index].sizes, [size]: quantity } });
  }

  async function createClient() {
    try {
      const created = await api(scope('/producalza/clients'), {
        method: 'POST',
        body: JSON.stringify(newClient)
      });
      setLocalClients((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ ...form, client_id: String(created.id) });
      setNewClient(emptyClient);
      setShowNewClient(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function save(status) {
    setSaving(true);
    setError('');
    try {
      const response = await api(scope(initialOrder ? `/producalza/orders/${initialOrder.id}` : '/producalza/orders'), {
        method: initialOrder ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, status })
      });
      onSaved(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const grandTotal = form.models.reduce((sum, model) => sum + totalModel(model), 0);

  return (
    <div className="prod-stack">
      <section className="prod-panel prod-order-form">
        <div className="prod-panel-title">
          <div>
            <span>{initialOrder ? initialOrder.order_number : 'Nuevo pedido'}</span>
            <h2>Datos generales</h2>
          </div>
          <button className="prod-icon-button" onClick={onCancel} title="Cerrar"><X size={18} /></button>
        </div>
        <div className="prod-form-grid">
          <label className="span-2">
            Cliente
            <select value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}>
              <option value="">Selecciona un cliente</option>
              {localClients.map((client) => (
                <option value={client.id} key={client.id}>{client.name}{client.business_name ? ` · ${client.business_name}` : ''}</option>
              ))}
            </select>
          </label>
          <button className="prod-secondary-button align-end" type="button" onClick={() => setShowNewClient((value) => !value)}>
            <UserPlus size={17} />Nuevo cliente
          </button>
          <label>Fecha<input type="date" value={form.order_date} onChange={(event) => setForm({ ...form, order_date: event.target.value })} /></label>
          {isAdmin && (
            <label>Vendedor
              <select value={form.seller_user_id || ''} onChange={(event) => setForm({ ...form, seller_user_id: event.target.value })}>
                <option value="">Sin asignar</option>
                {users.filter((item) => item.status === 'active').map((seller) => <option value={seller.id} key={seller.id}>{seller.name}</option>)}
              </select>
            </label>
          )}
          <label>Marca<input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label>Forma de pago<input value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} /></label>
          <label>Referencia bancaria<input value={form.bank_reference} onChange={(event) => setForm({ ...form, bank_reference: event.target.value })} /></label>
          <label className="span-full">Observaciones generales<textarea value={form.general_notes} onChange={(event) => setForm({ ...form, general_notes: event.target.value })} /></label>
        </div>
      </section>

      {showNewClient && (
        <section className="prod-panel prod-inline-client">
          <div className="prod-panel-title"><div><span>Registro rapido</span><h2>Nuevo cliente</h2></div></div>
          <ClientFields value={newClient} onChange={setNewClient} />
          <div className="prod-form-actions">
            <button className="prod-secondary-button" onClick={() => setShowNewClient(false)}>Cancelar</button>
            <button className="prod-primary-button" onClick={createClient}><Save size={17} />Crear y seleccionar</button>
          </div>
        </section>
      )}

      <div className="prod-model-stack">
        {form.models.map((model, index) => (
          <section className="prod-panel prod-model-card" key={index}>
            <div className="prod-panel-title">
              <div><span>Modelo {index + 1}</span><h2>{model.model_code || 'Sin codigo'}</h2></div>
              {form.models.length > 1 && (
                <button className="prod-icon-button danger" onClick={() => setForm({ ...form, models: form.models.filter((_, itemIndex) => itemIndex !== index) })}>
                  <Trash2 size={17} />
                </button>
              )}
            </div>
            <div className="prod-form-grid">
              <label>Codigo o modelo<input value={model.model_code} onChange={(event) => updateModel(index, { model_code: event.target.value })} /></label>
              <label>Color<input value={model.color} onChange={(event) => updateModel(index, { color: event.target.value })} /></label>
              <label>Material o descripcion<input value={model.material} onChange={(event) => updateModel(index, { material: event.target.value })} /></label>
              <label>Planta o area<input value={model.plant_area} onChange={(event) => updateModel(index, { plant_area: event.target.value })} /></label>
              <label className="span-full">Observaciones del modelo<textarea value={model.notes} onChange={(event) => updateModel(index, { notes: event.target.value })} /></label>
            </div>
            <div className="prod-size-grid">
              {SIZES.map((size) => (
                <label key={size}>
                  <span>{size}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={model.sizes?.[size] || ''}
                    onChange={(event) => updateSize(index, size, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="prod-model-total">Total del modelo <strong>{totalModel(model)} pares</strong></div>
          </section>
        ))}
      </div>
      <button className="prod-add-model" onClick={() => setForm({ ...form, models: [...form.models, emptyModel()] })}>
        <Plus size={19} />Agregar otro modelo
      </button>
      <section className="prod-order-summary">
        <div><span>Resumen del pedido</span><strong>{form.models.length} modelos · {grandTotal} pares</strong></div>
        <div className="prod-form-actions">
          <button className="prod-secondary-button" disabled={saving} onClick={() => save('draft')}><Save size={17} />Guardar borrador</button>
          <button className="prod-primary-button" disabled={saving} onClick={() => save('received')}><Check size={17} />Confirmar pedido</button>
        </div>
      </section>
    </div>
  );
}

function OrderDetail({ order, isAdmin, onBack, onEdit, onPrint }) {
  return (
    <div className="prod-stack">
      <div className="prod-detail-actions">
        <button className="prod-secondary-button" onClick={onBack}><ChevronLeft size={17} />Volver</button>
        <div>
          <button className="prod-secondary-button" onClick={onEdit}><Pencil size={17} />Editar</button>
          <button className="prod-primary-button" onClick={() => onPrint('sheets')}><Printer size={17} />Hojas de produccion</button>
          <button className="prod-primary-button dark" onClick={() => onPrint('cards')}><Printer size={17} />Tarjetas</button>
        </div>
      </div>
      <section className="prod-order-hero">
        <div>
          <span>Pedido</span>
          <h2>{order.order_number}</h2>
          <p>{order.client_name} · {order.city || 'Sin ciudad'}</p>
        </div>
        <div>
          <StatusBadge status={order.status} />
          <strong>{order.models.reduce((sum, model) => sum + Number(model.total_pairs), 0)} pares</strong>
        </div>
      </section>
      <section className="prod-panel">
        <div className="prod-detail-grid">
          <Detail label="Razon social" value={order.business_name} />
          <Detail label="RUC o cedula" value={order.tax_id} />
          <Detail label="Telefono" value={order.phone} />
          <Detail label="Direccion" value={order.address} />
          <Detail label="Vendedor" value={order.seller_name} />
          <Detail label="Fecha" value={displayDate(order.order_date)} />
          <Detail label="Marca" value={order.brand} />
          <Detail label="Forma de pago" value={order.payment_method} />
        </div>
        {order.general_notes && <div className="prod-note"><strong>Observaciones</strong><p>{order.general_notes}</p></div>}
      </section>
      <div className="prod-model-stack">
        {order.models.map((model) => (
          <section className="prod-panel prod-detail-model" key={model.id}>
            <div className="prod-panel-title">
              <div><span>Tarjeta Nro. {model.card_number}</span><h2>{model.model_code}</h2></div>
              <div className="prod-detail-model-actions">
                <StatusBadge status={model.status} model />
                <button className="prod-icon-button" title="Imprimir tarjeta" onClick={() => onPrint('card', model.id)}><Printer size={17} /></button>
              </div>
            </div>
            <div className="prod-model-meta">
              <Detail label="Color" value={model.color} />
              <Detail label="Material" value={model.material} />
              <Detail label="Planta o area" value={model.plant_area} />
              <Detail label="Total" value={`${model.total_pairs} pares`} />
            </div>
            <SizeSummary sizes={model.sizes} />
            <ProcessStrip model={model} readOnly />
            {model.notes && <div className="prod-note"><strong>Observaciones</strong><p>{model.notes}</p></div>}
          </section>
        ))}
      </div>
    </div>
  );
}

function ClientsView({ clients, isAdmin, users, scope, onOpenOrder, onRefresh, setError }) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyClient);
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [visit, setVisit] = useState(emptyVisit);
  const [editingVisitId, setEditingVisitId] = useState(null);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const filtered = useMemo(() => {
    const text = search.toLowerCase();
    return clients.filter((client) => `${client.name} ${client.business_name} ${client.city} ${client.phone}`.toLowerCase().includes(text));
  }, [clients, search]);

  async function saveClient() {
    try {
      const currentId = editingId;
      await api(scope(editingId ? `/producalza/clients/${editingId}` : '/producalza/clients'), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyClient);
      setEditingId(null);
      setShowClientForm(false);
      await onRefresh(currentId ? 'Cliente actualizado' : 'Cliente creado');
      if (currentId) await openClient(currentId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function openClient(id) {
    try {
      setSelected(await api(scope(`/producalza/clients/${id}`)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addVisit() {
    try {
      await api(scope(editingVisitId
        ? `/producalza/clients/${selected.id}/visits/${editingVisitId}`
        : `/producalza/clients/${selected.id}/visits`), {
        method: editingVisitId ? 'PUT' : 'POST',
        body: JSON.stringify(visit)
      });
      setVisit(emptyVisit);
      setEditingVisitId(null);
      setShowVisitForm(false);
      await openClient(selected.id);
      await onRefresh(editingVisitId ? 'Visita actualizada' : 'Seguimiento registrado');
    } catch (err) {
      setError(err.message);
    }
  }

  function editVisit(item) {
    setEditingVisitId(item.id);
    setVisit({
      visit_date: item.visit_date || '',
      visited_by_user_id: item.visited_by_user_id ? String(item.visited_by_user_id) : '',
      visitor_name: item.visitor_name || '',
      visit_type: item.visit_type || 'visit',
      result: item.result || '',
      next_visit_date: item.next_visit_date || '',
      order_id: item.order_id ? String(item.order_id) : '',
      pairs: item.pairs ?? '',
      notes: item.notes || ''
    });
    setShowVisitForm(true);
  }

  async function deleteVisit(item) {
    if (!window.confirm('Seguro que deseas eliminar este registro de visita?')) return;
    try {
      await api(scope(`/producalza/clients/${selected.id}/visits/${item.id}`), { method: 'DELETE' });
      await openClient(selected.id);
      await onRefresh('Visita eliminada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function importClients(file) {
    if (!file) return;
    try {
      const clientsToImport = JSON.parse(await file.text());
      const result = await api(scope('/producalza/clients/import'), {
        method: 'POST',
        body: JSON.stringify({ clients: clientsToImport })
      });
      onRefresh(`${result.imported_clients} clientes y ${result.imported_visits} antecedentes importados`);
    } catch (err) {
      setError(err.message === 'Unexpected token'
        ? 'El archivo de importacion no tiene el formato correcto'
        : err.message);
    }
  }

  function edit(client) {
    setEditingId(client.id);
    setForm(Object.fromEntries(Object.keys(emptyClient).map((key) => [key, client[key] || ''])));
    setShowClientForm(true);
  }

  if (selected) {
    return (
      <div className="prod-client-profile">
        <div className="prod-detail-actions">
          <button className="prod-secondary-button" onClick={() => {
            setSelected(null);
            setShowVisitForm(false);
            setShowClientForm(false);
            setEditingVisitId(null);
          }}><ChevronLeft size={17} />Volver a clientes</button>
          <div>
            <button className="prod-secondary-button" onClick={() => edit(selected)}><Pencil size={17} />Editar cliente</button>
            <button className="prod-primary-button" onClick={() => {
              setVisit(emptyVisit);
              setEditingVisitId(null);
              setShowVisitForm(true);
            }}><Plus size={17} />Registrar seguimiento</button>
          </div>
        </div>

        <section className="prod-client-hero">
          <div>
            <span>Expediente del cliente</span>
            <h2>{selected.name}</h2>
            <p>{selected.business_name || 'Sin razon social'} · {selected.city || 'Sin ciudad'}</p>
          </div>
          <div className="prod-client-summary">
            <div><span>Visitas</span><strong>{selected.summary?.visit_count || 0}</strong></div>
            <div><span>Pedidos</span><strong>{selected.summary?.order_count || 0}</strong></div>
            <div><span>Pares</span><strong>{selected.summary?.total_pairs || 0}</strong></div>
            <div><span>Proxima visita</span><strong>{selected.summary?.next_visit ? displayDate(selected.summary.next_visit) : 'Sin agendar'}</strong></div>
          </div>
        </section>

        {showClientForm && (
          <section className="prod-panel">
            <div className="prod-panel-title">
              <div><span>Informacion general</span><h2>Editar cliente</h2></div>
              <button className="prod-icon-button" onClick={() => setShowClientForm(false)}><X size={17} /></button>
            </div>
            <ClientFields value={form} onChange={setForm} />
            <div className="prod-form-actions">
              <button className="prod-secondary-button" onClick={() => setShowClientForm(false)}>Cancelar</button>
              <button className="prod-primary-button" onClick={saveClient}><Save size={17} />Guardar cambios</button>
            </div>
          </section>
        )}

        <section className="prod-panel">
          <div className="prod-panel-title"><div><span>Datos registrados</span><h2>Informacion del cliente</h2></div></div>
          <div className="prod-client-info-grid">
            <Detail label="Telefono / WhatsApp" value={selected.phone} />
            <Detail label="Correo" value={selected.email} />
            <Detail label="RUC o cedula" value={selected.tax_id} />
            <Detail label="Direccion" value={selected.address} />
            <Detail label="Marca" value={selected.brand} />
            <Detail label="Forma de pago" value={selected.payment_method} />
            <Detail label="Referencia bancaria" value={selected.bank_reference} />
            <Detail label="Clasificacion" value={selected.classification} />
            <Detail label="Vendedor historico" value={selected.imported_seller_code} />
            <Detail label="Ultima actividad" value={selected.summary?.last_activity ? displayDate(selected.summary.last_activity.slice(0, 10)) : ''} />
          </div>
          {selected.general_notes && <div className="prod-note"><strong>Observaciones generales</strong><p>{selected.general_notes}</p></div>}
        </section>

        {showVisitForm && (
          <section className="prod-panel prod-followup-form">
            <div className="prod-panel-title">
              <div><span>Actividad comercial</span><h2>{editingVisitId ? 'Editar seguimiento' : 'Nuevo seguimiento'}</h2></div>
              <button className="prod-icon-button" onClick={() => {
                setShowVisitForm(false);
                setEditingVisitId(null);
                setVisit(emptyVisit);
              }}><X size={17} /></button>
            </div>
            <div className="prod-form-grid">
              <label>Fecha<input type="date" value={visit.visit_date} onChange={(event) => setVisit({ ...visit, visit_date: event.target.value })} /></label>
              <label>Tipo de contacto
                <select value={visit.visit_type} onChange={(event) => setVisit({ ...visit, visit_type: event.target.value })}>
                  {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              {isAdmin ? (
                <label>Quien realizo la visita
                  <select value={visit.visited_by_user_id} onChange={(event) => setVisit({ ...visit, visited_by_user_id: event.target.value })}>
                    <option value="">Nombre manual / historico</option>
                    {users.filter((item) => item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label>Nombre manual del responsable<input value={visit.visitor_name} onChange={(event) => setVisit({ ...visit, visitor_name: event.target.value })} /></label>
              <label>Pedido relacionado
                <select value={visit.order_id} onChange={(event) => setVisit({ ...visit, order_id: event.target.value })}>
                  <option value="">Sin pedido relacionado</option>
                  {selected.orders.map((order) => <option value={order.id} key={order.id}>{order.order_number}</option>)}
                </select>
              </label>
              <label>Pares conversados o solicitados<input type="number" min="0" value={visit.pairs} onChange={(event) => setVisit({ ...visit, pairs: event.target.value })} /></label>
              <label>Proxima visita<input type="date" value={visit.next_visit_date} onChange={(event) => setVisit({ ...visit, next_visit_date: event.target.value })} /></label>
              <label className="span-full">Resultado de la visita<textarea value={visit.result} onChange={(event) => setVisit({ ...visit, result: event.target.value })} /></label>
              <label className="span-full">Observaciones y acuerdos<textarea value={visit.notes} onChange={(event) => setVisit({ ...visit, notes: event.target.value })} /></label>
            </div>
            <div className="prod-form-actions">
              <button className="prod-secondary-button" onClick={() => setShowVisitForm(false)}>Cancelar</button>
              <button className="prod-primary-button" onClick={addVisit}><Save size={17} />Guardar seguimiento</button>
            </div>
          </section>
        )}

        <div className="prod-client-record-grid">
          <section className="prod-panel">
            <div className="prod-panel-title"><div><span>Actividad acumulada</span><h2>Visitas y seguimientos</h2></div></div>
            <div className="prod-timeline">
              {selected.visits.map((item) => (
                <article key={item.id}>
                  <div className="prod-timeline-marker" />
                  <div className="prod-timeline-content">
                    <header>
                      <div>
                        <strong>{item.visit_date ? displayDate(item.visit_date) : item.visit_date_text || 'Fecha no especificada'}</strong>
                        <span>{VISIT_TYPE_LABELS[item.visit_type] || item.visit_type || 'Visita'} · {item.visited_by_name}</span>
                      </div>
                      <div className="prod-row-actions">
                        <button title="Editar visita" onClick={() => editVisit(item)}><Pencil size={15} /></button>
                        {isAdmin && <button className="danger" title="Eliminar visita" onClick={() => deleteVisit(item)}><Trash2 size={15} /></button>}
                      </div>
                    </header>
                    <div className="prod-timeline-tags">
                      {item.pairs != null && <span>{item.pairs} pares</span>}
                      {item.related_order_number && <span>Pedido {item.related_order_number}</span>}
                      {item.next_visit_date && <span>Proxima: {displayDate(item.next_visit_date)}</span>}
                    </div>
                    {item.result && <p><strong>Resultado:</strong> {item.result}</p>}
                    {item.notes && <p>{item.notes}</p>}
                  </div>
                </article>
              ))}
              {!selected.visits.length && <div className="prod-empty">Todavia no hay visitas o seguimientos.</div>}
            </div>
          </section>

          <section className="prod-panel">
            <div className="prod-panel-title"><div><span>Compras realizadas</span><h2>Historial de pedidos</h2></div></div>
            <div className="prod-client-orders">
              {selected.orders.map((order) => (
                <button key={order.id} onClick={() => onOpenOrder(order.id)}>
                  <div>
                    <strong>{order.order_number}</strong>
                    <span>{displayDate(order.order_date)} · {order.seller_name || 'Sin vendedor'}</span>
                    <small>{order.model_codes || 'Sin modelos detallados'}</small>
                  </div>
                  <div>
                    <b>{order.total_pairs} pares</b>
                    <StatusBadge status={order.status} />
                  </div>
                </button>
              ))}
              {!selected.orders.length && <div className="prod-empty">Este cliente aun no tiene pedidos registrados.</div>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="prod-clients-layout">
      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Base de datos</span><h2>{clients.length} clientes</h2></div>
          {isAdmin && (
            <label className="prod-import-button">
              <input type="file" accept=".json,application/json" onChange={(event) => importClients(event.target.files?.[0])} />
              <FilePlus2 size={16} />
              Importar
            </label>
          )}
        </div>
        <label className="prod-search"><Search size={17} /><input placeholder="Buscar cliente, ciudad o telefono" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="prod-client-list">
          {filtered.map((client) => (
            <article key={client.id}>
              <button onClick={() => openClient(client.id)}>
                <strong>{client.name}</strong>
                <span>{client.business_name || 'Sin razon social'} · {client.city || 'Sin ciudad'}</span>
                <small>{client.phone || 'Sin telefono'} · {client.visit_count} antecedentes · {client.order_count} pedidos</small>
              </button>
              <button className="prod-icon-button" onClick={() => edit(client)} title="Editar cliente"><Pencil size={16} /></button>
            </article>
          ))}
        </div>
      </section>
      <div className="prod-stack">
        <section className="prod-panel">
          <div className="prod-panel-title"><div><span>{editingId ? 'Edicion' : 'Nuevo registro'}</span><h2>{editingId ? 'Editar cliente' : 'Agregar cliente'}</h2></div></div>
          <ClientFields value={form} onChange={setForm} />
          <div className="prod-form-actions">
            {editingId && <button className="prod-secondary-button" onClick={() => { setEditingId(null); setForm(emptyClient); }}>Cancelar</button>}
            <button className="prod-primary-button" onClick={saveClient}><Save size={17} />Guardar cliente</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProductionBoard({ items, isAdmin, scope, onOpen, onRefresh, setError, onPrint }) {
  const [status, setStatus] = useState('');
  const filtered = status ? items.filter((item) => item.status === status) : items;

  async function update(item, patch) {
    try {
      await api(scope(`/producalza/models/${item.id}`), {
        method: 'PATCH',
        body: JSON.stringify({ ...item, ...patch })
      });
      onRefresh('Avance actualizado');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="prod-stack">
      <section className="prod-filterbar">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los procesos</option>
          {Object.entries(MODEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <span className="prod-filter-count">{filtered.length} modelos</span>
      </section>
      <div className="prod-production-grid">
        {filtered.map((item) => (
          <article className="prod-production-card" key={item.id}>
            <div className="prod-production-head">
              <div><span>{item.order_number} · Tarjeta {item.card_number}</span><h3>{item.model_code}</h3><p>{item.client_name}</p></div>
              <StatusBadge status={item.status} model />
            </div>
            <div className="prod-production-meta">
              <span>{item.color || 'Sin color'}</span>
              <strong>{item.total_pairs} pares</strong>
            </div>
            {isAdmin ? (
              <>
                <label className="prod-status-select">Estado
                  <select value={item.status} onChange={(event) => update(item, { status: event.target.value })}>
                    {Object.entries(MODEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <ProcessStrip model={item} onChange={(field, value) => update(item, { [field]: value })} />
                <label className="prod-card-number">Tarjeta Nro.
                  <input type="number" defaultValue={item.card_number} onBlur={(event) => update(item, { card_number: event.target.value })} />
                </label>
              </>
            ) : <ProcessStrip model={item} readOnly />}
            <div className="prod-card-actions">
              <button className="prod-secondary-button" onClick={() => onOpen(item.order_id)}>Ver pedido</button>
              <button className="prod-icon-button" title="Imprimir tarjeta" onClick={() => onPrint(item.order_id, 'card', item.id)}><Printer size={17} /></button>
            </div>
          </article>
        ))}
        {!filtered.length && <div className="prod-empty">No hay modelos en este estado.</div>}
      </div>
    </div>
  );
}

function UsersView({ users, scope, onRefresh, setError }) {
  const [form, setForm] = useState(emptyUser);
  const [editingId, setEditingId] = useState(null);

  function edit(item) {
    setEditingId(item.id);
    setForm({ ...item, password: '' });
  }

  async function save() {
    try {
      await api(scope(editingId ? `/producalza/users/${editingId}` : '/producalza/users'), {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyUser);
      setEditingId(null);
      onRefresh(editingId ? 'Usuario actualizado' : 'Usuario creado');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="prod-users-layout">
      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Accesos</span><h2>{editingId ? 'Editar usuario' : 'Nuevo usuario'}</h2></div></div>
        <div className="prod-form-grid single">
          <label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Usuario<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Contrasena<input type="password" placeholder={editingId ? 'Dejar vacio para conservar' : ''} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <label>Rol<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="vendor">Vendedor</option><option value="admin">Administrador</option></select></label>
          <label>Estado<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
          <label className="prod-check-line"><input type="checkbox" checked={Boolean(form.can_view_all_orders)} onChange={(event) => setForm({ ...form, can_view_all_orders: event.target.checked })} />Puede ver pedidos de otros vendedores</label>
        </div>
        <div className="prod-form-actions">
          {editingId && <button className="prod-secondary-button" onClick={() => { setEditingId(null); setForm(emptyUser); }}>Cancelar</button>}
          <button className="prod-primary-button" onClick={save}><Save size={17} />Guardar usuario</button>
        </div>
      </section>
      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Equipo</span><h2>Usuarios Producalza</h2></div></div>
        <div className="prod-user-list">
          {users.map((item) => (
            <article key={item.id}>
              <div><strong>{item.name}</strong><span>@{item.username} · {item.role === 'admin' ? 'Administrador' : 'Vendedor'}</span><small>{item.status === 'active' ? 'Activo' : 'Inactivo'}{item.can_view_all_orders ? ' · Ve todos los pedidos' : ''}</small></div>
              <button className="prod-icon-button" onClick={() => edit(item)}><Pencil size={16} /></button>
            </article>
          ))}
          {!users.length && <div className="prod-empty">Crea el primer vendedor para comenzar.</div>}
        </div>
      </section>
    </div>
  );
}

function ProductionReports({ dashboard, orders, clientActivity }) {
  const byStatus = Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => ({
    key,
    label,
    count: orders.filter((order) => order.status === key).length,
    pairs: orders.filter((order) => order.status === key).reduce((sum, order) => sum + Number(order.total_pairs || 0), 0)
  }));
  const totalPairs = orders.reduce((sum, order) => sum + Number(order.total_pairs || 0), 0);
  return (
    <div className="prod-stack">
      <section className="prod-metrics">
        <article><ClipboardList size={21} /><span>Total de pedidos</span><strong>{orders.length}</strong></article>
        <article><Boxes size={21} /><span>Total de pares</span><strong>{totalPairs}</strong></article>
        <article><Factory size={21} /><span>Pares pendientes</span><strong>{dashboard?.pending_pairs || 0}</strong></article>
        <article><PackageCheck size={21} /><span>Pedidos terminados</span><strong>{dashboard?.finished || 0}</strong></article>
      </section>
      <div className="prod-dashboard-grid">
        <section className="prod-panel">
          <div className="prod-panel-title"><div><span>Situacion actual</span><h2>Pedidos por estado</h2></div></div>
          <div className="prod-report-bars">
            {byStatus.map((item) => (
              <div key={item.key}>
                <span>{item.label}</span>
                <div><i style={{ width: `${orders.length ? Math.max(4, item.count / orders.length * 100) : 0}%` }} /></div>
                <strong>{item.count} · {item.pairs} pares</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="prod-panel">
          <div className="prod-panel-title"><div><span>Rendimiento</span><h2>Pares por vendedor</h2></div></div>
          <div className="prod-seller-list">
            {(dashboard?.by_seller || []).map((seller) => (
              <div key={seller.seller_name}><span>{seller.seller_name}</span><strong>{seller.total_pairs} pares</strong></div>
            ))}
          </div>
        </section>
      </div>
      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Relacion comercial</span><h2>Actividad por cliente</h2></div>
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr><th>Cliente</th><th>Ciudad</th><th>Visitas</th><th>Pedidos</th><th>Pares</th><th>Ultima actividad</th><th>Proxima visita</th></tr>
            </thead>
            <tbody>
              {(clientActivity || []).map((client) => (
                <tr key={client.id}>
                  <td><strong>{client.name}</strong><small>{client.business_name || client.phone || ''}</small></td>
                  <td>{client.city || '-'}</td>
                  <td>{client.visit_count}</td>
                  <td>{client.order_count}</td>
                  <td>{client.total_pairs}</td>
                  <td>{client.last_activity ? displayDate(client.last_activity.slice(0, 10)) : 'Sin actividad'}</td>
                  <td>{client.next_visit ? displayDate(client.next_visit) : 'Sin agendar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ClientFields({ value, onChange }) {
  const update = (key, nextValue) => onChange({ ...value, [key]: nextValue });
  return (
    <div className="prod-form-grid">
      <label>Cliente<input value={value.name} onChange={(event) => update('name', event.target.value)} /></label>
      <label>Razon social<input value={value.business_name} onChange={(event) => update('business_name', event.target.value)} /></label>
      <label>RUC o cedula<input value={value.tax_id} onChange={(event) => update('tax_id', event.target.value)} /></label>
      <label>Ciudad<input value={value.city} onChange={(event) => update('city', event.target.value)} /></label>
      <label className="span-2">Direccion<input value={value.address} onChange={(event) => update('address', event.target.value)} /></label>
      <label>Telefono / WhatsApp<input value={value.phone} onChange={(event) => update('phone', event.target.value)} /></label>
      <label>Correo<input type="email" value={value.email} onChange={(event) => update('email', event.target.value)} /></label>
      <label>Marca<input value={value.brand} onChange={(event) => update('brand', event.target.value)} /></label>
      <label>Forma de pago<input value={value.payment_method} onChange={(event) => update('payment_method', event.target.value)} /></label>
      <label>Referencia bancaria<input value={value.bank_reference} onChange={(event) => update('bank_reference', event.target.value)} /></label>
      <label>Clasificacion<input value={value.classification} onChange={(event) => update('classification', event.target.value)} /></label>
      <label className="span-full">Observaciones<textarea value={value.general_notes} onChange={(event) => update('general_notes', event.target.value)} /></label>
    </div>
  );
}

function ProcessStrip({ model, onChange, readOnly = false }) {
  return (
    <div className="prod-process-strip">
      {PROCESS_FIELDS.map(([field, letter, label]) => (
        <label key={field} title={label} className={model[field] ? 'done' : ''}>
          <input
            type="checkbox"
            checked={Boolean(model[field])}
            disabled={readOnly}
            onChange={(event) => onChange?.(field, event.target.checked)}
          />
          <span>{letter}</span>
          <small>{label}</small>
        </label>
      ))}
    </div>
  );
}

function SizeSummary({ sizes }) {
  const entries = SIZES.filter((size) => Number(sizes?.[size] || 0) > 0);
  return (
    <div className="prod-size-summary">
      {entries.map((size) => <div key={size}><span>{size}</span><strong>{sizes[size]}</strong></div>)}
      {!entries.length && <span>Sin tallas registradas</span>}
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="prod-detail-item"><span>{label}</span><strong>{value || 'No registrado'}</strong></div>;
}

function StatusBadge({ status, model = false }) {
  const labels = model ? MODEL_STATUS_LABELS : ORDER_STATUS_LABELS;
  return <span className={`prod-status status-${status}`}>{labels[status] || status}</span>;
}

function orderToForm(order) {
  return {
    client_id: String(order.client_id),
    seller_user_id: order.seller_user_id ? String(order.seller_user_id) : '',
    order_date: order.order_date,
    brand: order.brand || '',
    payment_method: order.payment_method || '',
    bank_reference: order.bank_reference || '',
    general_notes: order.general_notes || '',
    status: order.status,
    models: order.models.map((model) => ({
      ...model,
      sizes: Object.fromEntries(SIZES.map((size) => [size, Number(model.sizes?.[size] || 0)]))
    }))
  };
}

function PrintLayouts({ state }) {
  if (!state?.order) return null;
  const { order, type, modelId } = state;
  const models = modelId ? order.models.filter((model) => model.id === modelId) : order.models;
  return (
    <div className="prod-print-root">
      {(type === 'sheets' ? models : []).map((model) => (
        <ProductionSheet order={order} model={model} key={`sheet-${model.id}`} />
      ))}
      {(type === 'cards' || type === 'card' ? models : []).map((model) => (
        <ProductionCard order={order} model={model} key={`card-${model.id}`} />
      ))}
    </div>
  );
}

function ProductionSheet({ order, model }) {
  return (
    <article className="prod-print-page">
      <header><div><strong>PRODUCALZA</strong><span>HOJA DE PRODUCCION</span></div><b>{order.order_number}</b></header>
      <section className="prod-print-info">
        <div><span>Cliente</span><strong>{order.client_name}</strong></div>
        <div><span>Fecha</span><strong>{displayDate(order.order_date)}</strong></div>
        <div><span>Vendedor</span><strong>{order.seller_name || 'Sin asignar'}</strong></div>
        <div><span>Ciudad</span><strong>{order.city || 'Sin ciudad'}</strong></div>
        <div><span>Modelo</span><strong>{model.model_code}</strong></div>
        <div><span>Color</span><strong>{model.color || '-'}</strong></div>
        <div><span>Material</span><strong>{model.material || '-'}</strong></div>
        <div><span>Tarjeta Nro.</span><strong>{model.card_number}</strong></div>
      </section>
      <table><thead><tr>{SIZES.map((size) => <th key={size}>{size}</th>)}<th>TOTAL</th></tr></thead>
        <tbody><tr>{SIZES.map((size) => <td key={size}>{model.sizes?.[size] || ''}</td>)}<td><strong>{model.total_pairs}</strong></td></tr></tbody>
      </table>
      <section className="prod-print-notes"><span>Observaciones</span><p>{model.notes || order.general_notes || ''}</p></section>
      <section className="prod-print-process">
        {PROCESS_FIELDS.map(([, letter, label]) => <div key={label}><strong>{letter}</strong><span>{label}</span><i /></div>)}
      </section>
      <footer><span>Planta / area: {model.plant_area || '________________'}</span><span>Firma: __________________________</span></footer>
    </article>
  );
}

function ProductionCard({ order, model }) {
  return (
    <article className="prod-print-card">
      <header><div><strong>PRODUCALZA</strong><span>TARJETA DE PRODUCCION</span></div><b>Nro. {model.card_number}</b></header>
      <div className="prod-card-client"><span>Cliente</span><strong>{order.client_name}</strong></div>
      <section>
        <div><span>Modelo</span><strong>{model.model_code}</strong></div>
        <div><span>Color</span><strong>{model.color || '-'}</strong></div>
        <div><span>Material</span><strong>{model.material || '-'}</strong></div>
        <div><span>Planta / area</span><strong>{model.plant_area || '-'}</strong></div>
      </section>
      <table><thead><tr>{SIZES.map((size) => <th key={size}>{size}</th>)}</tr></thead>
        <tbody><tr>{SIZES.map((size) => <td key={size}>{model.sizes?.[size] || ''}</td>)}</tr></tbody>
      </table>
      <div className="prod-card-total"><span>Total</span><strong>{model.total_pairs} pares</strong></div>
      <div className="prod-card-observation"><span>Observaciones</span><p>{model.notes || '-'}</p></div>
      <div className="prod-card-process">{PROCESS_FIELDS.map(([, letter, label]) => <span key={label}>{letter} □</span>)}</div>
    </article>
  );
}
