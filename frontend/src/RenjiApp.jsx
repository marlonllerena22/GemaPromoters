import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy, Edit3, PackagePlus, Printer, Shirt, Trash2, Truck, WalletCards } from 'lucide-react';
import { api, clearToken } from './api.js';
import './renji-catalog.css';

const today = new Date().toISOString().slice(0, 10);
const sizes = ['S', 'M', 'L', 'XL'];
const itemLabels = {
  hoodie: 'Hoodie',
  pants: 'Pantalon'
};
const selectionLabels = {
  set: 'Conjunto',
  hoodie: 'Solo hoodie',
  pants: 'Solo pantalon'
};

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function renjiItemDetail(order) {
  const catalogItems = order.catalog_items?.length
    ? order.catalog_items
    : [...(order.stock_items || []), ...(order.production_items || [])];
  if (catalogItems.length > 1 || catalogItems.some((item) => item.product_name || item.color)) {
    return catalogItems.map((item, index) =>
      `${index + 1}. ${item.product_name || 'Pantalon baggy'} - ${item.color || ''} - Talla ${item.size}`
    ).join(' / ');
  }
  const hoodieSize = order.hoodie_size || order.size || 'M';
  const pantsSize = order.pants_size || order.size || 'M';
  if (order.product_id) return `${order.product_name || 'Pantalon baggy'} - ${order.color} - Talla ${pantsSize}`;
  if (order.selection_type === 'set') {
    return `Hoodie ${hoodieSize} + Pantalon ${pantsSize}`;
  }
  if (order.selection_type === 'hoodie') {
    return `Hoodie ${hoodieSize}`;
  }
  return `Pantalon ${pantsSize}`;
}

function scoped(path, establishmentId) {
  if (!establishmentId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}establishment_id=${establishmentId}`;
}

const emptyOrder = {
  customer_name: '',
  customer_cedula: '',
  customer_email: '',
  customer_city: '',
  customer_address: '',
  customer_phone: '',
  customer_instagram: '',
  purchase_channel: 'other',
  product_id: 'baggy-negro',
  selection_type: 'pants',
  size: 'M',
  hoodie_size: 'M',
  pants_size: 'M',
  quantity: 1,
  registration_type: 'paid',
  deposit_amount: '',
  pending_amount: '',
  notes: ''
};

const emptyStockItem = {
  product_id: 'baggy-negro',
  item_type: 'pants',
  size: 'M',
  quantity: ''
};

function RenjiApp({ user, establishmentId: forcedEstablishmentId, embedded = false, onLogout }) {
  const establishmentId = forcedEstablishmentId || user?.establishment_id || '';
  const [overview, setOverview] = useState({ stock: [], orders: [], summary: {} });
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [stockForm, setStockForm] = useState({ movement_date: today, notes: '', items: [{ ...emptyStockItem }] });
  const [selectedGuideIds, setSelectedGuideIds] = useState([]);
  const [guideOrders, setGuideOrders] = useState([]);
  const [paymentEdits, setPaymentEdits] = useState({});
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [editingRegistrationId, setEditingRegistrationId] = useState(null);
  const [salePanelOpen, setSalePanelOpen] = useState(false);
  const [stockPanelOpen, setStockPanelOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const publicLink = `${window.location.origin}/renji-registro`;
  const separationLink = `${window.location.origin}/renji-separar`;

  async function loadOverview(message = '') {
    setError('');
    try {
      const data = await api(scoped('/renji/overview', establishmentId));
      setOverview(data);
      if (message) {
        setNotice(message);
        setTimeout(() => setNotice(''), 2600);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, [establishmentId]);

  const guideSelectableOrders = useMemo(
    () => [...overview.orders].sort((a, b) => {
      if (a.shipping_status !== b.shipping_status) {
        return a.shipping_status === 'sent' ? 1 : -1;
      }
      return String(a.customer_name || '').localeCompare(String(b.customer_name || ''));
    }),
    [overview.orders]
  );

  const stockByType = useMemo(() => {
    const grouped = { hoodie: {}, pants: {} };
    for (const row of overview.stock || []) {
      grouped[row.item_type][row.size] = Number(row.quantity || 0);
    }
    return grouped;
  }, [overview.stock]);

  function formFromRecord(record) {
    return {
      customer_name: record.customer_name || '',
      customer_cedula: record.customer_cedula || '',
      customer_email: record.customer_email || '',
      customer_city: record.customer_city || '',
      customer_address: record.customer_address || '',
      customer_phone: record.customer_phone || '',
      customer_instagram: record.customer_instagram || '',
      purchase_channel: record.purchase_channel || 'other',
      product_id: record.product_id || '',
      selection_type: record.selection_type || 'set',
      size: record.size || 'M',
      hoodie_size: record.hoodie_size || record.size || 'M',
      pants_size: record.pants_size || record.size || 'M',
      quantity: record.quantity || 1,
      registration_type: record.registration_type || (Number(record.deposit_amount || 0) > 0 ? 'separation' : 'paid'),
      deposit_amount: record.deposit_amount || '',
      pending_amount: record.pending_amount || '',
      payment_status: record.payment_status || 'pending',
      notes: record.notes || ''
    };
  }

  function resetOrderForm() {
    setOrderForm(emptyOrder);
    setEditingOrderId(null);
    setEditingRegistrationId(null);
  }

  async function submitOrder(event) {
    event.preventDefault();
    setError('');
    try {
      const path = editingOrderId
        ? `/renji/orders/${editingOrderId}`
        : editingRegistrationId
          ? `/renji/registrations/${editingRegistrationId}`
          : '/renji/orders';
      await api(scoped(path, establishmentId), {
        method: editingOrderId || editingRegistrationId ? 'PUT' : 'POST',
        body: JSON.stringify(orderForm)
      });
      const message = editingRegistrationId
        ? 'Registro actualizado'
        : editingOrderId
          ? 'Pedido actualizado y stock corregido'
          : 'Venta registrada y stock actualizado';
      resetOrderForm();
      setSalePanelOpen(false);
      await loadOverview(message);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitStock(event) {
    event.preventDefault();
    setError('');
    try {
      await api(scoped('/renji/stock', establishmentId), {
        method: 'POST',
        body: JSON.stringify(stockForm)
      });
      setStockForm({ movement_date: stockForm.movement_date, notes: '', items: [{ ...emptyStockItem }] });
      setStockPanelOpen(false);
      await loadOverview('Stock ingresado correctamente');
    } catch (err) {
      setError(err.message);
    }
  }

  async function markPaid(order) {
    setError('');
    try {
      await api(scoped(`/renji/orders/${order.id}/payment`, establishmentId), {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'paid' })
      });
      await loadOverview('Pedido marcado como pagado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function updatePendingAmount(order) {
    setError('');
    try {
      await api(scoped(`/renji/orders/${order.id}/payment`, establishmentId), {
        method: 'PATCH',
        body: JSON.stringify({
          payment_status: 'pending',
          pending_amount: paymentEdits[order.id] ?? order.pending_amount
        })
      });
      await loadOverview('Valor faltante actualizado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleShipping(order) {
    setError('');
    const nextStatus = order.shipping_status === 'sent' ? 'not_sent' : 'sent';
    try {
      await api(scoped(`/renji/orders/${order.id}/shipping`, establishmentId), {
        method: 'PATCH',
        body: JSON.stringify({ shipping_status: nextStatus })
      });
      await loadOverview(nextStatus === 'sent' ? 'Pedido marcado como enviado' : 'Pedido marcado como no enviado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function markProductionReady(order) {
    setError('');
    try {
      await api(scoped(`/renji/orders/${order.id}/production-ready`, establishmentId), { method: 'PATCH' });
      await loadOverview('Pedido marcado como listo para guia');
    } catch (err) {
      setError(err.message);
    }
  }

  async function generateGuides() {
    setError('');
    const paidIds = selectedGuideIds.filter((id) => (
      overview.orders.some((order) => order.id === id && canGenerateGuide(order))
    ));
    if (!paidIds.length) {
      setError('Selecciona al menos un pedido pagado para generar guia');
      return;
    }
    try {
      const response = await api(scoped('/renji/guides', establishmentId), {
        method: 'POST',
        body: JSON.stringify({ order_ids: paidIds })
      });
      setGuideOrders(response.guides || []);
      setOverview(response.overview || overview);
      setSelectedGuideIds([]);
      window.setTimeout(() => window.print(), 100);
      window.setTimeout(() => setGuideOrders([]), 800);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resendEmail(registration) {
    setError('');
    try {
      await api(scoped(`/renji/registrations/${registration.id}/resend-email`, establishmentId), { method: 'POST' });
      setNotice('Confirmacion enviada al correo del cliente.');
      await loadOverview();
    } catch (err) { setError(err.message); }
  }

  async function confirmRegistration(registration) {
    setError('');
    try {
      await api(scoped(`/renji/registrations/${registration.id}/confirm`, establishmentId), { method: 'POST' });
      await loadOverview('Registro confirmado, stock descontado y guia lista');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteRegistration(registration) {
    if (!window.confirm('Seguro quieres eliminar este registro pendiente?')) return;
    setError('');
    try {
      await api(scoped(`/renji/registrations/${registration.id}`, establishmentId), { method: 'DELETE' });
      await loadOverview('Registro eliminado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteOrder(order) {
    if (!window.confirm('Seguro quieres eliminar este pedido? Se devolvera el stock de esa prenda.')) return;
    setError('');
    try {
      const data = await api(scoped(`/renji/orders/${order.id}`, establishmentId), { method: 'DELETE' });
      setOverview(data);
      setNotice('Pedido eliminado y stock devuelto');
      setTimeout(() => setNotice(''), 2600);
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyPublicLink() {
    try {
      await navigator.clipboard?.writeText(publicLink);
      setNotice('Enlace copiado para enviar al cliente');
      setTimeout(() => setNotice(''), 2400);
    } catch {
      setNotice(publicLink);
    }
  }

  async function copySeparationLink() {
    try {
      await navigator.clipboard?.writeText(separationLink);
      setNotice('Enlace de separacion copiado para enviar al cliente');
      setTimeout(() => setNotice(''), 2400);
    } catch {
      setNotice(separationLink);
    }
  }

  function paymentLabel(order) {
    if (order.payment_status === 'paid') {
      return 'Pagado';
    }
    return Number(order.deposit_amount || 0) > 0 ? 'COBRAR' : 'Pendiente';
  }

  function paymentClass(order) {
    if (order.payment_status === 'paid') {
      return 'paid';
    }
    return Number(order.deposit_amount || 0) > 0 ? 'collect' : 'pending';
  }

  function canGenerateGuide(order) {
    return order.payment_status === 'paid' && (order.production_status || 'ready') === 'ready';
  }

  function productionLabel(order) {
    const status = order.production_status || 'ready';
    if (status === 'in_production') return 'EN PRODUCCION';
    if (status === 'partial_production') return 'PARTE EN PRODUCCION';
    return 'LISTO';
  }

  function productionItemsText(order) {
    const items = order.production_items || [];
    return items.length
      ? items.map((item) => `${item.item_type === 'hoodie' ? 'Hoodie' : 'Pantalon'} ${item.size} x${item.quantity}`).join(', ')
      : 'Sin prendas pendientes';
  }

  function logout() {
    clearToken();
    onLogout?.();
  }

  return (
    <main className={embedded ? 'renji-app embedded' : 'renji-app'}>
      {!embedded && (
        <header className="renji-hero">
          <div>
            <span>PROMOTERS</span>
            <h1>RENJI</h1>
            <p>Control de ventas, stock y guias de envio.</p>
          </div>
          <button onClick={logout}>Salir</button>
        </header>
      )}

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {loading ? (
        <div className="empty-state">Cargando Renji...</div>
      ) : (
        <>
          <section className="renji-summary">
            <article><Shirt size={22} /><span>Prendas vendidas</span><strong>{overview.summary.sold_garments || 0}</strong></article>
            <article><WalletCards size={22} /><span>Pedidos pagados</span><strong>{overview.summary.paid_orders || 0}</strong></article>
            <article><Truck size={22} /><span>Pendientes de envio</span><strong>{overview.summary.pending_shipping || 0}</strong></article>
            <article><PackagePlus size={22} /><span>Registros por confirmar</span><strong>{overview.summary.pending_registrations || 0}</strong></article>
            <article><Shirt size={22} /><span>En produccion</span><strong>{overview.summary.production_items || 0}</strong></article>
          </section>

          <section className="renji-panel renji-link-card">
            <div>
              <strong>Enlace para clientes cancelados</strong>
              <span>{publicLink}</span>
            </div>
            <button className="renji-secondary" onClick={copyPublicLink}><Copy size={16} />Copiar enlace</button>
          </section>
          <section className="renji-panel renji-link-card">
            <div>
              <strong>Enlace para clientes que separaron</strong>
              <span>{separationLink}</span>
            </div>
            <button className="renji-secondary" onClick={copySeparationLink}><Copy size={16} />Copiar enlace</button>
          </section>

          <section className="renji-grid">
            <article className={`renji-panel renji-collapsible ${salePanelOpen ? 'open' : ''}`}>
              <button className="renji-collapsible-trigger" type="button" onClick={() => setSalePanelOpen(!salePanelOpen)}>
                <span><Edit3 size={18} />{editingRegistrationId ? 'Editar registro por confirmar' : editingOrderId ? 'Editar venta' : 'Registrar venta'}</span>
                <small>Datos del cliente, prenda, pago y estado de produccion.</small>
                <ChevronDown className={`renji-chevron ${salePanelOpen ? 'rotated' : ''}`} size={20} />
              </button>
              {salePanelOpen && (
              <form className="renji-form renji-collapsible-body" onSubmit={submitOrder}>
                <label>Nombres completos<input value={orderForm.customer_name} onChange={(e) => setOrderForm({ ...orderForm, customer_name: e.target.value })} required /></label>
                <label>Cedula<input value={orderForm.customer_cedula} onChange={(e) => setOrderForm({ ...orderForm, customer_cedula: e.target.value })} /></label>
                <label>Correo<input type="email" value={orderForm.customer_email} onChange={(e) => setOrderForm({ ...orderForm, customer_email: e.target.value })} /></label>
                <label>Ciudad<input value={orderForm.customer_city} onChange={(e) => setOrderForm({ ...orderForm, customer_city: e.target.value })} required /></label>
                <label>Direccion<input value={orderForm.customer_address} onChange={(e) => setOrderForm({ ...orderForm, customer_address: e.target.value })} required /></label>
                <label>Celular<input value={orderForm.customer_phone} onChange={(e) => setOrderForm({ ...orderForm, customer_phone: e.target.value })} required /></label>
                <label>Compra por
                  <select value={orderForm.purchase_channel} onChange={(e) => setOrderForm({ ...orderForm, purchase_channel: e.target.value })}>
                    <option value="other">Otro medio</option>
                    <option value="instagram">Instagram</option>
                  </select>
                </label>
                <label>Instagram<input value={orderForm.customer_instagram} onChange={(e) => setOrderForm({ ...orderForm, customer_instagram: e.target.value })} required={orderForm.purchase_channel === 'instagram'} placeholder="@usuario" /></label>
                <label>Prenda y color
                  <select value={orderForm.product_id || orderForm.selection_type} onChange={(e) => {
                    const product = overview.catalog?.find((entry) => entry.id === e.target.value);
                    setOrderForm({ ...orderForm, product_id: product?.id || '', selection_type: product ? 'pants' : e.target.value,
                      size: product || e.target.value === 'pants' ? orderForm.pants_size : orderForm.hoodie_size });
                  }}>
                    {(overview.catalog || []).map((product) => <option key={product.id} value={product.id}>{product.name} - {product.color}</option>)}
                    {(editingOrderId || editingRegistrationId) && !orderForm.product_id && <>
                      <option value="set">Conjunto Sukuna (anterior)</option>
                      <option value="hoodie">Hoodie Sukuna (anterior)</option>
                      <option value="pants">Pantalon Sukuna (anterior)</option>
                    </>}
                  </select>
                </label>
                {orderForm.selection_type !== 'pants' && (
                  <label>Talla hoodie
                    <select value={orderForm.hoodie_size} onChange={(e) => setOrderForm({ ...orderForm, hoodie_size: e.target.value, size: e.target.value })}>
                      {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                )}
                {orderForm.selection_type !== 'hoodie' && (
                  <label>Talla pantalon
                    <select value={orderForm.pants_size} onChange={(e) => setOrderForm({ ...orderForm, pants_size: e.target.value, size: orderForm.selection_type === 'pants' ? e.target.value : orderForm.size })}>
                      {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                )}
                <label>Cantidad<input type="number" min="1" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} /></label>
                {editingRegistrationId && (
                  <label>Tipo de registro
                    <select value={orderForm.registration_type} onChange={(e) => setOrderForm({ ...orderForm, registration_type: e.target.value })}>
                      <option value="paid">Cancelado</option>
                      <option value="separation">Separado</option>
                    </select>
                  </label>
                )}
                {(orderForm.registration_type === 'separation' || Number(orderForm.deposit_amount || 0) > 0) && (
                  <label>Valor depositado<input type="number" min="0" step="0.01" value={orderForm.deposit_amount} onChange={(e) => setOrderForm({ ...orderForm, deposit_amount: e.target.value })} /></label>
                )}
                {!editingRegistrationId && <label>Valor faltante<input type="number" min="0" step="0.01" value={orderForm.pending_amount} onChange={(e) => setOrderForm({ ...orderForm, pending_amount: e.target.value })} /></label>}
                <label className="span-2">Observacion<input value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} /></label>
                <button className="renji-primary span-2" type="submit">{editingRegistrationId ? 'Guardar registro pendiente' : editingOrderId ? 'Guardar cambios del pedido' : 'Guardar venta pendiente'}</button>
                {(editingOrderId || editingRegistrationId) && <button className="renji-secondary span-2" type="button" onClick={() => { resetOrderForm(); setSalePanelOpen(false); }}>Cancelar edicion</button>}
              </form>
              )}
            </article>

            <article className={`renji-panel renji-collapsible ${stockPanelOpen ? 'open' : ''}`}>
              <button className="renji-collapsible-trigger stock" type="button" onClick={() => setStockPanelOpen(!stockPanelOpen)}>
                <span><PackagePlus size={18} />Ingresar stock</span>
                <small>Agrega prendas por tipo, talla y cantidad en un solo movimiento.</small>
                <ChevronDown className={`renji-chevron ${stockPanelOpen ? 'rotated' : ''}`} size={20} />
              </button>
              {stockPanelOpen && (
              <form className="renji-form renji-collapsible-body" onSubmit={submitStock}>
                <label>Fecha<input type="date" value={stockForm.movement_date} onChange={(e) => setStockForm({ ...stockForm, movement_date: e.target.value })} /></label>
                <label>Nota<input value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} /></label>
                {stockForm.items.map((item, index) => (
                  <div className="renji-stock-line span-2" key={index}>
                    <select value={item.product_id || item.item_type} onChange={(e) => {
                      const product = overview.catalog?.find((entry) => entry.id === e.target.value);
                      const items = [...stockForm.items];
                      items[index] = { ...item, product_id: product?.id || '', item_type: product ? 'pants' : e.target.value };
                      setStockForm({ ...stockForm, items });
                    }}>
                      {(overview.catalog || []).map((product) => <option key={product.id} value={product.id}>{product.name} - {product.color}</option>)}
                      <option value="hoodie">Hoodie Sukuna (historico)</option>
                      <option value="pants">Pantalon Sukuna (historico)</option>
                    </select>
                    <select value={item.size} onChange={(e) => {
                      const items = [...stockForm.items];
                      items[index] = { ...item, size: e.target.value };
                      setStockForm({ ...stockForm, items });
                    }}>
                      {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                    <input type="number" min="1" placeholder="Cantidad" value={item.quantity} onChange={(e) => {
                      const items = [...stockForm.items];
                      items[index] = { ...item, quantity: e.target.value };
                      setStockForm({ ...stockForm, items });
                    }} />
                  </div>
                ))}
                <button className="renji-secondary span-2" type="button" onClick={() => setStockForm({ ...stockForm, items: [...stockForm.items, { ...emptyStockItem }] })}>Agregar otra prenda</button>
                <button className="renji-primary span-2" type="submit">Guardar stock</button>
              </form>
              )}
            </article>
          </section>

          <section className="renji-panel">
            <div className="panel-title"><h3>Stock actual</h3></div>
            <div className="renji-admin-catalog">
              {(overview.catalog || []).map((product) => <article key={product.id}>
                <img src={product.image_url} alt={`${product.name} ${product.color}`} />
                <strong>{product.name} - {product.color}</strong>
                <div>{product.sizes.map((variant) => <span key={variant.size}>{variant.size}: <b>{variant.quantity}</b></span>)}</div>
              </article>)}
            </div>
            <p>Conjunto Sukuna: agotado para nuevos pedidos. Inventario historico:</p>
            <div className="renji-stock-grid">
              {['hoodie', 'pants'].map((itemType) => (
                <article key={itemType}>
                  <strong>{itemLabels[itemType]}</strong>
                  <div>
                    {sizes.map((size) => <span key={size}>{size}: <b>{stockByType[itemType]?.[size] || 0}</b></span>)}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="renji-panel">
            <div className="panel-title">
              <h3>Registros por confirmar</h3>
            </div>
            <div className="renji-table-wrap">
              <table className="renji-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Prenda</th>
                    <th>Fecha</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.registrations?.length ? overview.registrations.map((registration) => (
                    <tr key={registration.id}>
                      <td><strong>{registration.customer_name}</strong><small>{registration.customer_city} - {registration.customer_address}</small></td>
                      <td>{registration.customer_phone}<small>{registration.customer_instagram ? `@${registration.customer_instagram}` : 'Sin Instagram'}</small></td>
                      <td>{renjiItemDetail(registration)}{registration.catalog_items?.length > 1 ? '' : ` x${registration.quantity}`}</td>
                      <td>{registration.created_at}{registration.product_id && <small>{registration.email_sent ? "Correo enviado" : "Correo pendiente"}</small>}<small>{registration.registration_type === 'separation' ? `Separado: ${money(registration.deposit_amount)}` : 'Cancelado'}</small></td>
                      <td>
                        <div className="renji-actions">
                          {registration.catalog_items?.length <= 1 && <button onClick={() => { setEditingRegistrationId(registration.id); setEditingOrderId(null); setOrderForm(formFromRecord(registration)); setSalePanelOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Edit3 size={15} />Editar</button>}
                          {registration.product_id && <button onClick={() => resendEmail(registration)}>Reenviar correo</button>}
                          <button onClick={() => confirmRegistration(registration)}><CheckCircle2 size={15} />Confirmar</button>
                          <button onClick={() => deleteRegistration(registration)}><Trash2 size={15} />Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="5">No hay registros pendientes.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="renji-panel">
            <div className="panel-title">
              <h3>Pedidos / clientes</h3>
            </div>
            <div className="renji-table-wrap">
              <table className="renji-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Prenda</th>
                      <th>Pago</th>
                      <th>Produccion</th>
                      <th>Envio</th>
                      <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.orders.length ? overview.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.order_number}</td>
                      <td><strong>{order.customer_name}</strong><small>{order.customer_city} - {order.customer_phone}{order.customer_instagram ? ` - @${order.customer_instagram}` : ''}</small></td>
                      <td className={Number(order.size_edited || 0) ? 'renji-size-edited-cell' : ''}>
                        {renjiItemDetail(order)}{order.stock_items?.length > 1 ? '' : ` x${order.quantity}`}
                        {Number(order.size_edited || 0) ? <span className="renji-ed-badge">ED</span> : null}
                      </td>
                      <td>
                        <span className={`renji-pill ${paymentClass(order)}`}>{paymentLabel(order)}</span>
                        {Number(order.deposit_amount || 0) > 0 && <small>Deposito: {money(order.deposit_amount)}</small>}
                        {order.payment_status !== 'paid' && (
                          <div className="renji-inline-edit">
                            <input type="number" min="0" step="0.01" value={paymentEdits[order.id] ?? order.pending_amount} onChange={(e) => setPaymentEdits({ ...paymentEdits, [order.id]: e.target.value })} />
                            <button onClick={() => updatePendingAmount(order)}>Guardar</button>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`renji-pill production-${order.production_status || 'ready'}`}>{productionLabel(order)}</span>
                        {(order.production_status || 'ready') !== 'ready' && <small>{productionItemsText(order)}</small>}
                      </td>
                      <td><span className={`renji-pill ${order.shipping_status}`}>{order.shipping_status === 'sent' ? 'Enviado' : 'No enviado'}</span></td>
                      <td>
                        <div className="renji-actions">
                          {(order.stock_items?.length || 0) + (order.production_items?.length || 0) <= 1 && <button onClick={() => { setEditingOrderId(order.id); setEditingRegistrationId(null); setOrderForm(formFromRecord(order)); setSalePanelOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Edit3 size={15} />Editar</button>}
                          <button onClick={() => markPaid(order)} disabled={order.payment_status === 'paid'}><CheckCircle2 size={15} />Pagado</button>
                          {(order.production_status || 'ready') !== 'ready' && <button onClick={() => markProductionReady(order)}><CheckCircle2 size={15} />Listo</button>}
                          <button onClick={() => toggleShipping(order)}><Truck size={15} />{order.shipping_status === 'sent' ? 'No enviado' : 'Enviado'}</button>
                          <button onClick={() => deleteOrder(order)}><Trash2 size={15} />Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="7">Aun no hay ventas registradas.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="renji-panel">
            <div className="panel-title">
              <h3>Produccion</h3>
            </div>
            <div className="renji-table-wrap">
              <table className="renji-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Prendas pendientes</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.orders.filter((order) => (order.production_status || 'ready') !== 'ready').length ? overview.orders
                    .filter((order) => (order.production_status || 'ready') !== 'ready')
                    .map((order) => (
                      <tr key={order.id}>
                        <td>{order.order_number}</td>
                        <td><strong>{order.customer_name}</strong><small>{order.customer_phone}</small></td>
                        <td>{productionItemsText(order)}</td>
                        <td><span className={`renji-pill production-${order.production_status}`}>{productionLabel(order)}</span></td>
                        <td><button className="renji-primary" onClick={() => markProductionReady(order)}><CheckCircle2 size={15} />Marcar listo</button></td>
                      </tr>
                    )) : <tr><td colSpan="5">No hay prendas pendientes de produccion.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="renji-panel">
            <div className="panel-title">
              <h3>Guias de envio</h3>
              <button className="renji-primary" onClick={generateGuides}><Printer size={16} />Generar guias seleccionadas</button>
            </div>
            <div className="renji-guide-list">
              {guideSelectableOrders.length ? guideSelectableOrders.map((order) => (
                <label key={order.id} className={!canGenerateGuide(order) ? 'disabled' : ''}>
                  <input
                    type="checkbox"
                    disabled={!canGenerateGuide(order)}
                    checked={selectedGuideIds.includes(order.id)}
                    onChange={(e) => setSelectedGuideIds(e.target.checked ? [...selectedGuideIds, order.id] : selectedGuideIds.filter((id) => id !== order.id))}
                  />
                  <span>{order.customer_name}</span>
                  <small>{order.customer_city} - {renjiItemDetail(order)}</small>
                  <b className={`renji-guide-pay-status ${paymentClass(order)}`}>{paymentLabel(order)}</b>
                  {!canGenerateGuide(order) && <small className="renji-guide-lock">{order.payment_status !== 'paid' ? 'Primero marcar como pagado' : 'Pendiente de produccion'}</small>}
                  <b className={`renji-guide-status ${order.shipping_status}`}>{order.shipping_status === 'sent' ? 'Enviado' : 'No enviado'}</b>
                </label>
              )) : <div className="empty-state">No hay pedidos para guias.</div>}
            </div>
          </section>
        </>
      )}

      {guideOrders.length > 0 && (
        <section className="renji-print-root">
          <RenjiGuidesPrint orders={guideOrders} />
        </section>
      )}
    </main>
  );
}

function RenjiGuidesPrint({ orders }) {
  const pages = [];
  for (let index = 0; index < orders.length; index += 6) {
    pages.push(orders.slice(index, index + 6));
  }

  return (
    <>
      {pages.map((pageOrders, pageIndex) => (
        <article className="renji-guide-sheet" key={pageIndex}>
          {pageOrders.map((order) => (
            <section className="renji-guide-label" key={order.id}>
              <strong>{order.customer_name}</strong>
              <span>{order.customer_city}</span>
              <span>{order.customer_address}</span>
              <b>{order.customer_phone}</b>
              <small>Cedula: {order.customer_cedula || 'Sin cedula'}</small>
              <em>Detalle: {renjiItemDetail(order)}</em>
            </section>
          ))}
        </article>
      ))}
    </>
  );
}

export { default as RenjiPublicRegistration } from './RenjiPublicRegistration.jsx';

export default RenjiApp;
