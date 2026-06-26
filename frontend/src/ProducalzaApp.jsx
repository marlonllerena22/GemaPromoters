import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Check,
  ChevronLeft,
  ClipboardList,
  Factory,
  FilePlus2,
  Filter,
  Image as ImageIcon,
  FileDown,
  LogOut,
  MessageCircle,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Tags,
  BarChart3,
  Trash2,
  Upload,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react';
import { api, downloadApiFile } from './api.js';

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
  guide_template_key: '',
  guide_logo_url: '',
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
  next_visit_type: 'follow_up',
  order_id: '',
  pairs: '',
  notes: ''
};

const emptyGuideTemplate = {
  name: '',
  logo_url: ''
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
    guide_template_key: '',
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

function processStateForStatus(status) {
  const order = ['received', 'reviewed', 'in_production', 'cut', 'stitched', 'assembled', 'finished', 'delivered'];
  const step = order.indexOf(status);
  if (status === 'cancelled' || step < 0) {
    return {};
  }
  return {
    process_prepared: step >= 2,
    process_cut: step >= 3,
    process_stitched: step >= 4,
    process_assembled: step >= 5,
    process_planted: step >= 6,
    process_finished: step >= 6
  };
}

function displayDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-EC');
}

function whatsappNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('5930')) return `593${digits.slice(4)}`;
  if (digits.startsWith('593')) return digits;
  if (digits.startsWith('0')) return `593${digits.slice(1)}`;
  if (digits.length === 9) return `593${digits}`;
  return digits;
}

function safeFilename(value) {
  return String(value || 'Cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .trim() || 'Cliente';
}

function normalizeGuideText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const GUIDE_TEMPLATE_ALIASES = {
  'standard-l-alvarado': ['lasland'],
  'standard-j-velastegui': ['ambacuero'],
  'standard-k-leon': ['calzado aries', 'aries'],
  'standard-g-camaco': ['gabbys', 'gabby s'],
  'standard-c-andrade': ['sebastians', 'sebastian s'],
  'standard-l-guznay': ['d mujeres shop', 'dmujeres shop'],
  'standard-j-enriquez': ['jestilos y modelos'],
  'standard-marjorie': ['marjorie botas'],
  'standard-r-molina': ['desing'],
  'standard-j-barrera': ['moda en cuero'],
  'standard-m-saavedra': ['emanuels', 'emanuell s'],
  'standard-f-guerrero': ['adore shoes'],
  'standard-m-guerrero-2-': ['belle scarpe'],
  'standard-n-llivicura': ['amis'],
  'standard-t-macas': ['boga'],
  'standard-l-llango': ['naysha', 'lever sastreria'],
  'standard-m-cueva': ['milenne cueva'],
  'standard-m-galarza': ['cellini'],
  'standard-j-torres': ['klauso'],
  'standard-j-hernandez': ['ecuabotas'],
  'standard-febraty': ['ferratty'],
  'standard-f-recalde': ['calzado pony'],
  'standard-l-quezada': ['zaba'],
  'standard-c-vactory': ['paloma vactory'],
  'special-d-martinez': ['gusmar'],
  'special-bruma': ['bruma'],
  'special-f-guaman': ['calzado marcos', 'calzado marcos 2']
};

function guideSimilarity(first, second) {
  const left = normalizeGuideText(first).replace(/\s/g, '');
  const right = normalizeGuideText(second).replace(/\s/g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
  }
  return 1 - rows[left.length][right.length] / Math.max(left.length, right.length);
}

function inferGuideTemplate(client, templates) {
  if (!client || !templates?.length) return '';
  const name = normalizeGuideText(client.name || client.client_name || '');
  const business = normalizeGuideText(client.business_name || '');
  const brand = normalizeGuideText(client.brand || '');
  const nameTokens = name.split(' ').filter(Boolean);
  let best = null;
  for (const template of templates) {
    const templateTokens = normalizeGuideText(template.name).split(' ').filter(Boolean);
    if (!templateTokens.length) continue;
    const surname = templateTokens.findLast((token) => token.length > 1 && !/^\d+$/.test(token));
    const initial = templateTokens[0]?.[0];
    let score = 0;
    const aliases = GUIDE_TEMPLATE_ALIASES[template.key] || [];
    const aliasMatch = aliases.some((alias) =>
      [business, brand, name].some((source) =>
        source && (source.includes(normalizeGuideText(alias))
          || guideSimilarity(source, alias) >= 0.88)
      )
    );
    if (aliasMatch) score += 130;

    const surnameSimilarity = surname
      ? Math.max(0, ...nameTokens.map((token) => guideSimilarity(token, surname)))
      : 0;
    const initialMatches = initial
      ? nameTokens.slice(0, -1).some((token) => token.startsWith(initial))
      : false;
    if (surnameSimilarity >= 0.9) score += 65;
    else if (surnameSimilarity >= 0.76) score += 42;
    if (initialMatches) score += 35;
    if (normalizeGuideText(template.name).replace(/\s/g, '') === name.replace(/\s/g, '')) score += 80;

    if (!aliasMatch && (!initialMatches || surnameSimilarity < 0.76)) score = 0;
    if (!best || score > best.score) best = { key: template.key, score };
  }
  return best?.score >= 90 ? best.key : '';
}

function resolveGuideTemplateKey(order, templates) {
  return order?.guide_template_key
    || order?.client_guide_template_key
    || inferGuideTemplate(order, templates);
}

function guideTemplateSlug(key) {
  return String(key || 'custom')
    .replace(/^custom-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom';
}

function cloneGuideTemplate(template) {
  return {
    ...template,
    page: { ...(template.page || {}) },
    columns: (template.columns || []).map((item) => ({ ...item })),
    rows: (template.rows || []).map((item) => ({ ...item })),
    logos: [...(template.logos || [])]
  };
}

function buildManagedGuideTemplate(row, baseTemplate) {
  const base = cloneGuideTemplate(baseTemplate || {
    family: 'standard',
    capacity: 4,
    variant: 'classic',
    page: { paperSize: 'A4', orientation: 'portrait', marginLeftIn: 1.38, marginRightIn: 0.71, marginTopIn: 0.2, marginBottomIn: 0.75 },
    columns: [
      { min: 1, max: 1, width: 22.66 },
      { min: 2, max: 2, width: 10.33 },
      { min: 3, max: 3, width: 21.16 },
      { min: 4, max: 4, width: 10 },
      { min: 5, max: 5, width: 8.33 },
      { min: 6, max: 7, width: 10.83 }
    ],
    rows: [
      { row: 1, height: 62 },
      { row: 2, height: 23 },
      { row: 3, height: 21 },
      { row: 4, height: 7 },
      { row: 5, height: 7 },
      { row: 6, height: 19 },
      { row: 7, height: 62 },
      { row: 8, height: 23 },
      { row: 9, height: 23 },
      { row: 10, height: 8 },
      { row: 11, height: 8 }
    ]
  });
  return {
    ...base,
    key: row.key,
    name: row.name,
    slug: guideTemplateSlug(row.key),
    family: 'standard',
    variant: base.variant || 'classic',
    capacity: Number(base.capacity || 4),
    logos: row.logo_url ? [row.logo_url] : [],
    managed: true,
    customManaged: Boolean(row.custom_layout)
  };
}

function mergeGuideTemplates(staticTemplates, managedTemplates) {
  const templates = (staticTemplates || []).map((template) => cloneGuideTemplate(template));
  const standardBase = templates.find((item) => item.key === 'standard-f-recalde')
    || templates.find((item) => item.family === 'standard')
    || null;
  const byKey = new Map(templates.map((template) => [template.key, template]));
  for (const row of managedTemplates || []) {
    if (!row?.key) continue;
    if (byKey.has(row.key)) {
      const existing = byKey.get(row.key);
      byKey.set(row.key, {
        ...existing,
        name: row.name || existing.name,
        logos: row.logo_url ? [row.logo_url] : existing.logos,
        managed: true,
        customManaged: Boolean(row.custom_layout)
      });
    } else {
      const custom = buildManagedGuideTemplate(row, standardBase);
      templates.push(custom);
      byKey.set(row.key, custom);
    }
  }
  return templates.map((template) => byKey.get(template.key));
}

function resizeGuideImage(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Selecciona una imagen valida'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('La imagen no puede superar 8 MB'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      image.onload = () => {
        const maxWidth = 1400;
        const maxHeight = 900;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.88));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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
  const [guideTemplates, setGuideTemplates] = useState([]);
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
      const [
        nextBootstrap,
        nextDashboard,
        nextClients,
        nextOrders,
        nextProduction,
        nextClientActivity,
        staticGuideTemplates,
        managedGuideTemplates
      ] = await Promise.all([
        api(scope('/producalza/bootstrap')),
        api(scope('/producalza/dashboard')),
        api(scope('/producalza/clients')),
        api(scope('/producalza/orders')),
        api(scope('/producalza/production')),
        isAdmin ? api(scope('/producalza/client-activity-report')) : Promise.resolve([]),
        fetch('/producalza/guides/templates.json').then((response) => response.ok ? response.json() : []),
        api(scope('/producalza/guide-templates'))
      ]);
      setBootstrap(nextBootstrap);
      setDashboard(nextDashboard);
      setClients(nextClients);
      setOrders(nextOrders);
      setProduction(nextProduction);
      setClientActivity(nextClientActivity);
      setUsers(nextBootstrap.users || []);
      setGuideTemplates(mergeGuideTemplates(staticGuideTemplates || [], managedGuideTemplates || []));
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
    const guideTemplateKey = resolveGuideTemplateKey(order, guideTemplates);
    if (type === 'guides' && !guideTemplateKey) {
      setError('Asigna un formato de guia al cliente o al pedido antes de imprimir.');
      return;
    }
    setPrintState({ order, type, modelId, guideTemplateKey });
  }

  useEffect(() => {
    if (!printState) return undefined;
    let cancelled = false;
    let fallbackTimer;
    const clearPrint = () => setPrintState(null);

    async function openPrintWhenReady() {
      await new Promise((resolve) => window.requestAnimationFrame(() =>
        window.requestAnimationFrame(resolve)
      ));
      if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => {});
      }
      const images = Array.from(document.querySelectorAll('.prod-print-root img'));
      await Promise.all(images.map((image) => {
        if (image.complete && image.naturalWidth > 0) {
          return image.decode?.().catch(() => {}) || Promise.resolve();
        }
        return new Promise((resolve) => {
          const finish = () => resolve();
          image.addEventListener('load', finish, { once: true });
          image.addEventListener('error', finish, { once: true });
          window.setTimeout(finish, 5000);
        });
      }));
      if (!cancelled) {
        fallbackTimer = window.setTimeout(() => window.print(), 120);
      }
    }

    window.addEventListener('afterprint', clearPrint, { once: true });
    openPrintWhenReady();
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('afterprint', clearPrint);
    };
  }, [printState]);

  const nav = [
    ['dashboard', 'Panel', Boxes],
    ['orders', 'Pedidos', ClipboardList],
    ['new-order', 'Crear pedido', FilePlus2],
    ['clients', 'Clientes', UsersRound],
    ['production', 'Produccion', Factory],
    ...(isAdmin ? [['reports', 'Reportes', BarChart3]] : []),
    ...(isAdmin ? [['guide-templates', 'Guias', Tags]] : []),
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
          guideTemplates={guideTemplates}
        />
      )}
      {view === 'order-detail' && selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          isAdmin={isAdmin}
          scope={scope}
          setError={setError}
          onBack={() => setView('orders')}
          onEdit={() => editOrder(selectedOrder.id)}
          onPrint={(type, modelId) => preparePrint(selectedOrder.id, type, modelId)}
          onUpdated={async () => {
            const updatedOrder = await api(scope(`/producalza/orders/${selectedOrder.id}`));
            setSelectedOrder(updatedOrder);
            await refresh('Estados del pedido actualizados');
          }}
          guideTemplates={guideTemplates}
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
          guideTemplates={guideTemplates}
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
      {view === 'guide-templates' && isAdmin && (
        <GuideTemplatesView
          templates={guideTemplates}
          scope={scope}
          onRefresh={refresh}
          setError={setError}
        />
      )}
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
      <PrintLayouts state={printState} guideTemplates={guideTemplates} />
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
  const followUpAlerts = data?.follow_up_alerts || [];
  const today = new Date().toISOString().slice(0, 10);
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
      {followUpAlerts.length > 0 && (
        <section className="prod-panel prod-followup-alerts">
          <div className="prod-panel-title">
            <div><span>Seguimientos</span><h2>Alertas proximas</h2></div>
            <strong>{followUpAlerts.length}</strong>
          </div>
          <div className="prod-followup-alert-list">
            {followUpAlerts.map((item) => {
              const isOverdue = item.next_visit_date < today;
              const isToday = item.next_visit_date === today;
              return (
                <article className={isOverdue ? 'overdue' : isToday ? 'today' : ''} key={item.id}>
                  <div>
                    <strong>{item.client_name}</strong>
                    <span>{item.city || 'Sin ciudad'} - {VISIT_TYPE_LABELS[item.next_visit_type] || VISIT_TYPE_LABELS[item.visit_type] || 'Seguimiento'}</span>
                  </div>
                  <div>
                    <b>{isOverdue ? 'Vencido' : isToday ? 'Hoy' : 'Manana'}</b>
                    <small>{displayDate(item.next_visit_date)}</small>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
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

function OrderForm({ clients, users, isAdmin, scope, initialOrder, onCancel, onSaved, setError, guideTemplates }) {
  const [form, setForm] = useState(() => initialOrder ? orderToForm(initialOrder) : emptyOrder());
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState(emptyClient);
  const [localClients, setLocalClients] = useState(clients);
  const [saving, setSaving] = useState(false);
  const initialClient = clients.find((client) => String(client.id) === String(initialOrder?.client_id));
  const [clientQuery, setClientQuery] = useState(initialClient?.name || initialOrder?.client_name || '');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  useEffect(() => {
    setForm(initialOrder ? orderToForm(initialOrder) : emptyOrder());
    const client = clients.find((item) => String(item.id) === String(initialOrder?.client_id));
    setClientQuery(client?.name || initialOrder?.client_name || '');
  }, [initialOrder]);

  const selectedClient = localClients.find((client) => String(client.id) === String(form.client_id));
  const clientSuggestions = (clientQuery.trim()
    ? localClients.filter((client) =>
      `${client.name} ${client.business_name || ''} ${client.city || ''} ${client.phone || ''}`
        .toLowerCase()
        .includes(clientQuery.toLowerCase())
    )
    : localClients).slice(0, 8);

  function selectClient(client) {
    setClientQuery(client.name);
    setShowClientSuggestions(false);
    setForm((current) => ({
      ...current,
      client_id: String(client.id),
      brand: current.brand || client.brand || '',
      payment_method: current.payment_method || client.payment_method || '',
      bank_reference: current.bank_reference || client.bank_reference || '',
      guide_template_key: current.guide_template_key
        || client.guide_template_key
        || inferGuideTemplate(client, guideTemplates)
    }));
  }

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
      selectClient(created);
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
          <div className="span-2 prod-client-picker">
            <label>
              Cliente
              <input
                value={clientQuery}
                placeholder="Escribe el nombre, ciudad o telefono"
                autoComplete="off"
                onFocus={() => setShowClientSuggestions(true)}
                onChange={(event) => {
                  setClientQuery(event.target.value);
                  setForm((current) => ({ ...current, client_id: '' }));
                  setShowClientSuggestions(true);
                }}
              />
            </label>
            {showClientSuggestions && (
              <div className="prod-client-suggestions">
                {clientSuggestions.map((client) => (
                  <button type="button" key={client.id} onClick={() => selectClient(client)}>
                    <strong>{client.name}</strong>
                    <span>{client.business_name || 'Sin razon social'} · {client.city || 'Sin ciudad'} · {client.phone || 'Sin telefono'}</span>
                  </button>
                ))}
                {!clientSuggestions.length && <div>Cliente no encontrado. Puedes crearlo con Nuevo cliente.</div>}
              </div>
            )}
          </div>
          <button className="prod-secondary-button align-end" type="button" onClick={() => setShowNewClient((value) => !value)}>
            <UserPlus size={17} />Nuevo cliente
          </button>
          {selectedClient && (
            <div className="span-full prod-selected-client">
              <div><span>Razon social</span><strong>{selectedClient.business_name || 'No registrada'}</strong></div>
              <div><span>RUC / Cedula</span><strong>{selectedClient.tax_id || 'No registrado'}</strong></div>
              <div><span>Ciudad</span><strong>{selectedClient.city || 'No registrada'}</strong></div>
              <div><span>Direccion</span><strong>{selectedClient.address || 'No registrada'}</strong></div>
              <div><span>Telefono</span><strong>{selectedClient.phone || 'No registrado'}</strong></div>
              <div><span>Correo</span><strong>{selectedClient.email || 'No registrado'}</strong></div>
            </div>
          )}
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
          <GuideTemplateSelect
            value={form.guide_template_key}
            templates={guideTemplates}
            onChange={(guide_template_key) => setForm({ ...form, guide_template_key })}
          />
          <label>Forma de pago<input value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} /></label>
          <label>Referencia bancaria<input value={form.bank_reference} onChange={(event) => setForm({ ...form, bank_reference: event.target.value })} /></label>
          <label className="span-full">Observaciones generales<textarea value={form.general_notes} onChange={(event) => setForm({ ...form, general_notes: event.target.value })} /></label>
        </div>
      </section>

      {showNewClient && (
        <section className="prod-panel prod-inline-client">
          <div className="prod-panel-title"><div><span>Registro rapido</span><h2>Nuevo cliente</h2></div></div>
          <ClientFields
            value={newClient}
            onChange={setNewClient}
            guideTemplates={guideTemplates}
            canEditGuideImage={isAdmin}
            setError={setError}
          />
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

function OrderDetail({ order, isAdmin, scope, setError, onBack, onEdit, onPrint, onUpdated, guideTemplates }) {
  const [sendingPdf, setSendingPdf] = useState(false);
  const [models, setModels] = useState(order.models);
  const [dirtyIds, setDirtyIds] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setModels(order.models);
    setDirtyIds([]);
  }, [order]);

  function deriveStatus(model) {
    if (model.process_finished) return 'finished';
    if (model.process_planted || model.process_assembled) return 'assembled';
    if (model.process_stitched) return 'stitched';
    if (model.process_cut) return 'cut';
    if (model.process_prepared) return 'in_production';
    return 'received';
  }

  function stageModel(modelId, patch, explicitStatus = false) {
    setModels((current) => current.map((model) => {
      if (model.id !== modelId) return model;
      const merged = { ...model, ...patch };
      return explicitStatus ? merged : { ...merged, status: deriveStatus(merged) };
    }));
    setDirtyIds((current) => current.includes(modelId) ? current : [...current, modelId]);
  }

  function stageEntireOrder(status) {
    const processPatch = processStateForStatus(status);
    setModels((current) => current.map((model) => ({ ...model, ...processPatch, status })));
    setDirtyIds(models.map((model) => model.id));
  }

  async function saveModelStates() {
    if (!dirtyIds.length) return;
    setSaving(true);
    try {
      await api(scope('/producalza/models-batch'), {
        method: 'PATCH',
        body: JSON.stringify({
          updates: models
            .filter((model) => dirtyIds.includes(model.id))
            .map((model) => ({
              id: model.id,
              status: model.status,
              card_number: model.card_number,
              plant_area: model.plant_area,
              process_cut: model.process_cut,
              process_prepared: model.process_prepared,
              process_stitched: model.process_stitched,
              process_assembled: model.process_assembled,
              process_planted: model.process_planted,
              process_finished: model.process_finished
            }))
        })
      });
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendOrderToClient() {
    const phone = whatsappNumber(order.phone);
    if (!phone) {
      setError('Este cliente no tiene un numero de WhatsApp registrado.');
      return;
    }
    const today = new Date().toLocaleDateString('es-EC', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const message = `Buenas tardes, estimado/estimada ${order.client_name}. Le envio el pedido realizado en fecha ${today}. Por favor, revise el documento adjunto. Muchas gracias.`;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    const isMobile = window.matchMedia('(max-width: 620px)').matches;
    const whatsappWindow = isMobile ? null : window.open('', '_blank');
    if (!isMobile && whatsappWindow) {
      whatsappWindow.opener = null;
      whatsappWindow.location.href = whatsappUrl;
    }
    try {
      setSendingPdf(true);
      await downloadApiFile(
        scope(`/producalza/orders/${order.id}/pdf`),
        `Pedido Producalza ${safeFilename(order.client_name)}.pdf`
      );
      if (isMobile || !whatsappWindow) {
        window.location.assign(whatsappUrl);
      }
    } catch (error) {
      whatsappWindow?.close();
      setError(error.message);
    } finally {
      setSendingPdf(false);
    }
  }

  return (
    <div className="prod-stack">
      <button
        className="prod-primary-button whatsapp prod-mobile-whatsapp-action"
        disabled={sendingPdf}
        onClick={sendOrderToClient}
      >
        {sendingPdf ? <FileDown size={19} /> : <MessageCircle size={19} />}
        <span>
          <strong>{sendingPdf ? 'Descargando PDF...' : 'Enviar pedido por WhatsApp'}</strong>
          {!sendingPdf && <small>Descarga el PDF y abre el chat del cliente</small>}
        </span>
      </button>
      <div className="prod-detail-actions">
        <button className="prod-secondary-button" onClick={onBack}><ChevronLeft size={17} />Volver</button>
        <div>
          <button className="prod-secondary-button" onClick={onEdit}><Pencil size={17} />Editar</button>
          <button className="prod-primary-button" onClick={() => onPrint('sheets')}><Printer size={17} />Hoja unica del pedido</button>
          <button className="prod-primary-button whatsapp prod-desktop-whatsapp-action" disabled={sendingPdf} onClick={sendOrderToClient}>
            {sendingPdf ? <FileDown size={17} /> : <MessageCircle size={17} />}
            {sendingPdf ? 'Descargando PDF...' : 'Enviar pedido por WhatsApp'}
          </button>
          <button className="prod-primary-button dark" onClick={() => onPrint('cards')}><Printer size={17} />Tarjetas</button>
          <button className="prod-primary-button guide" onClick={() => onPrint('guides')}><Tags size={17} />Guias para cajas</button>
          {isAdmin && dirtyIds.length > 0 && (
            <button className="prod-primary-button prod-save-order-status" disabled={saving} onClick={saveModelStates}>
              <Save size={17} />Guardar estados ({dirtyIds.length})
            </button>
          )}
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
          {isAdmin && (
            <label className="prod-order-status-control">
              Cambiar todo el pedido
              <select value="" onChange={(event) => event.target.value && stageEntireOrder(event.target.value)}>
                <option value="">Seleccionar estado</option>
                {Object.entries(MODEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          )}
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
          <Detail
            label="Formato de guias"
            value={guideTemplates.find((item) => item.key === resolveGuideTemplateKey(order, guideTemplates))?.name}
          />
          <Detail label="Forma de pago" value={order.payment_method} />
        </div>
        {order.general_notes && <div className="prod-note"><strong>Observaciones</strong><p>{order.general_notes}</p></div>}
      </section>
      <div className="prod-model-stack">
        {models.map((model) => (
          <section className={`prod-panel prod-detail-model ${dirtyIds.includes(model.id) ? 'pending-save' : ''}`} key={model.id}>
            <div className="prod-panel-title">
              <div><span>Tarjeta Nro. {model.card_number}</span><h2>{model.model_code}</h2></div>
              <div className="prod-detail-model-actions">
                {isAdmin ? (
                  <select
                    className="prod-inline-status-select"
                    value={model.status}
                    onChange={(event) => {
                      const status = event.target.value;
                      stageModel(model.id, { ...processStateForStatus(status), status }, true);
                    }}
                  >
                    {Object.entries(MODEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                ) : <StatusBadge status={model.status} model />}
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
            <ProcessStrip
              model={model}
              readOnly={!isAdmin}
              onChange={(field, value) => stageModel(model.id, { [field]: value })}
            />
            {dirtyIds.includes(model.id) && <div className="prod-pending-label">Cambios pendientes de guardar</div>}
            {model.notes && <div className="prod-note"><strong>Observaciones</strong><p>{model.notes}</p></div>}
          </section>
        ))}
      </div>
    </div>
  );
}

function ClientsView({ clients, isAdmin, users, scope, onOpenOrder, onRefresh, setError, guideTemplates }) {
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
      next_visit_type: item.next_visit_type || 'follow_up',
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

  async function edit(client) {
    try {
      const fullClient = client.guide_logo_url !== undefined
        ? client
        : await api(scope(`/producalza/clients/${client.id}`));
      setEditingId(fullClient.id);
      setForm({
        ...Object.fromEntries(Object.keys(emptyClient).map((key) => [key, fullClient[key] || ''])),
        guide_template_key: fullClient.guide_template_key
          || inferGuideTemplate(fullClient, guideTemplates)
      });
      setShowClientForm(true);
    } catch (err) {
      setError(err.message);
    }
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
            <ClientFields
              value={form}
              onChange={setForm}
              guideTemplates={guideTemplates}
              canEditGuideImage={isAdmin}
              setError={setError}
            />
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
          <GuideBrandPreview
            value={selected.guide_logo_url}
            templateKey={selected.guide_template_key || inferGuideTemplate(selected, guideTemplates)}
            templates={guideTemplates}
            title="Imagen que se imprimira en las guias"
          />
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
              <label>Tipo de proximo seguimiento
                <select value={visit.next_visit_type} onChange={(event) => setVisit({ ...visit, next_visit_type: event.target.value })}>
                  {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
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
                      {item.next_visit_date && <span>Proxima: {displayDate(item.next_visit_date)} - {VISIT_TYPE_LABELS[item.next_visit_type] || 'Seguimiento'}</span>}
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
              <ClientGuideThumbnail client={client} templates={guideTemplates} />
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
          <ClientFields
            value={form}
            onChange={setForm}
            guideTemplates={guideTemplates}
            canEditGuideImage={isAdmin}
            setError={setError}
          />
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
  const [search, setSearch] = useState('');
  const [processFilter, setProcessFilter] = useState('');
  const [draftItems, setDraftItems] = useState(items);
  const [dirtyIds, setDirtyIds] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftItems(items);
    setDirtyIds([]);
  }, [items]);

  function deriveStatus(item) {
    if (item.process_finished) return 'finished';
    if (item.process_planted || item.process_assembled) return 'assembled';
    if (item.process_stitched) return 'stitched';
    if (item.process_cut) return 'cut';
    if (item.process_prepared) return 'in_production';
    return 'received';
  }

  function stageUpdate(item, patch) {
    setDraftItems((current) => current.map((currentItem) => {
      if (currentItem.id !== item.id) return currentItem;
      const merged = { ...currentItem, ...patch };
      return { ...merged, status: patch.status || deriveStatus(merged) };
    }));
    setDirtyIds((current) => current.includes(item.id) ? current : [...current, item.id]);
  }

  async function saveUpdates() {
    if (!dirtyIds.length) return;
    setSaving(true);
    try {
      await api(scope('/producalza/models-batch'), {
        method: 'PATCH',
        body: JSON.stringify({
          updates: draftItems
            .filter((item) => dirtyIds.includes(item.id))
            .map((item) => ({
              id: item.id,
              status: item.status,
              card_number: item.card_number,
              plant_area: item.plant_area,
              process_cut: item.process_cut,
              process_prepared: item.process_prepared,
              process_stitched: item.process_stitched,
              process_assembled: item.process_assembled,
              process_planted: item.process_planted,
              process_finished: item.process_finished
            }))
        })
      });
      await onRefresh(`${dirtyIds.length} avances actualizados`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const processField = PROCESS_FIELDS.find(([, , label]) => label === processFilter)?.[0];
  const filtered = draftItems.filter((item) => {
    const matchesStatus = !status || item.status === status;
    const matchesSearch = !search || `${item.order_number} ${item.client_name} ${item.model_code}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesProcess = !processField || Boolean(item[processField]);
    return matchesStatus && matchesSearch && matchesProcess;
  });
  const grouped = Object.values(filtered.reduce((orders, item) => {
    const key = item.order_id;
    if (!orders[key]) {
      orders[key] = {
        order_id: item.order_id,
        order_number: item.order_number,
        client_name: item.client_name,
        city: item.city,
        order_date: item.order_date,
        items: []
      };
    }
    orders[key].items.push(item);
    return orders;
  }, {}));

  return (
    <div className="prod-stack">
      <section className="prod-filterbar">
        <label className="prod-search">
          <Search size={17} />
          <input
            placeholder="Pedido, cliente o modelo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(MODEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <select value={processFilter} onChange={(event) => setProcessFilter(event.target.value)}>
          <option value="">Todas las etapas marcadas</option>
          {PROCESS_FIELDS.map(([, , label]) => <option value={label} key={label}>{label}</option>)}
        </select>
        <span className="prod-filter-count">{grouped.length} pedidos · {filtered.length} modelos</span>
        {isAdmin && dirtyIds.length > 0 && (
          <button className="prod-primary-button prod-save-progress" disabled={saving} onClick={saveUpdates}>
            <Save size={17} />
            Guardar avances ({dirtyIds.length})
          </button>
        )}
      </section>
      <div className="prod-production-orders">
        {grouped.map((order) => (
          <section className="prod-production-order" key={order.order_id}>
            <header>
              <div>
                <span>{order.order_number} · {displayDate(order.order_date)}</span>
                <h2>{order.client_name}</h2>
                <small>{order.city || 'Sin ciudad'} · {order.items.length} modelos · {order.items.reduce((sum, item) => sum + Number(item.total_pairs || 0), 0)} pares</small>
              </div>
              <div>
                <button className="prod-secondary-button" onClick={() => onOpen(order.order_id)}>Ver pedido</button>
                <button className="prod-icon-button" title="Imprimir tarjetas" onClick={() => onPrint(order.order_id, 'cards')}><Printer size={17} /></button>
              </div>
            </header>
            <div className="prod-production-grid">
              {order.items.map((item) => (
                <article className={`prod-production-card ${dirtyIds.includes(item.id) ? 'pending-save' : ''}`} key={item.id}>
                  <div className="prod-production-head">
                    <div><span>Tarjeta {item.card_number}</span><h3>{item.model_code}</h3><p>{item.color || 'Sin color'}</p></div>
                    <StatusBadge status={item.status} model />
                  </div>
                  <div className="prod-production-meta">
                    <span>{item.material || 'Sin material'}</span>
                    <strong>{item.total_pairs} pares</strong>
                  </div>
                  {isAdmin ? (
                    <>
                      <ProcessStrip model={item} onChange={(field, value) => stageUpdate(item, { [field]: value })} />
                      <label className="prod-card-number">Tarjeta Nro.
                        <input type="number" value={item.card_number || ''} onChange={(event) => stageUpdate(item, { card_number: event.target.value })} />
                      </label>
                    </>
                  ) : <ProcessStrip model={item} readOnly />}
                  <div className="prod-card-actions">
                    <span>{dirtyIds.includes(item.id) ? 'Cambio pendiente de guardar' : 'Actualizado'}</span>
                    <button className="prod-icon-button" title="Imprimir tarjeta" onClick={() => onPrint(item.order_id, 'card', item.id)}><Printer size={17} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {!grouped.length && <div className="prod-empty">No hay pedidos que coincidan con estos filtros.</div>}
      </div>
    </div>
  );
}

function GuideTemplatesView({ templates, scope, onRefresh, setError }) {
  const [form, setForm] = useState(emptyGuideTemplate);
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedLogo, setSelectedLogo] = useState('');
  const selectedTemplate = templates.find((template) => template.key === selectedKey) || templates[0];

  useEffect(() => {
    if (!selectedKey && templates.length) {
      setSelectedKey(templates[0].key);
    }
  }, [templates, selectedKey]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setSelectedLogo(selectedTemplate.managed ? selectedTemplate.logos?.[0] || '' : '');
  }, [selectedTemplate?.key]);

  async function imageFromFile(file, next) {
    if (!file) return;
    try {
      next(await resizeGuideImage(file));
    } catch (error) {
      setError(error.message);
    }
  }

  async function createTemplate() {
    try {
      await api(scope('/producalza/guide-templates'), {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(emptyGuideTemplate);
      await onRefresh('Formato de guia creado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateTemplate() {
    if (!selectedTemplate) return;
    try {
      await api(scope(`/producalza/guide-templates/${encodeURIComponent(selectedTemplate.key)}`), {
        method: 'PUT',
        body: JSON.stringify({
          name: selectedTemplate.name,
          logo_url: selectedLogo
        })
      });
      await onRefresh('Imagen de guia actualizada');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="prod-guide-admin-layout">
      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Nuevo formato</span><h2>Crear guia para cliente</h2></div>
        </div>
        <div className="prod-form-grid single">
          <label>Nombre del cliente<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <GuideBrandPreview value={form.logo_url} templateKey="" templates={[]} title="Logo del nuevo formato" />
          <div className="prod-guide-image-actions">
            <label className="prod-secondary-button">
              <Upload size={17} />
              Cargar logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  imageFromFile(event.target.files?.[0], (logo_url) => setForm((current) => ({ ...current, logo_url })));
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <div className="prod-form-actions">
          <button className="prod-primary-button" disabled={!form.name.trim() || !form.logo_url} onClick={createTemplate}>
            <Save size={17} />
            Crear formato
          </button>
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Formatos existentes</span><h2>Editar foto de guia</h2></div>
        </div>
        <div className="prod-form-grid single">
          <label>Formato
            <select value={selectedTemplate?.key || ''} onChange={(event) => setSelectedKey(event.target.value)}>
              {templates.map((template) => (
                <option value={template.key} key={template.key}>
                  {template.customManaged ? 'Nuevo - ' : ''}{template.name}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate && (
            <>
              <GuideBrandPreview
                value={selectedLogo}
                templateKey={selectedTemplate.key}
                templates={templates}
                title="Foto actual para imprimir"
              />
              <div className="prod-guide-image-actions">
                <label className="prod-secondary-button">
                  <Upload size={17} />
                  Reemplazar foto
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      imageFromFile(event.target.files?.[0], setSelectedLogo);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
        <div className="prod-form-actions">
          <button className="prod-primary-button" disabled={!selectedTemplate || !selectedLogo} onClick={updateTemplate}>
            <Save size={17} />
            Guardar foto
          </button>
        </div>
      </section>
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
  const emptyReportFilters = {
    client: '',
    city: '',
    visits_min: '',
    visits_max: '',
    orders_min: '',
    orders_max: '',
    pairs_min: '',
    pairs_max: '',
    last_from: '',
    last_to: '',
    next_from: '',
    next_to: '',
    next_status: 'all'
  };
  const [reportFilters, setReportFilters] = useState(emptyReportFilters);
  const byStatus = Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => ({
    key,
    label,
    count: orders.filter((order) => order.status === key).length,
    pairs: orders.filter((order) => order.status === key).reduce((sum, order) => sum + Number(order.total_pairs || 0), 0)
  }));
  const totalPairs = orders.reduce((sum, order) => sum + Number(order.total_pairs || 0), 0);
  const cities = [...new Set((clientActivity || []).map((client) => client.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const filteredClients = (clientActivity || []).filter((client) => {
    const matchesText = `${client.name || ''} ${client.business_name || ''} ${client.phone || ''}`
      .toLowerCase()
      .includes(reportFilters.client.toLowerCase());
    const matchesCity = !reportFilters.city || client.city === reportFilters.city;
    const inNumberRange = (value, min, max) =>
      (min === '' || Number(value || 0) >= Number(min)) &&
      (max === '' || Number(value || 0) <= Number(max));
    const inDateRange = (value, from, to) =>
      (!from || (value && value.slice(0, 10) >= from)) &&
      (!to || (value && value.slice(0, 10) <= to));
    const matchesNextStatus =
      reportFilters.next_status === 'all' ||
      (reportFilters.next_status === 'scheduled' && client.next_visit) ||
      (reportFilters.next_status === 'unscheduled' && !client.next_visit);
    return matchesText &&
      matchesCity &&
      inNumberRange(client.visit_count, reportFilters.visits_min, reportFilters.visits_max) &&
      inNumberRange(client.order_count, reportFilters.orders_min, reportFilters.orders_max) &&
      inNumberRange(client.total_pairs, reportFilters.pairs_min, reportFilters.pairs_max) &&
      inDateRange(client.last_activity, reportFilters.last_from, reportFilters.last_to) &&
      inDateRange(client.next_visit, reportFilters.next_from, reportFilters.next_to) &&
      matchesNextStatus;
  });
  const updateReportFilter = (key, value) => setReportFilters((current) => ({ ...current, [key]: value }));
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
          <strong className="prod-report-result-count">{filteredClients.length} de {(clientActivity || []).length} clientes</strong>
        </div>
        <div className="prod-client-report-filters">
          <label className="prod-search">
            <Search size={16} />
            <input
              placeholder="Cliente, razon social o telefono"
              value={reportFilters.client}
              onChange={(event) => updateReportFilter('client', event.target.value)}
            />
          </label>
          <label>Ciudad
            <select value={reportFilters.city} onChange={(event) => updateReportFilter('city', event.target.value)}>
              <option value="">Todas</option>
              {cities.map((city) => <option value={city} key={city}>{city}</option>)}
            </select>
          </label>
          <ReportNumberRange
            label="Visitas"
            min={reportFilters.visits_min}
            max={reportFilters.visits_max}
            onMin={(value) => updateReportFilter('visits_min', value)}
            onMax={(value) => updateReportFilter('visits_max', value)}
          />
          <ReportNumberRange
            label="Pedidos"
            min={reportFilters.orders_min}
            max={reportFilters.orders_max}
            onMin={(value) => updateReportFilter('orders_min', value)}
            onMax={(value) => updateReportFilter('orders_max', value)}
          />
          <ReportNumberRange
            label="Pares"
            min={reportFilters.pairs_min}
            max={reportFilters.pairs_max}
            onMin={(value) => updateReportFilter('pairs_min', value)}
            onMax={(value) => updateReportFilter('pairs_max', value)}
          />
          <ReportDateRange
            label="Ultima actividad"
            from={reportFilters.last_from}
            to={reportFilters.last_to}
            onFrom={(value) => updateReportFilter('last_from', value)}
            onTo={(value) => updateReportFilter('last_to', value)}
          />
          <ReportDateRange
            label="Proxima visita"
            from={reportFilters.next_from}
            to={reportFilters.next_to}
            onFrom={(value) => updateReportFilter('next_from', value)}
            onTo={(value) => updateReportFilter('next_to', value)}
          />
          <label>Agenda
            <select value={reportFilters.next_status} onChange={(event) => updateReportFilter('next_status', event.target.value)}>
              <option value="all">Con y sin proxima visita</option>
              <option value="scheduled">Solo agendados</option>
              <option value="unscheduled">Sin proxima visita</option>
            </select>
          </label>
          <button className="prod-secondary-button prod-clear-report" onClick={() => setReportFilters(emptyReportFilters)}>
            <X size={16} />
            Limpiar filtros
          </button>
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead>
              <tr><th>Cliente</th><th>Ciudad</th><th>Visitas</th><th>Pedidos</th><th>Pares</th><th>Ultima actividad</th><th>Proxima visita</th></tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
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
          {!filteredClients.length && <div className="prod-empty">No hay clientes que coincidan con estos filtros.</div>}
        </div>
      </section>
    </div>
  );
}

function ReportNumberRange({ label, min, max, onMin, onMax }) {
  return (
    <fieldset className="prod-report-range">
      <legend>{label}</legend>
      <input type="number" min="0" placeholder="Min." value={min} onChange={(event) => onMin(event.target.value)} />
      <span>a</span>
      <input type="number" min="0" placeholder="Max." value={max} onChange={(event) => onMax(event.target.value)} />
    </fieldset>
  );
}

function ReportDateRange({ label, from, to, onFrom, onTo }) {
  return (
    <fieldset className="prod-report-range date">
      <legend>{label}</legend>
      <input type="date" value={from} onChange={(event) => onFrom(event.target.value)} />
      <span>a</span>
      <input type="date" value={to} onChange={(event) => onTo(event.target.value)} />
    </fieldset>
  );
}

function GuideTemplateSelect({ value, templates, onChange }) {
  const standard = templates.filter((item) => item.family === 'standard');
  const special = templates.filter((item) => item.family === 'special');
  return (
    <label>
      Formato de guias
      <select value={value || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sin asignar</option>
        {standard.length > 0 && (
          <optgroup label="Formatos normales">
            {standard.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}
          </optgroup>
        )}
        {special.length > 0 && (
          <optgroup label="Formatos especiales">
            {special.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function ClientGuideThumbnail({ client, templates }) {
  const templateKey = client.guide_template_key || inferGuideTemplate(client, templates);
  const template = templates.find((item) => item.key === templateKey);
  const image = template?.logos?.[0];
  return (
    <div
      className={`prod-client-guide-thumb ${client.has_guide_logo ? 'custom' : ''}`}
      title={client.has_guide_logo
        ? 'Este cliente tiene una imagen personalizada'
        : template
          ? `Formato sugerido: ${template.name}`
          : 'Sin formato de guia enlazado'}
    >
      {image ? <img src={image} alt="" /> : <ImageIcon size={20} />}
      {client.has_guide_logo ? <i>Personalizada</i> : template ? <i>{template.name}</i> : <i>Sin foto</i>}
    </div>
  );
}

function GuideBrandPreview({ value, templateKey, templates, title = 'Vista previa' }) {
  const template = templates.find((item) => item.key === templateKey);
  const images = value ? [value] : (template?.logos || []);
  return (
    <div className="prod-guide-image-preview">
      <div>
        <ImageIcon size={19} />
        <span>{title}</span>
        <strong>{value ? 'Imagen personalizada' : template?.name || 'Sin formato asignado'}</strong>
      </div>
      <div className="prod-guide-image-gallery">
        {images.map((image, index) => (
          <figure key={`${image.slice(0, 80)}-${index}`}>
            <img src={image} alt={`Imagen de guia ${index + 1}`} />
          </figure>
        ))}
        {!images.length && <p>Selecciona un formato o carga una imagen para verla aqui.</p>}
      </div>
    </div>
  );
}

function GuideImageEditor({ value, templateKey, templates, onChange, setError, canEdit }) {
  async function selectImage(file) {
    if (!file) return;
    try {
      onChange(await resizeGuideImage(file));
    } catch (error) {
      setError?.(error.message);
    }
  }

  return (
    <div className="span-full prod-guide-image-editor">
      <GuideBrandPreview
        value={value}
        templateKey={templateKey}
        templates={templates}
        title="Logo o foto para las guias"
      />
      {canEdit && (
        <div className="prod-guide-image-actions">
          <label className="prod-secondary-button">
            <Upload size={17} />
            {value ? 'Reemplazar imagen' : 'Cargar desde dispositivo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                selectImage(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {value && (
            <button type="button" className="prod-secondary-button danger" onClick={() => onChange('')}>
              <Trash2 size={17} />
              Quitar y usar original
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ClientFields({
  value,
  onChange,
  guideTemplates = [],
  canEditGuideImage = false,
  setError
}) {
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
      <GuideTemplateSelect
        value={value.guide_template_key}
        templates={guideTemplates}
        onChange={(guide_template_key) => update('guide_template_key', guide_template_key)}
      />
      <GuideImageEditor
        value={value.guide_logo_url}
        templateKey={value.guide_template_key}
        templates={guideTemplates}
        onChange={(guide_logo_url) => update('guide_logo_url', guide_logo_url)}
        setError={setError}
        canEdit={canEditGuideImage}
      />
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
    guide_template_key: order.guide_template_key || order.client_guide_template_key || '',
    general_notes: order.general_notes || '',
    status: order.status,
    models: order.models.map((model) => ({
      ...model,
      sizes: Object.fromEntries(SIZES.map((size) => [size, Number(model.sizes?.[size] || 0)]))
    }))
  };
}

function excelColumnWidthMm(width) {
  const pixels = width < 1 ? Math.floor(width * 12 + 0.5) : Math.floor(width * 7 + 5);
  return pixels * 25.4 / 96;
}

function expandTemplateColumns(template) {
  const columns = {};
  for (const item of template?.columns || []) {
    for (let column = Number(item.min); column <= Math.min(Number(item.max), 7); column += 1) {
      columns[column] = excelColumnWidthMm(Number(item.width));
    }
  }
  return columns;
}

function templateRowMm(template, row) {
  const item = template?.rows?.find((entry) => Number(entry.row) === row);
  return Number(item?.height || 15) * 25.4 / 72;
}

function sumTemplateRows(template, from, to) {
  let total = 0;
  for (let row = from; row <= to; row += 1) total += templateRowMm(template, row);
  return total;
}

function guideSlots(template) {
  const columns = expandTemplateColumns(template);
  if (template.family === 'standard') {
    const wide = template.variant === 'wide';
    const firstWidth = wide
      ? (columns[1] || 0) + (columns[2] || 0) + (columns[3] || 0)
      : (columns[1] || 0) + (columns[2] || 0);
    const secondLeft = wide
      ? firstWidth + (columns[4] || 0)
      : firstWidth;
    const secondWidth = wide
      ? (columns[5] || 0) + (columns[6] || 0) + (columns[7] || 0)
      : (columns[3] || 0) + (columns[4] || 0);
    const topHeight = sumTemplateRows(template, 1, 5);
    const bottomTop = sumTemplateRows(template, 1, 6);
    const bottomHeight = sumTemplateRows(template, 7, 11);
    return [
      { left: 0, top: 0, width: firstWidth, height: topHeight },
      { left: secondLeft, top: 0, width: secondWidth, height: topHeight },
      { left: 0, top: bottomTop, width: firstWidth, height: bottomHeight },
      { left: secondLeft, top: bottomTop, width: secondWidth, height: bottomHeight }
    ];
  }

  const firstRow = template.slug === 'f-guaman' ? 2 : 1;
  const contentWidth = Object.values(columns).reduce((sum, width) => sum + width, 0);
  const topOffset = template.slug === 'f-guaman' ? templateRowMm(template, 1) : 0;
  const labelHeight = sumTemplateRows(template, firstRow, firstRow + 2);
  const gap = templateRowMm(template, firstRow + 3);
  return Array.from({ length: template.capacity }, (_, index) => ({
    left: 0,
    top: topOffset + index * (labelHeight + gap),
    width: contentWidth,
    height: labelHeight
  }));
}

function expandOrderGuides(order) {
  const guides = [];
  for (const model of order.models || []) {
    for (const size of SIZES) {
      const quantity = Math.max(0, Number(model.sizes?.[size] || 0));
      for (let copy = 0; copy < quantity; copy += 1) {
        guides.push({ model, size, copy });
      }
    }
  }
  return guides;
}

function PrintLayouts({ state, guideTemplates }) {
  if (!state?.order) return null;
  const { order, type, modelId, guideTemplateKey } = state;
  const models = modelId ? order.models.filter((model) => model.id === modelId) : order.models;
  const guideTemplate = guideTemplates.find((item) => item.key === guideTemplateKey);
  const guides = expandOrderGuides(order);
  const guidePages = [];
  if (guideTemplate) {
    for (let index = 0; index < guides.length; index += guideTemplate.capacity) {
      guidePages.push(guides.slice(index, index + guideTemplate.capacity));
    }
  }
  const cardPages = [];
  for (let index = 0; index < models.length; index += 2) {
    cardPages.push(models.slice(index, index + 2));
  }
  return (
    <div className={`prod-print-root ${
      type === 'sheets' ? 'print-order' : type === 'guides' ? 'print-guides' : 'print-cards'
    }`}>
      {type === 'sheets' && <ProductionOrderSheet order={order} />}
      {(type === 'cards' || type === 'card') && cardPages.map((pageModels, pageIndex) => (
        <article className="prod-print-card-page" key={`card-page-${pageIndex}`}>
          {pageModels.map((model) => <ProductionCard order={order} model={model} key={`card-${model.id}`} />)}
        </article>
      ))}
      {type === 'guides' && guideTemplate && guidePages.map((pageGuides, pageIndex) => (
        <GuidePrintPage
          guides={pageGuides}
          order={order}
          template={guideTemplate}
          key={`guide-page-${pageIndex}`}
        />
      ))}
    </div>
  );
}

function GuidePrintPage({ guides, order, template }) {
  const slots = guideSlots(template);
  return (
    <article
      className={`prod-guide-page guide-${template.family} guide-${template.variant}`}
      style={{
        '--guide-page-left': `${Number(template.page?.marginLeftIn || 0) * 25.4}mm`,
        '--guide-page-top': `${Number(template.page?.marginTopIn || 0) * 25.4}mm`
      }}
    >
      {slots.map((slot, index) => (
        <div
          className="prod-guide-slot"
          key={index}
          style={{
            left: `${slot.left}mm`,
            top: `${slot.top}mm`,
            width: `${slot.width}mm`,
            height: `${slot.height}mm`
          }}
        >
          {guides[index] && (
            <GuideLabel guide={guides[index]} order={order} template={template} />
          )}
        </div>
      ))}
    </article>
  );
}

function GuideLabel({ guide, order, template }) {
  const { model, size } = guide;
  const customLogo = order.client_guide_logo_url || '';
  const logos = customLogo ? [customLogo] : (template.logos || []);
  const description = [model.material, model.color]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' ');
  if (template.family === 'special') {
    return (
      <div className={`prod-guide-label special template-${template.slug}`}>
        <div className={`prod-guide-special-logos ${customLogo ? 'custom-logo' : ''}`}>
          {template.slug === 'bruma' && <span>FABRICADO POR:</span>}
          {logos.map((logo, index) => (
            <img src={logo} alt="" key={logo} className={`logo-${index + 1}`} />
          ))}
        </div>
        <div className="prod-guide-special-data">
          <strong>{model.model_code}</strong>
          <span>{description || order.brand || ''}</span>
          <small>BY PRODUCALZA</small>
        </div>
        <div className="prod-guide-special-size">
          <strong>{size}</strong>
          <small>MADE IN ECUADOR</small>
        </div>
      </div>
    );
  }
  return (
    <div className={`prod-guide-label standard template-${template.slug}`}>
      <div className="prod-guide-logo">
        {logos[0]
          ? <img src={logos[0]} alt="" />
          : <strong>{order.brand || order.client_name || template.name}</strong>}
      </div>
      <div className="prod-guide-model">
        <strong>{model.model_code}</strong>
        <span>{description}</span>
      </div>
      <div className="prod-guide-size"><strong>{size}</strong></div>
      <div className="prod-guide-origin"><span>MADE IN EC</span><strong>BY PRODUCALZA</strong></div>
    </div>
  );
}

function ProductionOrderSheet({ order }) {
  const totalPairs = order.models.reduce((sum, model) => sum + Number(model.total_pairs || 0), 0);
  return (
    <article
      className={`prod-print-page ${order.models.length > 8 ? 'dense' : ''}`}
      style={{ '--order-model-count': Math.max(order.models.length, 1) }}
    >
      <header><div><strong>PRODUCALZA</strong><span>HOJA UNICA DE PEDIDO Y PRODUCCION</span></div><b>{order.order_number}</b></header>
      <section className="prod-print-info">
        <div><span>Cliente</span><strong>{order.client_name}</strong></div>
        <div><span>Fecha</span><strong>{displayDate(order.order_date)}</strong></div>
        <div><span>Marca</span><strong>{order.brand || '-'}</strong></div>
        <div><span>Ciudad</span><strong>{order.city || 'Sin ciudad'}</strong></div>
      </section>
      <div className="prod-print-process-legend">
        {PROCESS_FIELDS.map(([, letter, label]) => <span key={label}><strong>{letter}</strong> {label}</span>)}
      </div>
      <table className="prod-print-order-table">
        <colgroup>
          <col className="prod-col-card" />
          <col className="prod-col-model" />
          <col className="prod-col-description" />
          {SIZES.map((size) => <col className="prod-col-size" key={`col-${size}`} />)}
          <col className="prod-col-total" />
          {PROCESS_FIELDS.map(([, , label]) => <col className="prod-col-process" key={`col-${label}`} />)}
          <col className="prod-col-notes" />
        </colgroup>
        <thead>
          <tr>
            <th>Tarj.</th><th>Modelo</th><th>Color / Material</th>
            {SIZES.map((size) => <th key={size}>{size}</th>)}
            <th>Total</th>
            {PROCESS_FIELDS.map(([, letter, label]) => <th title={label} key={label}>{letter}</th>)}
            <th>Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {order.models.map((model) => (
            <tr key={model.id}>
              <td>{model.card_number}</td>
              <td><strong>{model.model_code}</strong></td>
              <td>{model.color || '-'}<br /><small>{model.material || '-'}</small></td>
              {SIZES.map((size) => <td key={size}>{model.sizes?.[size] || ''}</td>)}
              <td><strong>{model.total_pairs}</strong></td>
              {PROCESS_FIELDS.map(([field, , label]) => <td key={label}>{model[field] ? 'X' : ''}</td>)}
              <td>{model.notes || ''}</td>
            </tr>
          ))}
          <tr className="prod-print-total-row">
            <td colSpan="13"><strong>TOTAL DEL PEDIDO</strong></td>
            <td><strong>{totalPairs}</strong></td>
            <td colSpan="7" />
          </tr>
        </tbody>
      </table>
      <section className="prod-print-notes"><span>Observaciones generales</span><p>{order.general_notes || ''}</p></section>
      <footer><span>Revisado por: __________________________</span><span>Firma cliente: __________________________</span></footer>
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
