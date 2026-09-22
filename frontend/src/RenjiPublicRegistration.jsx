import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import './renji-catalog.css';

const newItem = () => ({ key: crypto.randomUUID(), product_id: '', size: '', quantity: 1 });
const newForm = () => ({
  customer_name: '', customer_cedula: '', customer_email: '', customer_city: '',
  customer_address: '', customer_phone: '', customer_instagram: '', purchase_channel: 'other',
  deposit_amount: '', items: [newItem()]
});

export default function RenjiPublicRegistration({ mode = 'paid' }) {
  const isSeparation = mode === 'separation';
  const [form, setForm] = useState(newForm);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const submitting = useRef(false);

  async function refreshCatalog() {
    const data = await api('/renji/catalog');
    setProducts(data.products);
  }

  useEffect(() => {
    refreshCatalog().catch((err) => setError(err.message)).finally(() => setLoading(false));
    const refresh = () => refreshCatalog().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeItem(index, changes) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item)
    }));
  }

  function selectedProduct(item) {
    return products.find((product) => product.id === item.product_id);
  }

  function requestedFor(productId, size) {
    return form.items.filter((item) => item.product_id === productId && item.size === size).length;
  }

  const canSubmit = form.items.length >= 1 && form.items.length <= 2 && form.items.every((item) => {
    const product = selectedProduct(item);
    const available = product?.sizes.find((variant) => variant.size === item.size)?.quantity || 0;
    return product?.active && item.size && available >= requestedFor(item.product_id, item.size);
  });

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!canSubmit) return setError('Revisa el color y la talla de cada prenda. Alguna selección ya no tiene unidades suficientes.');
    submitting.current = true;
    setSending(true);
    setError('');
    try {
      const first = form.items[0];
      const result = await api(isSeparation ? '/renji/public-separations' : '/renji/public-registrations', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          items: form.items.map(({ product_id, size }) => ({ product_id, size, quantity: 1 })),
          product_id: first.product_id,
          selection_type: 'pants',
          size: first.size,
          pants_size: first.size,
          quantity: form.items.length,
          request_key: requestKey.current
        })
      });
      setReceipt({ ...result, email_address: form.customer_email });
      setForm(newForm());
      requestKey.current = crypto.randomUUID();
    } catch (err) {
      setError(err.message);
    } finally {
      await refreshCatalog().catch(() => {});
      submitting.current = false;
      setSending(false);
    }
  }

  return (
    <main className="renji-public-page renji-catalog-page">
      <section className="renji-public-card">
        <header className="renji-catalog-header">
          <span className="renji-wordmark">RENJI<span> / STREETWEAR</span></span>
          <span className="renji-drop-tag">NUEVO DROP</span>
        </header>
        <h1>Tu próximo favorito.</h1>
        <p>Elige una o dos prendas. Puedes seleccionar un color y una talla diferente para cada una.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <form className="renji-form" onSubmit={submit}>
          <fieldset className="renji-form-fields" disabled={sending}>
            <section className="span-2 renji-product-section" aria-labelledby="renji-choose">
              <h2 id="renji-choose"><span>01</span> Elige tus prendas</h2>
              {loading ? <p role="status">Cargando prendas disponibles…</p> : !products.length ? <p>No se pudo cargar el catálogo. <button type="button" onClick={() => refreshCatalog().catch((err) => setError(err.message))}>Reintentar</button></p> : (
                <div className="renji-item-list">
                  {form.items.map((item, itemIndex) => {
                    const selected = selectedProduct(item);
                    return (
                      <section className="renji-item-choice" key={item.key} aria-label={`Prenda ${itemIndex + 1}`}>
                        <div className="renji-item-choice-heading">
                          <h3>Prenda {itemIndex + 1}</h3>
                          {itemIndex === 1 && <button className="renji-remove-item" type="button" onClick={() => setForm((current) => ({ ...current, items: current.items.slice(0, 1) }))}><Trash2 size={15} /> Quitar</button>}
                        </div>
                        <div className="renji-product-grid">
                          {products.map((product) => {
                            const total = product.sizes.reduce((sum, variant) => sum + variant.quantity, 0);
                            const chosen = product.id === item.product_id;
                            return (
                              <button className={`renji-product-card ${chosen ? 'selected' : ''}`} key={product.id} type="button"
                                aria-pressed={chosen} aria-label={`Elegir ${product.name} ${product.color} como prenda ${itemIndex + 1}`}
                                disabled={!product.active || total === 0}
                                onClick={() => changeItem(itemIndex, { product_id: product.id, size: '' })}>
                                <div className="renji-product-photo"><img src={product.image_url} alt={`${product.name} color ${product.color}`} />
                                  {chosen && <span className="renji-product-check"><Check size={18} /></span>}
                                  <span className="renji-photo-label">{total && product.active ? 'DISPONIBLE' : 'AGOTADO'}</span>
                                </div>
                                <div className="renji-product-caption"><small>{product.name}</small><strong><i style={{ background: product.color === 'Negro' ? '#202020' : '#bcbcb8' }} />{product.color}</strong><span>{total} disponibles</span></div>
                              </button>
                            );
                          })}
                        </div>
                        {selected && <div className="renji-size-picker">
                          <h3>Talla de la prenda {itemIndex + 1} · {selected.color}</h3>
                          <div className="renji-size-options" role="group" aria-label={`Talla de la prenda ${itemIndex + 1}`}>
                            {selected.sizes.map((variant) => {
                              const usedByOther = form.items.filter((other, otherIndex) => otherIndex !== itemIndex
                                && other.product_id === selected.id && other.size === variant.size).length;
                              const remaining = Math.max(0, variant.quantity - usedByOther);
                              return <button key={variant.size} type="button" disabled={!remaining}
                                aria-pressed={item.size === variant.size} className={item.size === variant.size ? 'selected' : ''}
                                onClick={() => changeItem(itemIndex, { size: variant.size })}>
                                <strong>{variant.size}</strong><small>{remaining ? `${remaining} disponibles` : 'Agotada'}</small>
                              </button>;
                            })}
                          </div>
                        </div>}
                      </section>
                    );
                  })}
                  {form.items.length < 2 && <button className="renji-add-item" type="button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, newItem()] }))}>
                    <Plus size={18} /> Agregar una segunda prenda
                  </button>}
                </div>
              )}
              <div className="renji-previous-drop"><LockKeyhole size={15} /><span>Conjunto Sukuna</span><b>AGOTADO</b></div>
            </section>
            <h2 className="span-2 renji-form-heading"><span>02</span> {isSeparation ? 'Datos de tu separación' : 'Datos para tu envío'}</h2>
            <p className="span-2 renji-customer-once">Llena estos datos una sola vez. Se aplicarán a todas las prendas de este pedido.</p>
            <label>Nombres completos<input autoComplete="name" value={form.customer_name} onChange={(e) => change('customer_name', e.target.value)} required /></label>
            <label>Cédula<input value={form.customer_cedula} onChange={(e) => change('customer_cedula', e.target.value)} required /></label>
            <label>Correo electrónico<input type="email" autoComplete="email" value={form.customer_email} onChange={(e) => change('customer_email', e.target.value)} required /></label>
            <label>Celular<input type="tel" autoComplete="tel" value={form.customer_phone} onChange={(e) => change('customer_phone', e.target.value)} required /></label>
            <label>Ciudad<input autoComplete="address-level2" value={form.customer_city} onChange={(e) => change('customer_city', e.target.value)} required /></label>
            <label>Dirección<input autoComplete="street-address" value={form.customer_address} onChange={(e) => change('customer_address', e.target.value)} required /></label>
            <label>Compré por<select value={form.purchase_channel} onChange={(e) => change('purchase_channel', e.target.value)}><option value="other">Otro medio</option><option value="instagram">Instagram</option></select></label>
            <label>Usuario de Instagram<input value={form.customer_instagram} onChange={(e) => change('customer_instagram', e.target.value)} required={form.purchase_channel === 'instagram'} placeholder="@usuario" /></label>
            {isSeparation && <label className="span-2">Valor transferido para separar<input type="number" min="0.01" step="0.01" value={form.deposit_amount} onChange={(e) => change('deposit_amount', e.target.value)} required /></label>}
            <div className="renji-order-summary span-2">
              <strong>{form.items.length === 1 ? 'Tu prenda' : 'Tus dos prendas'}</strong>
              {form.items.map((item, index) => {
                const product = selectedProduct(item);
                return <span key={item.key}>{index + 1}. {product && item.size ? `${product.name} · ${product.color} · Talla ${item.size}` : 'Selecciona color y talla'}</span>;
              })}
              <small>Recibirás en un solo correo el detalle completo. La disponibilidad se confirma al enviar.</small>
            </div>
            <button className="renji-primary renji-submit-order span-2" type="submit" disabled={sending || !canSubmit}>
              {sending ? 'Registrando tu pedido…' : 'Registrar mi pedido'}{!sending && <ArrowRight size={18} />}
            </button>
          </fieldset>
        </form>
        {receipt && <div className="renji-push-overlay" role="dialog" aria-modal="true" aria-labelledby="renji-receipt-title">
          <div className="renji-push-card"><CheckCircle2 size={36} /><strong id="renji-receipt-title">¡Pedido registrado!</strong>
            <p>Registro #{receipt.registration_id}</p>
            <div className="renji-receipt-items">{(receipt.items || []).map((item, index) => <span key={`${item.product_id}-${item.size}-${index}`}>{index + 1}. {item.product_name} · {item.color} · Talla {item.size}</span>)}</div>
            <p>{receipt.email?.sent ? `Enviamos la confirmación a ${receipt.email_address}. Revisa también la carpeta de no deseados.` : 'Tus prendas quedaron reservadas, pero no pudimos enviar el correo. Contacta a RENJI con el número de registro para solicitar tu confirmación.'}</p>
            <button className="renji-primary" type="button" autoFocus onClick={() => setReceipt(null)}>Entendido</button>
          </div>
        </div>}
      </section>
    </main>
  );
}
