import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from './api.js';
import './renji-catalog.css';

const emptyForm = {
  customer_name: '', customer_cedula: '', customer_email: '', customer_city: '',
  customer_address: '', customer_phone: '', customer_instagram: '', purchase_channel: 'other',
  product_id: '', selection_type: 'pants', size: '', pants_size: '', quantity: 1, deposit_amount: ''
};

export default function RenjiPublicRegistration({ mode = 'paid' }) {
  const isSeparation = mode === 'separation';
  const [form, setForm] = useState(emptyForm);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const selected = products.find((product) => product.id === form.product_id);
  const available = selected?.sizes.find((variant) => variant.size === form.pants_size)?.quantity || 0;
  const canSubmit = selected?.active && available >= Number(form.quantity) && Number(form.quantity) > 0;

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

  function change(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!canSubmit) return setError('Elige un color y una talla con unidades disponibles.');
    submitting.current = true;
    setSending(true);
    setError('');
    try {
      const result = await api(isSeparation ? '/renji/public-separations' : '/renji/public-registrations', {
        method: 'POST', body: JSON.stringify({ ...form, request_key: requestKey.current })
      });
      setReceipt({ ...result, email_address: form.customer_email });
      setForm(emptyForm);
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
        <p>Elige tu color y talla. Nosotros preparamos el resto.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <form className="renji-form" onSubmit={submit}>
          <fieldset className="renji-form-fields" disabled={sending}>
            <section className="span-2 renji-product-section" aria-labelledby="renji-choose">
              <h2 id="renji-choose"><span>01</span> Elige tu pantalón</h2>
              {loading ? <p role="status">Cargando prendas disponibles…</p> : !products.length ? <p>No se pudo cargar el catálogo. <button type="button" onClick={() => refreshCatalog().catch((err) => setError(err.message))}>Reintentar</button></p> : (
                <div className="renji-product-grid">
                  {products.map((product) => {
                    const total = product.sizes.reduce((sum, item) => sum + item.quantity, 0);
                    const chosen = product.id === form.product_id;
                    return (
                      <button className={`renji-product-card ${chosen ? 'selected' : ''}`} key={product.id} type="button"
                        aria-pressed={chosen} aria-label={`Elegir ${product.name} ${product.color}`} disabled={!product.active || total === 0}
                        onClick={() => setForm({ ...form, product_id: product.id, pants_size: '', size: '', quantity: 1 })}>
                        <div className="renji-product-photo"><img src={product.image_url} alt={`${product.name} color ${product.color}`} />
                          {chosen && <span className="renji-product-check"><Check size={18} /></span>}
                          <span className="renji-photo-label">{total && product.active ? 'DISPONIBLE' : 'AGOTADO'}</span>
                        </div>
                        <div className="renji-product-caption"><small>{product.name}</small><strong><i style={{ background: product.color === 'Negro' ? '#202020' : '#bcbcb8' }} />{product.color}</strong><span>{total} disponibles</span></div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="renji-previous-drop"><LockKeyhole size={15} /><span>Conjunto Sukuna</span><b>AGOTADO</b></div>
              {selected && <div className="renji-size-picker">
                <h3>Tu talla · {selected.color}</h3>
                <div className="renji-size-options" role="group" aria-label="Talla del pantalón">
                  {selected.sizes.map((variant) => <button key={variant.size} type="button" disabled={!variant.quantity}
                    aria-pressed={form.pants_size === variant.size} className={form.pants_size === variant.size ? 'selected' : ''}
                    onClick={() => setForm({ ...form, pants_size: variant.size, size: variant.size, quantity: 1 })}>
                    <strong>{variant.size}</strong><small>{variant.quantity ? `${variant.quantity} disponibles` : 'Agotada'}</small>
                  </button>)}
                </div>
              </div>}
            </section>
            <label className="span-2">Cantidad<input type="number" min="1" max={available || 1} step="1" value={form.quantity} disabled={!available}
              onChange={(e) => change('quantity', e.target.value)} required /></label>
            <h2 className="span-2 renji-form-heading"><span>02</span> {isSeparation ? 'Datos de tu separación' : 'Datos para tu envío'}</h2>
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
              <strong>{selected && form.pants_size ? `${selected.name} · ${selected.color} · ${form.pants_size} × ${form.quantity}` : 'Selecciona un color y una talla'}</strong>
              <small>Recibirás el detalle en tu correo. La disponibilidad se confirma al enviar.</small>
            </div>
            <button className="renji-primary renji-submit-order span-2" type="submit" disabled={sending || !canSubmit}>
              {sending ? 'Registrando tu pedido…' : 'Registrar mi pedido'}{!sending && <ArrowRight size={18} />}
            </button>
          </fieldset>
        </form>
        {receipt && <div className="renji-push-overlay" role="dialog" aria-modal="true" aria-labelledby="renji-receipt-title">
          <div className="renji-push-card"><CheckCircle2 size={36} /><strong id="renji-receipt-title">¡Pedido registrado!</strong>
            <p>Registro #{receipt.registration_id}<br />{receipt.product_name} · {receipt.color}<br />Talla {receipt.size} · Cantidad {receipt.quantity}</p>
            <p>{receipt.email?.sent ? `Enviamos la confirmación a ${receipt.email_address}. Revisa también la carpeta de no deseados.` : 'Tu prenda quedó reservada, pero no pudimos enviar el correo. Contacta a RENJI con el número de registro para solicitar tu confirmación.'}</p>
            <button className="renji-primary" type="button" autoFocus onClick={() => setReceipt(null)}>Entendido</button>
          </div>
        </div>}
      </section>
    </main>
  );
}
