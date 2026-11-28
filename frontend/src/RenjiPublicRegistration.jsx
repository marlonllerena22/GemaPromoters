import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, CreditCard, LockKeyhole, MessageCircle, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { api } from './api.js';
import './renji-catalog.css';

const emptyCustomer = {
  customer_name: '', customer_cedula: '', customer_email: '', customer_city: '', customer_address: '',
  customer_phone: '', customer_instagram: '', purchase_channel: 'other', deposit_amount: ''
};
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function RenjiPublicRegistration({ mode = 'shop' }) {
  const isSeparation = mode === 'separation';
  const isPaidRegistration = mode === 'paid';
  const [customer, setCustomer] = useState(emptyCustomer);
  const [products, setProducts] = useState([]);
  const [checkout, setCheckout] = useState({ payphone_configured: false, whatsapp_number: '' });
  const [choice, setChoice] = useState({ product_id: '', size: '', quantity: 1 });
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const paymentState = new URLSearchParams(window.location.search).get('payment');

  async function refreshCatalog() {
    const data = await api('/renji/catalog');
    setProducts(data.products || []);
    setCheckout(data.checkout || {});
    setChoice((current) => ({ ...current, product_id: current.product_id || data.products?.[0]?.id || '' }));
  }

  useEffect(() => {
    refreshCatalog().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const chosenProduct = products.find((product) => product.id === choice.product_id);
  const selectedAvailable = Number(chosenProduct?.sizes?.find((row) => row.size === choice.size)?.quantity || 0);
  const cartQuantity = (productId, size) => cart.filter((item) => item.product_id === productId && item.size === size)
    .reduce((sum, item) => sum + item.quantity, 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.quantity * Number(item.price || 0), 0);

  function addToCart() {
    setError('');
    if (!chosenProduct || !choice.size) return setError('Selecciona una talla antes de agregar la prenda.');
    const already = cartQuantity(chosenProduct.id, choice.size);
    if (already + choice.quantity > selectedAvailable) return setError(`Solo quedan ${selectedAvailable} unidades en talla ${choice.size}.`);
    setCart((current) => {
      const index = current.findIndex((item) => item.product_id === chosenProduct.id && item.size === choice.size);
      const line = { product_id: chosenProduct.id, product_name: chosenProduct.name, item_type: chosenProduct.item_type,
        color: chosenProduct.color, image_url: chosenProduct.image_url, size: choice.size,
        quantity: choice.quantity, price: Number(chosenProduct.price || 0) };
      if (index < 0) return [...current, line];
      return current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + choice.quantity } : item);
    });
    setChoice((current) => ({ ...current, size: '', quantity: 1 }));
  }

  function updateCart(index, quantity) {
    if (quantity <= 0) return setCart((current) => current.filter((_, itemIndex) => itemIndex !== index));
    const item = cart[index];
    const available = Number(products.find((product) => product.id === item.product_id)?.sizes
      ?.find((variant) => variant.size === item.size)?.quantity || 0);
    if (quantity > available) return setError(`Solo quedan ${available} unidades de ${item.product_name} talla ${item.size}.`);
    setCart((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity } : entry));
  }

  function whatsappUrl(registrationId, currentCart) {
    const detail = currentCart.map((item) => `• ${item.product_name} ${item.color}, talla ${item.size} x${item.quantity}`).join('\n');
    const text = `Hola RENJI, registré el pedido #${registrationId}.\n${detail}\nTotal de productos: ${totalItems}${total > 0 ? `\nSubtotal: ${money(total)}` : ''}`;
    const number = String(checkout.whatsapp_number || '').replace(/\D/g, '');
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }

  async function submit(event, method = 'whatsapp') {
    event?.preventDefault();
    if (submitting.current) return;
    if (!cart.length) return setError('Agrega al menos una prenda a tu pedido.');
    const submittedCart = [...cart];
    submitting.current = true;
    setSending(true);
    setError('');
    try {
      const first = submittedCart[0];
      const endpoint = isSeparation ? '/renji/public-separations' : isPaidRegistration ? '/renji/public-registrations' : '/renji/public-orders';
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ ...customer,
          items: submittedCart.map(({ product_id, item_type, size, quantity }) => ({ product_id, item_type, size, quantity })),
          product_id: first.product_id, selection_type: first.item_type, size: first.size,
          hoodie_size: first.item_type === 'hoodie' ? first.size : undefined,
          pants_size: first.item_type === 'pants' ? first.size : undefined,
          quantity: totalItems, request_key: requestKey.current })
      });
      if (method === 'payphone') {
        const payment = await api('/renji/payments/payphone/prepare', {
          method: 'POST', body: JSON.stringify({ registration_id: result.registration_id })
        });
        window.location.assign(payment.payment_url);
        return;
      }
      setReceipt({ ...result, email_address: customer.customer_email, method });
      setCart([]);
      setCustomer(emptyCustomer);
      requestKey.current = crypto.randomUUID();
      if (method === 'whatsapp') window.open(whatsappUrl(result.registration_id, submittedCart), '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.message);
    } finally {
      await refreshCatalog().catch(() => {});
      submitting.current = false;
      setSending(false);
    }
  }

  const payPhoneReady = checkout.payphone_configured && total > 0;

  return (
    <main className="renji-public-page renji-store-page">
      <section className="renji-store-shell">
        <header className="renji-store-nav"><span className="renji-store-logo">R</span><div><strong>RENJI</strong><small>STREETWEAR / ECUADOR</small></div><span className="renji-cart-pill"><ShoppingBag size={17} />{totalItems}</span></header>
        {paymentState === 'success' && <div className="renji-payment-message success"><CheckCircle2 size={19} />Pago aprobado. Tu pedido quedó registrado correctamente.</div>}
        {paymentState === 'cancelled' && <div className="renji-payment-message">El pago fue cancelado. Tu registro permanece reservado para que puedas contactarnos.</div>}
        {paymentState === 'failed' && <div className="renji-payment-message error">No pudimos confirmar el pago. No vuelvas a pagar sin antes contactarnos.</div>}

        <section className="renji-store-hero"><div><span>NUEVO DROP · STOCK LIMITADO</span><h1>Viste diferente.<br />Elige tu talla.</h1><p>Compra tus prendas RENJI en un solo pedido. El stock se aparta al registrar tus datos.</p><a href="#catalogo">Ver productos <ArrowRight size={17} /></a></div><img src="/renji/hoodie-toros-negros.png" alt="Hoodie Toros Negros RENJI" /></section>
        {error && <div className="alert error" role="alert">{error}</div>}

        <section id="catalogo" className="renji-store-section">
          <div className="renji-store-title"><span>01</span><div><h2>Elige tu producto</h2><p>Selecciona producto, talla y cantidad.</p></div></div>
          {loading ? <p>Cargando catálogo…</p> : <div className="renji-shop-grid">{products.map((product) => {
            const available = product.sizes.reduce((sum, row) => sum + Number(row.quantity), 0);
            const selected = choice.product_id === product.id;
            return <button type="button" key={product.id} className={`renji-shop-product ${selected ? 'selected' : ''}`} disabled={!product.active || !available} onClick={() => setChoice({ product_id: product.id, size: '', quantity: 1 })}>
              <div className="renji-shop-photo"><img src={product.image_url} alt={`${product.name} ${product.color}`} />{product.featured ? <b>NUEVO</b> : null}{selected && <i><Check size={16} /></i>}</div>
              <div className="renji-shop-copy"><small>{product.item_type === 'hoodie' ? 'HOODIE' : 'PANTALÓN'} · {product.color}</small><strong>{product.name}</strong><p>{product.description || 'Edición RENJI.'}</p><div>{Number(product.price) > 0 ? <><b>{money(product.price)}</b>{Number(product.compare_at_price) > Number(product.price) && <del>{money(product.compare_at_price)}</del>}</> : <b>Consultar precio</b>}<span>{available} disponibles</span></div></div>
            </button>;
          })}</div>}

          {chosenProduct && <div className="renji-configurator"><div><strong>{chosenProduct.name}</strong><span>Elige la talla</span></div><div className="renji-size-options">{chosenProduct.sizes.map((variant) => <button type="button" key={variant.size} disabled={!variant.quantity} className={choice.size === variant.size ? 'selected' : ''} onClick={() => setChoice((current) => ({ ...current, size: variant.size }))}><strong>{variant.size}</strong><small>{variant.quantity ? `${variant.quantity} disp.` : 'Agotada'}</small></button>)}</div>
            <div className="renji-add-row"><label>Cantidad<select value={choice.quantity} onChange={(e) => setChoice((current) => ({ ...current, quantity: Number(e.target.value) }))}>{Array.from({ length: Math.min(10, Math.max(1, selectedAvailable)) }, (_, index) => index + 1).map((quantity) => <option key={quantity}>{quantity}</option>)}</select></label><button type="button" onClick={addToCart} disabled={!choice.size}><Plus size={18} />Agregar al pedido</button></div></div>}
          <div className="renji-previous-drop"><LockKeyhole size={15} /><span>Conjunto Sukuna</span><b>AGOTADO</b></div>
        </section>

        <form className="renji-store-checkout" onSubmit={(event) => submit(event, 'whatsapp')}>
          <section className="renji-store-section"><div className="renji-store-title"><span>02</span><div><h2>Tu pedido</h2><p>Puedes combinar productos y tallas.</p></div></div>
            {!cart.length ? <div className="renji-empty-cart"><ShoppingBag /><span>Aún no agregas prendas.</span></div> : <div className="renji-cart-list">{cart.map((item, index) => <article key={`${item.product_id}-${item.size}`}><img src={item.image_url} alt="" /><div><strong>{item.product_name}</strong><span>{item.color} · Talla {item.size}</span>{item.price > 0 && <b>{money(item.price * item.quantity)}</b>}</div><div className="renji-quantity"><button type="button" onClick={() => updateCart(index, item.quantity - 1)}><Minus size={15} /></button><b>{item.quantity}</b><button type="button" onClick={() => updateCart(index, item.quantity + 1)}><Plus size={15} /></button></div><button className="renji-trash" type="button" onClick={() => updateCart(index, 0)} aria-label="Quitar"><Trash2 size={17} /></button></article>)}<div className="renji-cart-total"><span>{totalItems} {totalItems === 1 ? 'prenda' : 'prendas'}</span><strong>{total > 0 ? money(total) : 'Precio por confirmar'}</strong></div></div>}
          </section>

          <section className="renji-store-section"><div className="renji-store-title"><span>03</span><div><h2>Datos del cliente</h2><p>Llénalos una sola vez; sirven para todo el pedido y la guía.</p></div></div>
            <fieldset className="renji-customer-grid" disabled={sending}>
              <label>Nombres completos<input autoComplete="name" value={customer.customer_name} onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })} required /></label>
              <label>Cédula<input inputMode="numeric" value={customer.customer_cedula} onChange={(e) => setCustomer({ ...customer, customer_cedula: e.target.value })} required /></label>
              <label>Correo<input type="email" autoComplete="email" value={customer.customer_email} onChange={(e) => setCustomer({ ...customer, customer_email: e.target.value })} required /></label>
              <label>Celular / WhatsApp<input type="tel" autoComplete="tel" value={customer.customer_phone} onChange={(e) => setCustomer({ ...customer, customer_phone: e.target.value })} required /></label>
              <label>Ciudad<input autoComplete="address-level2" value={customer.customer_city} onChange={(e) => setCustomer({ ...customer, customer_city: e.target.value })} required /></label>
              <label>Dirección completa<input autoComplete="street-address" value={customer.customer_address} onChange={(e) => setCustomer({ ...customer, customer_address: e.target.value })} required /></label>
              <label>¿Dónde nos encontraste?<select value={customer.purchase_channel} onChange={(e) => setCustomer({ ...customer, purchase_channel: e.target.value })}><option value="other">WhatsApp / otro</option><option value="instagram">Instagram</option></select></label>
              <label>Instagram (opcional)<input value={customer.customer_instagram} onChange={(e) => setCustomer({ ...customer, customer_instagram: e.target.value })} placeholder="@usuario" /></label>
              {isSeparation && <label className="span-2">Valor transferido<input type="number" min="0.01" step="0.01" value={customer.deposit_amount} onChange={(e) => setCustomer({ ...customer, deposit_amount: e.target.value })} required /></label>}
            </fieldset>
          </section>

          <section className="renji-checkout-actions">{isPaidRegistration || isSeparation ? <button className="renji-whatsapp-checkout" type="submit" disabled={sending || !cart.length}>{sending ? 'Registrando…' : isSeparation ? 'Registrar mi separación' : 'Registrar pedido pagado'}<ArrowRight size={18} /></button> : <>
            <button className="renji-whatsapp-checkout" type="submit" disabled={sending || !cart.length}><MessageCircle size={20} />{sending ? 'Registrando…' : 'Continuar por WhatsApp'}</button>
            <button className="renji-payphone-checkout" type="button" disabled={sending || !cart.length || !payPhoneReady} onClick={(event) => submit(event, 'payphone')}><CreditCard size={20} />Pagar con PayPhone</button>
            {!checkout.payphone_configured && <small>PayPhone está preparado y se habilitará cuando RENJI conecte su cuenta.</small>}{checkout.payphone_configured && total <= 0 && <small>El pago en línea se habilita en productos con precio definido.</small>}
          </>}<p>Al continuar, el pedido y el stock quedan registrados. El envío se coordina con RENJI.</p></section>
        </form>

        {receipt && <div className="renji-push-overlay" role="dialog" aria-modal="true"><div className="renji-push-card"><CheckCircle2 size={38} /><strong>¡Pedido registrado!</strong><p>Registro #{receipt.registration_id}</p><div className="renji-receipt-items">{(receipt.items || []).map((item, index) => <span key={`${item.product_id}-${item.size}`}>{index + 1}. {item.product_name} · Talla {item.size} x{item.quantity}</span>)}</div><p>{receipt.email?.sent ? `Enviamos la confirmación a ${receipt.email_address}.` : 'Guarda tu número de registro y envíalo a RENJI.'}</p><button className="renji-primary" type="button" onClick={() => setReceipt(null)}>Entendido</button></div></div>}
      </section>
    </main>
  );
}
