export function transferSettings(db, establishmentId, eventId) {
  const settings = db.prepare('SELECT * FROM ticketing_payment_settings WHERE establishment_id = ?').get(establishmentId);
  const event = eventId ? db.prepare('SELECT transfer_qr_url FROM ticketing_events WHERE id = ? AND establishment_id = ?').get(eventId, establishmentId) : null;
  const qr = event?.transfer_qr_url || settings?.deuna_qr_url || '';
  return {
    ...settings,
    deuna_qr_url: qr,
    ready: Boolean(settings?.transfer_enabled && (settings.account_number || qr))
  };
}

export function transferInstructions(settings, order) {
  const message = `Hola, envio el comprobante de transferencia del pedido ${order.order_number} de ProTickets. Total: $${Number(order.total).toFixed(2)}. Por favor, verificar el pago y enviar las entradas al correo registrado.`;
  return {
    beneficiary: settings.beneficiary,
    bank_name: settings.bank_name,
    identification: settings.identification,
    account_number: settings.account_number,
    account_type: settings.account_type,
    deuna_qr_url: settings.deuna_qr_url,
    whatsapp: settings.whatsapp,
    whatsapp_url: `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(message)}`
  };
}

const cents = (value) => Math.round(Number(value || 0) * 100);
const dollars = (value) => value / 100;

// Allocate order-level cents without losing rounding differences across localities.
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let remaining = total;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1 ? remaining : Math.round(total * (sum ? weight / sum : 1 / weights.length));
    remaining -= value;
    return value;
  });
}

export function buildTicketSalesReport(orders, items, defaultFeePercent) {
  const groups = new Map();
  const totals = { quantity: 0, subtotal: 0, service_fee: 0, gross: 0, payphone_fee: 0, protickets_net: 0, event_net: 0 };
  let estimatedOrders = 0;
  for (const order of orders) {
    const lines = items.filter((item) => item.order_id === order.id);
    if (!lines.length) continue;
    const weights = lines.map((item) => cents(item.unit_price) * item.quantity);
    const gross = cents(order.total);
    const fee = order.payment_method === 'transfer' ? 0 : Math.round(gross * Number(order.provider_fee_rate ?? defaultFeePercent) / 100);
    if (order.payment_method !== 'transfer' && order.provider_fee_rate == null) estimatedOrders += 1;
    const grossParts = allocate(gross, weights);
    const baseParts = allocate(cents(order.subtotal), weights);
    const serviceParts = allocate(cents(order.service_fee), weights);
    const feeParts = allocate(fee, weights);
    lines.forEach((item, index) => {
      const key = JSON.stringify([order.event_id, item.ticket_type_id, item.ticket_name, cents(item.unit_price), order.payment_method]);
      const row = groups.get(key) || {
        event_title: order.event_title, locality: item.ticket_name, unit_price: Number(item.unit_price),
        payment_method: order.payment_method, quantity: 0, subtotal: 0, service_fee: 0,
        gross: 0, payphone_fee: 0, protickets_net: 0, event_net: 0
      };
      const values = {
        quantity: Number(item.quantity), subtotal: baseParts[index], service_fee: serviceParts[index],
        gross: grossParts[index], payphone_fee: feeParts[index],
        protickets_net: serviceParts[index] - feeParts[index],
        event_net: grossParts[index] - serviceParts[index]
      };
      for (const [field, value] of Object.entries(values)) {
        row[field] += value;
        totals[field] += value;
      }
      groups.set(key, row);
    });
  }
  const convert = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    key !== 'quantity' && Object.hasOwn(totals, key) ? dollars(value) : value
  ]));
  return { rows: [...groups.values()].map(convert), totals: convert(totals), orders: orders.length, estimated_orders: estimatedOrders };
}
