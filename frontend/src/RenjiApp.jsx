import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PackagePlus, Printer, Shirt, Truck, WalletCards } from 'lucide-react';
import { api, clearToken } from './api.js';

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

function scoped(path, establishmentId) {
  if (!establishmentId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}establishment_id=${establishmentId}`;
}

const emptyOrder = {
  customer_name: '',
  customer_cedula: '',
  customer_city: '',
  customer_address: '',
  customer_phone: '',
  selection_type: 'set',
  size: 'M',
  quantity: 1,
  pending_amount: '',
  notes: ''
};

const emptyStockItem = {
  item_type: 'hoodie',
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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

  const pendingGuideOrders = useMemo(
    () => overview.orders.filter((order) => order.shipping_status !== 'sent'),
    [overview.orders]
  );

  const stockByType = useMemo(() => {
    const grouped = { hoodie: {}, pants: {} };
    for (const row of overview.stock || []) {
      grouped[row.item_type][row.size] = Number(row.quantity || 0);
    }
    return grouped;
  }, [overview.stock]);

  async function submitOrder(event) {
    event.preventDefault();
    setError('');
    try {
      await api(scoped('/renji/orders', establishmentId), {
        method: 'POST',
        body: JSON.stringify(orderForm)
      });
      setOrderForm(emptyOrder);
      await loadOverview('Venta registrada y stock actualizado');
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

  async function generateGuides() {
    setError('');
    try {
      const response = await api(scoped('/renji/guides', establishmentId), {
        method: 'POST',
        body: JSON.stringify({ order_ids: selectedGuideIds })
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
            <article><PackagePlus size={22} /><span>Valor faltante</span><strong>{money(overview.summary.pending_amount)}</strong></article>
          </section>

          <section className="renji-grid">
            <article className="renji-panel">
              <div className="panel-title"><h3>Registrar venta</h3></div>
              <form className="renji-form" onSubmit={submitOrder}>
                <label>Nombres completos<input value={orderForm.customer_name} onChange={(e) => setOrderForm({ ...orderForm, customer_name: e.target.value })} required /></label>
                <label>Cedula<input value={orderForm.customer_cedula} onChange={(e) => setOrderForm({ ...orderForm, customer_cedula: e.target.value })} /></label>
                <label>Ciudad<input value={orderForm.customer_city} onChange={(e) => setOrderForm({ ...orderForm, customer_city: e.target.value })} required /></label>
                <label>Direccion<input value={orderForm.customer_address} onChange={(e) => setOrderForm({ ...orderForm, customer_address: e.target.value })} required /></label>
                <label>Celular<input value={orderForm.customer_phone} onChange={(e) => setOrderForm({ ...orderForm, customer_phone: e.target.value })} required /></label>
                <label>Prenda
                  <select value={orderForm.selection_type} onChange={(e) => setOrderForm({ ...orderForm, selection_type: e.target.value })}>
                    <option value="set">Conjunto Sukuna</option>
                    <option value="hoodie">Solo hoodie Sukuna</option>
                    <option value="pants">Solo pantalon Sukuna</option>
                  </select>
                </label>
                <label>Talla
                  <select value={orderForm.size} onChange={(e) => setOrderForm({ ...orderForm, size: e.target.value })}>
                    {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <label>Cantidad<input type="number" min="1" value={orderForm.quantity} onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })} /></label>
                <label>Valor faltante<input type="number" min="0" step="0.01" value={orderForm.pending_amount} onChange={(e) => setOrderForm({ ...orderForm, pending_amount: e.target.value })} /></label>
                <label className="span-2">Observacion<input value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} /></label>
                <button className="renji-primary span-2" type="submit">Guardar venta pendiente</button>
              </form>
            </article>

            <article className="renji-panel">
              <div className="panel-title"><h3>Ingresar stock</h3></div>
              <form className="renji-form" onSubmit={submitStock}>
                <label>Fecha<input type="date" value={stockForm.movement_date} onChange={(e) => setStockForm({ ...stockForm, movement_date: e.target.value })} /></label>
                <label>Nota<input value={stockForm.notes} onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })} /></label>
                {stockForm.items.map((item, index) => (
                  <div className="renji-stock-line span-2" key={index}>
                    <select value={item.item_type} onChange={(e) => {
                      const items = [...stockForm.items];
                      items[index] = { ...item, item_type: e.target.value };
                      setStockForm({ ...stockForm, items });
                    }}>
                      <option value="hoodie">Hoodie</option>
                      <option value="pants">Pantalon</option>
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
            </article>
          </section>

          <section className="renji-panel">
            <div className="panel-title"><h3>Stock actual</h3></div>
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
                    <th>Envio</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.orders.length ? overview.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.order_number}</td>
                      <td><strong>{order.customer_name}</strong><small>{order.customer_city} · {order.customer_phone}</small></td>
                      <td>{selectionLabels[order.selection_type]} · {order.size} · Negro x{order.quantity}</td>
                      <td>
                        <span className={`renji-pill ${order.payment_status}`}>{order.payment_status === 'paid' ? 'Pagado' : 'Pendiente'}</span>
                        {order.payment_status !== 'paid' && (
                          <div className="renji-inline-edit">
                            <input type="number" min="0" step="0.01" value={paymentEdits[order.id] ?? order.pending_amount} onChange={(e) => setPaymentEdits({ ...paymentEdits, [order.id]: e.target.value })} />
                            <button onClick={() => updatePendingAmount(order)}>Guardar</button>
                          </div>
                        )}
                      </td>
                      <td><span className={`renji-pill ${order.shipping_status}`}>{order.shipping_status === 'sent' ? 'Enviado' : 'No enviado'}</span></td>
                      <td>
                        <div className="renji-actions">
                          <button onClick={() => markPaid(order)} disabled={order.payment_status === 'paid'}><CheckCircle2 size={15} />Pagado</button>
                          <button onClick={() => toggleShipping(order)}><Truck size={15} />{order.shipping_status === 'sent' ? 'No enviado' : 'Enviado'}</button>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan="6">Aun no hay ventas registradas.</td></tr>}
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
              {pendingGuideOrders.length ? pendingGuideOrders.map((order) => (
                <label key={order.id}>
                  <input
                    type="checkbox"
                    checked={selectedGuideIds.includes(order.id)}
                    onChange={(e) => setSelectedGuideIds(e.target.checked ? [...selectedGuideIds, order.id] : selectedGuideIds.filter((id) => id !== order.id))}
                  />
                  <span>{order.customer_name}</span>
                  <small>{order.customer_city} · {selectionLabels[order.selection_type]} {order.size}</small>
                </label>
              )) : <div className="empty-state">No hay guias pendientes.</div>}
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
            </section>
          ))}
        </article>
      ))}
    </>
  );
}

export default RenjiApp;
