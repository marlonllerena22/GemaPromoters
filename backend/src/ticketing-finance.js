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
  const simpleGroups = new Map();
  const totals = { quantity: 0, subtotal: 0, service_fee: 0, gross: 0, payphone_fee: 0, protickets_net: 0, event_net: 0 };
  const simpleTotals = { ...totals, transfer_total: 0, payphone_total: 0 };
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

      const simpleKey = JSON.stringify([order.event_id, item.ticket_type_id, item.ticket_name]);
      const simpleRow = simpleGroups.get(simpleKey) || {
        event_title: order.event_title, locality: item.ticket_name, unit_price_cents: 0, purchase_quantity: 0,
        is_promo_golden: false,
        quantity: 0, subtotal: 0, service_fee: 0, gross: 0, payphone_fee: 0,
        protickets_net: 0, event_net: 0, transfer_total: 0, payphone_total: 0
      };
      const purchaseQuantity = Number(item.quantity);
      const normalizedName = String(item.ticket_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isPromoGolden = normalizedName.includes('promo golden');
      const admissionQuantity = purchaseQuantity * (isPromoGolden ? 2 : 1);
      simpleRow.unit_price_cents += cents(item.unit_price) * purchaseQuantity;
      simpleRow.purchase_quantity += purchaseQuantity;
      simpleRow.is_promo_golden ||= isPromoGolden;
      simpleRow.quantity += admissionQuantity;
      for (const field of ['subtotal', 'service_fee', 'gross', 'payphone_fee', 'protickets_net', 'event_net']) {
        simpleRow[field] += values[field];
        simpleTotals[field] += values[field];
      }
      const methodField = order.payment_method === 'transfer' ? 'transfer_total' : 'payphone_total';
      simpleRow[methodField] += values.gross;
      simpleTotals[methodField] += values.gross;
      simpleTotals.quantity += admissionQuantity;
      simpleGroups.set(simpleKey, simpleRow);
    });
  }
  const moneyFields = new Set(['subtotal', 'service_fee', 'gross', 'payphone_fee', 'protickets_net', 'event_net', 'transfer_total', 'payphone_total']);
  const convert = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, moneyFields.has(key) ? dollars(value) : value]));
  const simpleRows = [...simpleGroups.values()].map((row) => {
    const { unit_price_cents, ...values } = row;
    return { ...convert(values), unit_price: dollars(values.purchase_quantity ? Math.round(unit_price_cents / values.purchase_quantity) : 0) };
  });
  return {
    rows: [...groups.values()].map(convert), totals: convert(totals),
    simple_rows: simpleRows, simple_totals: convert(simpleTotals),
    orders: orders.length, estimated_orders: estimatedOrders
  };
}
