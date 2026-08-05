import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Clock,
  Copy,
  DollarSign,
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
  Settings2,
  Tags,
  BarChart3,
  Trash2,
  Truck,
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
  delivered: 'Enviado',
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
  delivered: 'Enviado',
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
  is_local_secretary: false,
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

const PAYMENT_TYPE_LABELS = {
  abono: 'Abono',
  cheque: 'Cheque',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  saldo: 'Saldo',
  otro: 'Otro'
};

const PAYMENT_STATUS_LABELS = {
  pending: 'Pendiente',
  paid: 'Pagado',
  cancelled: 'Cancelado'
};

const PAYMENT_METHOD_OPTIONS = [
  'Credito con cheques: 30 dias',
  'Credito con cheques: 30-60 dias',
  'Credito con cheques: 30-60-90 dias',
  'Contado: efectivo',
  'Contado: 50% al pedido y saldo a la entrega',
  'AB Y EF',
  'Abonos: semanales',
  'Abonos: quincenales'
];

const REMISSION_FORMATS = {
  producalza: {
    label: 'Producalza Rieker',
    owner: 'LLERENA VALDEZ LUIS GERMAN',
    business: 'PRODUCALZA RIEKER',
    logo: '/producalza/nota-logo-producalza.jpeg',
    ruc: '1802727196001',
    address: 'Imbabura s/n e Isidro Viteri - Ambato - Ecuador',
    phone: '032851293 - 0995858297',
    email: 'producalza@hotmail.com'
  },
  marjorie: {
    label: 'Marjorie Botas',
    owner: 'RODRIGUEZ BURGOS MARJORIE ELIZABETH',
    business: 'MARJORIE BOTAS',
    logo: '/producalza/nota-logo-marjorie.png',
    ruc: '1802973824001',
    address: 'Imbabura S/N y boca del lobo',
    phone: '099585297',
    email: 'marjoriebotas@hotmail.com'
  }
};

const RETURN_DESTINATIONS = [
  'Local Marjorie Botas Norte',
  'Local Marjorie Botas Sur',
  'Local Marjorie Botas Valle',
  'Sebastians'
];
const LOCAL_PAYMENT_METHODS = [
  ['efectivo', 'Efectivo'],
  ['transferencia', 'Transferencia'],
  ['tarjeta', 'Tarjeta']
];
const LOCAL_SALE_KIND_OPTIONS = [
  ['normal', 'Normal'],
  ['separated', 'Separado'],
  ['wholesale', 'Mayorista']
];
const LOCAL_FINANCE_GROUP_OPTIONS = [
  ['various', 'Gastos varios'],
  ['service', 'Servicios basicos'],
  ['deposit', 'Depositos'],
  ['admin', 'Gastos administrativos'],
  ['income', 'Otro ingreso']
];
const LOCAL_RENT_DEFAULTS = {
  'Local Marjorie Botas Norte': 760,
  'Local Marjorie Botas Sur': 287.5,
  'Local Marjorie Botas Valle': 550,
  Sebastians: 1042.5
};
const LOCAL_INTERNET_DEFAULTS = {
  'Local Marjorie Botas Norte': 29.21,
  'Local Marjorie Botas Valle': 29.21,
  Sebastians: 29.21
};
const LOCAL_STAFF_DEFAULTS = [
  { name: 'Liliana', local_name: 'Local Marjorie Botas Norte', monthly_salary: 550 },
  { name: 'Selena', local_name: 'Local Marjorie Botas Sur', monthly_salary: 500 },
  { name: 'Nayeli', local_name: 'Local Marjorie Botas Valle', monthly_salary: 482 },
  { name: 'Belen', local_name: 'Sebastians', monthly_salary: 600 },
  { name: 'Yamileth sabado', local_name: '', monthly_salary: 20 },
  { name: 'Yamileth domingo', local_name: '', monthly_salary: 15 }
];
const LOCAL_SELLERS = {
  'Local Marjorie Botas Norte': ['Liliana'],
  'Local Marjorie Botas Sur': ['Yamileth', 'Selena'],
  'Local Marjorie Botas Valle': ['Nayeli', 'Yamileth'],
  Sebastians: ['Belen', 'Yamileth']
};
const MARJORIE_GUIDE_TEMPLATE_KEY = 'standard-marjorie';
const SEBASTIANS_GUIDE_TEMPLATE_KEY = 'standard-c-andrade';

function localSaleCommission(localName, amountValue, configuration = null) {
  const amount = Number(amountValue || 0);
  const schemeKey = String(localName || '').toLowerCase().includes('sebastian') ? 'sebastians' : 'marjorie';
  const configuredRules = configuration?.commission_schemes
    ?.find((scheme) => scheme.scheme_key === schemeKey)?.rules || [];
  if (configuredRules.length) {
    const matchingRule = [...configuredRules]
      .sort((left, right) => Number(right.min_amount || 0) - Number(left.min_amount || 0))
      .find((rule) => amount >= Number(rule.min_amount || 0));
    return Number(matchingRule?.commission_amount || 0);
  }
  const isSebastians = String(localName || '').toLowerCase().includes('sebastian');
  if (isSebastians) {
    if (amount >= 185) return 3;
    if (amount >= 160) return 2.5;
    if (amount >= 135) return 2;
    if (amount >= 110) return 1.5;
    if (amount >= 85) return 1;
    if (amount >= 60) return 0.75;
    if (amount >= 35) return 0.5;
    return 0;
  }
  if (amount >= 150) return 3;
  if (amount >= 120) return 2.5;
  if (amount >= 100) return 2;
  if (amount >= 80) return 1.5;
  if (amount >= 60) return 1;
  if (amount >= 40) return 0.75;
  if (amount >= 20) return 0.5;
  return 0;
}

const emptyPayment = {
  payment_type: 'abono',
  amount: '',
  payment_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  status: 'paid',
  bank: '',
  reference: '',
  notes: ''
};

const emptyUpcomingPayment = {
  payment_type: 'cheque',
  amount: '',
  payment_date: '',
  due_date: '',
  status: 'pending',
  bank: '',
  reference: '',
  notes: ''
};

function emptyModel() {
  return {
    model_code: '',
    color: '',
    material: '',
    notes: '',
    plant_area: '',
    unit_price: '',
    status: 'received',
    sizes: Object.fromEntries(SIZES.map((size) => [size, 0]))
  };
}

function emptyOrder() {
  return {
    is_sample: false,
    sample_destination: '',
    client_id: '',
    seller_user_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    delivery_date: '',
    origin_label: '',
    card_alert: '',
    brand: '',
    payment_method: '',
    bank_reference: '',
    guide_template_key: '',
    general_notes: '',
    shipping_value: '',
    discount_value: '',
    invoice_number: '',
    invoice_date: '',
    invoice_value: '',
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

function modelValue(model) {
  return totalModel(model) * Number(model.unit_price || 0);
}

function orderSubtotal(order) {
  return (order.models || []).reduce((sum, model) => sum + modelValue(model), 0);
}

function orderTotalValue(order) {
  return Math.max(0, orderSubtotal(order) + Number(order.shipping_value || 0) - Number(order.discount_value || 0));
}

function deliveryValuesFromOrder(order) {
  const remainingModels = deliveryModelsAfterReturns(order);
  return {
    shipping_value: order.shipping_value || '',
    discount_mode: 'value',
    discount_value: order.discount_value || '',
    discount_percent: '',
    models: remainingModels.map((model) => ({
      id: model.id,
      model_code: model.model_code,
      material: model.material,
      color: model.color,
      total_pairs: Number(model.total_pairs || 0),
      unit_price: model.unit_price || '',
      not_sent: false
    }))
  };
}

function deliverySubtotal(form) {
  return (form.models || []).reduce(
    (sum, model) => model.not_sent ? sum : sum + Number(model.total_pairs || 0) * Number(model.unit_price || 0),
    0
  );
}

function deliveryDiscountAmount(form) {
  const subtotal = deliverySubtotal(form);
  if (form.discount_mode === 'percent') {
    return Math.max(0, subtotal * (Number(form.discount_percent || 0) / 100));
  }
  return Math.max(0, Number(form.discount_value || 0));
}

function deliveryTotal(form) {
  return Math.max(0, deliverySubtotal(form) + Number(form.shipping_value || 0) - deliveryDiscountAmount(form));
}

function emptyInvoiceFormFromOrder(order) {
  return {
    invoice_number: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    invoice_value: '',
    item_quantities: {}
  };
}

function sumSelectionPairs(selection = {}) {
  return Object.values(selection || {}).reduce((sum, sizes) => (
    sum + Object.values(sizes || {}).reduce((inner, qty) => inner + Number(qty || 0), 0)
  ), 0);
}

function invoiceSelectionValue(order, selection = {}) {
  return (order.models || []).reduce((sum, model) => {
    const pairs = Object.values(selection[String(model.id)] || {}).reduce((inner, qty) => inner + Number(qty || 0), 0);
    return sum + pairs * Number(model.unit_price || 0);
  }, 0);
}

function remainingInvoiceQuantities(order) {
  const remaining = {};
  for (const model of order.models || []) {
    remaining[String(model.id)] = {};
    for (const size of SIZES) {
      remaining[String(model.id)][size] = Number(model.sizes?.[size] || 0);
    }
  }
  for (const invoice of order.invoices || []) {
    for (const [modelId, sizes] of Object.entries(invoice.item_quantities || {})) {
      for (const [size, qty] of Object.entries(sizes || {})) {
        remaining[modelId] ||= {};
        remaining[modelId][size] = Math.max(0, Number(remaining[modelId][size] || 0) - Number(qty || 0));
      }
    }
  }
  return remaining;
}

function cleanSelection(selection = {}) {
  const cleaned = {};
  for (const [modelId, sizes] of Object.entries(selection || {})) {
    const row = {};
    for (const [size, qty] of Object.entries(sizes || {})) {
      const value = Math.max(0, Math.floor(Number(qty || 0)));
      if (value > 0) row[size] = value;
    }
    if (Object.keys(row).length) cleaned[modelId] = row;
  }
  return cleaned;
}

function guideTemplateKeyForDestination(destination) {
  const text = normalizeText(destination);
  if (text.includes('sebastian')) return SEBASTIANS_GUIDE_TEMPLATE_KEY;
  if (text.includes('marjorie')) return MARJORIE_GUIDE_TEMPLATE_KEY;
  return '';
}

function shortDestinationName(destination) {
  return String(destination || '')
    .replace(/^Local\s+/i, '')
    .replace(/^Marjorie Botas\s+/i, 'Marjorie ')
    .trim();
}

function returnDestinationsForOrder(order) {
  return [...new Set((order.return_allocations || []).map((item) => item.destination).filter(Boolean))];
}

function orderForReturnDestination(order, destination, note = null) {
  const allocations = (order.return_allocations || []).filter((item) => item.destination === destination);
  if (!allocations.length) return order;
  const prices = note?.model_prices || {};
  const byModel = new Map();
  for (const allocation of allocations) {
    const modelId = Number(allocation.return_model_id);
    const baseModel = (order.models || []).find((model) => Number(model.id) === modelId);
    if (!baseModel) continue;
    if (!byModel.has(modelId)) {
      byModel.set(modelId, {
        ...baseModel,
        unit_price: prices[modelId] ?? baseModel.unit_price,
        sizes: Object.fromEntries(SIZES.map((size) => [size, 0])),
        total_pairs: 0
      });
    }
    const model = byModel.get(modelId);
    const size = Number(allocation.size);
    const quantity = Number(allocation.quantity || 0);
    model.sizes[size] = Number(model.sizes[size] || 0) + quantity;
    model.total_pairs += quantity;
  }
  return {
    ...order,
    client_name: destination,
    business_name: destination,
    guide_template_key: guideTemplateKeyForDestination(destination) || order.guide_template_key,
    client_guide_logo_url: '',
    shipping_value: note?.shipping_value ?? order.shipping_value ?? 0,
    discount_value: note?.discount_value ?? order.discount_value ?? 0,
    delivery_note_title: note?.title || `Nota de devolucion - ${destination}`,
    delivery_note_number: note?.note_number,
    delivery_note_destination: destination,
    general_notes: [order.general_notes, `Devolucion recibida desde ${order.client_name || 'cliente'}`].filter(Boolean).join(' / '),
    models: [...byModel.values()]
  };
}

function returnedRowsForOrder(order) {
  const rowsByKey = new Map();
  for (const item of order.returned_allocations || []) {
    const key = `${item.source_model_id}-${item.destination}`;
    const current = rowsByKey.get(key) || {
      id: key,
      source_model_id: Number(item.source_model_id || 0),
      destination: item.destination,
      return_order_number: item.return_order_number,
      model_code: item.model_code,
      material: item.material,
      color: item.color,
      unit_price: Number(item.unit_price || 0),
      total_pairs: 0,
      sizes: Object.fromEntries(SIZES.map((size) => [size, 0]))
    };
    const quantity = Number(item.quantity || 0);
    current.total_pairs += quantity;
    current.sizes[Number(item.size)] = Number(current.sizes[Number(item.size)] || 0) + quantity;
    rowsByKey.set(key, current);
  }
  return [...rowsByKey.values()];
}

function returnedQuantitiesByModelSize(order) {
  return (order.returned_allocations || []).reduce((map, item) => {
    const modelId = Number(item.source_model_id || 0);
    const size = Number(item.size || 0);
    if (!modelId || !size) return map;
    const modelSizes = map[modelId] || {};
    modelSizes[size] = Number(modelSizes[size] || 0) + Number(item.quantity || 0);
    map[modelId] = modelSizes;
    return map;
  }, {});
}

function deliveryModelsAfterReturns(order) {
  const returned = returnedQuantitiesByModelSize(order);
  return (order.models || [])
    .map((model) => {
      const sizes = Object.fromEntries(SIZES.map((size) => {
        const ordered = Number(model.sizes?.[size] || 0);
        const returnedQty = Number(returned[Number(model.id)]?.[size] || 0);
        return [size, Math.max(0, ordered - returnedQty)];
      }));
      const totalPairs = SIZES.reduce((sum, size) => sum + Number(sizes[size] || 0), 0);
      return {
        ...model,
        sizes,
        total_pairs: totalPairs
      };
    })
    .filter((model) => Number(model.total_pairs || 0) > 0);
}

function returnedCreditForOrder(order) {
  return returnedRowsForOrder(order).reduce(
    (sum, row) => sum + Number(row.total_pairs || 0) * Number(row.unit_price || 0),
    0
  );
}

function deliveryOrderFromNote(order, note) {
  if (order.order_type === 'return' && note?.destination) {
    return orderForReturnDestination(order, note.destination, note);
  }
  const modelIds = new Set((note.model_ids || []).map((id) => Number(id)));
  const prices = note.model_prices || {};
  return {
    ...order,
    shipping_value: note.shipping_value || 0,
    discount_value: note.discount_value || 0,
    delivery_note_title: note.title,
    delivery_note_number: note.note_number,
    returned_allocations: (order.returned_allocations || []).filter((item) => modelIds.has(Number(item.source_model_id))),
    models: (order.models || [])
      .filter((model) => modelIds.has(Number(model.id)))
      .map((model) => ({
        ...model,
        unit_price: prices[Number(model.id)] ?? model.unit_price
      }))
  };
}

function remissionGuideValuesFromOrder(order) {
  const guide = (order.remission_guides || [])[0] || {};
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: guide.id || '',
    guide_number: guide.guide_number || '',
    format_type: guide.format_type || 'producalza',
    issue_date: guide.issue_date || today,
    departure_place: guide.departure_place || 'PRODUCALZA RIEKER - Imbabura s/n e Isidro Viteri - Ambato - Ecuador',
    arrival_place: guide.arrival_place || [order.city, order.address].filter(Boolean).join(' - '),
    recipient_name: guide.recipient_name || order.client_name || '',
    recipient_business_name: guide.recipient_business_name || order.business_name || order.client_name || '',
    recipient_tax_id: guide.recipient_tax_id || order.tax_id || '',
    sale_receipt: guide.sale_receipt || order.invoice_number || order.order_number || '',
    departure_time: guide.departure_time || '',
    arrival_time: guide.arrival_time || '',
    transfer_reason: guide.transfer_reason || 'VENTA',
    carrier_identification: guide.carrier_identification || '',
    description: guide.description || ''
  };
}

function deliveryNoteEditValues(order, note) {
  const noteOrder = deliveryOrderFromNote(order, note);
  return {
    shipping_value: note.shipping_value ?? 0,
    discount_value: note.discount_value ?? 0,
    models: (noteOrder.models || []).map((model) => ({
      id: model.id,
      model_code: model.model_code,
      color: model.color,
      material: model.material,
      total_pairs: model.total_pairs,
      unit_price: note.model_prices?.[Number(model.id)] ?? model.unit_price ?? 0
    }))
  };
}

function paymentTotalsFromList(payments = []) {
  return payments.reduce((totals, payment) => {
    if (payment.status === 'paid') totals.paid += Number(payment.amount || 0);
    if (payment.status === 'pending') totals.pending += Number(payment.amount || 0);
    return totals;
  }, { paid: 0, pending: 0 });
}

function paymentSummaryValues(payments = []) {
  const totals = paymentTotalsFromList(payments);
  return {
    paid_total: totals.paid.toFixed(2),
    pending_total: totals.pending.toFixed(2)
  };
}

function paymentDetailText(payment = {}) {
  const parts = [
    payment.bank ? `Banco: ${payment.bank}` : '',
    payment.reference ? `Ref/Cheque: ${payment.reference}` : '',
    payment.notes ? `Obs: ${payment.notes}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'Sin detalle adicional';
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

function displayShortDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' }).replace('.', '');
}

function displayMonthYear(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }).toUpperCase();
}

function displayNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString('es-EC', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function displayMoney(value) {
  return `$${displayNumber(value, 2)}`;
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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function clientGender(order) {
  const text = normalizeText(`${order.client_classification || ''} ${order.client_name || ''}`);
  if (/\b(mujer|femenino|senora|sra|srta|miss)\b/.test(text)) return 'female';
  if (/\b(hombre|masculino|senor|sr|mister)\b/.test(text)) return 'male';
  return '';
}

function orderWhatsappMessage(order, today) {
  const gender = clientGender(order);
  if (gender === 'female') {
    return `Buenas tardes, estimada ${order.client_name}. Le compartimos el pedido registrado el ${today} para su revision. Quedamos atentos a cualquier observacion. Muchas gracias.`;
  }
  if (gender === 'male') {
    return `Buenas tardes, estimado ${order.client_name}. Le compartimos el pedido registrado el ${today} para su revision. Quedamos atentos a cualquier observacion. Muchas gracias.`;
  }
  return `Buenas tardes. Le compartimos el pedido registrado a nombre de ${order.client_name} el ${today} para su revision. Quedamos atentos a cualquier observacion. Muchas gracias.`;
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(reader.result);
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
  const [remissionGuides, setRemissionGuides] = useState([]);
  const [clientActivity, setClientActivity] = useState([]);
  const [users, setUsers] = useState([]);
  const [guideTemplates, setGuideTemplates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payrollPeriods, setPayrollPeriods] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [clientAlertTarget, setClientAlertTarget] = useState(null);
  const [paymentAlertTarget, setPaymentAlertTarget] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printState, setPrintState] = useState(null);
  const isAdmin = ['admin', 'supreme', 'production_admin'].includes(user?.role);
  const isLocalSecretary = Boolean(user?.is_local_secretary);
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
        nextRemissionGuides,
        nextClientActivity,
        staticGuideTemplates,
        managedGuideTemplates,
        nextEmployees,
        nextPayrollPeriods
      ] = await Promise.all([
        api(scope('/producalza/bootstrap')),
        api(scope('/producalza/dashboard')),
        api(scope('/producalza/clients')),
        api(scope('/producalza/orders')),
        api(scope('/producalza/production')),
        isAdmin ? api(scope('/producalza/remission-guides')) : Promise.resolve([]),
        isAdmin ? api(scope('/producalza/client-activity-report')) : Promise.resolve([]),
        fetch('/producalza/guides/templates.json').then((response) => response.ok ? response.json() : []),
        api(scope('/producalza/guide-templates')),
        isAdmin ? api(scope('/producalza/employees')) : Promise.resolve([]),
        isAdmin ? api(scope('/producalza/payroll-periods')) : Promise.resolve([])
      ]);
      setBootstrap(nextBootstrap);
      setDashboard(nextDashboard);
      setClients(nextClients);
      setOrders(nextOrders);
      setProduction(nextProduction);
      setRemissionGuides(nextRemissionGuides || []);
      setClientActivity(nextClientActivity);
      setUsers(nextBootstrap.users || []);
      setGuideTemplates(mergeGuideTemplates(staticGuideTemplates || [], managedGuideTemplates || []));
      setEmployees(nextEmployees || []);
      setPayrollPeriods(nextPayrollPeriods || []);
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

  async function printRemissionFromRegistry(guide) {
    try {
      const order = await api(scope(`/producalza/orders/${guide.order_id}`));
      const selectedGuide = (order.remission_guides || []).find((item) => Number(item.id) === Number(guide.id)) || guide;
      setPrintState({ order: { ...order, selected_remission_guide: selectedGuide }, type: 'remission-guide', modelId: null, guideTemplateKey: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function preparePrint(orderId, type, modelId = null, orderOverride = null, options = {}) {
    const rawOrder = orderOverride || (selectedOrder?.id === orderId
      ? selectedOrder
      : await api(scope(`/producalza/orders/${orderId}`)));
    const localSampleGuideKey = rawOrder.is_sample ? guideTemplateKeyForDestination(rawOrder.sample_destination) : '';
    const order = type === 'guides' && localSampleGuideKey
      ? { ...rawOrder, guide_template_key: localSampleGuideKey, client_guide_logo_url: '' }
      : rawOrder;
    const guideTemplateKey = options.guideTemplateKey
      || localSampleGuideKey
      || resolveGuideTemplateKey(order, guideTemplates);
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
    const previousTitle = document.title;
    if (printState.type === 'guides') {
      document.title = '\u200b';
    }
    const clearPrint = () => {
      document.title = previousTitle;
      setPrintState(null);
    };

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
      document.title = previousTitle;
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
    ...(isAdmin ? [['remissions', 'Remisiones', FileDown]] : []),
    ...(isAdmin || isLocalSecretary ? [['reports', 'Reportes', BarChart3]] : []),
    ...(isLocalSecretary ? [['local-attendance', 'Empleadas', Clock]] : []),
    ...(isAdmin ? [['payroll', 'Roles', DollarSign]] : []),
    ...(isAdmin ? [['guide-templates', 'Guias', Tags]] : []),
    ...(isAdmin ? [['users', 'Usuarios', UserPlus]] : [])
  ];

  const currentLabel = nav.find(([key]) => key === view)?.[1]
    || (view === 'order-detail'
      ? selectedOrder?.order_type === 'return' ? 'Detalle de devolucion' : 'Detalle del pedido'
      : 'Producalza');

  const content = loading ? (
    <div className="prod-empty">Cargando Producalza...</div>
  ) : (
    <>
      {error && <div className="alert error prod-alert">{error}</div>}
      {notice && <div className="alert success prod-alert">{notice}</div>}
      {view === 'dashboard' && (
        <ProductionDashboard
          data={dashboard}
          orders={orders}
          onOpen={openOrder}
          onOpenFollowUp={(item) => {
            setClientAlertTarget({ clientId: item.client_id, visitId: item.id, token: Date.now() });
            setView('clients');
          }}
          onOpenPayment={(item) => {
            setPaymentAlertTarget({ orderId: item.order_id, paymentId: item.id, token: Date.now() });
            openOrder(item.order_id);
          }}
        />
      )}
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
          isLocalSecretary={isLocalSecretary}
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
          onPrint={(type, modelId, orderOverride, options) => preparePrint(selectedOrder.id, type, modelId, orderOverride, options)}
          onUpdated={async (message = 'Pedido actualizado') => {
            const updatedOrder = await api(scope(`/producalza/orders/${selectedOrder.id}`));
            setSelectedOrder(updatedOrder);
            await refresh(message);
          }}
          onReturnCreated={async (returnOrder) => {
            setSelectedOrder(returnOrder);
            setView('order-detail');
            await refresh('Devolucion creada');
          }}
          guideTemplates={guideTemplates}
          focusPayment={paymentAlertTarget}
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
          alertTarget={clientAlertTarget}
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
      {view === 'remissions' && isAdmin && (
        <RemissionGuidesRegistry
          guides={remissionGuides}
          scope={scope}
          setError={setError}
          setGuides={setRemissionGuides}
          onOpen={openOrder}
          onPrint={printRemissionFromRegistry}
        />
      )}
      {view === 'reports' && (isAdmin || isLocalSecretary) && (
        isLocalSecretary ? (
          <LocalSecretaryReports
            dashboard={dashboard}
            orders={orders}
            production={production}
            scope={scope}
            onRefresh={refresh}
            setError={setError}
          />
        ) : (
          <ProductionReports
            dashboard={dashboard}
            orders={orders}
            clientActivity={clientActivity}
            scope={scope}
            setError={setError}
          />
        )
      )}
      {view === 'local-attendance' && isLocalSecretary && (
        <LocalAttendanceAdmin scope={scope} setError={setError} />
      )}
      {view === 'payroll' && isAdmin && (
        <PayrollView
          employees={employees}
          periods={payrollPeriods}
          scope={scope}
          onRefresh={refresh}
          setError={setError}
        />
      )}
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
                <span>{isLocalSecretary ? 'Locales y produccion' : 'Pedidos y produccion'}</span>
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
                <span>{isAdmin ? 'Administrador' : isLocalSecretary ? 'Secretaria locales' : 'Vendedor'}</span>
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

function ProductionDashboard({ data, orders, onOpen, onOpenFollowUp, onOpenPayment }) {
  const metrics = [
    ['Pedidos nuevos', data?.new_orders || 0, ClipboardList],
    ['En produccion', data?.in_production || 0, Factory],
    ['Terminados', data?.finished || 0, PackageCheck],
    ['Pares pendientes', data?.pending_pairs || 0, Boxes]
  ];
  const followUpAlerts = data?.follow_up_alerts || [];
  const paymentAlerts = data?.payment_alerts || [];
  const today = new Date().toISOString().slice(0, 10);
  const alertSection = followUpAlerts.length > 0 && (
    <section className="prod-panel prod-followup-alerts top">
      <div className="prod-panel-title">
        <div><span>Seguimientos</span><h2>Alertas proximas</h2></div>
        <strong>{followUpAlerts.length}</strong>
      </div>
      <div className="prod-followup-alert-list">
        {followUpAlerts.map((item) => {
          const isOverdue = item.next_visit_date < today;
          const isToday = item.next_visit_date === today;
          const isPhysicalVisit = Number(item.alert_hours || 24) === 96;
          return (
            <button type="button" className={`${isOverdue ? 'overdue' : isToday ? 'today' : ''} alert-window ${isPhysicalVisit ? 'visit-window' : ''}`} key={item.id} onClick={() => onOpenFollowUp?.(item)}>
              <div>
                <strong>{item.client_name}</strong>
                <span>{item.city || 'Sin ciudad'} - {VISIT_TYPE_LABELS[item.next_visit_type] || VISIT_TYPE_LABELS[item.visit_type] || 'Seguimiento'}</span>
              </div>
              <div>
                <b>{isOverdue ? 'Vencido' : isToday ? 'Hoy' : isPhysicalVisit ? 'Visita 96h' : '24h'}</b>
                <small>{displayDate(item.next_visit_date)}</small>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
  const paymentAlertSection = paymentAlerts.length > 0 && (
    <section className="prod-panel prod-followup-alerts prod-payment-alerts top">
      <div className="prod-panel-title">
        <div><span>Cobros</span><h2>Proximos cobros</h2></div>
        <strong>{paymentAlerts.length}</strong>
      </div>
      <div className="prod-followup-alert-list">
        {paymentAlerts.map((item) => {
          const isOverdue = item.due_date < today;
          const isToday = item.due_date === today;
          return (
            <button type="button" className={`${isOverdue ? 'overdue' : isToday ? 'today' : ''} alert-window payment-window`} key={item.id} onClick={() => onOpenPayment?.(item)}>
              <DollarSign size={19} />
              <div>
                <strong>{item.client_name}</strong>
                <span>{item.order_number} - {PAYMENT_TYPE_LABELS[item.payment_type] || 'Cobro'} - {item.city || 'Sin ciudad'}</span>
              </div>
              <div>
                <b>{displayMoney(item.amount)}</b>
                <small>{isOverdue ? 'Vencido' : isToday ? 'Hoy' : displayDate(item.due_date)}</small>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
  return (
    <div className="prod-stack">
      {paymentAlertSection}
      {alertSection}
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

  async function markShipped(order) {
    if (!window.confirm(`Marcar el pedido ${order.order_number} como ENVIADO? Se registrara la fecha de despacho de hoy para el reporte mensual.`)) return;
    try {
      await api(scope(`/producalza/orders/${order.id}/shipped`), {
        method: 'PATCH',
        body: JSON.stringify({ dispatched_date: new Date().toISOString().slice(0, 10) })
      });
      onRefresh('Pedido marcado como enviado');
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
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Fecha</th><th>Modelos</th><th>Pares</th><th>Cobros</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <button className="prod-link-button" onClick={() => onOpen(order.id)}>{order.order_number}</button>
                    {order.order_type === 'return' && <small className="prod-return-chip">Devolucion de {order.parent_order_number || 'pedido'}</small>}
                    {Boolean(order.is_sample) && <small className="prod-sample-chip">Muestra · {order.sample_destination || 'Sin destino'}</small>}
                  </td>
                  <td><strong>{order.client_name}</strong><small>{order.city}</small></td>
                  <td>{order.seller_name || 'Sin asignar'}</td>
                  <td>{displayDate(order.order_date)}</td>
                  <td>{order.model_count}</td>
                  <td>{order.total_pairs}</td>
                  <td><strong>{displayMoney(order.total_paid)}</strong><small>Pend. {displayMoney(order.total_pending)}</small></td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>
                    <div className="prod-row-actions">
                      {isAdmin && order.status !== 'delivered' && (
                        <button className="success text" title="Marcar como enviado" onClick={() => markShipped(order)}>ENVIADO</button>
                      )}
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

function RemissionGuidesRegistry({ guides, scope, setError, setGuides, onOpen, onPrint }) {
  const [filters, setFilters] = useState({ guide_number: '', client: '', date_from: '', date_to: '', format_type: '' });
  const [loading, setLoading] = useState(false);

  async function applyFilters() {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
    setLoading(true);
    try {
      setGuides(await api(scope(`/producalza/remission-guides?${query.toString()}`)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="prod-stack">
      <section className="prod-filterbar">
        <label className="prod-search">
          <Search size={17} />
          <input
            placeholder="Numero de guia"
            value={filters.guide_number}
            onChange={(event) => setFilters({ ...filters, guide_number: event.target.value })}
          />
        </label>
        <input
          placeholder="Cliente o destinatario"
          value={filters.client}
          onChange={(event) => setFilters({ ...filters, client: event.target.value })}
        />
        <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
        <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
        <select value={filters.format_type} onChange={(event) => setFilters({ ...filters, format_type: event.target.value })}>
          <option value="">Todos los formatos</option>
          {Object.entries(REMISSION_FORMATS).map(([value, format]) => <option value={value} key={value}>{format.label}</option>)}
        </select>
        <button className="prod-secondary-button" disabled={loading} onClick={applyFilters}>
          <Filter size={17} />{loading ? 'Filtrando...' : 'Filtrar'}
        </button>
      </section>
      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Registro</span><h2>Guias de remision emitidas</h2></div>
          <strong>{guides.length} guias</strong>
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Guia</th><th>Formato</th><th>Fecha</th><th>Cliente</th><th>Destino</th><th>Pedido</th><th /></tr></thead>
            <tbody>
              {guides.map((guide) => (
                <tr key={guide.id}>
                  <td><strong>{String(guide.guide_number).padStart(8, '0')}</strong></td>
                  <td>{REMISSION_FORMATS[guide.format_type || 'producalza']?.label || 'Producalza Rieker'}</td>
                  <td>{displayDate(guide.issue_date)}</td>
                  <td><strong>{guide.recipient_name || guide.client_name}</strong><small>{guide.recipient_business_name || guide.client_business_name || ''}</small></td>
                  <td>{guide.arrival_place || guide.client_city || ''}</td>
                  <td><button className="prod-link-button" onClick={() => onOpen(guide.order_id)}>{guide.order_number}</button></td>
                  <td>
                    <div className="prod-row-actions">
                      <button title="Imprimir guia" onClick={() => onPrint(guide)}><Printer size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!guides.length && <div className="prod-empty">No hay guias con esos filtros.</div>}
        </div>
      </section>
    </div>
  );
}

function OrderForm({ clients, users, isAdmin, isLocalSecretary, scope, initialOrder, onCancel, onSaved, setError, guideTemplates }) {
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

  function duplicateModel(index) {
    setForm((current) => {
      const source = current.models[index] || emptyModel();
      const duplicated = {
        ...source,
        id: undefined,
        card_number: undefined,
        model_code: '',
        sizes: { ...(source.sizes || {}) }
      };
      return {
        ...current,
        models: [
          ...current.models.slice(0, index + 1),
          duplicated,
          ...current.models.slice(index + 1)
        ]
      };
    });
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
          {!isLocalSecretary && (
            <button className="prod-secondary-button align-end" type="button" onClick={() => setShowNewClient((value) => !value)}>
              <UserPlus size={17} />Nuevo cliente
            </button>
          )}
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
          <label>Tipo de pedido
            <select
              value={form.is_sample ? 'sample' : 'normal'}
              onChange={(event) => setForm({
                ...form,
                is_sample: event.target.value === 'sample',
                sample_destination: event.target.value === 'sample' ? form.sample_destination : ''
              })}
            >
              <option value="normal">Pedido normal</option>
              <option value="sample">Pedido de muestras</option>
            </select>
          </label>
          {form.is_sample && (
            <label>Local destino
              <select value={form.sample_destination} onChange={(event) => setForm({ ...form, sample_destination: event.target.value })}>
                <option value="">Seleccionar local</option>
                {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
              </select>
            </label>
          )}
          <label>Fecha<input type="date" value={form.order_date} onChange={(event) => setForm({ ...form, order_date: event.target.value })} /></label>
          <label>Fecha de entrega<input value={form.delivery_date} onChange={(event) => setForm({ ...form, delivery_date: event.target.value })} /></label>
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
          <label>Forma de pago
            <select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}>
              <option value="">Seleccionar forma de pago</option>
              {PAYMENT_METHOD_OPTIONS.map((item) => <option value={item} key={item}>{item}</option>)}
              {form.payment_method && !PAYMENT_METHOD_OPTIONS.includes(form.payment_method) && <option value={form.payment_method}>{form.payment_method}</option>}
            </select>
          </label>
          <label>Referencia bancaria<input value={form.bank_reference} onChange={(event) => setForm({ ...form, bank_reference: event.target.value })} /></label>
          <label>Etiqueta de origen<input value={form.origin_label} onChange={(event) => setForm({ ...form, origin_label: event.target.value })} /></label>
          <label>Texto rojo tarjeta<input value={form.card_alert} onChange={(event) => setForm({ ...form, card_alert: event.target.value })} /></label>
          <label>Valor envio<input type="number" min="0" step="0.01" value={form.shipping_value} onChange={(event) => setForm({ ...form, shipping_value: event.target.value })} /></label>
          <label>Descuento<input type="number" min="0" step="0.01" value={form.discount_value} onChange={(event) => setForm({ ...form, discount_value: event.target.value })} /></label>
          <label className="span-full">Observaciones generales<textarea value={form.general_notes} onChange={(event) => setForm({ ...form, general_notes: event.target.value })} /></label>
        </div>
      </section>

      {showNewClient && !isLocalSecretary && (
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
              <div className="prod-row-actions">
                <button className="prod-secondary-button compact" type="button" onClick={() => duplicateModel(index)}>
                  <Copy size={16} />Duplicar
                </button>
                {form.models.length > 1 && (
                  <button className="prod-icon-button danger" type="button" onClick={() => setForm({ ...form, models: form.models.filter((_, itemIndex) => itemIndex !== index) })}>
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </div>
            <div className="prod-form-grid">
              <label>Codigo o modelo<input value={model.model_code} onChange={(event) => updateModel(index, { model_code: event.target.value })} /></label>
              <label>Color<input value={model.color} onChange={(event) => updateModel(index, { color: event.target.value })} /></label>
              <label>Material o descripcion<input value={model.material} onChange={(event) => updateModel(index, { material: event.target.value })} /></label>
              <label>Planta<input value={model.plant_area} onChange={(event) => updateModel(index, { plant_area: event.target.value })} /></label>
              <label>Precio unitario<input type="number" min="0" step="0.01" value={model.unit_price || ''} onChange={(event) => updateModel(index, { unit_price: event.target.value })} /></label>
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
            <div className="prod-model-total">Total del modelo <strong>{totalModel(model)} pares · {displayMoney(modelValue(model))}</strong></div>
          </section>
        ))}
      </div>
      <button className="prod-add-model" onClick={() => setForm({ ...form, models: [...form.models, emptyModel()] })}>
        <Plus size={19} />Agregar otro modelo
      </button>
      <section className="prod-order-summary">
        <div><span>Resumen del pedido</span><strong>{form.models.length} modelos · {grandTotal} pares · {displayMoney(orderTotalValue(form))}</strong></div>
        <div className="prod-form-actions">
          <button className="prod-secondary-button" disabled={saving} onClick={() => save('draft')}><Save size={17} />Guardar borrador</button>
          <button className="prod-primary-button" disabled={saving} onClick={() => save('received')}><Check size={17} />Confirmar pedido</button>
        </div>
      </section>
    </div>
  );
}

function OrderDetail({ order, isAdmin, scope, setError, onBack, onEdit, onPrint, onUpdated, onReturnCreated, guideTemplates, focusPayment }) {
  const [sendingPdf, setSendingPdf] = useState(false);
  const [models, setModels] = useState(order.models);
  const [dirtyIds, setDirtyIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showDeliveryEditor, setShowDeliveryEditor] = useState(false);
  const [showGuidePicker, setShowGuidePicker] = useState(false);
  const [showRemissionForm, setShowRemissionForm] = useState(false);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [remissionSaving, setRemissionSaving] = useState(false);
  const [deliveryForm, setDeliveryForm] = useState(() => deliveryValuesFromOrder(order));
  const [remissionForm, setRemissionForm] = useState(() => remissionGuideValuesFromOrder(order));
  const [pendingNoteEdits, setPendingNoteEdits] = useState({});
  const [editingDeliveryNoteId, setEditingDeliveryNoteId] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [upcomingPaymentForm, setUpcomingPaymentForm] = useState(emptyUpcomingPayment);
  const [paymentSummaryForm, setPaymentSummaryForm] = useState(() => paymentSummaryValues(order.payments || []));
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [editingUpcomingPaymentId, setEditingUpcomingPaymentId] = useState(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingUpcomingPayment, setSavingUpcomingPayment] = useState(false);
  const [savingPaymentSummary, setSavingPaymentSummary] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [savingReturn, setSavingReturn] = useState(false);
  const [returnAllocations, setReturnAllocations] = useState({});
  const [invoiceForm, setInvoiceForm] = useState(() => emptyInvoiceFormFromOrder(order));

  useEffect(() => {
    setModels(order.models);
    setDirtyIds([]);
    setDeliveryForm(deliveryValuesFromOrder(order));
    setRemissionForm(remissionGuideValuesFromOrder(order));
    setPendingNoteEdits({});
    setEditingDeliveryNoteId(null);
    setShowDeliveryEditor(false);
    setShowGuidePicker(false);
    setShowRemissionForm(false);
    setPaymentForm(emptyPayment);
    setUpcomingPaymentForm(emptyUpcomingPayment);
    setPaymentSummaryForm(paymentSummaryValues(order.payments || []));
    setEditingPaymentId(null);
    setEditingUpcomingPaymentId(null);
    setShowInvoiceForm(false);
    setShowReturnForm(false);
    setReturnAllocations({});
    setInvoiceForm(emptyInvoiceFormFromOrder(order));
  }, [order]);

  useEffect(() => {
    if (!focusPayment?.paymentId || Number(focusPayment.orderId) !== Number(order.id)) return;
    const payment = (order.payments || []).find((item) => Number(item.id) === Number(focusPayment.paymentId));
    if (payment?.status === 'pending') editUpcomingPayment(payment);
    else if (payment) editPayment(payment);
  }, [focusPayment?.token, order.id, order.payments]);

  const payments = order.payments || [];
  const paidPayments = payments.filter((payment) => payment.status === 'paid');
  const upcomingPayments = payments.filter((payment) => payment.status === 'pending' && payment.due_date);
  const paymentTotals = paymentTotalsFromList(payments);
  const totalPaid = paymentTotals.paid;
  const totalPending = paymentTotals.pending;
  const subtotal = orderSubtotal({ ...order, models });
  const returnedRows = returnedRowsForOrder(order);
  const returnedCredit = returnedCreditForOrder(order);
  const noteTotal = Math.max(0, subtotal - returnedCredit + Number(order.shipping_value || 0) - Number(order.discount_value || 0));
  const deliveryDiscount = deliveryDiscountAmount(deliveryForm);
  const deliveryFormTotal = deliveryTotal(deliveryForm);
  const deliveryNotes = order.delivery_notes || [];
  const invoices = order.invoices || [];
  const invoiceRemaining = remainingInvoiceQuantities(order);
  const invoicePairs = sumSelectionPairs(invoiceForm.item_quantities);
  const invoiceEstimatedValue = invoiceSelectionValue(order, invoiceForm.item_quantities);
  const isReturnOrder = order.order_type === 'return';
  const isSampleOrder = Boolean(order.is_sample);
  const returnDestinations = isReturnOrder ? returnDestinationsForOrder(order) : [];

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
      await onUpdated('Estados del pedido actualizados');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function editPayment(payment) {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      payment_type: payment.payment_type || 'abono',
      amount: payment.amount || '',
      payment_date: payment.payment_date || '',
      due_date: '',
      status: 'paid',
      bank: payment.bank || '',
      reference: payment.reference || '',
      notes: payment.notes || ''
    });
  }

  function editUpcomingPayment(payment) {
    setEditingUpcomingPaymentId(payment.id);
    setUpcomingPaymentForm({
      payment_type: payment.payment_type || 'cheque',
      amount: payment.amount || '',
      payment_date: '',
      due_date: payment.due_date || '',
      status: 'pending',
      bank: payment.bank || '',
      reference: payment.reference || '',
      notes: payment.notes || ''
    });
  }

  async function savePayment() {
    setSavingPayment(true);
    try {
      await api(scope(editingPaymentId
        ? `/producalza/orders/${order.id}/payments/${editingPaymentId}`
        : `/producalza/orders/${order.id}/payments`
      ), {
        method: editingPaymentId ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...paymentForm, status: 'paid', due_date: '' })
      });
      setPaymentForm(emptyPayment);
      setEditingPaymentId(null);
      await onUpdated(editingPaymentId ? 'Cobro actualizado' : 'Cobro registrado');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPayment(false);
    }
  }

  async function saveUpcomingPayment() {
    setSavingUpcomingPayment(true);
    try {
      await api(scope(editingUpcomingPaymentId
        ? `/producalza/orders/${order.id}/payments/${editingUpcomingPaymentId}`
        : `/producalza/orders/${order.id}/payments`
      ), {
        method: editingUpcomingPaymentId ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...upcomingPaymentForm, status: 'pending', payment_date: '' })
      });
      setUpcomingPaymentForm(emptyUpcomingPayment);
      setEditingUpcomingPaymentId(null);
      await onUpdated(editingUpcomingPaymentId ? 'Proximo cobro actualizado' : 'Proximo cobro registrado');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingUpcomingPayment(false);
    }
  }

  async function savePaymentSummary() {
    setSavingPaymentSummary(true);
    try {
      await api(scope(`/producalza/orders/${order.id}/payment-summary`), {
        method: 'PATCH',
        body: JSON.stringify(paymentSummaryForm)
      });
      await onUpdated('Totales de cobro actualizados');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPaymentSummary(false);
    }
  }

  async function updatePaymentStatus(payment, status) {
    try {
      await api(scope(`/producalza/orders/${order.id}/payments/${payment.id}`), {
        method: 'PATCH',
        body: JSON.stringify({ ...payment, status, payment_date: status === 'paid' ? new Date().toISOString().slice(0, 10) : payment.payment_date })
      });
      await onUpdated(status === 'paid' ? 'Cobro marcado como pagado' : 'Cobro marcado como pendiente');
    } catch (err) {
      setError(err.message);
    }
  }

  async function removePayment(payment) {
    if (!window.confirm('Seguro que deseas eliminar este registro de cobro?')) return;
    try {
      await api(scope(`/producalza/orders/${order.id}/payments/${payment.id}`), { method: 'DELETE' });
      await onUpdated('Cobro eliminado');
    } catch (err) {
      setError(err.message);
    }
  }

  function updateDeliveryModel(modelId, unitPrice) {
    setDeliveryForm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, unit_price: unitPrice } : model
      )
    }));
  }

  function toggleDeliveryNotSent(modelId, notSent) {
    setDeliveryForm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, not_sent: notSent } : model
      )
    }));
  }

  async function saveDeliveryValuesAndPrint() {
    setDeliverySaving(true);
    try {
      const sentModels = deliveryForm.models.filter((model) => !model.not_sent);
      if (!sentModels.length) {
        setError('Selecciona al menos un modelo enviado para generar la nota.');
        return;
      }
      const sentModelIds = sentModels.map((model) => Number(model.id));
      const isPartialDelivery = deliveryForm.models.some((model) => model.not_sent);
      const updatedOrder = await api(scope(`/producalza/orders/${order.id}/delivery-note-values`), {
        method: 'PATCH',
        body: JSON.stringify({
          ...deliveryForm,
          discount_value: deliveryDiscount,
          partial_delivery: isPartialDelivery,
          sent_model_ids: sentModelIds
        })
      });
      const priceByModel = new Map(deliveryForm.models.map((model) => [Number(model.id), model.unit_price]));
      const deliveryPrintOrder = {
        ...updatedOrder,
        shipping_value: deliveryForm.shipping_value,
        discount_value: deliveryDiscount,
        models: updatedOrder.models
          .filter((model) => sentModelIds.includes(Number(model.id)))
          .map((model) => ({ ...model, unit_price: priceByModel.get(Number(model.id)) ?? model.unit_price }))
      };
      setShowDeliveryEditor(false);
      await onUpdated('Valores de nota guardados');
      onPrint('delivery-note', null, deliveryPrintOrder);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeliverySaving(false);
    }
  }

  async function savePendingNoteAndPrint(note) {
    const edit = pendingNoteEdits[note.id] || {};
    setDeliverySaving(true);
    try {
      const updatedOrder = await api(scope(`/producalza/orders/${order.id}/delivery-notes/${note.id}`), {
        method: 'PATCH',
        body: JSON.stringify({
          shipping_value: edit.shipping_value ?? note.shipping_value ?? 0,
          discount_value: edit.discount_value ?? note.discount_value ?? 0,
          models: edit.models || []
        })
      });
      const updatedNote = (updatedOrder.delivery_notes || []).find((item) => Number(item.id) === Number(note.id));
      await onUpdated('Nota actualizada');
      setEditingDeliveryNoteId(null);
      onPrint('delivery-note', null, deliveryOrderFromNote(updatedOrder, updatedNote || note));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeliverySaving(false);
    }
  }

  function startEditingDeliveryNote(note) {
    setPendingNoteEdits((current) => ({
      ...current,
      [note.id]: current[note.id] || deliveryNoteEditValues(order, note)
    }));
    setEditingDeliveryNoteId(note.id);
  }

  function updateSavedNoteValue(noteId, key, value) {
    setPendingNoteEdits((current) => ({
      ...current,
      [noteId]: {
        ...(current[noteId] || {}),
        [key]: value
      }
    }));
  }

  function updateSavedNoteModel(noteId, modelId, value) {
    setPendingNoteEdits((current) => ({
      ...current,
      [noteId]: {
        ...(current[noteId] || {}),
        models: (current[noteId]?.models || []).map((model) =>
          Number(model.id) === Number(modelId) ? { ...model, unit_price: value } : model
        )
      }
    }));
  }

  function printGuidesForNote(note) {
    const noteOrder = deliveryOrderFromNote(order, note);
    const guideTemplateKey = note.destination ? guideTemplateKeyForDestination(note.destination) : '';
    onPrint('guides', null, noteOrder, guideTemplateKey ? { guideTemplateKey } : {});
  }

  function printGuidesForReturnDestination(destination) {
    const destinationOrder = orderForReturnDestination(order, destination);
    const guideTemplateKey = guideTemplateKeyForDestination(destination);
    onPrint('guides', null, destinationOrder, guideTemplateKey ? { guideTemplateKey } : {});
  }

  function updateInvoiceQuantity(modelId, size, value) {
    const max = Number(invoiceRemaining[String(modelId)]?.[size] || 0);
    const quantity = Math.max(0, Math.min(Math.floor(Number(value || 0)), max));
    setInvoiceForm((current) => ({
      ...current,
      item_quantities: {
        ...(current.item_quantities || {}),
        [String(modelId)]: {
          ...(current.item_quantities?.[String(modelId)] || {}),
          [size]: quantity
        }
      }
    }));
  }

  function fillInvoicePendingPairs() {
    const nextSelection = {};
    for (const [modelId, sizes] of Object.entries(invoiceRemaining)) {
      for (const [size, qty] of Object.entries(sizes || {})) {
        if (Number(qty || 0) > 0) {
          nextSelection[modelId] ||= {};
          nextSelection[modelId][size] = Number(qty || 0);
        }
      }
    }
    setInvoiceForm((current) => ({
      ...current,
      item_quantities: nextSelection,
      invoice_value: current.invoice_value || invoiceSelectionValue(order, nextSelection).toFixed(2)
    }));
  }

  async function saveInvoice() {
    setSavingInvoice(true);
    try {
      const payload = {
        ...invoiceForm,
        item_quantities: cleanSelection(invoiceForm.item_quantities),
        invoice_value: invoiceForm.invoice_value || invoiceEstimatedValue
      };
      await api(scope(`/producalza/orders/${order.id}/invoice`), {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setShowInvoiceForm(false);
      setInvoiceForm(emptyInvoiceFormFromOrder(order));
      await onUpdated('Factura registrada');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingInvoice(false);
    }
  }

  async function markInvoiceShipped(invoice) {
    const dispatchedDate = window.prompt('Fecha de envio de esta factura (AAAA-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!dispatchedDate) return;
    try {
      await api(scope(`/producalza/orders/${order.id}/invoices/${invoice.id}/shipped`), {
        method: 'PATCH',
        body: JSON.stringify({ dispatched_date: dispatchedDate })
      });
      await onUpdated('Factura marcada como enviada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function markDeliveryNoteShipped(note) {
    const dispatchedDate = window.prompt('Fecha de envio de esta nota (AAAA-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!dispatchedDate) return;
    try {
      await api(scope(`/producalza/orders/${order.id}/delivery-notes/${note.id}/shipped`), {
        method: 'PATCH',
        body: JSON.stringify({ dispatched_date: dispatchedDate })
      });
      await onUpdated('Nota marcada como enviada');
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveRemissionGuideAndPrint() {
    setRemissionSaving(true);
    try {
      const updatedOrder = await api(scope(`/producalza/orders/${order.id}/remission-guide`), {
        method: 'POST',
        body: JSON.stringify(remissionForm)
      });
      const guide = (updatedOrder.remission_guides || [])[0];
      setShowRemissionForm(false);
      setRemissionForm(remissionGuideValuesFromOrder(updatedOrder));
      await onUpdated('Guia de remision guardada');
      onPrint('remission-guide', null, { ...updatedOrder, selected_remission_guide: guide });
    } catch (err) {
      setError(err.message);
    } finally {
      setRemissionSaving(false);
    }
  }

  function updateReturnAllocation(modelId, size, destination, value) {
    const quantity = Math.max(0, Math.floor(Number(value || 0)));
    setReturnAllocations((current) => ({
      ...current,
      [modelId]: {
        ...(current[modelId] || {}),
        [size]: {
          ...((current[modelId] || {})[size] || {}),
          [destination]: quantity
        }
      }
    }));
  }

  function returnSizeTotal(modelId, size) {
    return RETURN_DESTINATIONS.reduce(
      (sum, destination) => sum + Number(returnAllocations[modelId]?.[size]?.[destination] || 0),
      0
    );
  }

  async function saveReturnOrder() {
    const allocations = [];
    for (const model of order.models || []) {
      for (const size of SIZES) {
        const available = Number(model.sizes?.[size] || 0);
        const selected = returnSizeTotal(model.id, size);
        if (selected > available) {
          setError(`En ${model.model_code}, talla ${size}, seleccionaste ${selected} pares pero solo hay ${available}.`);
          return;
        }
        for (const destination of RETURN_DESTINATIONS) {
          const quantity = Number(returnAllocations[model.id]?.[size]?.[destination] || 0);
          if (quantity > 0) {
            allocations.push({ model_id: model.id, size, destination, quantity });
          }
        }
      }
    }
    if (!allocations.length) {
      setError('Selecciona al menos una talla devuelta.');
      return;
    }
    setSavingReturn(true);
    try {
      const created = await api(scope(`/producalza/orders/${order.id}/returns`), {
        method: 'POST',
        body: JSON.stringify({ allocations })
      });
      setShowReturnForm(false);
      setReturnAllocations({});
      await onReturnCreated(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingReturn(false);
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
    const message = orderWhatsappMessage(order, today);
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
          <button className="prod-primary-button delivery" onClick={() => setShowDeliveryEditor((value) => !value)}><Printer size={17} />Nota de entrega</button>
          <button className="prod-secondary-button remision" onClick={() => setShowRemissionForm((value) => !value)}><FilePlus2 size={17} />Guia de remision</button>
          {isAdmin && !isReturnOrder && !isSampleOrder && (
            <button className="prod-secondary-button return" onClick={() => setShowReturnForm((value) => !value)}><PackageCheck size={17} />Registrar devolucion</button>
          )}
          <button className="prod-secondary-button" onClick={() => setShowInvoiceForm((value) => !value)}><FilePlus2 size={17} />Registrar factura</button>
          <button className="prod-primary-button" onClick={() => onPrint('sheets')}><Printer size={17} />{isReturnOrder ? 'Hoja de devolucion' : isSampleOrder ? 'Hoja de muestra' : 'Hoja unica del pedido'}</button>
          <button className="prod-primary-button dark" onClick={() => onPrint('cards')}><Printer size={17} />Tarjetas</button>
          <button className="prod-primary-button guide" onClick={() => isReturnOrder ? setShowGuidePicker((value) => !value) : onPrint('guides')}><Tags size={17} />Guias para cajas</button>
          <button className="prod-primary-button whatsapp prod-desktop-whatsapp-action" disabled={sendingPdf} onClick={sendOrderToClient}>
            {sendingPdf ? <FileDown size={17} /> : <MessageCircle size={17} />}
            {sendingPdf ? 'Descargando PDF...' : 'Enviar pedido por WhatsApp'}
          </button>
          {isAdmin && dirtyIds.length > 0 && (
            <button className="prod-primary-button prod-save-order-status" disabled={saving} onClick={saveModelStates}>
              <Save size={17} />Guardar estados ({dirtyIds.length})
            </button>
          )}
        </div>
      </div>
      <section className="prod-order-hero">
        <div>
          <span>{isReturnOrder ? 'Devolucion' : isSampleOrder ? 'Pedido de muestras' : 'Pedido'}</span>
          <h2>{order.order_number}</h2>
          <p>{order.client_name} · {order.city || 'Sin ciudad'}{isReturnOrder && order.parent_order_number ? ` · Origen ${order.parent_order_number}` : ''}{isSampleOrder && order.sample_destination ? ` · Destino ${order.sample_destination}` : ''}</p>
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
      {showGuidePicker && isReturnOrder && (
        <section className="prod-panel prod-guide-destination-panel">
          <div className="prod-panel-title">
            <div><span>Guias por local</span><h2>Selecciona que local imprimir</h2></div>
          </div>
          <div className="prod-guide-destination-list">
            {returnDestinations.map((destination) => (
              <article key={destination}>
                <div>
                  <strong>{shortDestinationName(destination)}</strong>
                  <span>{guideTemplateKeyForDestination(destination) === SEBASTIANS_GUIDE_TEMPLATE_KEY ? 'Formato Sebastians' : 'Formato Marjorie Botas'}</span>
                </div>
                <button className="prod-secondary-button compact" onClick={() => printGuidesForReturnDestination(destination)}>
                  <Tags size={16} />Imprimir guias
                </button>
              </article>
            ))}
            {!returnDestinations.length && <div className="prod-empty">Esta devolucion aun no tiene locales asignados.</div>}
          </div>
        </section>
      )}
      {isReturnOrder && (
        <section className="prod-panel prod-return-detail-panel">
          <div className="prod-panel-title">
            <div><span>Detalle de devolucion</span><h2>Destino de pares devueltos</h2></div>
          </div>
          <div className="prod-table-wrap">
            <table className="prod-table">
              <thead><tr><th>Destino</th><th>Modelo</th><th>Talla</th><th>Pares</th></tr></thead>
              <tbody>
                {(order.return_allocations || []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.destination}</td>
                    <td><strong>{item.model_code}</strong><small>{[item.color, item.material].filter(Boolean).join(' ')}</small></td>
                    <td>{item.size}</td>
                    <td>{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!(order.return_allocations || []).length && <div className="prod-empty">Sin asignaciones de devolucion.</div>}
          </div>
        </section>
      )}
      {showReturnForm && !isReturnOrder && (
        <section className="prod-panel prod-return-form-panel">
          <div className="prod-panel-title">
            <div><span>Devoluciones</span><h2>Seleccionar tallas y destino</h2></div>
          </div>
          <div className="prod-return-form-help">
            Selecciona cuantos pares devuelve el cliente y a que local se enviaran. El sistema creara un nuevo Detalle de Devolucion.
          </div>
          <div className="prod-return-models">
            {order.models.map((model) => (
              <article key={model.id} className="prod-return-model-card">
                <div className="prod-return-model-head">
                  <div><span>Modelo</span><strong>{model.model_code}</strong><small>{[model.color, model.material].filter(Boolean).join(' ')}</small></div>
                  <b>{model.total_pairs} pares vendidos</b>
                </div>
                <div className="prod-return-size-list">
                  {SIZES.filter((size) => Number(model.sizes?.[size] || 0) > 0).map((size) => {
                    const selected = returnSizeTotal(model.id, size);
                    const available = Number(model.sizes?.[size] || 0);
                    return (
                      <div className={`prod-return-size-row ${selected > available ? 'over' : ''}`} key={size}>
                        <div><strong>Talla {size}</strong><span>{selected}/{available} pares</span></div>
                        <div className="prod-return-destinations">
                          {RETURN_DESTINATIONS.map((destination) => (
                            <label key={destination}>
                              <span>{destination.replace('Local Marjorie Botas ', '')}</span>
                              <input
                                type="number"
                                min="0"
                                max={available}
                                value={returnAllocations[model.id]?.[size]?.[destination] || ''}
                                onChange={(event) => updateReturnAllocation(model.id, size, destination, event.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
          <div className="prod-form-actions">
            <button className="prod-secondary-button" onClick={() => setShowReturnForm(false)}>Cancelar</button>
            <button className="prod-primary-button" disabled={savingReturn} onClick={saveReturnOrder}>
              <Save size={17} />{savingReturn ? 'Creando...' : 'Crear devolucion'}
            </button>
          </div>
        </section>
      )}
      {showDeliveryEditor && (
        <section className="prod-panel prod-delivery-editor">
          <div className="prod-panel-title">
            <div><span>Antes de imprimir</span><h2>Valores de nota de entrega</h2></div>
          </div>
          {deliveryNotes.length > 0 && (
            <div className="prod-saved-delivery-notes">
              <div>
                <span>Notas guardadas</span>
                <strong>Imprime una nota anterior o pendiente</strong>
              </div>
              {deliveryNotes.map((note) => {
                const isEditingNote = Number(editingDeliveryNoteId) === Number(note.id);
                const edit = pendingNoteEdits[note.id] || deliveryNoteEditValues(order, note);
                return (
                <article key={note.id} className={note.note_type === 'pending' ? 'pending' : ''}>
                  <div>
                    <strong>Nota #{note.note_number} · {note.title || 'Nota de entrega'}</strong>
                    <span>{displayMoney(note.total_value)} · {displayDate(note.created_at?.slice(0, 10))}{note.destination ? ` · ${shortDestinationName(note.destination)}` : ''}</span>
                  </div>
                  {isEditingNote && (
                    <div className="prod-pending-note-edit saved">
                      {(edit.models || []).map((model) => (
                        <label key={model.id}>{model.model_code}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={model.unit_price}
                            onChange={(event) => updateSavedNoteModel(note.id, model.id, event.target.value)}
                          />
                        </label>
                      ))}
                      <label>Envio
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={edit.shipping_value ?? ''}
                          onChange={(event) => updateSavedNoteValue(note.id, 'shipping_value', event.target.value)}
                        />
                      </label>
                      <label>Descuento
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={edit.discount_value ?? ''}
                          onChange={(event) => updateSavedNoteValue(note.id, 'discount_value', event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <div className="prod-saved-note-actions">
                  {isEditingNote ? (
                    <>
                      <button
                        className="prod-secondary-button compact"
                        disabled={deliverySaving}
                        onClick={() => savePendingNoteAndPrint(note)}
                      >
                        <Printer size={16} />Guardar e imprimir
                      </button>
                      <button className="prod-secondary-button compact" onClick={() => setEditingDeliveryNoteId(null)}>
                        <X size={16} />Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="prod-secondary-button compact" onClick={() => startEditingDeliveryNote(note)}>
                        <Pencil size={16} />Editar
                      </button>
                      <button
                        className="prod-secondary-button compact"
                        onClick={() => onPrint('delivery-note', null, deliveryOrderFromNote(order, note))}
                      >
                        <Printer size={16} />Imprimir
                      </button>
                      <button className="prod-secondary-button compact" onClick={() => printGuidesForNote(note)}>
                        <Tags size={16} />Guias
                      </button>
                      <button className="prod-secondary-button compact" onClick={() => markDeliveryNoteShipped(note)}>
                        <Truck size={16} />{note.dispatched_date ? `Enviado ${displayDate(note.dispatched_date)}` : 'Marcar enviado'}
                      </button>
                    </>
                  )}
                  </div>
                </article>
                );
              })}
            </div>
          )}
          <div className="prod-delivery-editor-list">
            {deliveryForm.models.map((model) => {
              const quantity = Number(model.total_pairs || 0);
              const unitPrice = Number(model.unit_price || 0);
              return (
                <article key={model.id}>
                  <div>
                    <strong>{model.model_code}</strong>
                    <span>{quantity} pares · {[model.material, model.color].filter(Boolean).join(' ') || 'Sin descripcion'}</span>
                  </div>
                  <label>Valor unitario
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={model.unit_price}
                      onChange={(event) => updateDeliveryModel(model.id, event.target.value)}
                    />
                  </label>
                  <label className="prod-delivery-not-sent">
                    <input
                      type="checkbox"
                      checked={Boolean(model.not_sent)}
                      onChange={(event) => toggleDeliveryNotSent(model.id, event.target.checked)}
                    />
                    No enviado
                  </label>
                  <div>
                    <span>{model.not_sent ? 'Estado' : 'Total'}</span>
                    <strong>{model.not_sent ? 'No enviado' : displayMoney(quantity * unitPrice)}</strong>
                  </div>
                </article>
              );
            })}
            {returnedRows.map((row) => (
              <article className="prod-delivery-return-row" key={`returned-${row.id}`}>
                <div>
                  <strong>DEVOLUCION · {row.model_code}</strong>
                  <span>{row.total_pairs} pares · {[row.material, row.color].filter(Boolean).join(' ') || 'Sin descripcion'} · {shortDestinationName(row.destination)}</span>
                </div>
                <label>Valor unitario
                  <input type="number" value="0.00" disabled readOnly />
                </label>
                <div>
                  <span>Estado</span>
                  <strong>Precio 0</strong>
                </div>
              </article>
            ))}
          </div>
          <div className="prod-delivery-editor-totals">
            <label>Envio<input type="number" min="0" step="0.01" value={deliveryForm.shipping_value} onChange={(event) => setDeliveryForm({ ...deliveryForm, shipping_value: event.target.value })} /></label>
            <label>Tipo descuento
              <select value={deliveryForm.discount_mode} onChange={(event) => setDeliveryForm({ ...deliveryForm, discount_mode: event.target.value })}>
                <option value="value">Valor</option>
                <option value="percent">Porcentaje</option>
              </select>
            </label>
            {deliveryForm.discount_mode === 'percent' ? (
              <label>Descuento %
                <input type="number" min="0" step="0.01" value={deliveryForm.discount_percent} onChange={(event) => setDeliveryForm({ ...deliveryForm, discount_percent: event.target.value })} />
              </label>
            ) : (
              <label>Descuento
                <input type="number" min="0" step="0.01" value={deliveryForm.discount_value} onChange={(event) => setDeliveryForm({ ...deliveryForm, discount_value: event.target.value })} />
              </label>
            )}
            <div><span>Subtotal</span><strong>{displayMoney(deliverySubtotal(deliveryForm))}</strong></div>
            {returnedCredit > 0 && <div className="prod-delivery-return-total"><span>Devoluciones</span><strong>Precio 0</strong></div>}
            <div><span>Desc. aplicado</span><strong>{displayMoney(deliveryDiscount)}</strong></div>
            <div><span>Total</span><strong>{displayMoney(deliveryFormTotal)}</strong></div>
          </div>
          <div className="prod-form-actions">
            <button className="prod-secondary-button" onClick={() => setShowDeliveryEditor(false)}>Cancelar</button>
            <button className="prod-primary-button delivery" disabled={deliverySaving} onClick={saveDeliveryValuesAndPrint}>
              <Printer size={17} />{deliverySaving ? 'Guardando...' : 'Guardar e imprimir'}
            </button>
          </div>
        </section>
      )}
      {showRemissionForm && (
        <section className="prod-panel prod-remission-editor">
          <div className="prod-panel-title">
            <div><span>Salida de mercaderia</span><h2>Guia de remision</h2></div>
            {remissionForm.guide_number && <strong className="prod-remission-number">Nro. {String(remissionForm.guide_number).padStart(8, '0')}</strong>}
          </div>
          <div className="prod-detail-grid">
            <Detail label="Fecha de emision" value={displayDate(remissionForm.issue_date)} />
            <Detail label="Comprobante de venta" value={remissionForm.sale_receipt} />
          </div>
          <div className="prod-form-grid">
            <label>Formato de guia
              <select value={remissionForm.format_type} onChange={(event) => setRemissionForm({ ...remissionForm, format_type: event.target.value })}>
                {Object.entries(REMISSION_FORMATS).map(([value, format]) => <option value={value} key={value}>{format.label}</option>)}
              </select>
            </label>
            <label>Destinatario
              <input value={remissionForm.recipient_name} onChange={(event) => setRemissionForm({ ...remissionForm, recipient_name: event.target.value })} />
            </label>
            <label>Nombre o razon social
              <input value={remissionForm.recipient_business_name} onChange={(event) => setRemissionForm({ ...remissionForm, recipient_business_name: event.target.value })} />
            </label>
            <label className="span-2">Punto de llegada
              <input value={remissionForm.arrival_place} onChange={(event) => setRemissionForm({ ...remissionForm, arrival_place: event.target.value })} />
            </label>
            <label>RUC o cedula
              <input value={remissionForm.recipient_tax_id} onChange={(event) => setRemissionForm({ ...remissionForm, recipient_tax_id: event.target.value })} />
            </label>
            <label>Empresa encargada de transporte
              <input value={remissionForm.carrier_identification} onChange={(event) => setRemissionForm({ ...remissionForm, carrier_identification: event.target.value })} />
            </label>
            <label className="span-full">Descripcion de cartones o paquetes enviados
              <textarea rows="4" value={remissionForm.description} onChange={(event) => setRemissionForm({ ...remissionForm, description: event.target.value })} />
            </label>
          </div>
          <div className="prod-form-actions">
            <button className="prod-secondary-button" onClick={() => setShowRemissionForm(false)}>Cancelar</button>
            <button className="prod-primary-button guide" disabled={remissionSaving} onClick={saveRemissionGuideAndPrint}>
              <Printer size={17} />{remissionSaving ? 'Guardando...' : 'Guardar e imprimir guia'}
            </button>
          </div>
        </section>
      )}
      <section className="prod-panel">
        <div className="prod-detail-grid">
          <Detail label="Razon social" value={order.business_name} />
          <Detail label="RUC o cedula" value={order.tax_id} />
          <Detail label="Telefono" value={order.phone} />
          <Detail label="Direccion" value={order.address} />
          <Detail label="Vendedor" value={order.seller_name} />
          <Detail label="Fecha" value={displayDate(order.order_date)} />
          <Detail label="Fecha de entrega" value={order.delivery_date ? displayDate(order.delivery_date) : ''} />
          <Detail label="Marca" value={order.brand} />
          {isSampleOrder && <Detail label="Local destino muestra" value={order.sample_destination} />}
          <Detail label="Etiqueta de origen" value={order.origin_label} />
          <Detail label="Texto rojo tarjeta" value={order.card_alert} />
          <Detail
            label="Formato de guias"
            value={guideTemplates.find((item) => item.key === resolveGuideTemplateKey(order, guideTemplates))?.name}
          />
          <Detail label="Forma de pago" value={order.payment_method} />
          <Detail label="Fecha de envio" value={order.dispatched_date ? displayDate(order.dispatched_date) : ''} />
          <Detail
            label="Estado de envio"
            value={order.shipment_status === 'delivered'
              ? 'Enviado completo'
              : order.shipment_status === 'partial'
                ? `Envio parcial (${order.shipped_pairs || 0}/${Number(order.shipped_pairs || 0) + Number(order.pending_shipment_pairs || 0)} pares)`
                : 'Pendiente de envio'}
          />
          <Detail label="Subtotal" value={displayMoney(subtotal)} />
          {returnedCredit > 0 && <Detail label="Devoluciones" value={`-${displayMoney(returnedCredit)}`} />}
          <Detail label="Descuento" value={displayMoney(order.discount_value)} />
          <Detail label="Transporte" value={displayMoney(order.shipping_value)} />
          <Detail label="Total nota" value={displayMoney(noteTotal)} />
          <Detail label="Factura" value={order.invoice_number ? `${order.invoice_number} · ${displayDate(order.invoice_date)} · ${displayMoney(order.invoice_value)}` : ''} />
        </div>
        {order.general_notes && <div className="prod-note"><strong>Observaciones</strong><p>{order.general_notes}</p></div>}
      </section>
      {showInvoiceForm && (
        <section className="prod-panel prod-invoice-panel">
          <div className="prod-panel-title"><div><span>Registro opcional</span><h2>Factura del pedido</h2></div></div>
          {!!invoices.length && (
            <div className="prod-saved-notes">
              {invoices.map((invoice) => (
                <article key={invoice.id}>
                  <div>
                    <strong>Factura {invoice.invoice_number || invoice.id}</strong>
                    <span>{displayDate(invoice.invoice_date)} · {sumSelectionPairs(invoice.item_quantities)} pares · {displayMoney(invoice.invoice_value)}</span>
                    <small>{invoice.dispatched_date ? `Enviado ${displayDate(invoice.dispatched_date)}` : 'Pendiente de envio'}</small>
                  </div>
                  <div className="prod-saved-note-actions">
                    <button className="prod-secondary-button compact" onClick={() => markInvoiceShipped(invoice)}>
                      <Truck size={16} />{invoice.dispatched_date ? 'Cambiar envio' : 'Marcar enviado'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <form className="prod-form-grid" onSubmit={(event) => { event.preventDefault(); saveInvoice(); }}>
            <label>Numero de factura<input value={invoiceForm.invoice_number} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_number: event.target.value })} /></label>
            <label>Fecha<input type="date" value={invoiceForm.invoice_date} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_date: event.target.value })} /></label>
            <label>Valor<input type="number" min="0" step="0.01" value={invoiceForm.invoice_value} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_value: event.target.value })} /></label>
            <div className="span-full prod-invoice-pairs">
              <div className="prod-panel-title inline">
                <div><span>Seleccion de pares</span><h3>Pares que se facturan</h3></div>
                <button type="button" className="prod-secondary-button compact" onClick={fillInvoicePendingPairs}>Seleccionar faltantes</button>
              </div>
              {(order.models || []).map((model) => (
                <article key={model.id} className="prod-invoice-model">
                  <div>
                    <strong>{model.model_code}</strong>
                    <span>{[model.color, model.material].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="prod-size-grid compact">
                    {SIZES.map((size) => {
                      const max = Number(invoiceRemaining[String(model.id)]?.[size] || 0);
                      if (!max) return null;
                      return (
                        <label key={size}>
                          <span>{size}</span>
                          <input
                            type="number"
                            min="0"
                            max={max}
                            value={invoiceForm.item_quantities?.[String(model.id)]?.[size] || ''}
                            placeholder={`0/${max}`}
                            onChange={(event) => updateInvoiceQuantity(model.id, size, event.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </article>
              ))}
              <div className="prod-delivery-editor-totals">
                <div><span>Pares seleccionados</span><strong>{invoicePairs}</strong></div>
                <div><span>Valor estimado por precios del pedido</span><strong>{displayMoney(invoiceEstimatedValue)}</strong></div>
              </div>
            </div>
            <div className="prod-form-actions align-end">
              <button type="button" className="prod-secondary-button" onClick={() => setShowInvoiceForm(false)}>Cancelar</button>
              <button className="prod-primary-button" type="submit" disabled={savingInvoice}><Save size={17} />{savingInvoice ? 'Guardando...' : 'Guardar factura'}</button>
            </div>
          </form>
        </section>
      )}
      <section className="prod-panel prod-payment-panel">
        <div className="prod-panel-title">
          <div><span>Cobros del pedido</span><h2>Pagos, abonos y cheques</h2></div>
          <div className="prod-payment-totals">
            <span>Pagado <strong>{displayMoney(totalPaid)}</strong></span>
            <span>Pendiente <strong>{displayMoney(totalPending)}</strong></span>
          </div>
        </div>
        <div className="prod-payment-summary-editor">
          <div>
            <strong>Ajustar totales manualmente</strong>
            <span>Usa esto para cuadrar el valor pagado y pendiente del pedido.</span>
          </div>
          <label>Pagado
            <input
              type="number"
              min="0"
              step="0.01"
              value={paymentSummaryForm.paid_total}
              onChange={(event) => setPaymentSummaryForm({ ...paymentSummaryForm, paid_total: event.target.value })}
            />
          </label>
          <label>Pendiente
            <input
              type="number"
              min="0"
              step="0.01"
              value={paymentSummaryForm.pending_total}
              onChange={(event) => setPaymentSummaryForm({ ...paymentSummaryForm, pending_total: event.target.value })}
            />
          </label>
          <button className="prod-secondary-button" disabled={savingPaymentSummary} onClick={savePaymentSummary}>
            <Save size={16} />{savingPaymentSummary ? 'Guardando...' : 'Guardar totales'}
          </button>
        </div>
        <div className="prod-payment-layout">
          <div className="prod-payment-list">
            {paidPayments.map((payment) => (
              <article className={`prod-payment-item ${payment.status}`} key={payment.id}>
                <div>
                  <strong>{PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type}</strong>
                  <span>{paymentDetailText(payment)}</span>
                  <small>{payment.payment_date ? `Pago: ${displayDate(payment.payment_date)}` : 'Cobro verificado'}</small>
                </div>
                <div>
                  <b>{displayMoney(payment.amount)}</b>
                  <em>Verificado</em>
                  <div className="prod-row-actions">
                    <button title="Editar cobro" onClick={() => editPayment(payment)}><Pencil size={15} /></button>
                    {isAdmin && <button className="danger" title="Eliminar cobro" onClick={() => removePayment(payment)}><Trash2 size={15} /></button>}
                  </div>
                </div>
              </article>
            ))}
            {!paidPayments.length && <div className="prod-empty">Aun no hay pagos, abonos o cheques registrados para este pedido.</div>}
          </div>
          <div className="prod-payment-form">
            <div className="prod-form-title">
              <strong>{editingPaymentId ? 'Editar cobro' : 'Nuevo cobro'}</strong>
              {editingPaymentId && <button className="prod-link-button" onClick={() => { setEditingPaymentId(null); setPaymentForm(emptyPayment); }}>Cancelar</button>}
            </div>
            <label>Tipo
              <select value={paymentForm.payment_type} onChange={(event) => setPaymentForm({ ...paymentForm, payment_type: event.target.value })}>
                {Object.entries(PAYMENT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>Valor<input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label>
            <label>Fecha de pago<input type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} /></label>
            <label>Banco<input value={paymentForm.bank} onChange={(event) => setPaymentForm({ ...paymentForm, bank: event.target.value })} /></label>
            <label>Referencia / cheque<input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></label>
            <label>Observaciones<textarea rows="3" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></label>
            <button className="prod-primary-button" disabled={savingPayment} onClick={savePayment}>
              <DollarSign size={17} />{savingPayment ? 'Guardando...' : editingPaymentId ? 'Guardar cobro' : 'Registrar cobro'}
            </button>
          </div>
        </div>
      </section>
      <section className="prod-panel prod-payment-panel prod-upcoming-payment-panel">
        <div className="prod-panel-title">
          <div><span>Alertas de cobro</span><h2>Proximos cobros</h2></div>
        </div>
        <div className="prod-payment-layout">
          <div className="prod-payment-list">
            {upcomingPayments.map((payment) => (
              <article className="prod-payment-item pending" key={payment.id}>
                <div>
                  <strong>{PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type}</strong>
                  <span>{paymentDetailText(payment)}</span>
                  <small>{payment.due_date ? `Cobrar: ${displayDate(payment.due_date)}` : 'Sin fecha de alerta'}</small>
                </div>
                <div>
                  <b>{displayMoney(payment.amount)}</b>
                  <em>Pendiente</em>
                  <div className="prod-row-actions">
                    <button title="Editar proximo cobro" onClick={() => editUpcomingPayment(payment)}><Pencil size={15} /></button>
                    <button className="success" title="Marcar cobrado" onClick={() => updatePaymentStatus(payment, 'paid')}><Check size={15} /></button>
                    {isAdmin && <button className="danger" title="Eliminar proximo cobro" onClick={() => removePayment(payment)}><Trash2 size={15} /></button>}
                  </div>
                </div>
              </article>
            ))}
            {!upcomingPayments.length && <div className="prod-empty">Aun no hay proximos cobros para alertar.</div>}
          </div>
          <div className="prod-payment-form">
            <div className="prod-form-title">
              <strong>{editingUpcomingPaymentId ? 'Editar proximo cobro' : 'Nuevo proximo cobro'}</strong>
              {editingUpcomingPaymentId && <button className="prod-link-button" onClick={() => { setEditingUpcomingPaymentId(null); setUpcomingPaymentForm(emptyUpcomingPayment); }}>Cancelar</button>}
            </div>
            <label>Tipo
              <select value={upcomingPaymentForm.payment_type} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, payment_type: event.target.value })}>
                {Object.entries(PAYMENT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>Valor<input type="number" min="0" step="0.01" value={upcomingPaymentForm.amount} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, amount: event.target.value })} /></label>
            <label>Fecha de alerta<input type="date" value={upcomingPaymentForm.due_date} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, due_date: event.target.value })} /></label>
            <label>Banco<input value={upcomingPaymentForm.bank} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, bank: event.target.value })} /></label>
            <label>Referencia / cheque<input value={upcomingPaymentForm.reference} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, reference: event.target.value })} /></label>
            <label>Observaciones<textarea rows="3" value={upcomingPaymentForm.notes} onChange={(event) => setUpcomingPaymentForm({ ...upcomingPaymentForm, notes: event.target.value })} /></label>
            <button className="prod-primary-button" disabled={savingUpcomingPayment} onClick={saveUpcomingPayment}>
              <DollarSign size={17} />{savingUpcomingPayment ? 'Guardando...' : editingUpcomingPaymentId ? 'Guardar alerta' : 'Registrar alerta'}
            </button>
          </div>
        </div>
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
              <Detail label="Planta" value={model.plant_area} />
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

function ClientsView({ clients, isAdmin, users, scope, onOpenOrder, onRefresh, setError, guideTemplates, alertTarget }) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyClient);
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [visit, setVisit] = useState(emptyVisit);
  const [editingVisitId, setEditingVisitId] = useState(null);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [handledAlertToken, setHandledAlertToken] = useState(null);
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

  useEffect(() => {
    if (!alertTarget?.clientId || alertTarget.token === handledAlertToken) return;
    openClient(alertTarget.clientId);
  }, [alertTarget?.token, alertTarget?.clientId, handledAlertToken]);

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

  useEffect(() => {
    if (!selected || !alertTarget?.visitId || alertTarget.token === handledAlertToken) return;
    if (Number(selected.id) !== Number(alertTarget.clientId)) return;
    const item = (selected.visits || []).find((visitItem) => Number(visitItem.id) === Number(alertTarget.visitId));
    if (!item) return;
    editVisit(item);
    setHandledAlertToken(alertTarget.token);
  }, [selected, alertTarget?.token, alertTarget?.visitId, alertTarget?.clientId, handledAlertToken]);

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

const emptyEmployeeForm = {
  name: '',
  pay_type: 'salary',
  monthly_salary: '',
  default_iess: '',
  late_penalty: 5,
  normal_start: '08:00',
  normal_end: '16:30',
  grace_minutes: 4,
  status: 'active',
  notes: ''
};

function payrollPeriodLabel() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    label: today.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }).toUpperCase(),
    date_from: first.toISOString().slice(0, 10),
    date_to: last.toISOString().slice(0, 10)
  };
}

function PayrollView({ employees, periods, scope, onRefresh, setError }) {
  const initialPeriod = payrollPeriodLabel();
  const defaultVisiblePayrollFields = {
    late: true,
    overtime50: true,
    overtime100: false,
    unworked: true,
    iess: true,
    advance: true,
    savings: false,
    footwear: false,
    loan: false,
    other: false,
    piece: false
  };
  const payrollFieldOptions = [
    ['late', 'Atrasos'],
    ['overtime50', 'Extra 50%'],
    ['overtime100', 'Extra 100%'],
    ['unworked', 'Horas no trabajadas'],
    ['iess', 'IESS'],
    ['advance', 'Adelantos'],
    ['savings', 'Ahorro/Rifa'],
    ['footwear', 'Calzado'],
    ['loan', 'Prestamos'],
    ['other', 'Varios'],
    ['piece', 'Comisiones']
  ];
  const [selected, setSelected] = useState(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [periodForm, setPeriodForm] = useState(initialPeriod);
  const [payrollFile, setPayrollFile] = useState(null);
  const [payrollDrafts, setPayrollDrafts] = useState({});
  const [visiblePayrollFields, setVisiblePayrollFields] = useState(defaultVisiblePayrollFields);
  const [showPayrollFields, setShowPayrollFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState('');

  useEffect(() => {
    if (!selected?.entries?.length) {
      setPayrollDrafts({});
      return;
    }
    const nextDrafts = {};
    selected.entries.forEach((entry) => {
      nextDrafts[entry.id] = {
        late_days: entry.late_days ?? 0,
        late_minutes: entry.late_minutes ?? 0,
        absent_days: entry.absent_days ?? 0,
        justify_late: Number(entry.justify_late || 0) ? 1 : 0,
        justify_absence: Number(entry.justify_absence || 0) ? 1 : 0,
        overtime_50_hours: entry.overtime_50_hours ?? entry.overtime_hours ?? 0,
        overtime_100_hours: entry.overtime_100_hours ?? 0,
        manual_unworked_hours: entry.manual_unworked_hours ?? 0,
        iess_amount: entry.iess_amount ?? 0,
        advance_amount: entry.advance_amount ?? 0,
        savings_amount: entry.savings_amount ?? 0,
        footwear_amount: entry.footwear_amount ?? 0,
        loan_amount: entry.loan_amount ?? 0,
        other_deductions: entry.other_deductions ?? 0,
        other_income: entry.other_income ?? 0,
        piece_income: entry.piece_income ?? 0,
        notes: entry.notes || ''
      };
    });
    setPayrollDrafts(nextDrafts);
  }, [selected]);

  useEffect(() => {
    if (!printMode) return undefined;
    const timer = window.setTimeout(() => window.print(), 160);
    const clear = () => setPrintMode('');
    window.addEventListener('afterprint', clear, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', clear);
    };
  }, [printMode]);

  async function openPeriod(id) {
    setLoadingPeriod(true);
    try {
      setSelected(await api(scope(`/producalza/payroll-periods/${id}`)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPeriod(false);
    }
  }

  async function deletePeriod(period) {
    if (!window.confirm(`Eliminar el rol "${period.label}"? Esta accion no se puede deshacer.`)) return;
    setSaving(true);
    try {
      await api(scope(`/producalza/payroll-periods/${period.id}`), { method: 'DELETE' });
      if (selected?.id === period.id) setSelected(null);
      await onRefresh('Rol eliminado');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importPayroll() {
    if (!payrollFile) {
      setError('Selecciona el Excel descargado del reloj antes de importar.');
      return;
    }
    setSaving(true);
    try {
      const fileData = await fileToDataUrl(payrollFile);
      const period = await api(scope('/producalza/payroll-periods/import-detail'), {
        method: 'POST',
        body: JSON.stringify({
          ...periodForm,
          filename: payrollFile.name,
          file_base64: fileData
        })
      });
      setSelected(period);
      setPayrollFile(null);
      await onRefresh('Rol importado y calculado');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function editEmployee(employee) {
    setEditingEmployeeId(employee.id);
    setEmployeeForm({
      name: employee.name || '',
      pay_type: employee.pay_type || 'salary',
      monthly_salary: employee.monthly_salary || '',
      default_iess: employee.default_iess || '',
      late_penalty: employee.late_penalty ?? 5,
      normal_start: employee.normal_start || '08:00',
      normal_end: employee.normal_end || '16:30',
      grace_minutes: employee.grace_minutes ?? 4,
      status: employee.status || 'active',
      notes: employee.notes || ''
    });
  }

  async function saveEmployee() {
    setSaving(true);
    try {
      await api(scope(editingEmployeeId ? `/producalza/employees/${editingEmployeeId}` : '/producalza/employees'), {
        method: editingEmployeeId ? 'PUT' : 'POST',
        body: JSON.stringify(employeeForm)
      });
      setEditingEmployeeId(null);
      setEmployeeForm(emptyEmployeeForm);
      await onRefresh(editingEmployeeId ? 'Empleado actualizado' : 'Empleado creado');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function entryDraft(entry) {
    return payrollDrafts[entry.id] || {
      late_days: entry.late_days ?? 0,
      late_minutes: entry.late_minutes ?? 0,
      absent_days: entry.absent_days ?? 0,
      justify_late: Number(entry.justify_late || 0) ? 1 : 0,
      justify_absence: Number(entry.justify_absence || 0) ? 1 : 0,
      overtime_50_hours: entry.overtime_50_hours ?? entry.overtime_hours ?? 0,
      overtime_100_hours: entry.overtime_100_hours ?? 0,
      manual_unworked_hours: entry.manual_unworked_hours ?? 0,
      iess_amount: entry.iess_amount ?? 0,
      advance_amount: entry.advance_amount ?? 0,
      savings_amount: entry.savings_amount ?? 0,
      footwear_amount: entry.footwear_amount ?? 0,
      loan_amount: entry.loan_amount ?? 0,
      other_deductions: entry.other_deductions ?? 0,
      other_income: entry.other_income ?? 0,
      piece_income: entry.piece_income ?? 0,
      notes: entry.notes || ''
    };
  }

  function updateEntryDraft(entryId, patch) {
    setPayrollDrafts((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] || {}),
        ...patch
      }
    }));
  }

  async function savePayrollDrafts() {
    if (!selected?.entries?.length) return;
    setSaving(true);
    try {
      let updatedPeriod = selected;
      for (const entry of selected.entries) {
        updatedPeriod = await api(scope(`/producalza/payroll-entries/${entry.id}`), {
          method: 'PATCH',
          body: JSON.stringify(entryDraft(entry))
        });
      }
      setSelected(updatedPeriod);
      await onRefresh('Roles actualizados');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const totals = selected?.entries?.reduce((acc, entry) => ({
    income: acc.income + Number(entry.total_income || 0),
    deductions: acc.deductions + Number(entry.total_deductions || 0),
    net: acc.net + Number(entry.net_pay || 0)
  }), { income: 0, deductions: 0, net: 0 }) || { income: 0, deductions: 0, net: 0 };

  return (
    <div className="prod-payroll-layout">
      <section className="prod-panel prod-payroll-import">
        <div className="prod-panel-title">
          <div><span>Roles de pago</span><h2>Importar detalle del reloj</h2></div>
        </div>
        <div className="prod-form-grid">
          <label>Nombre del rol<input value={periodForm.label} onChange={(event) => setPeriodForm({ ...periodForm, label: event.target.value })} /></label>
          <label>Desde<input type="date" value={periodForm.date_from} onChange={(event) => setPeriodForm({ ...periodForm, date_from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={periodForm.date_to} onChange={(event) => setPeriodForm({ ...periodForm, date_to: event.target.value })} /></label>
          <label>Excel DETALLE<input type="file" accept=".xlsx,.xls" onChange={(event) => setPayrollFile(event.target.files?.[0] || null)} /></label>
        </div>
        <div className="prod-form-actions">
          <button className="prod-primary-button" disabled={saving} onClick={importPayroll}><Upload size={17} />{saving ? 'Importando...' : 'Importar y calcular'}</button>
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Historial</span><h2>Roles generados</h2></div></div>
        <div className="prod-payroll-periods">
          {periods.map((period) => (
            <article key={period.id} className={selected?.id === period.id ? 'active' : ''}>
              <button onClick={() => openPeriod(period.id)}>
              <strong>{period.label}</strong>
              <span>{displayDate(period.date_from)} - {displayDate(period.date_to)}</span>
              <small>{period.employees_count || 0} empleados · {displayMoney(period.net_pay)}</small>
              </button>
              <button className="prod-icon-button danger" disabled={saving} onClick={() => deletePeriod(period)}><Trash2 size={16} /></button>
            </article>
          ))}
          {!periods.length && <div className="prod-empty">Aun no hay roles importados.</div>}
        </div>
      </section>

      {selected && (
        <section className="prod-panel prod-payroll-period-detail">
          <div className="prod-panel-title">
            <div><span>{loadingPeriod ? 'Cargando...' : 'Rol mensual'}</span><h2>{selected.label}</h2></div>
            <div className="prod-payroll-actions">
              <button className="prod-secondary-button" disabled={saving} onClick={savePayrollDrafts}><Save size={17} />{saving ? 'Guardando...' : 'Guardar cambios'}</button>
              <button className="prod-secondary-button" onClick={() => setShowPayrollFields((value) => !value)}><Filter size={17} />Campos</button>
              <button className="prod-secondary-button" onClick={() => setPrintMode('cards')}><Printer size={17} />Imprimir tarjetas</button>
              <button className="prod-primary-button" onClick={() => setPrintMode('report')}><Printer size={17} />Reporte mensual</button>
            </div>
          </div>
          <div className="prod-monthly-summary">
            <article><span>Ingresos</span><strong>{displayMoney(totals.income)}</strong><small>Sueldo + extras</small></article>
            <article><span>Egresos</span><strong>{displayMoney(totals.deductions)}</strong><small>IESS + descuentos</small></article>
            <article><span>A pagar</span><strong>{displayMoney(totals.net)}</strong><small>Reporte mensual</small></article>
          </div>
          {showPayrollFields && (
            <div className="prod-payroll-field-picker">
              {payrollFieldOptions.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean(visiblePayrollFields[key])}
                    onChange={(event) => setVisiblePayrollFields((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="prod-table-wrap prod-payroll-table">
            <table className={Object.entries(visiblePayrollFields).filter(([, visible]) => !visible).map(([key]) => `hide-payroll-${key}`).join(' ')}>
              <thead><tr><th>Empleado</th><th>Atrasos</th><th>Extra 50%</th><th>Extra 100%</th><th>Horas no trabajadas</th><th>IESS</th><th>Adelanto</th><th>Ahorro/Rifa</th><th>Calzado</th><th>Prestamos</th><th>Varios</th><th>Comisiones</th><th>A recibir</th></tr></thead>
              <tbody>
                {selected.entries.map((entry) => {
                  const draft = entryDraft(entry);
                  return (
                    <React.Fragment key={entry.id}>
                    <tr>
                      <td><strong>{entry.employee_name}</strong><small>{entry.attendance_days} asistencias · {entry.absent_days} ausencias</small></td>
                      <td>
                        <div className="prod-payroll-mini-inputs">
                          <input type="number" min="0" step="1" value={draft.late_days} onChange={(event) => updateEntryDraft(entry.id, { late_days: event.target.value })} />
                          <input type="number" min="0" step="1" value={draft.late_minutes} onChange={(event) => updateEntryDraft(entry.id, { late_minutes: event.target.value })} />
                        </div>
                        <small>dias / min</small>
                      </td>
                      <td><input type="number" min="0" step="0.01" value={draft.overtime_50_hours} onChange={(event) => updateEntryDraft(entry.id, { overtime_50_hours: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.overtime_100_hours} onChange={(event) => updateEntryDraft(entry.id, { overtime_100_hours: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.manual_unworked_hours} onChange={(event) => updateEntryDraft(entry.id, { manual_unworked_hours: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.iess_amount} onChange={(event) => updateEntryDraft(entry.id, { iess_amount: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.advance_amount} onChange={(event) => updateEntryDraft(entry.id, { advance_amount: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.savings_amount} onChange={(event) => updateEntryDraft(entry.id, { savings_amount: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.footwear_amount} onChange={(event) => updateEntryDraft(entry.id, { footwear_amount: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.loan_amount} onChange={(event) => updateEntryDraft(entry.id, { loan_amount: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.other_deductions} onChange={(event) => updateEntryDraft(entry.id, { other_deductions: event.target.value })} /></td>
                      <td><input type="number" min="0" step="0.01" value={draft.piece_income} onChange={(event) => updateEntryDraft(entry.id, { piece_income: event.target.value })} /></td>
                      <td><strong>{displayMoney(entry.net_pay)}</strong><small>Se recalcula al guardar</small></td>
                    </tr>
                    <tr className="prod-payroll-incidents-row">
                      <td colSpan="13">
                        <div className="prod-payroll-incidents">
                          <label>Faltas<input type="number" min="0" step="1" value={draft.absent_days} onChange={(event) => updateEntryDraft(entry.id, { absent_days: event.target.value })} /></label>
                          <label><input type="checkbox" checked={Boolean(Number(draft.justify_late || 0))} onChange={(event) => updateEntryDraft(entry.id, { justify_late: event.target.checked ? 1 : 0 })} /> Justificar atrasos</label>
                          <label><input type="checkbox" checked={Boolean(Number(draft.justify_absence || 0))} onChange={(event) => updateEntryDraft(entry.id, { justify_absence: event.target.checked ? 1 : 0 })} /> Justificar faltas</label>
                          <small>Atrasos descuentan 1% del sueldo por dia. Faltas injustificadas descuentan 5% por falta.</small>
                        </div>
                      </td>
                    </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Configuracion</span><h2>Empleados</h2></div></div>
        <div className="prod-form-grid">
          <label>Nombre<input value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} /></label>
          <label>Tipo
            <select value={employeeForm.pay_type} onChange={(event) => setEmployeeForm({ ...employeeForm, pay_type: event.target.value })}>
              <option value="salary">Sueldo</option>
              <option value="piecework">Por obra</option>
            </select>
          </label>
          <label>Sueldo mensual<input type="number" step="0.01" value={employeeForm.monthly_salary} onChange={(event) => setEmployeeForm({ ...employeeForm, monthly_salary: event.target.value })} /></label>
          <label>IESS fijo<input type="number" step="0.01" value={employeeForm.default_iess} onChange={(event) => setEmployeeForm({ ...employeeForm, default_iess: event.target.value })} /></label>
          <label>Multa atraso<input type="number" step="0.01" value={employeeForm.late_penalty} onChange={(event) => setEmployeeForm({ ...employeeForm, late_penalty: event.target.value })} /></label>
          <label>Entrada<input type="time" value={employeeForm.normal_start} onChange={(event) => setEmployeeForm({ ...employeeForm, normal_start: event.target.value })} /></label>
          <label>Salida<input type="time" value={employeeForm.normal_end} onChange={(event) => setEmployeeForm({ ...employeeForm, normal_end: event.target.value })} /></label>
          <label>Gracia minutos<input type="number" value={employeeForm.grace_minutes} onChange={(event) => setEmployeeForm({ ...employeeForm, grace_minutes: event.target.value })} /></label>
        </div>
        <div className="prod-form-actions">
          {editingEmployeeId && <button className="prod-secondary-button" onClick={() => { setEditingEmployeeId(null); setEmployeeForm(emptyEmployeeForm); }}>Cancelar</button>}
          <button className="prod-primary-button" disabled={saving} onClick={saveEmployee}><Save size={17} />{editingEmployeeId ? 'Guardar empleado' : 'Crear empleado'}</button>
        </div>
        <div className="prod-employee-list">
          {employees.map((employee) => (
            <article key={employee.id}>
              <div><strong>{employee.name}</strong><span>{employee.normal_start} - {employee.normal_end} · {employee.pay_type === 'piecework' ? 'Por obra' : displayMoney(employee.monthly_salary)}</span></div>
              <button className="prod-secondary-button" onClick={() => editEmployee(employee)}><Pencil size={16} />Editar</button>
            </article>
          ))}
        </div>
      </section>

      {printMode && selected && (
        <PayrollPrintRoot mode={printMode} period={selected} totals={totals} />
      )}
    </div>
  );
}

function PayrollPrintRoot({ mode, period, totals }) {
  const cardPages = [];
  for (let index = 0; index < period.entries.length; index += 4) {
    cardPages.push(period.entries.slice(index, index + 4));
  }
  return (
    <div className={`prod-print-root prod-payroll-print-root print-payroll-${mode}`}>
      {mode === 'report' ? (
        <article className="prod-payroll-report-page">
          <h1>REPORTE DE PAGO MENSUAL</h1>
          <h2>MES: {period.label}</h2>
          <table>
            <thead><tr><th>Nro.</th><th>Nombre</th><th>Sueldo a recibir</th><th>Adelanto</th><th>Saldo</th><th>Firma</th></tr></thead>
            <tbody>
              {period.entries.map((entry, index) => (
                <tr key={entry.id}><td>{index + 1}</td><td>{entry.employee_name}</td><td>{displayMoney(entry.net_pay)}</td><td>{displayMoney(entry.advance_amount)}</td><td></td><td></td></tr>
              ))}
              <tr><td></td><td>TOTAL</td><td>{displayMoney(totals.net)}</td><td></td><td></td><td></td></tr>
            </tbody>
          </table>
        </article>
      ) : cardPages.map((pageEntries, pageIndex) => (
        <div className="prod-payroll-cards-page" key={pageIndex}>
          {pageEntries.map((entry) => {
            const overtime50Hours = Number(entry.overtime_50_hours ?? entry.overtime_hours ?? 0);
            const overtime100Hours = Number(entry.overtime_100_hours || 0);
            const overtime50Value = overtime50Hours * Number(entry.overtime_rate || 0);
            const overtime100Value = overtime100Hours * Number(entry.overtime_100_rate || 0);
            const unworkedDiscount = Number(entry.manual_unworked_hours || 0) * Number(entry.hourly_rate || 0);
            const lateDiscount = Number(entry.justify_late || 0) ? 0 : Number(entry.late_days || 0) * Number(entry.monthly_salary || 0) * 0.01;
            const absenceDiscount = Number(entry.justify_absence || 0) ? 0 : Number(entry.absent_days || 0) * Number(entry.monthly_salary || 0) * 0.05;
            return (
              <article className="prod-payroll-card" key={entry.id}>
                <table className="prod-payroll-card-table">
                  <tbody>
                    <tr><th colSpan="2" className="payroll-card-title">ROL DE PAGOS</th></tr>
                    <tr><td colSpan="2" className="payroll-card-center">Fecha: {displayDate(period.date_from)} - {displayDate(period.date_to)}</td></tr>
                    <tr><td colSpan="2"><strong>Nombre :</strong> {entry.employee_name}</td></tr>
                    <tr><td>Dia de llegar tarde: <strong>{entry.late_days || 0}</strong></td><td>Trabajo hora extra: <strong>{displayNumber(overtime50Hours + overtime100Hours, 2)}</strong></td></tr>
                    <tr><th colSpan="2">INGRESOS:</th></tr>
                    <tr><td>SUELDO</td><td>{displayMoney(entry.pay_type === 'piecework' ? 0 : entry.monthly_salary)}</td></tr>
                    <tr><td>DECIMO III ,IV</td><td>{displayMoney(entry.other_income)}</td></tr>
                    <tr><td>HORAS EXTRAS 50% ({displayNumber(overtime50Hours, 2)} horas)</td><td>{displayMoney(overtime50Value)}</td></tr>
                    <tr><td>HORAS EXTRAS 100% ({displayNumber(overtime100Hours, 2)} horas)</td><td>{displayMoney(overtime100Value)}</td></tr>
                    <tr><td>COMISIONES VENTA / OBRA</td><td>{displayMoney(entry.piece_income)}</td></tr>
                    <tr className="payroll-total-row"><td>TOTAL INGRESOS</td><td>{displayMoney(entry.total_income)}</td></tr>
                    <tr><th colSpan="2">EGRESOS</th></tr>
                    <tr><td>APORTE IESS</td><td>{displayMoney(entry.iess_amount)}</td></tr>
                    <tr><td>DESCUENTO ATRASOS</td><td>{displayMoney(lateDiscount)}</td></tr>
                    <tr><td>DESC. HORAS NO TRABAJA ({displayNumber(entry.manual_unworked_hours || 0, 2)} h)</td><td>{displayMoney(unworkedDiscount)}</td></tr>
                    <tr><td>DESC. FALTAS INJUST. ({entry.absent_days || 0})</td><td>{displayMoney(absenceDiscount)}</td></tr>
                    <tr><td>DESCUE. ADELANTOS</td><td>{displayMoney(entry.advance_amount)}</td></tr>
                    <tr><td>DESC. AHORRO Y RIFA</td><td>{displayMoney(entry.savings_amount)}</td></tr>
                    <tr><td>DES.CALZADO</td><td>{displayMoney(entry.footwear_amount)}</td></tr>
                    <tr><td>DESC. PRESTAMOS</td><td>{displayMoney(entry.loan_amount)}</td></tr>
                    <tr><td>DESC. VARIOS</td><td>{displayMoney(entry.other_deductions)}</td></tr>
                    <tr className="payroll-total-row"><td>TOTAL DE EGRESOS</td><td>{displayMoney(entry.total_deductions)}</td></tr>
                    <tr className="payroll-net-row"><td>TOTAL A RECIBIR (INGRESOS-EGRESOS)</td><td>{displayMoney(entry.net_pay)}</td></tr>
                  </tbody>
                </table>
                <footer>FIRMA</footer>
              </article>
            );
          })}
        </div>
      ))}
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
          <label className="prod-check-line"><input type="checkbox" checked={Boolean(form.is_local_secretary)} onChange={(event) => setForm({ ...form, is_local_secretary: event.target.checked, role: 'vendor', can_view_all_orders: false })} />Secretaria de locales Marjorie/Sebastians</label>
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
              <div><strong>{item.name}</strong><span>@{item.username} · {item.role === 'admin' ? 'Administrador' : item.is_local_secretary ? 'Secretaria locales' : 'Vendedor'}</span><small>{item.status === 'active' ? 'Activo' : 'Inactivo'}{item.can_view_all_orders ? ' · Ve todos los pedidos' : ''}{item.is_local_secretary ? ' · Solo locales' : ''}</small></div>
              <button className="prod-icon-button" onClick={() => edit(item)}><Pencil size={16} /></button>
            </article>
          ))}
          {!users.length && <div className="prod-empty">Crea el primer vendedor para comenzar.</div>}
        </div>
      </section>
    </div>
  );
}

function LocalSecretaryReports({ dashboard, orders, production, scope, onRefresh, setError }) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultSellerForLocal = (localName) => (LOCAL_SELLERS[localName] || [])[0] || '';
  const emptySaleItem = (localName = RETURN_DESTINATIONS[0]) => ({
    model_code: '',
    color: '',
    size: '',
    quantity: 1,
    sale_kind: 'normal',
    seller_name: defaultSellerForLocal(localName),
    payment_method: 'efectivo',
    amount: '',
    notes: ''
  });
  const [filters, setFilters] = useState({
    date_from: `${today.slice(0, 8)}01`,
    date_to: today,
    local_name: ''
  });
  const [finance, setFinance] = useState(null);
  const [sales, setSales] = useState(null);
  const [localConfiguration, setLocalConfiguration] = useState(null);
  const [saleForm, setSaleForm] = useState({
    local_name: RETURN_DESTINATIONS[0],
    sale_date: today,
    items: [emptySaleItem(RETURN_DESTINATIONS[0])]
  });
  const [form, setForm] = useState({
    local_name: RETURN_DESTINATIONS[0],
    entry_type: 'income',
    finance_group: 'various',
    category: 'Gasto varios',
    amount: '',
    entry_date: today,
    payee: '',
    pairs: '',
    notes: ''
  });
  const [loading, setLoading] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const sentOrders = (orders || []).filter((order) => order.order_type !== 'return');
  const visibleProduction = (production || []).filter((item) =>
    !filters.local_name || item.client_name === filters.local_name || item.sample_destination === filters.local_name
  );

  async function loadFinance() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('date_from', filters.date_from);
      query.set('date_to', filters.date_to);
      if (filters.local_name) query.set('local_name', filters.local_name);
      const [financeResponse, salesResponse, configurationResponse] = await Promise.all([
        api(scope(`/producalza/local-finances?${query.toString()}`)),
        api(scope(`/producalza/local-sales?${query.toString()}`)),
        api(scope('/producalza/local-settings'))
      ]);
      setFinance(financeResponse);
      setSales(salesResponse);
      setLocalConfiguration(configurationResponse);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFinance();
  }, []);

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',').pop());
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  }

  async function importLocalReportsExcel(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!window.confirm('Esto reemplazara la importacion historica anterior de REPORTES LOCALES 2026. Las ventas y gastos manuales no se eliminan. Continuar?')) {
      return;
    }
    setImportingExcel(true);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const response = await api(scope('/producalza/local-reports/import-excel'), {
        method: 'POST',
        body: JSON.stringify({ file_name: file.name, file_base64: fileBase64 })
      });
      setImportSummary(response.summary || null);
      await loadFinance();
      onRefresh('Excel de locales importado');
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingExcel(false);
    }
  }

  async function saveFinance() {
    try {
      await api(scope('/producalza/local-finances'), {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm({ ...form, amount: '', notes: '', payee: '', pairs: '' });
      await loadFinance();
      onRefresh('Movimiento registrado');
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveSale() {
    try {
      const hasMissingSeller = saleForm.items.some((item) => !String(item.seller_name || '').trim());
      if (hasMissingSeller) {
        setError('Selecciona la vendedora en cada modelo antes de guardar.');
        return;
      }
      await api(scope('/producalza/local-sales'), {
        method: 'POST',
        body: JSON.stringify(saleForm)
      });
      setSaleForm({
        ...saleForm,
        sale_date: saleForm.sale_date || today,
        items: [emptySaleItem(saleForm.local_name)]
      });
      await loadFinance();
      onRefresh('Venta diaria registrada');
    } catch (err) {
      setError(err.message);
    }
  }

  function updateSaleItem(index, patch) {
    setSaleForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    }));
  }

  function removeSaleItem(index) {
    setSaleForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items
    }));
  }

  async function removeSale(item) {
    if (!window.confirm(`Eliminar la venta ${item.sale_number}?`)) return;
    try {
      await api(scope(`/producalza/local-sales/${item.id}`), { method: 'DELETE' });
      await loadFinance();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeFinance(item) {
    if (!window.confirm('Eliminar este movimiento de ingresos/egresos?')) return;
    try {
      await api(scope(`/producalza/local-finances/${item.id}`), { method: 'DELETE' });
      await loadFinance();
    } catch (err) {
      setError(err.message);
    }
  }

  const totals = finance?.totals || { income: 0, expense: 0 };
  const salesTotals = sales?.totals || { amount: 0, commission: 0, sales_count: 0 };
  const saleRows = sales?.rows || [];
  const financeRows = finance?.rows || [];
  const totalIncome = Number(totals.income || 0) + Number(salesTotals.amount || 0);
  const balance = totalIncome - Number(totals.expense || 0);
  const saleFormTotals = saleForm.items.reduce((acc, item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    acc.pairs += quantity;
    acc.amount += Number(item.amount || 0) * quantity;
    acc.commission += localSaleCommission(saleForm.local_name, item.amount, localConfiguration) * quantity;
    return acc;
  }, { pairs: 0, amount: 0, commission: 0 });
  const totalByPayment = (method) => saleRows
    .filter((item) => item.payment_method === method)
    .reduce((acc, item) => ({
      pairs: acc.pairs + Number(item.quantity || 1),
      amount: acc.amount + Number(item.amount || 0)
    }), { pairs: 0, amount: 0 });
  const totalByKind = (kind) => saleRows
    .filter((item) => (item.sale_kind || 'normal') === kind)
    .reduce((acc, item) => ({
      pairs: acc.pairs + Number(item.quantity || 1),
      amount: acc.amount + Number(item.amount || 0)
    }), { pairs: 0, amount: 0 });
  const cashTotals = totalByPayment('efectivo');
  const cardTotals = totalByPayment('tarjeta');
  const separatedTotals = totalByKind('separated');
  const wholesaleTotals = totalByKind('wholesale');
  const financeSum = (group, categoryIncludes = '') => financeRows
    .filter((item) =>
      (item.finance_group || 'various') === group &&
      (!categoryIncludes || String(item.category || '').toLowerCase().includes(categoryIncludes))
    )
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const variousExpenses = financeSum('various');
  const adminExpenses = financeSum('admin');
  const deposits = financeSum('deposit');
  const serviceExpenses = financeSum('service');
  const selectedLocalConfiguration = localConfiguration?.locations?.find((item) => item.local_name === filters.local_name);
  const payrollBase = (selectedLocalConfiguration?.staff || [])
    .filter((staff) => staff.include_in_report)
    .reduce((sum, staff) => sum + Number(staff.monthly_salary || 0), 0);
  const payrollTotalEstimate = payrollBase + Number(salesTotals.commission || 0);
  const finalLocalTotal = Number(salesTotals.amount || 0) - payrollTotalEstimate - serviceExpenses - deposits;
  const sellerOptions = LOCAL_SELLERS[saleForm.local_name] || [];

  function syncLocal(localName) {
    const fallbackSeller = defaultSellerForLocal(localName);
    setSaleForm((current) => ({
      ...current,
      local_name: localName,
      items: current.items.map((item) => ({
        ...item,
        seller_name: (LOCAL_SELLERS[localName] || []).includes(item.seller_name) ? item.seller_name : fallbackSeller
      }))
    }));
    setForm((current) => ({
      ...current,
      local_name: localName,
      amount: current.finance_group === 'service' && current.category === 'Arriendo'
        ? String(localConfiguration?.locations?.find((item) => item.local_name === localName)?.rent_amount || '')
        : current.finance_group === 'service' && current.category === 'Internet'
          ? String(localConfiguration?.locations?.find((item) => item.local_name === localName)?.internet_amount || '')
          : current.amount
    }));
  }

  return (
    <div className="prod-stack">
      <section className="prod-metrics">
        <article><Factory size={21} /><span>Mandado a fabricar</span><strong>{sentOrders.length}</strong></article>
        <article><Boxes size={21} /><span>Pares en proceso</span><strong>{dashboard?.pending_pairs || 0}</strong></article>
        <article><DollarSign size={21} /><span>Ventas locales</span><strong>{displayMoney(salesTotals.amount || 0)}</strong></article>
        <article><DollarSign size={21} /><span>Comisiones</span><strong>{displayMoney(salesTotals.commission || 0)}</strong></article>
        <article><DollarSign size={21} /><span>Saldo rapido</span><strong>{displayMoney(balance)}</strong></article>
      </section>

      <LocalSettingsManager
        scope={scope}
        setError={setError}
        configuration={localConfiguration}
        onConfigurationChange={setLocalConfiguration}
      />

      <LocalMonthlyManager scope={scope} setError={setError} configuration={localConfiguration} />

      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Datos historicos</span><h2>Importar Excel de locales</h2></div>
          <label className={`prod-primary-button ${importingExcel ? 'disabled' : ''}`}>
            <Upload size={17} />{importingExcel ? 'Importando...' : 'Seleccionar Excel'}
            <input type="file" accept=".xlsx,.xls" disabled={importingExcel} onChange={importLocalReportsExcel} hidden />
          </label>
        </div>
        <div className="prod-empty">
          Sube el archivo REPORTES LOCALES 2026 para cargar ventas, gastos y asistencias historicas. Si lo subes otra vez, se reemplaza solo esa importacion.
        </div>
        {importSummary && (
          <div className="prod-return-destination-summary">
            <article><span>Ventas importadas</span><strong>{displayNumber(importSummary.ventas || 0)}</strong><small>Desde el Excel historico</small></article>
            <article><span>Gastos/ingresos</span><strong>{displayNumber(importSummary.gastos_movimientos || 0)}</strong><small>Movimientos diarios</small></article>
            <article><span>Asistencias</span><strong>{displayNumber(importSummary.asistencias_dias || 0)}</strong><small>{displayNumber(importSummary.asistencias_registros_entrada_salida || 0)} entradas/salidas</small></article>
          </div>
        )}
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Locales</span><h2>Ventas diarias</h2></div>
          <button className="prod-primary-button" disabled={loading} onClick={loadFinance}><Filter size={17} />Filtrar</button>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
          <label>Local
            <select value={filters.local_name} onChange={(event) => setFilters({ ...filters, local_name: event.target.value })}>
              <option value="">Todos los locales</option>
              {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
            </select>
          </label>
        </div>
        <div className="prod-return-destination-summary">
          {(sales?.by_local || []).map((item) => (
            <article key={item.local_name}>
              <span>{item.local_name}</span>
              <strong>{displayMoney(item.amount)}</strong>
              <small>{item.sales_count} ventas · Comisión {displayMoney(item.commission)}</small>
            </article>
          ))}
          {!(sales?.by_local || []).length && <article><span>Sin ventas</span><strong>{displayMoney(0)}</strong><small>Con los filtros actuales</small></article>}
        </div>
        <div className="prod-form-grid">
          <label>Local
            <select value={saleForm.local_name} onChange={(event) => syncLocal(event.target.value)}>
              {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
            </select>
          </label>
          <label>Fecha<input type="date" value={saleForm.sale_date} onChange={(event) => setSaleForm({ ...saleForm, sale_date: event.target.value })} /></label>
          <label>Total venta<input value={displayMoney(saleFormTotals.amount)} readOnly /></label>
          <label>Comision calculada<input value={displayMoney(saleFormTotals.commission)} readOnly /></label>
        </div>
        <div className="prod-local-items">
          {saleForm.items.map((item, index) => (
            <div key={index} className="prod-local-item-row local-sale-item-row">
              <input placeholder="Modelo" value={item.model_code} onChange={(event) => updateSaleItem(index, { model_code: event.target.value })} />
              <input placeholder="Color" value={item.color} onChange={(event) => updateSaleItem(index, { color: event.target.value })} />
              <input placeholder="Talla" value={item.size} onChange={(event) => updateSaleItem(index, { size: event.target.value })} />
              <input type="number" min="1" placeholder="Pares" value={item.quantity} onChange={(event) => updateSaleItem(index, { quantity: event.target.value })} />
              <select value={item.sale_kind} onChange={(event) => updateSaleItem(index, { sale_kind: event.target.value })}>
                {LOCAL_SALE_KIND_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <select value={item.seller_name} onChange={(event) => updateSaleItem(index, { seller_name: event.target.value })}>
                <option value="">Vendedora</option>
                {sellerOptions.map((seller) => <option value={seller} key={seller}>{seller}</option>)}
              </select>
              <select value={item.payment_method} onChange={(event) => updateSaleItem(index, { payment_method: event.target.value })}>
                {LOCAL_PAYMENT_METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <input type="number" min="0" step="0.01" placeholder="Valor unitario" value={item.amount} onChange={(event) => updateSaleItem(index, { amount: event.target.value })} />
              <input placeholder="Notas" value={item.notes} onChange={(event) => updateSaleItem(index, { notes: event.target.value })} />
              <button className="prod-icon-button danger" onClick={() => removeSaleItem(index)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="prod-form-actions">
          <button className="prod-secondary-button" onClick={() => setSaleForm((current) => ({ ...current, items: [...current.items, emptySaleItem(current.local_name)] }))}><Plus size={16} />Agregar modelo</button>
          <button className="prod-primary-button" onClick={saveSale}><Save size={17} />Guardar venta</button>
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Secuencia</th><th>Fecha</th><th>Local</th><th>Modelo</th><th>Vendedora</th><th>Tipo</th><th>Pago</th><th>Pares</th><th>Valor</th><th>Comision</th><th /></tr></thead>
            <tbody>
              {(sales?.rows || []).map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.sale_number}</strong></td>
                  <td>{displayDate(item.sale_date)}</td>
                  <td>{item.local_name}</td>
                  <td><strong>{item.model_code}</strong><small>{[item.color, item.size && `Talla ${item.size}`].filter(Boolean).join(' / ')}</small></td>
                  <td>{item.seller_name || '-'}</td>
                  <td>{LOCAL_SALE_KIND_OPTIONS.find(([value]) => value === (item.sale_kind || 'normal'))?.[1] || 'Normal'}</td>
                  <td>{LOCAL_PAYMENT_METHODS.find(([value]) => value === item.payment_method)?.[1] || item.payment_method}</td>
                  <td>{item.quantity || 1}</td>
                  <td>{displayMoney(item.amount)}</td>
                  <td><strong>{displayMoney(item.commission)}</strong></td>
                  <td><button className="prod-icon-button danger" onClick={() => removeSale(item)}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sales?.rows?.length && <div className="prod-empty">No hay ventas diarias con esos filtros.</div>}
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Locales</span><h2>Otros ingresos y egresos</h2></div>
          <button className="prod-primary-button" disabled={loading} onClick={loadFinance}><Filter size={17} />Filtrar</button>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
          <label>Local
            <select value={filters.local_name} onChange={(event) => setFilters({ ...filters, local_name: event.target.value })}>
              <option value="">Todos los locales</option>
              {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
            </select>
          </label>
        </div>
        <div className="prod-return-destination-summary">
          {(finance?.by_local || []).map((item) => (
            <article key={item.local_name}>
              <span>{item.local_name}</span>
              <strong>{displayMoney(item.balance)}</strong>
              <small>Otros ingresos {displayMoney(item.income)} · Egresos {displayMoney(item.expense)}</small>
            </article>
          ))}
        </div>
        <div className="prod-form-grid">
          <label>Local
            <select value={form.local_name} onChange={(event) => syncLocal(event.target.value)}>
              {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
            </select>
          </label>
          <label>Grupo
            <select
              value={form.finance_group}
              onChange={(event) => setForm({
                ...form,
                finance_group: event.target.value,
                entry_type: event.target.value === 'income' ? 'income' : 'expense',
                category: event.target.value === 'service' ? 'Arriendo'
                  : event.target.value === 'deposit' ? 'Deposito'
                    : event.target.value === 'admin' ? 'Publicidad'
                      : event.target.value === 'income' ? 'Otro ingreso'
                        : 'Gasto varios',
                amount: event.target.value === 'service'
                  ? String(localConfiguration?.locations?.find((item) => item.local_name === form.local_name)?.rent_amount || '')
                  : form.amount
              })}
            >
              {LOCAL_FINANCE_GROUP_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          {form.finance_group === 'service' && (
            <label>Servicio
              <select
                value={form.category}
                onChange={(event) => setForm({
                  ...form,
                  category: event.target.value,
                  amount: event.target.value === 'Arriendo'
                    ? String(localConfiguration?.locations?.find((item) => item.local_name === form.local_name)?.rent_amount || '')
                    : event.target.value === 'Internet'
                      ? String(localConfiguration?.locations?.find((item) => item.local_name === form.local_name)?.internet_amount || '')
                    : form.amount
                })}
              >
                <option>Arriendo</option>
                <option>Luz</option>
                <option>Agua</option>
                <option>Internet</option>
              </select>
            </label>
          )}
          <label>Detalle<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
          <label>Valor<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
          <label>Fecha<input type="date" value={form.entry_date} onChange={(event) => setForm({ ...form, entry_date: event.target.value })} /></label>
          <label>Persona / destino<input value={form.payee} onChange={(event) => setForm({ ...form, payee: event.target.value })} /></label>
          <label>Pares Producalza<input type="number" min="0" value={form.pairs} onChange={(event) => setForm({ ...form, pairs: event.target.value, amount: form.finance_group === 'admin' && form.category.toLowerCase().includes('producalza') ? String(Number(event.target.value || 0) * 35) : form.amount })} /></label>
          <label className="span-full">Notas<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        </div>
        <div className="prod-form-actions">
          <button className="prod-primary-button" onClick={saveFinance}><Save size={17} />Guardar movimiento</button>
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Fecha</th><th>Local</th><th>Grupo</th><th>Detalle</th><th>Persona</th><th>Valor</th><th /></tr></thead>
            <tbody>
              {(finance?.rows || []).map((item) => (
                <tr key={item.id}>
                  <td>{displayDate(item.entry_date)}</td>
                  <td><strong>{item.local_name}</strong></td>
                  <td>{LOCAL_FINANCE_GROUP_OPTIONS.find(([value]) => value === (item.finance_group || 'various'))?.[1] || item.finance_group}</td>
                  <td>{item.category}<small>{[item.pairs ? `${item.pairs} pares` : '', item.notes || ''].filter(Boolean).join(' / ')}</small></td>
                  <td>{item.payee || '-'}</td>
                  <td>{displayMoney(item.amount)}</td>
                  <td><button className="prod-icon-button danger" onClick={() => removeFinance(item)}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!finance?.rows?.length && <div className="prod-empty">No hay movimientos con esos filtros.</div>}
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Produccion</span><h2>Lo que mandaste a fabricar</h2></div></div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Pedido</th><th>Cliente/local</th><th>Modelo</th><th>Pares</th><th>Estado</th></tr></thead>
            <tbody>
              {visibleProduction.map((item) => (
                <tr key={item.id}>
                  <td>{item.order_number}<small>{displayDate(item.order_date)}</small></td>
                  <td><strong>{item.client_name}</strong><small>{item.seller_name || ''}</small></td>
                  <td>{item.model_code}<small>{[item.color, item.material].filter(Boolean).join(' ')}</small></td>
                  <td>{item.total_pairs}</td>
                  <td><StatusBadge status={item.status} model /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleProduction.length && <div className="prod-empty">No hay produccion con esos filtros.</div>}
        </div>
      </section>
    </div>
  );
}

function LocalSettingsManager({ scope, setError, configuration, onConfigurationChange }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState(RETURN_DESTINATIONS[0]);
  const [draft, setDraft] = useState(null);
  const [rules, setRules] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  const selectedConfiguration = configuration?.locations?.find((item) => item.local_name === selectedLocal);
  const selectedScheme = selectedLocal === 'Sebastians' ? 'sebastians' : 'marjorie';

  useEffect(() => {
    if (!selectedConfiguration) return;
    setDraft({
      ...selectedConfiguration,
      staff: (selectedConfiguration.staff || []).map((item) => ({ ...item }))
    });
  }, [configuration, selectedLocal]);

  useEffect(() => {
    const scheme = configuration?.commission_schemes?.find((item) => item.scheme_key === selectedScheme);
    setRules((scheme?.rules || []).map((item) => ({
      min_amount: item.min_amount,
      commission_amount: item.commission_amount
    })));
  }, [configuration, selectedScheme]);

  async function reloadConfiguration() {
    const response = await api(scope('/producalza/local-settings'));
    onConfigurationChange(response);
    return response;
  }

  function updateStaff(staffId, patch) {
    setDraft((current) => ({
      ...current,
      staff: current.staff.map((item) => item.id === staffId ? { ...item, ...patch } : item)
    }));
  }

  async function saveLocalSettings() {
    if (!draft) return;
    setSaving(true);
    setSavedMessage('');
    try {
      await api(scope('/producalza/local-settings'), {
        method: 'PUT',
        body: JSON.stringify({
          ...draft,
          local_name: selectedLocal,
          staff: (draft.staff || []).map((item) => ({
            staff_id: item.id,
            include_in_report: Boolean(item.include_in_report),
            monthly_salary: item.monthly_salary
          }))
        })
      });
      await reloadConfiguration();
      setSavedMessage(`Informacion de ${selectedLocal} guardada.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function updateRule(index, patch) {
    setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function saveCommissionRules() {
    setSaving(true);
    setSavedMessage('');
    try {
      await api(scope('/producalza/local-commission-rules'), {
        method: 'PUT',
        body: JSON.stringify({ scheme_key: selectedScheme, rules })
      });
      await reloadConfiguration();
      setSavedMessage(`Tabla de comisiones de ${selectedScheme === 'marjorie' ? 'Marjorie Botas' : 'Sebastians'} guardada.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const activeStaff = (draft?.staff || []).filter((item) => item.status === 'active');
  const includedStaff = activeStaff.filter((item) => item.include_in_report);
  const fixedCosts = Number(draft?.rent_amount || 0)
    + Number(draft?.electricity_amount || 0)
    + Number(draft?.water_amount || 0)
    + Number(draft?.internet_amount || 0)
    + Number(draft?.condominium_amount || 0);

  return (
    <section className={`prod-panel prod-local-settings ${expanded ? 'is-open' : ''}`}>
      <button className="prod-local-settings-toggle" onClick={() => setExpanded((current) => !current)}>
        <span className="prod-local-settings-icon"><Settings2 size={21} /></span>
        <span>
          <small>Configuracion separada</small>
          <strong>Informacion de locales</strong>
        </span>
        <span className="prod-local-settings-summary">
          {selectedLocal} · {includedStaff.length} empleada{includedStaff.length === 1 ? '' : 's'} · {displayMoney(fixedCosts)} fijos
        </span>
        <ChevronDown size={20} />
      </button>

      {expanded && (
        <div className="prod-local-settings-body">
          {!draft ? <div className="prod-empty">Cargando configuracion...</div> : (
            <>
              <div className="prod-local-tabs" role="tablist" aria-label="Seleccionar local">
                {RETURN_DESTINATIONS.map((localName) => (
                  <button
                    key={localName}
                    className={selectedLocal === localName ? 'active' : ''}
                    onClick={() => { setSelectedLocal(localName); setSavedMessage(''); }}
                  >
                    {localName.replace('Local Marjorie Botas ', '')}
                  </button>
                ))}
              </div>

              <div className="prod-local-config-grid">
                <div className="prod-local-config-card">
                  <div className="prod-local-config-heading">
                    <div><span>Valores del local</span><h3>{selectedLocal}</h3></div>
                  </div>
                  <div className="prod-form-grid prod-local-cost-grid">
                    <label>Arriendo $<input type="number" min="0" step="0.01" value={draft.rent_amount ?? ''} onChange={(event) => setDraft({ ...draft, rent_amount: event.target.value })} /></label>
                    <label>Luz $<input type="number" min="0" step="0.01" value={draft.electricity_amount ?? ''} onChange={(event) => setDraft({ ...draft, electricity_amount: event.target.value })} /></label>
                    <label>Agua $<input type="number" min="0" step="0.01" value={draft.water_amount ?? ''} onChange={(event) => setDraft({ ...draft, water_amount: event.target.value })} /></label>
                    <label>Internet $<input type="number" min="0" step="0.01" value={draft.internet_amount ?? ''} onChange={(event) => setDraft({ ...draft, internet_amount: event.target.value })} /></label>
                    <label>Alicuota $<input type="number" min="0" step="0.01" value={draft.condominium_amount ?? ''} onChange={(event) => setDraft({ ...draft, condominium_amount: event.target.value })} /></label>
                    <label>Costo Producalza por par $<input type="number" min="0" step="0.01" value={draft.production_cost_per_pair ?? ''} onChange={(event) => setDraft({ ...draft, production_cost_per_pair: event.target.value })} /></label>
                  </div>
                  <label>Tabla de comisiones
                    <input value={selectedLocal === 'Sebastians' ? 'Sebastians' : 'Marjorie Botas (compartida Norte, Sur y Valle)'} readOnly />
                  </label>
                  <label>Notas del local<textarea rows="2" value={draft.notes || ''} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
                  <button className="prod-primary-button" disabled={saving} onClick={saveLocalSettings}><Save size={17} />Guardar informacion del local</button>
                </div>

                <div className="prod-local-config-card">
                  <div className="prod-local-config-heading">
                    <div><span>Rol mensual</span><h3>Empleadas incluidas</h3></div>
                    <strong>{displayMoney(includedStaff.reduce((sum, item) => sum + Number(item.monthly_salary || 0), 0))}</strong>
                  </div>
                  <div className="prod-local-staff-config">
                    {activeStaff.map((item) => (
                      <div className={`prod-local-staff-row ${item.include_in_report ? 'selected' : ''}`} key={item.id}>
                        <label className="prod-check-line">
                          <input type="checkbox" checked={Boolean(item.include_in_report)} onChange={(event) => updateStaff(item.id, { include_in_report: event.target.checked })} />
                          <span><strong>{item.name}</strong><small>Incluir en el reporte de este local</small></span>
                        </label>
                        <label>Sueldo $<input type="number" min="0" step="0.01" disabled={!item.include_in_report} value={item.monthly_salary ?? ''} onChange={(event) => updateStaff(item.id, { monthly_salary: event.target.value })} /></label>
                      </div>
                    ))}
                  </div>
                  <button className="prod-primary-button" disabled={saving} onClick={saveLocalSettings}><Save size={17} />Guardar empleadas y sueldos</button>
                </div>
              </div>

              <div className="prod-local-config-card prod-commission-config">
                <div className="prod-local-config-heading">
                  <div>
                    <span>Calculo automatico</span>
                    <h3>Comisiones {selectedScheme === 'marjorie' ? 'Marjorie Botas' : 'Sebastians'}</h3>
                    <small>{selectedScheme === 'marjorie' ? 'Esta tabla se usa en Norte, Sur y Valle.' : 'Esta tabla se usa unicamente en Sebastians.'}</small>
                  </div>
                  <button className="prod-secondary-button" onClick={() => setRules((current) => [...current, { min_amount: '', commission_amount: '' }])}><Plus size={16} />Agregar rango</button>
                </div>
                <div className="prod-commission-table">
                  <div className="prod-commission-head"><span>Desde $</span><span>Hasta $</span><span>Comision $</span><span></span></div>
                  {rules.map((rule, index) => {
                    const nextMinimum = Number(rules[index + 1]?.min_amount);
                    const maximum = Number.isFinite(nextMinimum) && nextMinimum > Number(rule.min_amount || 0)
                      ? displayNumber(nextMinimum - 0.01, 2)
                      : 'En adelante';
                    return (
                      <div className="prod-commission-row" key={`${index}-${rule.min_amount}`}>
                        <input type="number" min="0" step="0.01" value={rule.min_amount} onChange={(event) => updateRule(index, { min_amount: event.target.value })} />
                        <span>{maximum}</span>
                        <input type="number" min="0" step="0.01" value={rule.commission_amount} onChange={(event) => updateRule(index, { commission_amount: event.target.value })} />
                        <button className="prod-icon-button danger" disabled={rules.length === 1 || Number(rule.min_amount) === 0} onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>
                      </div>
                    );
                  })}
                </div>
                <div className="prod-form-actions">
                  {savedMessage && <span className="prod-local-saved"><Check size={16} />{savedMessage}</span>}
                  <button className="prod-primary-button" disabled={saving} onClick={saveCommissionRules}><Save size={17} />Guardar tabla de comisiones</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function emptyLocalMonthlyForm(month) {
  return {
    report_month: month,
    local_name: RETURN_DESTINATIONS[0],
    cash_pairs: '',
    cash_value: '',
    card_pairs: '',
    card_value: '',
    separated_pairs: '',
    separated_value: '',
    wholesale_pairs: '',
    wholesale_value: '',
    business_pairs: '',
    business_value: '',
    previous_balance: '',
    card_note: '',
    notes: '',
    items: [
      { section: 'expense', label: 'PRAS/CARGO', amount: '', notes: '' },
      { section: 'service', label: 'ARRIENDO', amount: '', notes: '' },
      { section: 'deposit', label: 'TRANSFER MARLON', amount: '', notes: '' }
    ]
  };
}

function emptyLocalPayrollForm(month) {
  return {
    report_month: month,
    local_name: RETURN_DESTINATIONS[0],
    staff_id: '',
    staff_name: '',
    date_from: `${month}-01`,
    date_to: '',
    items: [
      { item_type: 'income', label: 'Sueldo mensual', amount: '', notes: '' },
      { item_type: 'income', label: 'Comisiones', amount: '', notes: '' },
      { item_type: 'income', label: 'Adicionales', amount: '', notes: '' },
      { item_type: 'deduction', label: 'Adelanto', amount: '', notes: '' },
      { item_type: 'deduction', label: 'Descuento', amount: '', notes: '' }
    ]
  };
}

function localStaffBaseSalary(name, localName = '', configuration = null) {
  const clean = String(name || '').toLowerCase();
  const configuredStaff = configuration?.locations
    ?.find((item) => item.local_name === localName)?.staff
    ?.find((staff) => {
      const staffName = String(staff.name || '').toLowerCase();
      return clean.includes(staffName) || staffName.includes(clean);
    });
  if (configuredStaff) return configuredStaff.monthly_salary || '';
  return LOCAL_STAFF_DEFAULTS.find((staff) => clean.includes(staff.name.toLowerCase()) || staff.name.toLowerCase().includes(clean))?.monthly_salary || '';
}

function localStaffCommission(name, salesRows = []) {
  const clean = String(name || '').toLowerCase();
  if (!clean) return 0;
  return salesRows
    .filter((sale) => {
      const seller = String(sale.seller_name || '').toLowerCase();
      return seller && (clean.includes(seller) || seller.includes(clean.split(' ')[0]));
    })
    .reduce((sum, sale) => sum + Number(sale.commission || 0), 0);
}

function localPayrollItemsFor(name, salesRows = [], localName = '', configuration = null) {
  return [
    { item_type: 'income', label: 'Sueldo mensual', amount: localStaffBaseSalary(name, localName, configuration), notes: '' },
    { item_type: 'income', label: 'Comisiones', amount: localStaffCommission(name, salesRows), notes: '' },
    { item_type: 'income', label: 'Adicionales', amount: '', notes: '' },
    { item_type: 'deduction', label: 'Adelanto', amount: '', notes: '' },
    { item_type: 'deduction', label: 'Descuento', amount: '', notes: '' }
  ];
}

function monthEndDate(month) {
  const [year, monthNumber] = String(month || '').split('-').map(Number);
  if (!year || !monthNumber) return `${new Date().toISOString().slice(0, 7)}-31`;
  return new Date(year, monthNumber, 0).toISOString().slice(0, 10);
}

function reportMonthName(month) {
  const [year, monthNumber] = String(month || '').split('-').map(Number);
  if (!year || !monthNumber) return '';
  return new Date(year, monthNumber - 1, 1)
    .toLocaleDateString('es-EC', { month: 'long' })
    .toUpperCase();
}

function escapeReportHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function localReportLineTotals(rows) {
  const empty = () => ({ pairs: 0, amount: 0 });
  const lines = {
    cash: empty(),
    card: empty(),
    separated: empty(),
    wholesale: empty(),
    business: empty()
  };
  for (const row of rows || []) {
    const quantity = Number(row.quantity || 1);
    const amount = Number(row.amount || 0);
    const kind = row.sale_kind || 'normal';
    let target = 'cash';
    if (kind === 'separated') target = 'separated';
    else if (kind === 'wholesale') target = 'wholesale';
    else if (kind === 'business') target = 'business';
    else if (row.payment_method === 'tarjeta') target = 'card';
    lines[target].pairs += quantity;
    lines[target].amount += amount;
  }
  lines.total = Object.values(lines).reduce((acc, line) => ({
    pairs: acc.pairs + line.pairs,
    amount: acc.amount + line.amount
  }), empty());
  return lines;
}

function localReportFinanceGroups(rows) {
  const byGroup = { various: [], service: [], deposit: [], admin: [] };
  for (const row of rows || []) {
    const group = row.finance_group || 'various';
    if (byGroup[group]) byGroup[group].push(row);
  }
  return byGroup;
}

function localReportConceptLabel(row, group = '') {
  const rawLabel = String(row.label || row.category || '').trim();
  const normalized = normalizeText(rawLabel);
  if (!rawLabel) return '';
  if (group === 'various' && /(sueldo|emplead|rol|comision)/.test(normalized)) return '';
  if (group === 'service') {
    if (normalized.includes('arriendo')) return 'Arriendo';
    if (normalized.includes('luz')) return 'Luz';
    if (normalized.includes('agua')) return 'Agua';
    if (normalized.includes('internet')) return 'Internet';
  }
  const knownConcepts = [
    [/servi\w*entrega|servierntrega|servientrega/, 'Servientrega'],
    [/motorizado|moto\b|motorizada/, 'Motorizado'],
    [/suministro/, 'Suministro'],
    [/\baseo\b/, 'Aseo'],
    [/\bprass?\b/, 'Prass'],
    [/\bpublicidad\b/, 'Publicidad'],
    [/\bproducalza\b/, 'Producalza']
  ];
  for (const [pattern, label] of knownConcepts) {
    if (pattern.test(normalized)) return label;
  }
  const stopWords = new Set([
    'ayer', 'hoy', 'manana', 'envio', 'envios', 'pago', 'pagos', 'abono', 'abonos',
    'deposito', 'depositos', 'transferencia', 'transferencias', 'efectivo', 'tarjeta',
    'factura', 'facturas', 'gasto', 'gastos', 'varios', 'varias', 'local', 'del', 'de',
    'la', 'el', 'los', 'las', 'para', 'por', 'con', 'en', 'al', 'a'
  ]);
  const tokens = normalized
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length >= 3 && !stopWords.has(word) && !/^\d+$/.test(word));
  const simpleName = tokens[0] || normalized.split(/\s+/).find((word) => word.length >= 3) || rawLabel;
  return simpleName
    .split(' ')
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '')
    .join(' ');
}

function localReportTableRows(rows, fallbackRows = [], group = '') {
  const grouped = new Map();
  for (const row of fallbackRows) {
    const label = localReportConceptLabel(row, group);
    if (!label) continue;
    const key = normalizeText(label);
    const current = grouped.get(key) || { label, amount: 0 };
    current.amount += Number(row.amount || 0);
    grouped.set(key, current);
  }
  const actual = new Map();
  for (const row of rows || []) {
    const label = localReportConceptLabel(row, group);
    if (!label) continue;
    const key = normalizeText(label);
    const current = actual.get(key) || { label, amount: 0 };
    current.amount += Number(row.amount || 0);
    actual.set(key, current);
  }
  for (const [key, value] of actual.entries()) grouped.set(key, value);
  return [...grouped.values()];
}

function localReportPayrollRows(payrollRows, localName, salesRows, configuration = null) {
  if (payrollRows?.length) {
    return payrollRows.map((row) => {
      const incomes = row.incomes || [];
      const deductionsRows = row.deductions || [];
      const incomeAmount = (pattern) => incomes
        .filter((item) => pattern.test(normalizeText(item.label || '')))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const deductionAmount = (pattern) => deductionsRows
        .filter((item) => pattern.test(normalizeText(item.label || '')))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const salary = incomeAmount(/sueldo|mensual/) || Number(localStaffBaseSalary(row.staff_name, localName, configuration) || 0);
      const commission = incomeAmount(/comision/);
      const additions = incomes
        .filter((item) => !/sueldo|mensual|comision/.test(normalizeText(item.label || '')))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const advance = deductionAmount(/adelanto/);
      const otherDeductions = deductionsRows
        .filter((item) => !/adelanto/.test(normalizeText(item.label || '')))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return {
        name: row.staff_name || 'Empleada',
        salary,
        commission,
        additions,
        advance,
        deductions: otherDeductions,
        deductionLines: deductionsRows.map((item) => ({
          label: item.label || 'Descuento',
          amount: Number(item.amount || 0)
        })),
        net: Number(row.net_pay || (salary + commission + additions - advance - otherDeductions))
      };
    });
  }
  const configuredLocation = configuration?.locations?.find((item) => item.local_name === localName);
  const configuredStaff = (configuredLocation?.staff || [])
    .filter((staff) => staff.include_in_report)
    .map((staff) => ({ name: staff.name, monthly_salary: staff.monthly_salary }));
  const fallbackStaff = LOCAL_STAFF_DEFAULTS.filter((staff) => staff.local_name === localName);
  return (configuredLocation ? configuredStaff : fallbackStaff)
    .map((staff) => {
      const commission = localStaffCommission(staff.name, salesRows);
      const salary = Number(staff.monthly_salary || 0);
      return {
        name: staff.name,
        salary,
        commission,
        additions: 0,
        advance: 0,
        deductions: 0,
        deductionLines: [],
        net: salary + commission
      };
    });
}

function LocalMonthlyManager({ scope, setError, configuration }) {
  const todayMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(todayMonth);
  const [localName, setLocalName] = useState(RETURN_DESTINATIONS[0]);
  const [reports, setReports] = useState(null);
  const [staff, setStaff] = useState([]);
  const [localSales, setLocalSales] = useState([]);
  const [localFinances, setLocalFinances] = useState([]);
  const [monthlyForm, setMonthlyForm] = useState(() => emptyLocalMonthlyForm(todayMonth));
  const [payrollForm, setPayrollForm] = useState(() => emptyLocalPayrollForm(todayMonth));
  const [loading, setLoading] = useState(false);

  async function loadMonthly() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('month', month);
      if (localName) query.set('local_name', localName);
      const salesQuery = new URLSearchParams();
      salesQuery.set('date_from', `${month}-01`);
      salesQuery.set('date_to', monthEndDate(month));
      if (localName) salesQuery.set('local_name', localName);
      const [reportResponse, staffResponse, salesResponse, financesResponse] = await Promise.all([
        api(scope(`/producalza/local-monthly-reports?${query.toString()}`)),
        api(scope('/producalza/local-attendance')),
        api(scope(`/producalza/local-sales?${salesQuery.toString()}`)),
        api(scope(`/producalza/local-finances?${salesQuery.toString()}`))
      ]);
      setReports(reportResponse);
      setStaff(staffResponse.staff || []);
      setLocalSales(salesResponse.rows || []);
      setLocalFinances(financesResponse.rows || []);
      const existing = (reportResponse.rows || [])[0];
      if (existing) {
        setMonthlyForm({
          ...emptyLocalMonthlyForm(month),
          ...existing,
          items: existing.items?.length ? existing.items.map((item) => ({
            section: item.section,
            label: item.label,
            amount: item.amount,
            notes: item.notes || ''
          })) : emptyLocalMonthlyForm(month).items
        });
      } else {
        setMonthlyForm({ ...emptyLocalMonthlyForm(month), local_name: localName });
      }
      setPayrollForm((current) => ({
        ...emptyLocalPayrollForm(month),
        local_name: localName,
        staff_id: current.staff_id,
        staff_name: current.staff_name,
        items: current.staff_name
          ? localPayrollItemsFor(current.staff_name, salesResponse.rows || [], localName, configuration)
          : emptyLocalPayrollForm(month).items
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMonthly();
  }, []);

  function updateMonthlyField(key, value) {
    setMonthlyForm((current) => ({ ...current, [key]: value }));
  }

  function updateMonthlyItem(index, patch) {
    setMonthlyForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    }));
  }

  function updatePayrollItem(index, patch) {
    setPayrollForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    }));
  }

  async function saveMonthlyReport() {
    try {
      await api(scope('/producalza/local-monthly-reports'), {
        method: 'POST',
        body: JSON.stringify({ ...monthlyForm, report_month: month, local_name: monthlyForm.local_name || localName })
      });
      await loadMonthly();
    } catch (err) {
      setError(err.message);
    }
  }

  async function savePayroll() {
    try {
      await api(scope('/producalza/local-payroll'), {
        method: 'POST',
        body: JSON.stringify({ ...payrollForm, report_month: month, local_name: payrollForm.local_name || localName })
      });
      setPayrollForm(emptyLocalPayrollForm(month));
      await loadMonthly();
    } catch (err) {
      setError(err.message);
    }
  }

  async function printMonthlyLocalReport() {
    if (!localName) {
      setError('Selecciona un local para generar el reporte general por local.');
      return;
    }
    let reportResponse = reports || { payroll: [] };
    let salesRows = localSales;
    let financeRows = localFinances;
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('month', month);
      query.set('local_name', localName);
      const salesQuery = new URLSearchParams();
      salesQuery.set('date_from', `${month}-01`);
      salesQuery.set('date_to', monthEndDate(month));
      salesQuery.set('local_name', localName);
      const [freshReports, freshSales, freshFinances] = await Promise.all([
        api(scope(`/producalza/local-monthly-reports?${query.toString()}`)),
        api(scope(`/producalza/local-sales?${salesQuery.toString()}`)),
        api(scope(`/producalza/local-finances?${salesQuery.toString()}`))
      ]);
      reportResponse = freshReports;
      salesRows = freshSales.rows || [];
      financeRows = freshFinances.rows || [];
      setReports(freshReports);
      setLocalSales(salesRows);
      setLocalFinances(financeRows);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }
    const salesLines = localReportLineTotals(salesRows.filter((row) => row.local_name === localName));
    const financeGroups = localReportFinanceGroups(financeRows.filter((row) => row.local_name === localName));
    const localSetting = configuration?.locations?.find((item) => item.local_name === localName);
    const includedStaff = (localSetting?.staff || []).filter((item) => item.include_in_report);
    const freshPayrollRows = (reportResponse?.payroll || []).filter((row) => {
      if (row.local_name !== localName) return false;
      if (!localSetting) return true;
      const rowName = normalizeText(row.staff_name || '');
      return includedStaff.some((item) => {
        const staffName = normalizeText(item.name || '');
        return rowName.includes(staffName) || staffName.includes(rowName);
      });
    });
    const payrollLines = localReportPayrollRows(freshPayrollRows, localName, salesRows, configuration);
    const payrollTotal = payrollLines.reduce((sum, row) => sum + Number(row.net || 0), 0);
    const variousRows = localReportTableRows(financeGroups.various, [], 'various');
    const serviceFallback = [
      { label: `Arriendo ${reportMonthName(month)}`, amount: localSetting?.rent_amount || 0 },
      { label: 'Luz', amount: localSetting?.electricity_amount || 0 },
      { label: 'Agua', amount: localSetting?.water_amount || 0 },
      { label: 'Internet', amount: localSetting?.internet_amount || 0 },
      { label: 'Alicuota', amount: localSetting?.condominium_amount || 0 }
    ];
    const serviceRows = localReportTableRows(financeGroups.service, serviceFallback, 'service');
    const depositRows = localReportTableRows(financeGroups.deposit, [], 'deposit');
    const adminRows = localReportTableRows(financeGroups.admin, [], 'admin');
    const sumAmount = (rows) => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const variousTotal = sumAmount(variousRows);
    const servicesTotal = sumAmount(serviceRows);
    const depositsTotal = sumAmount(depositRows);
    const adminTotal = sumAmount(adminRows);
    const productionCostPerPair = Number(localSetting?.production_cost_per_pair || 35);
    const producalzaCost = Number(salesLines.total.pairs || 0) * productionCostPerPair;
    const localBalance = Number(salesLines.total.amount || 0) - variousTotal - payrollTotal - servicesTotal - depositsTotal;
    const utility = Number(salesLines.total.amount || 0) - producalzaCost - variousTotal - payrollTotal - servicesTotal - adminTotal;
    const missingData = [
      !salesRows.length && 'ventas diarias',
      !financeGroups.various.length && 'gastos varios',
      !financeGroups.deposit.length && 'depositos',
      !freshPayrollRows.length && 'rol de pago guardado'
    ].filter(Boolean);
    const moneyCell = (value) => `<td class="currency">$</td><td class="value">${escapeReportHtml(displayNumber(value, 2))}</td>`;
    const rowsHtml = (rows, emptyCount = 5) => {
      const source = rows.length ? rows : Array.from({ length: emptyCount }, () => ({ label: '', amount: '' }));
      return source.map((row) => `<tr><td>${escapeReportHtml(row.label)}</td>${moneyCell(row.amount || 0)}</tr>`).join('');
    };
    const salesRowsHtml = [
      ['PARES EFECTIVO', salesLines.cash],
      ['PARES TARJETA', salesLines.card],
      ['PARES SEPARADOS', salesLines.separated],
      ['VENTA MAYORISTAS', salesLines.wholesale],
      ['VENTA EMPRESARIA', salesLines.business]
    ].map(([label, line]) => `<tr><td>${label}</td><td class="center">${line.pairs || ''}</td>${moneyCell(line.amount)}</tr>`).join('');
    const payrollHtml = payrollLines.length
      ? payrollLines.map((row) => `
          <tr><td>Mensual ${escapeReportHtml(row.name)}</td>${moneyCell(row.salary)}</tr>
          <tr><td>Comision</td>${moneyCell(row.commission)}</tr>
          <tr><td>Adicionales</td>${moneyCell(row.additions)}</tr>
          <tr class="accent-red"><td>Total ganado</td>${moneyCell(row.salary + row.commission + row.additions)}</tr>
          ${(row.deductionLines?.length
            ? row.deductionLines
            : [
                ...(row.advance ? [{ label: 'Adelanto', amount: row.advance }] : []),
                ...(row.deductions ? [{ label: 'Descuentos varios', amount: row.deductions }] : [])
              ]).map((item) => `<tr><td>${escapeReportHtml(item.label)}</td>${moneyCell(item.amount)}</tr>`).join('')}
          <tr class="accent-blue"><td>Total a recibir</td>${moneyCell(row.net)}</tr>
        `).join('')
      : rowsHtml([], 7);
    const html = `<!doctype html>
      <html>
        <head>
          <title>Reporte general por local ${escapeReportHtml(localName)}</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #333; margin: 0; }
            .sheet { width: 190mm; margin: 0 auto; padding: 2mm; }
            h1 { margin: 0 0 10px; text-align: center; font-size: 22px; letter-spacing: .02em; }
            .subtitle { margin: -6px 0 8px; text-align: center; font-size: 12px; font-weight: 700; text-transform: uppercase; }
            .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
            .month { margin-top: 18px; font-size: 13px; text-transform: uppercase; }
            .month strong { color: #b54d5b; margin-left: 10px; }
            .grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 8mm; }
            .left-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #555; padding: 3px 5px; height: 20px; }
            th { text-align: left; font-weight: 800; text-transform: uppercase; }
            .title-row td, .title-row th { font-weight: 800; background: #f6f6f6; }
            .currency { width: 18px; text-align: center; }
            .value { width: 70px; text-align: right; }
            .center { text-align: center; }
            .total-row td { font-weight: 800; }
            .accent-red td, .accent-red .value { color: #b54d5b; font-weight: 800; }
            .accent-blue td, .accent-blue .value { color: #4e78b7; font-weight: 800; }
            .section { margin-bottom: 8mm; break-inside: avoid; }
            .summary { width: 78mm; margin-top: 7mm; }
            .utility { width: 82mm; margin-top: 10mm; }
            .signature { margin-top: 17mm; padding-top: 4mm; border-top: 1px solid #555; text-align: center; font-size: 12px; }
            .signatures { display: grid; grid-template-columns: 1fr; gap: 15mm; margin-top: 52mm; }
            .note { font-size: 11px; color: #b54d5b; margin-top: 3px; }
            .missing { margin: -4px 0 8px; padding: 5px 8px; border: 1px solid #b54d5b; color: #8b1f2f; font-size: 11px; }
            @media print { button { display: none; } .sheet { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1>${escapeReportHtml(localName.replace(/^Local\s+/, '').toUpperCase())} ${escapeReportHtml(month.slice(0, 4))}</h1>
            <div class="subtitle">Reporte general por local: ${escapeReportHtml(localName)}</div>
            ${missingData.length ? `<div class="missing">Datos pendientes por llenar: ${escapeReportHtml(missingData.join(', '))}. El reporte se genera igual con los datos disponibles.</div>` : ''}
            <div class="top">
              <table style="width:108mm">
                <tr class="title-row"><th>* Venta total</th><th class="center">Cantidad</th><th colspan="2">Valor</th></tr>
                ${salesRowsHtml}
                <tr class="total-row"><td>Total:</td><td class="center">${salesLines.total.pairs}</td>${moneyCell(salesLines.total.amount)}</tr>
              </table>
              <div class="month">Mes: <strong>${escapeReportHtml(reportMonthName(month))}</strong></div>
            </div>
            <div class="grid">
              <div>
                <div class="left-grid">
                  <div class="section">
                    <table>
                      <tr class="title-row"><th colspan="3">1.- Gastos varios</th></tr>
                      ${rowsHtml(variousRows)}
                      <tr class="total-row"><td>Total:</td>${moneyCell(variousTotal)}</tr>
                    </table>
                  </div>
                  <div class="section">
                    <table>
                      <tr class="title-row"><th colspan="3">3.- Servicios basicos</th></tr>
                      ${rowsHtml(serviceRows, 4)}
                      <tr class="total-row"><td>Total:</td>${moneyCell(servicesTotal)}</tr>
                    </table>
                  </div>
                </div>
                <table class="summary">
                  <tr><td>*Venta total</td>${moneyCell(salesLines.total.amount)}</tr>
                  <tr><td>1.- Gastos varios</td>${moneyCell(variousTotal)}</tr>
                  <tr><td>2.- Sueldo empleadas</td>${moneyCell(payrollTotal)}</tr>
                  <tr><td>3.- Servicios basicos</td>${moneyCell(servicesTotal)}</tr>
                  <tr><td>4.- Depositos</td>${moneyCell(depositsTotal)}</tr>
                  <tr class="total-row"><td>Total</td>${moneyCell(localBalance)}</tr>
                </table>
                <table class="utility">
                  <tr><td>Venta total</td>${moneyCell(salesLines.total.amount)}</tr>
                  <tr><td>Producalza ${salesLines.total.pairs} x ${displayNumber(productionCostPerPair, 2)}</td>${moneyCell(producalzaCost)}</tr>
                  <tr><td>Gastos varios</td>${moneyCell(variousTotal)}</tr>
                  <tr><td>Sueldos empleadas</td>${moneyCell(payrollTotal)}</tr>
                  <tr><td>Servicios basicos</td>${moneyCell(servicesTotal)}</tr>
                  <tr><td>Publicidad</td>${moneyCell(adminTotal)}</tr>
                  <tr class="total-row"><td>Utilidad</td>${moneyCell(utility)}</tr>
                </table>
              </div>
              <div>
                <div class="section">
                  <table>
                    <tr class="title-row"><th colspan="3">2.- Sueldo empleada</th></tr>
                    ${payrollHtml}
                  </table>
                </div>
                <div class="section">
                  <table>
                    <tr class="title-row"><th colspan="3">4.- Depositos</th></tr>
                    ${rowsHtml(depositRows)}
                    <tr class="total-row"><td>Total</td>${moneyCell(depositsTotal)}</tr>
                  </table>
                </div>
                <div class="signatures">
                  <div class="signature">GERMAN LLERENA</div>
                  <div class="signature">MARLON LLERENA</div>
                  <div class="signature">MORELIA SILVA</div>
                </div>
              </div>
            </div>
          </div>
          <script>window.onload = () => { window.focus(); window.print(); };</script>
        </body>
      </html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError('El navegador bloqueo la ventana de impresion. Permite ventanas emergentes para imprimir el reporte.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  async function printWeeklyAllLocalsReport() {
    setLoading(true);
    let salesRows = [];
    try {
      const salesQuery = new URLSearchParams();
      salesQuery.set('date_from', `${month}-01`);
      salesQuery.set('date_to', monthEndDate(month));
      const freshSales = await api(scope(`/producalza/local-sales?${salesQuery.toString()}`));
      salesRows = freshSales.rows || [];
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }
    const monthStart = new Date(`${month}-01T12:00:00`);
    const monthEnd = new Date(`${monthEndDate(month)}T12:00:00`);
    const weeks = [];
    let currentStart = new Date(monthStart);
    while (currentStart <= monthEnd) {
      const currentEnd = new Date(currentStart);
      const day = currentEnd.getDay() || 7;
      currentEnd.setDate(currentEnd.getDate() + (7 - day));
      if (currentEnd > monthEnd) currentEnd.setTime(monthEnd.getTime());
      weeks.push({
        label: `${displayDate(currentStart.toISOString().slice(0, 10))} - ${displayDate(currentEnd.toISOString().slice(0, 10))}`,
        start: currentStart.toISOString().slice(0, 10),
        end: currentEnd.toISOString().slice(0, 10)
      });
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }
    const datesBetween = (start, end) => {
      const dates = [];
      const current = new Date(`${start}T12:00:00`);
      const finalDate = new Date(`${end}T12:00:00`);
      while (current <= finalDate) {
        dates.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };
    const dayTotals = (date) => {
      const byLocal = {};
      let totalPairs = 0;
      let totalAmount = 0;
      for (const local of RETURN_DESTINATIONS) {
        const localRows = salesRows.filter((row) =>
          row.local_name === local &&
          row.sale_date === date
        );
        const pairs = localRows.reduce((sum, row) => sum + Number(row.quantity || 1), 0);
        const amount = localRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        byLocal[local] = { pairs, amount };
        totalPairs += pairs;
        totalAmount += amount;
      }
      return { byLocal, totalPairs, totalAmount };
    };
    const weekTotals = (dailyRows) => {
      const byLocal = {};
      let totalPairs = 0;
      let totalAmount = 0;
      for (const local of RETURN_DESTINATIONS) {
        const pairs = dailyRows.reduce((sum, row) => sum + Number(row.byLocal[local].pairs || 0), 0);
        const amount = dailyRows.reduce((sum, row) => sum + Number(row.byLocal[local].amount || 0), 0);
        byLocal[local] = { pairs, amount };
        totalPairs += pairs;
        totalAmount += amount;
      }
      return { byLocal, totalPairs, totalAmount };
    };
    const weekBlocks = weeks.map((week, index) => {
      const days = datesBetween(week.start, week.end).map((date) => ({
        date,
        label: displayDate(date),
        ...dayTotals(date)
      }));
      return { ...week, index: index + 1, days, totals: weekTotals(days) };
    });
    const money = (value) => escapeReportHtml(displayNumber(value, 2));
    const localShortName = (local) => local
      .replace('Local Marjorie Botas ', '')
      .replace('Sebastians', 'Sebastians');
    const headerHtml = RETURN_DESTINATIONS
      .map((local) => `<th colspan="2">${escapeReportHtml(localShortName(local))}</th>`)
      .join('');
    const subHeaderHtml = RETURN_DESTINATIONS.map(() => '<th>Pares</th><th>$</th>').join('');
    const rowsHtml = weekBlocks.map((week) => `
      <tr class="week-row"><td colspan="11">Semana ${week.index}: ${escapeReportHtml(week.label)}</td></tr>
      ${week.days.map((day) => `
        <tr>
          <td>${escapeReportHtml(day.label)}</td>
          ${RETURN_DESTINATIONS.map((local) => `
            <td class="center">${day.byLocal[local].pairs || ''}</td>
            <td class="money">${day.byLocal[local].amount ? money(day.byLocal[local].amount) : ''}</td>
          `).join('')}
          <td class="center strong">${day.totalPairs || ''}</td>
          <td class="money strong">${day.totalAmount ? money(day.totalAmount) : ''}</td>
        </tr>
      `).join('')}
      <tr class="week-total">
        <td>Total semana ${week.index}</td>
        ${RETURN_DESTINATIONS.map((local) => `
          <td class="center">${week.totals.byLocal[local].pairs || ''}</td>
          <td class="money">${week.totals.byLocal[local].amount ? money(week.totals.byLocal[local].amount) : ''}</td>
        `).join('')}
        <td class="center strong">${week.totals.totalPairs}</td>
        <td class="money strong">${money(week.totals.totalAmount)}</td>
      </tr>
    `).join('');
    const totalsByLocal = RETURN_DESTINATIONS.reduce((acc, local) => {
      acc[local] = {
        pairs: weekBlocks.reduce((sum, week) => sum + Number(week.totals.byLocal[local].pairs || 0), 0),
        amount: weekBlocks.reduce((sum, week) => sum + Number(week.totals.byLocal[local].amount || 0), 0)
      };
      return acc;
    }, {});
    const grandPairs = weekBlocks.reduce((sum, week) => sum + week.totals.totalPairs, 0);
    const grandAmount = weekBlocks.reduce((sum, week) => sum + week.totals.totalAmount, 0);
    const totalRowHtml = `
      <tr class="total">
        <td>Total mes</td>
        ${RETURN_DESTINATIONS.map((local) => `
          <td class="center">${totalsByLocal[local].pairs}</td>
          <td class="money">${money(totalsByLocal[local].amount)}</td>
        `).join('')}
        <td class="center">${grandPairs}</td>
        <td class="money">${money(grandAmount)}</td>
      </tr>
    `;
    const html = `<!doctype html>
      <html>
        <head>
          <title>Reporte semanal todos los locales</title>
          <style>
            @page { size: A4 landscape; margin: 7mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; }
            .sheet { width: 283mm; margin: 0 auto; }
            h1 { margin: 0 0 2mm; text-align: center; font-size: 15px; text-transform: uppercase; }
            .subtitle { margin-bottom: 3mm; text-align: center; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.5px; }
            th, td { border: 1px solid #444; padding: 1px 2px; height: 10px; line-height: 1.05; }
            th { background: #f1f1f1; text-transform: uppercase; }
            .center { text-align: center; }
            .money { text-align: right; }
            .strong, .total td, .week-total td { font-weight: 800; }
            .week { width: 24mm; }
            .week-row td { background: #e9edf5; color: #1f2937; font-weight: 800; text-transform: uppercase; }
            .week-total td { background: #f7f0df; }
            @media print { .sheet { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1>Reporte de todos los locales por semanas</h1>
            <div class="subtitle">Mes: ${escapeReportHtml(reportMonthName(month))} ${escapeReportHtml(month.slice(0, 4))}</div>
            <table>
              <thead>
                <tr>
                  <th class="week" rowspan="2">Dia</th>
                  ${headerHtml}
                  <th colspan="2">Total semana</th>
                </tr>
                <tr>
                  ${subHeaderHtml}
                  <th>Pares</th><th>$</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                ${totalRowHtml}
              </tbody>
            </table>
          </div>
          <script>window.onload = () => { window.focus(); window.print(); };</script>
        </body>
      </html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError('El navegador bloqueo la ventana de impresion. Permite ventanas emergentes para imprimir el reporte.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  const selectedLocalSetting = configuration?.locations?.find((item) => item.local_name === localName);
  const selectedIncludedStaff = (selectedLocalSetting?.staff || []).filter((item) => item.include_in_report);
  const payrollRows = (reports?.payroll || []).filter((row) => {
    if (row.local_name !== localName) return false;
    if (!selectedLocalSetting) return true;
    const rowName = normalizeText(row.staff_name || '');
    return selectedIncludedStaff.some((item) => {
      const staffName = normalizeText(item.name || '');
      return rowName.includes(staffName) || staffName.includes(rowName);
    });
  });
  const reportStaffIds = new Set((selectedLocalSetting?.staff || [])
    .filter((item) => item.include_in_report)
    .map((item) => Number(item.id)));
  const payrollStaffOptions = selectedLocalSetting
    ? staff.filter((item) => reportStaffIds.has(Number(item.id)))
    : staff;
  const itemTotals = (monthlyForm.items || []).reduce((acc, item) => {
    acc[item.section] = (acc[item.section] || 0) + Number(item.amount || 0);
    return acc;
  }, {});
  const salesValue = ['cash_value', 'card_value', 'separated_value', 'wholesale_value', 'business_value']
    .reduce((sum, key) => sum + Number(monthlyForm[key] || 0), 0);
  const salesPairs = ['cash_pairs', 'card_pairs', 'separated_pairs', 'wholesale_pairs', 'business_pairs']
    .reduce((sum, key) => sum + Number(monthlyForm[key] || 0), 0);
  const payrollTotal = payrollRows.reduce((sum, item) => sum + Number(item.net_pay || 0), 0);
  const projectedBalance = Number(monthlyForm.previous_balance || 0) + salesValue - Number(itemTotals.expense || 0) - Number(itemTotals.service || 0) - Number(itemTotals.deposit || 0) - payrollTotal;

  return (
    <section className="prod-panel prod-local-monthly">
      <div className="prod-panel-title">
        <div><span>Formato mensual</span><h2>Reporte general por local</h2></div>
        <div className="prod-row-actions">
          <button className="prod-primary-button" onClick={printMonthlyLocalReport}><Printer size={17} />Generar reporte</button>
          <button className="prod-secondary-button" onClick={printWeeklyAllLocalsReport}><Printer size={17} />Reportes de todos los locales por semanas</button>
          <button className="prod-primary-button" disabled={loading} onClick={loadMonthly}><Filter size={17} />Cargar</button>
        </div>
      </div>
      <div className="prod-monthly-controls">
        <label>Mes<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setMonthlyForm(emptyLocalMonthlyForm(event.target.value)); setPayrollForm(emptyLocalPayrollForm(event.target.value)); }} /></label>
        <label>Local
          <select value={localName} onChange={(event) => { setLocalName(event.target.value); updateMonthlyField('local_name', event.target.value); setPayrollForm((current) => ({ ...current, local_name: event.target.value })); }}>
            <option value="">Todos los locales</option>
            {RETURN_DESTINATIONS.map((destination) => <option value={destination} key={destination}>{destination}</option>)}
          </select>
        </label>
      </div>
      <div className="prod-local-monthly-grid">
        <div>
          <h3>Rol de pago</h3>
          <div className="prod-form-grid">
            <label>Empleada
              <select
                value={payrollForm.staff_id}
                onChange={(event) => {
                  const selected = staff.find((item) => String(item.id) === event.target.value);
                  const staffName = selected?.name || '';
                  setPayrollForm({
                    ...payrollForm,
                    staff_id: event.target.value,
                    staff_name: staffName,
                    items: staffName ? localPayrollItemsFor(staffName, localSales, localName, configuration) : payrollForm.items
                  });
                }}
              >
                <option value="">Escribir manual</option>
                {payrollStaffOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Nombre<input value={payrollForm.staff_name} onChange={(event) => setPayrollForm({ ...payrollForm, staff_name: event.target.value, items: localPayrollItemsFor(event.target.value, localSales, localName, configuration) })} /></label>
            <label>Desde<input type="date" value={payrollForm.date_from || ''} onChange={(event) => setPayrollForm({ ...payrollForm, date_from: event.target.value })} /></label>
            <label>Hasta<input type="date" value={payrollForm.date_to || ''} onChange={(event) => setPayrollForm({ ...payrollForm, date_to: event.target.value })} /></label>
          </div>
          <div className="prod-local-items">
            {(payrollForm.items || []).map((item, index) => (
              <div key={index} className="prod-local-item-row">
                <select value={item.item_type} onChange={(event) => updatePayrollItem(index, { item_type: event.target.value })}>
                  <option value="income">Ingreso</option>
                  <option value="deduction">Egreso</option>
                </select>
                <input placeholder="Detalle" value={item.label} onChange={(event) => updatePayrollItem(index, { label: event.target.value })} />
                <input type="number" min="0" step="0.01" placeholder="Valor" value={item.amount} onChange={(event) => updatePayrollItem(index, { amount: event.target.value })} />
                <button className="prod-icon-button danger" onClick={() => setPayrollForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="prod-form-actions">
            <button className="prod-secondary-button" onClick={() => setPayrollForm((current) => ({ ...current, items: [...current.items, { item_type: 'income', label: '', amount: '', notes: '' }] }))}><Plus size={16} />Agregar fila</button>
            <button className="prod-primary-button" onClick={savePayroll}><Save size={17} />Guardar rol</button>
          </div>
        </div>

        <div>
          <h3>Roles guardados</h3>
          <div className="prod-table-wrap compact-table">
            <table className="prod-table">
              <thead><tr><th>Empleada</th><th>Ingresos</th><th>Egresos</th><th>A recibir</th></tr></thead>
              <tbody>
                {payrollRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.staff_name}</strong><small>{displayDate(row.date_from)} - {displayDate(row.date_to)}</small></td>
                    <td>{displayMoney(row.total_income)}</td>
                    <td>{displayMoney(row.total_deductions)}</td>
                    <td><strong>{displayMoney(row.net_pay)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payrollRows.length && <div className="prod-empty">Aun no hay roles guardados para este mes/local.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function LocalAttendanceAdmin({ scope, setError }) {
  const today = new Date().toISOString().slice(0, 10);
  const attendanceUrl = `${window.location.origin}/asistencia-locales`;
  const [filters, setFilters] = useState({
    date_from: today,
    date_to: today,
    location: '',
    staff_id: ''
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function loadAttendance() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('date_from', filters.date_from);
      query.set('date_to', filters.date_to);
      if (filters.location) query.set('location', filters.location);
      if (filters.staff_id) query.set('staff_id', filters.staff_id);
      setData(await api(scope(`/producalza/local-attendance?${query.toString()}`)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAttendance();
  }, []);

  async function copyLink() {
    await navigator.clipboard?.writeText(attendanceUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="prod-stack">
      <section className="prod-panel">
        <div className="prod-panel-title">
          <div><span>Asistencia</span><h2>Ingreso y salida de empleadas</h2></div>
          <button className="prod-primary-button" disabled={loading} onClick={loadAttendance}><Filter size={17} />Filtrar</button>
        </div>
        <div className="prod-attendance-link">
          <div>
            <strong>Pagina para las empleadas</strong>
            <span>{attendanceUrl}</span>
          </div>
          <div className="prod-row-actions">
            <button className="prod-secondary-button" onClick={copyLink}><Copy size={16} />{copied ? 'Copiado' : 'Copiar link'}</button>
            <button className="prod-primary-button" onClick={() => window.open(attendanceUrl, '_blank', 'noopener,noreferrer')}>Abrir</button>
          </div>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} /></label>
          <label>Local
            <select value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })}>
              <option value="">Todos</option>
              {(data?.locations || RETURN_DESTINATIONS).map((location) => <option value={location} key={location}>{location}</option>)}
            </select>
          </label>
          <label>Empleada
            <select value={filters.staff_id} onChange={(event) => setFilters({ ...filters, staff_id: event.target.value })}>
              <option value="">Todas</option>
              {(data?.staff || []).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Usuarios</span><h2>Empleadas registradas</h2></div></div>
        <div className="prod-staff-grid">
          {(data?.staff || []).map((item) => (
            <article key={item.id}>
              <strong>{item.name}</strong>
              <span>Usuario: {item.username}</span>
              <small>{(item.locations || []).join(', ')}</small>
              <b>{item.status === 'active' ? 'Activa' : 'Inactiva'}</b>
            </article>
          ))}
          {!data?.staff?.length && <div className="prod-empty">Cargando empleadas...</div>}
        </div>
      </section>

      <section className="prod-panel">
        <div className="prod-panel-title"><div><span>Registros</span><h2>Asistencia guardada</h2></div></div>
        <div className="prod-return-destination-summary">
          {(data?.by_staff || []).map((item) => (
            <article key={item.staff_name}>
              <span>{item.staff_name}</span>
              <strong>{item.in_count} ingresos</strong>
              <small>{item.out_count} salidas</small>
            </article>
          ))}
        </div>
        <div className="prod-table-wrap">
          <table className="prod-table">
            <thead><tr><th>Fecha</th><th>Hora</th><th>Empleada</th><th>Local</th><th>Accion</th><th>Mensaje</th></tr></thead>
            <tbody>
              {(data?.rows || []).map((item) => (
                <tr key={item.id}>
                  <td>{displayDate(item.local_date)}</td>
                  <td>{item.local_time}</td>
                  <td><strong>{item.staff_name}</strong><small>@{item.username || ''}</small></td>
                  <td>{item.location}</td>
                  <td>{item.action === 'in' ? 'Ingreso' : 'Salida'}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.rows?.length && <div className="prod-empty">No hay registros con esos filtros.</div>}
        </div>
      </section>
    </div>
  );
}

function ProductionReports({ dashboard, orders, clientActivity, scope, setError }) {
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
  const today = new Date().toISOString().slice(0, 10);
  const [monthlyFilters, setMonthlyFilters] = useState({
    date_from: `${today.slice(0, 8)}01`,
    date_to: today,
    days: '22'
  });
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [excludedClients, setExcludedClients] = useState([]);
  const [monthlyPairEdits, setMonthlyPairEdits] = useState({});
  const [excludedDispatchClients, setExcludedDispatchClients] = useState([]);
  const [excludedActivityClients, setExcludedActivityClients] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [dispatchFilters, setDispatchFilters] = useState({
    date_from: `${today.slice(0, 8)}01`,
    date_to: today,
    status: 'all'
  });
  const [dispatchReport, setDispatchReport] = useState(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [reportPrintMode, setReportPrintMode] = useState('');
  const [returnsFilters, setReturnsFilters] = useState({
    date_from: `${today.slice(0, 8)}01`,
    date_to: today
  });
  const [returnsReport, setReturnsReport] = useState(null);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const byStatus = Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => ({
    key,
    label,
    count: orders.filter((order) => order.status === key).length,
    pairs: orders.filter((order) => order.status === key).reduce((sum, order) => sum + Number(order.total_pairs || 0), 0)
  }));
  const totalPairs = orders.reduce((sum, order) => sum + Number(order.total_pairs || 0), 0);
  const cities = [...new Set((clientActivity || []).map((client) => client.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const baseFilteredClients = (clientActivity || []).filter((client) => {
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
  const activityReportClients = [...new Set(baseFilteredClients.map((client) => client.name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const filteredClients = baseFilteredClients.filter((client) => !excludedActivityClients.includes(client.name));
  const monthlyRows = monthlyReport?.rows || [];
  const monthlyEnteredRows = monthlyReport?.entered_rows || monthlyRows.filter((row) => Number(row.entered_pairs || 0) > 0);
  const monthlyDispatchedRows = monthlyReport?.dispatched_rows || monthlyRows.filter((row) => Number(row.dispatched_pairs || 0) > 0);
  const monthlyBackendPrintRows = monthlyReport?.print_rows || [];
  const monthlyClients = [...new Set(monthlyRows.map((row) => row.client_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const visibleMonthlyEnteredRows = monthlyEnteredRows.filter((row) => !excludedClients.includes(row.client_name));
  const visibleMonthlyDispatchedRows = monthlyDispatchedRows.filter((row) => !excludedClients.includes(row.client_name));
  const visibleBackendPrintRows = monthlyBackendPrintRows.filter((row) => !excludedClients.includes(row.client_name));
  const monthlyPrintRows = monthlyBackendPrintRows.length
    ? Array.from({ length: Math.max(visibleBackendPrintRows.length, 28) }, (_, index) => ({ row: visibleBackendPrintRows[index] }))
    : Array.from({ length: Math.max(visibleMonthlyEnteredRows.length, visibleMonthlyDispatchedRows.length, 28) }, (_, index) => ({
      entered: visibleMonthlyEnteredRows[index],
      dispatched: visibleMonthlyDispatchedRows[index]
    }));
  const monthlyEntryKey = (pair, index) => (pair.row || pair.entered)?.source_key || `monthly-entry-${index}`;
  const monthlyEntryPairsValue = (pair, index) => {
    const key = monthlyEntryKey(pair, index);
    if (Object.prototype.hasOwnProperty.call(monthlyPairEdits, key)) {
      return monthlyPairEdits[key];
    }
    return (pair.row || pair.entered)?.entered_pairs ?? '';
  };
  const dispatchRows = dispatchReport?.rows || [];
  const dispatchClients = [...new Set(dispatchRows.map((row) => row.client_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const visibleDispatchRows = dispatchRows.filter((row) => !excludedDispatchClients.includes(row.client_name));
  const dispatchTotals = {
    total: visibleDispatchRows.reduce((sum, row) => sum + Number(row.total || 0), 0),
    paid: visibleDispatchRows.reduce((sum, row) => sum + Number(row.paid_total || 0), 0),
    balance: visibleDispatchRows.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    cheques: visibleDispatchRows.reduce((sum, row) => sum + Number(row.cheque_total || 0), 0),
    abonos: visibleDispatchRows.reduce((sum, row) => sum + Number(row.abono_total || 0), 0),
    efectivo: visibleDispatchRows.reduce((sum, row) => sum + Number(row.efectivo_total || 0), 0),
    collected: visibleDispatchRows.reduce((sum, row) => sum + Number(row.collected_total || 0), 0)
  };
  const monthlyDays = Math.max(1, Number(monthlyFilters.days || 1) || 1);
  const monthlyEntered = monthlyPrintRows.reduce((sum, pair, index) => sum + Number(monthlyEntryPairsValue(pair, index) || 0), 0);
  const monthlyDispatched = visibleMonthlyDispatchedRows.reduce((sum, row) => sum + Number(row.dispatched_pairs || 0), 0);
  const updateReportFilter = (key, value) => setReportFilters((current) => ({ ...current, [key]: value }));
  const updateMonthlyFilter = (key, value) => setMonthlyFilters((current) => ({ ...current, [key]: value }));
  const updateDispatchFilter = (key, value) => setDispatchFilters((current) => ({ ...current, [key]: value }));
  const updateReturnsFilter = (key, value) => setReturnsFilters((current) => ({ ...current, [key]: value }));

  async function loadMonthlyReport() {
    setMonthlyLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('date_from', monthlyFilters.date_from);
      query.set('date_to', monthlyFilters.date_to);
      query.set('days', String(monthlyDays));
      const report = await api(scope(`/producalza/monthly-report?${query.toString()}`));
      setMonthlyReport(report);
      setExcludedClients([]);
      setMonthlyPairEdits({});
    } catch (err) {
      setError(err.message);
    } finally {
      setMonthlyLoading(false);
    }
  }

  function toggleClient(clientName) {
    setExcludedClients((current) =>
      current.includes(clientName)
        ? current.filter((item) => item !== clientName)
        : [...current, clientName]
    );
  }

  async function loadDispatchReport() {
    setDispatchLoading(true);
    try {
      const query = new URLSearchParams();
      if (dispatchFilters.date_from) query.set('date_from', dispatchFilters.date_from);
      if (dispatchFilters.date_to) query.set('date_to', dispatchFilters.date_to);
      query.set('status', dispatchFilters.status);
      setDispatchReport(await api(scope(`/producalza/dispatch-collections-report?${query.toString()}`)));
      setExcludedDispatchClients([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setDispatchLoading(false);
    }
  }

  async function loadReturnsReport() {
    setReturnsLoading(true);
    try {
      const query = new URLSearchParams();
      if (returnsFilters.date_from) query.set('date_from', returnsFilters.date_from);
      if (returnsFilters.date_to) query.set('date_to', returnsFilters.date_to);
      setReturnsReport(await api(scope(`/producalza/returns-report?${query.toString()}`)));
    } catch (err) {
      setError(err.message);
    } finally {
      setReturnsLoading(false);
    }
  }

  function toggleDispatchClient(clientName) {
    setExcludedDispatchClients((current) =>
      current.includes(clientName)
        ? current.filter((item) => item !== clientName)
        : [...current, clientName]
    );
  }

  function toggleActivityClient(clientName) {
    setExcludedActivityClients((current) =>
      current.includes(clientName)
        ? current.filter((item) => item !== clientName)
        : [...current, clientName]
    );
  }

  function printReport(mode) {
    setReportPrintMode(mode);
    window.setTimeout(() => window.print(), 120);
    window.setTimeout(() => setReportPrintMode(''), 700);
  }

  return (
    <div className="prod-stack">
      <section className="prod-metrics">
        <article><ClipboardList size={21} /><span>Total de pedidos</span><strong>{orders.length}</strong></article>
        <article><Boxes size={21} /><span>Total de pares</span><strong>{totalPairs}</strong></article>
        <article><Factory size={21} /><span>Pares pendientes</span><strong>{dashboard?.pending_pairs || 0}</strong></article>
        <article><PackageCheck size={21} /><span>Pedidos terminados</span><strong>{dashboard?.finished || 0}</strong></article>
      </section>
      <section className="prod-panel prod-monthly-report">
        <div className="prod-panel-title">
          <div><span>Produccion mensual</span><h2>Informe mensual de pedidos</h2></div>
          <button className="prod-primary-button" disabled={monthlyLoading} onClick={loadMonthlyReport}>
            <Filter size={17} />
            {monthlyLoading ? 'Generando...' : 'Generar reporte'}
          </button>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={monthlyFilters.date_from} onChange={(event) => updateMonthlyFilter('date_from', event.target.value)} /></label>
          <label>Hasta<input type="date" value={monthlyFilters.date_to} onChange={(event) => updateMonthlyFilter('date_to', event.target.value)} /></label>
          <label>Dias de trabajo<input type="number" min="1" value={monthlyFilters.days} onChange={(event) => updateMonthlyFilter('days', event.target.value)} /></label>
          {monthlyReport && (
            <button className="prod-secondary-button" onClick={() => printReport('monthly')}>
              <Printer size={17} />
              Imprimir reporte
            </button>
          )}
        </div>
        {monthlyReport && (
          <>
            <div className="prod-monthly-summary">
              <article><span>Ingresados</span><strong>{displayNumber(monthlyEntered)}</strong><small>{displayNumber(monthlyEntered / monthlyDays, 1)} pares/dia</small></article>
              <article><span>Despachados</span><strong>{displayNumber(monthlyDispatched)}</strong><small>{displayNumber(monthlyDispatched / monthlyDays, 1)} pares/dia</small></article>
              <article><span>Clientes incluidos</span><strong>{monthlyClients.length - excludedClients.length}</strong><small>{excludedClients.length} excluidos</small></article>
              <article><span>Base del informe</span><strong>Sistema</strong><small>Desde el primer pedido registrado</small></article>
            </div>
            <div className="prod-monthly-client-picker">
              <div><span>Clientes del reporte</span><strong>Desmarca los que no quieres incluir</strong></div>
              <div>
                {monthlyClients.map((client) => (
                  <label key={client} className={excludedClients.includes(client) ? 'excluded' : ''}>
                    <input
                      type="checkbox"
                      checked={!excludedClients.includes(client)}
                      onChange={() => toggleClient(client)}
                    />
                    {client}
                  </label>
                ))}
              </div>
            </div>
            <div className={`prod-table-wrap prod-monthly-print ${reportPrintMode === 'monthly' ? 'print-active' : ''}`}>
              <div className="prod-monthly-print-title">
                <h2>INFORME MENSUAL DE PEDIDOS</h2>
                <span>MES : {displayMonthYear(monthlyReport.date_to || monthlyReport.date_from)}</span>
              </div>
              <table className="prod-table prod-monthly-table">
                <colgroup>
                  <col className="prod-monthly-col-date" />
                  <col className="prod-monthly-col-client" />
                  <col className="prod-monthly-col-pairs" />
                  <col className="prod-monthly-col-notes" />
                  <col className="prod-monthly-col-dispatched-pairs" />
                  <col className="prod-monthly-col-dispatched-date" />
                </colgroup>
                <thead>
                  <tr className="prod-monthly-group-row"><th colSpan="4">INGRESO</th><th colSpan="2">DESPACHADO</th></tr>
                  <tr><th>Fecha</th><th>Cliente</th><th>Pares</th><th>Observaciones</th><th>Pares</th><th>Fecha</th></tr>
                </thead>
                <tbody>
                  {monthlyPrintRows.map((pair, index) => (
                    <tr key={`${pair.row?.source_key || pair.entered?.source_key || 'blank-e'}-${pair.dispatched?.source_key || 'blank-d'}-${index}`}>
                      <td>{(pair.row || pair.entered)?.entry_date ? displayShortDate((pair.row || pair.entered).entry_date) : ''}</td>
                      <td><strong>{(pair.row || pair.entered)?.client_name || ''}</strong></td>
                      <td>
                        {((pair.row || pair.entered)?.entered_pairs ?? '') !== '' ? (
                          <input
                            className="prod-monthly-pairs-input"
                            type="number"
                            min="0"
                            value={monthlyEntryPairsValue(pair, index)}
                            onChange={(event) => {
                              const key = monthlyEntryKey(pair, index);
                              setMonthlyPairEdits((current) => ({ ...current, [key]: event.target.value }));
                            }}
                          />
                        ) : ''}
                      </td>
                      <td></td>
                      <td>{(pair.row || pair.dispatched)?.dispatched_pairs || ''}</td>
                      <td>{(pair.row || pair.dispatched)?.dispatched_date ? displayShortDate((pair.row || pair.dispatched).dispatched_date) : ''}</td>
                    </tr>
                  ))}
                  <tr className="prod-monthly-total-row">
                    <td colSpan="2"><strong></strong></td>
                    <td><strong>{displayNumber(monthlyEntered)}</strong></td>
                    <td></td>
                    <td><strong>{displayNumber(monthlyDispatched)}</strong></td>
                    <td></td>
                  </tr>
                  <tr className="prod-monthly-days-row">
                    <td colSpan="3"></td>
                    <td>÷ {monthlyDays} dias laborables<br />{displayNumber(monthlyEntered / monthlyDays, 0)} p.</td>
                    <td colSpan="2">÷ {monthlyDays} dias laborables<br />{displayNumber(monthlyDispatched / monthlyDays, 0)} p.</td>
                  </tr>
                </tbody>
              </table>
              {!visibleMonthlyEnteredRows.length && !visibleMonthlyDispatchedRows.length && <div className="prod-empty">No hay filas para este rango o todos los clientes estan excluidos.</div>}
            </div>
          </>
        )}
      </section>
      <section className="prod-panel prod-dispatch-report">
        <div className="prod-panel-title">
          <div><span>Despachos y cobros</span><h2>Reporte de valores por cobrar</h2></div>
          <button className="prod-primary-button" disabled={dispatchLoading} onClick={loadDispatchReport}>
            <Filter size={17} />
            {dispatchLoading ? 'Generando...' : 'Generar reporte'}
          </button>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={dispatchFilters.date_from} onChange={(event) => updateDispatchFilter('date_from', event.target.value)} /></label>
          <label>Hasta<input type="date" value={dispatchFilters.date_to} onChange={(event) => updateDispatchFilter('date_to', event.target.value)} /></label>
          <label>Estado
            <select value={dispatchFilters.status} onChange={(event) => updateDispatchFilter('status', event.target.value)}>
              <option value="all">Todos</option>
              <option value="pending">Pendientes</option>
              <option value="paid">Pagados</option>
            </select>
          </label>
          {dispatchReport && (
            <button className="prod-secondary-button" onClick={() => printReport('dispatch')}>
              <Printer size={17} />
              Imprimir cobros
            </button>
          )}
        </div>
        {dispatchReport && (
          <>
            <div className="prod-monthly-summary">
              <article><span>Total despachado</span><strong>{displayMoney(dispatchTotals.total)}</strong><small>{visibleDispatchRows.length} pedidos</small></article>
              <article><span>Cheques</span><strong>{displayMoney(dispatchTotals.cheques)}</strong><small>Cobros registrados</small></article>
              <article><span>Abonos</span><strong>{displayMoney(dispatchTotals.abonos)}</strong><small>Abonos y transferencias</small></article>
              <article><span>Efectivo</span><strong>{displayMoney(dispatchTotals.efectivo)}</strong><small>Cobros en efectivo</small></article>
              <article><span>Total cobros</span><strong>{displayMoney(dispatchTotals.collected)}</strong><small>Cheques + abonos + efectivo</small></article>
              <article><span>Saldo</span><strong>{displayMoney(dispatchTotals.balance)}</strong><small>Pendiente de cobro</small></article>
            </div>
            <div className="prod-monthly-client-picker">
              <div><span>Clientes del reporte</span><strong>Desmarca los que no quieres incluir</strong></div>
              <div>
                {dispatchClients.map((client) => (
                  <label key={client} className={excludedDispatchClients.includes(client) ? 'excluded' : ''}>
                    <input
                      type="checkbox"
                      checked={!excludedDispatchClients.includes(client)}
                      onChange={() => toggleDispatchClient(client)}
                    />
                    {client}
                  </label>
                ))}
              </div>
            </div>
            <div className={`prod-table-wrap prod-dispatch-print ${reportPrintMode === 'dispatch' ? 'print-active' : ''}`}>
              <div className="prod-monthly-print-title">
                <h2>REPORTE DE DESPACHOS Y COBROS</h2>
                <span>{displayDate(dispatchReport.date_from)} - {displayDate(dispatchReport.date_to)}</span>
              </div>
              <table className="prod-table prod-dispatch-table">
                <colgroup>
                  <col className="prod-dispatch-col-date" />
                  <col className="prod-dispatch-col-client" />
                  <col className="prod-dispatch-col-payment" />
                  <col className="prod-dispatch-col-money" />
                  <col className="prod-dispatch-col-payments" />
                  <col className="prod-dispatch-col-money" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Fecha despacho</th><th>Cliente</th><th>Forma de pago</th><th>Valor inicial</th><th>Abonos</th><th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDispatchRows.map((row) => (
                    <tr key={row.id}>
                      <td>{displayDate(row.dispatched_date)}</td>
                      <td><strong>{row.client_name}</strong><small>{row.order_number} · {row.city || 'Sin ciudad'}</small></td>
                      <td>{row.payment_method || '-'}</td>
                      <td>{displayMoney(row.total)}</td>
                      <td>
                        <strong>{displayMoney(row.collected_total ?? row.paid_total)}</strong>
                        {(row.payment_rows || []).length ? (row.payment_rows || []).map((payment, index) => (
                          <small key={index}>{PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type}: {displayMoney(payment.amount)}{(payment.payment_date || payment.due_date) ? ` | ${displayDate(payment.payment_date || payment.due_date)}` : ''}{paymentDetailText(payment) !== 'Sin detalle adicional' ? ` | ${paymentDetailText(payment)}` : ''}</small>
                        )) : <small>Sin abonos registrados</small>}
                      </td>
                      <td>{displayMoney(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleDispatchRows.length && <div className="prod-empty">No hay despachos con esos filtros o todos los clientes estan excluidos.</div>}
            </div>
          </>
        )}
      </section>
      <section className="prod-panel prod-returns-report">
        <div className="prod-panel-title">
          <div><span>Locales</span><h2>Reporte de devoluciones y muestras</h2></div>
          <button className="prod-primary-button" disabled={returnsLoading} onClick={loadReturnsReport}>
            <Filter size={17} />
            {returnsLoading ? 'Generando...' : 'Generar reporte'}
          </button>
        </div>
        <div className="prod-monthly-controls">
          <label>Desde<input type="date" value={returnsFilters.date_from} onChange={(event) => updateReturnsFilter('date_from', event.target.value)} /></label>
          <label>Hasta<input type="date" value={returnsFilters.date_to} onChange={(event) => updateReturnsFilter('date_to', event.target.value)} /></label>
        </div>
        {returnsReport && (
          <>
            <div className="prod-monthly-summary">
              <article><span>Total locales</span><strong>{displayNumber(returnsReport.totals?.pairs || 0)}</strong><small>{displayDate(returnsReport.date_from)} - {displayDate(returnsReport.date_to)}</small></article>
              <article><span>Devoluciones</span><strong>{displayNumber(returnsReport.totals?.returns || 0)}</strong><small>Pares devueltos</small></article>
              <article><span>Muestras</span><strong>{displayNumber(returnsReport.totals?.samples || 0)}</strong><small>No entran a produccion</small></article>
              <article><span>Valor referencial</span><strong>{displayMoney(returnsReport.totals?.value || 0)}</strong><small>Segun valor unitario</small></article>
              <article><span>Pendiente devoluciones</span><strong>{displayMoney(returnsReport.totals?.pending_returns || 0)}</strong><small>Notas pendientes</small></article>
            </div>
            <div className="prod-return-destination-summary">
              {(returnsReport.by_destination || []).map((item) => (
                <article key={item.destination}>
                  <span>{item.destination}</span>
                  <strong>{displayNumber(item.pairs)} pares</strong>
                  <small>Dev. {displayNumber(item.returns || 0)} · Muestras {displayNumber(item.samples || 0)} · {displayMoney(item.value)}</small>
                </article>
              ))}
            </div>
            <div className="prod-table-wrap">
              <table className="prod-table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>Cliente</th><th>Destino</th><th>Modelo</th><th>Talla</th><th>Pares</th><th>Valor</th></tr></thead>
                <tbody>
                  {(returnsReport.rows || []).map((row, index) => (
                    <tr className={row.row_kind === 'sample' ? 'prod-sample-report-row' : 'prod-return-report-row'} key={`${row.id}-${row.destination}-${row.model_code}-${row.size}-${index}`}>
                      <td>{displayDate(row.order_date)}</td>
                      <td><span className={row.row_kind === 'sample' ? 'prod-sample-chip' : 'prod-return-chip'}>{row.row_label}</span></td>
                      <td><strong>{row.order_number}</strong><small>{row.source_order_number ? `Origen ${row.source_order_number}` : 'Pedido de muestras'}</small></td>
                      <td><strong>{row.client_name}</strong><small>{row.city || ''}</small></td>
                      <td>{row.destination}</td>
                      <td><strong>{row.model_code}</strong><small>{[row.color, row.material].filter(Boolean).join(' ')}</small></td>
                      <td>{row.size}</td>
                      <td>{row.quantity}</td>
                      <td>{displayMoney(row.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!(returnsReport.rows || []).length && <div className="prod-empty">No hay devoluciones ni muestras en ese rango.</div>}
            </div>
          </>
        )}
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
          <button className="prod-secondary-button prod-clear-report" onClick={() => { setReportFilters(emptyReportFilters); setExcludedActivityClients([]); }}>
            <X size={16} />
            Limpiar filtros
          </button>
        </div>
        {activityReportClients.length > 0 && (
          <div className="prod-monthly-client-picker">
            <div><span>Clientes del reporte</span><strong>Desmarca los que no quieres incluir</strong></div>
            <div>
              {activityReportClients.map((client) => (
                <label key={client} className={excludedActivityClients.includes(client) ? 'excluded' : ''}>
                  <input
                    type="checkbox"
                    checked={!excludedActivityClients.includes(client)}
                    onChange={() => toggleActivityClient(client)}
                  />
                  {client}
                </label>
              ))}
            </div>
          </div>
        )}
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
    is_sample: Boolean(order.is_sample),
    sample_destination: order.sample_destination || '',
    client_id: String(order.client_id),
    seller_user_id: order.seller_user_id ? String(order.seller_user_id) : '',
    order_date: order.order_date,
    delivery_date: order.delivery_date || '',
    origin_label: order.origin_label || '',
    card_alert: order.card_alert || '',
    brand: order.brand || '',
    payment_method: order.payment_method || '',
    bank_reference: order.bank_reference || '',
    guide_template_key: order.guide_template_key || order.client_guide_template_key || '',
    general_notes: order.general_notes || '',
    shipping_value: order.shipping_value || '',
    discount_value: order.discount_value || '',
    invoice_number: order.invoice_number || '',
    invoice_date: order.invoice_date || '',
    invoice_value: order.invoice_value || '',
    status: order.status,
    models: order.models.map((model) => ({
      ...model,
      unit_price: model.unit_price || '',
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
  return (
    <div className={`prod-print-root ${
      type === 'sheets' ? 'print-order' : type === 'delivery-note' ? 'print-delivery-note' : type === 'guides' ? 'print-guides' : type === 'remission-guide' ? 'print-remission-guide' : 'print-cards'
    }`}>
      {type === 'sheets' && <ProductionOrderSheet order={order} />}
      {type === 'delivery-note' && <DeliveryNoteSheet order={order} />}
      {type === 'remission-guide' && <RemissionGuideSheet order={order} />}
      {(type === 'cards' || type === 'card') && (
        <article className="prod-print-card-page">
          {models.map((model) => <ProductionCard order={order} model={model} key={`card-${model.id}`} />)}
        </article>
      )}
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
            left: `${slot.left + (template.family === 'standard' && index % 2 === 1 ? 12 : 0)}mm`,
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

function splitJEnriquezCode(value) {
  const code = String(value || '').trim();
  const match = code.match(/^(.+?)(\d+\s*1\/2)$/);
  if (!match) return { main: code, fraction: '' };
  return {
    main: match[1].trim(),
    fraction: match[2].replace(/\s+/g, '')
  };
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
  const jEnriquezCode = template.slug === 'j-enriquez' ? splitJEnriquezCode(model.model_code) : null;
  if (jEnriquezCode) {
    return (
      <div className={`prod-guide-label standard template-${template.slug}`}>
        <div className="prod-guide-logo">
          {logos[0] ? <img src={logos[0]} alt="" /> : null}
        </div>
        <div className="prod-guide-je-head"><span>CODIG</span><span>COLOR</span><span>TALLA</span></div>
        <div className="prod-guide-model">
          <strong className={jEnriquezCode.fraction ? 'split-code' : ''}>
            <span className="guide-code-main">{jEnriquezCode.main}</span>
            {jEnriquezCode.fraction && <span className="guide-code-fraction">{jEnriquezCode.fraction}</span>}
          </strong>
        </div>
        <div className="prod-guide-je-color"><span>{description}</span></div>
        <div className="prod-guide-size"><strong>{size}</strong></div>
        <div className="prod-guide-origin"><span>MADE IN EC</span><strong>BY PRODUCALZA</strong></div>
      </div>
    );
  }
  return (
    <div className={`prod-guide-label standard template-${template.slug}`}>
      <div className="prod-guide-logo">
        {logos[0]
          ? <img src={logos[0]} alt="" />
          : null}
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

function RemissionGuideSheet({ order }) {
  const guide = order.selected_remission_guide || (order.remission_guides || [])[0] || {};
  const format = REMISSION_FORMATS[guide.format_type || 'producalza'] || REMISSION_FORMATS.producalza;
  const guideNumber = String(guide.guide_number || 8201).padStart(8, '0');
  const issueDate = guide.issue_date || new Date().toISOString().slice(0, 10);
  const recipientName = guide.recipient_name || order.client_name || '';
  const clientName = guide.recipient_business_name || order.business_name || order.client_name || '';
  const clientId = guide.recipient_tax_id || order.tax_id || '';
  const pointArrival = guide.arrival_place || [order.city, order.address].filter(Boolean).join(' - ');
  const totalPairs = (order.models || []).reduce((sum, model) => sum + Number(model.total_pairs || 0), 0);
  const description = guide.description || `${totalPairs} pares de calzado segun pedido ${order.order_number}`;
  const copies = [
    { key: 'white', label: 'Original Adquiriente - 1ra.', tone: 'white' },
    { key: 'green', label: 'Copia Emisor (Verde) - 2da.', tone: 'green' }
  ];
  const line = (label, value = '', className = '') => (
    <div className={`remission-line ${className}`}>
      <span>{label}</span>
      <strong>{value || ''}</strong>
    </div>
  );
  return (
    <article className="prod-remission-page">
      {copies.map((copy) => (
        <section className={`prod-remission-copy ${copy.tone}`} key={copy.key}>
          <header>
            <div className="remission-logo">
              <img src={format.logo} alt={format.business} />
            </div>
            <div className="remission-company">
              <strong>{format.owner}</strong>
              <b>{format.business}</b>
              <span>CALIFICACION ARTESANAL - CALIFICACION IMPRO</span>
              <span>Direccion: {format.address}</span>
              <span>Telf.: {format.phone}</span>
              <span>Email: {format.email}</span>
            </div>
            <div className="remission-number">
              <b>GUIA DE REMISION</b>
              <strong>{guideNumber}</strong>
              <span>001-001</span>
              <em>R.U.C. {format.ruc}</em>
            </div>
          </header>
          <section className="remission-info-grid compact">
            {line('FECHA DE EMISION:', displayDate(issueDate), 'full date')}
            <h3>DATOS DEL DESTINATARIO</h3>
            {line('DESTINATARIO:', recipientName, 'recipient-main')}
            {line('NOMBRE O RAZON SOCIAL:', clientName, 'recipient-main')}
            {line('PUNTO DE LLEGADA:', pointArrival, 'recipient-main')}
            {line('RUC/C.I.:', clientId, 'recipient-main')}
            <h3>ENVIO</h3>
            {line('EMPRESA ENCARGADA DE TRANSPORTE:', guide.carrier_identification || '', 'full transport')}
          </section>
          <table className="remission-table">
            <thead><tr><th>DESCRIPCION</th></tr></thead>
            <tbody>
              <tr><td>{description}</td></tr>
              <tr><td></td></tr>
            </tbody>
          </table>
          <footer>{copy.label}</footer>
        </section>
      ))}
    </article>
  );
}

function DeliveryNoteSheet({ order }) {
  const returnedRows = returnedRowsForOrder(order);
  const printableModels = deliveryModelsAfterReturns(order);
  const subtotal = printableModels.reduce(
    (sum, model) => sum + Number(model.total_pairs || 0) * Number(model.unit_price || 0),
    0
  );
  const discount = Number(order.discount_value || 0);
  const shipping = Number(order.shipping_value || 0);
  const total = Math.max(0, subtotal - discount + shipping);
  const totalPairs = printableModels.reduce((sum, model) => sum + Number(model.total_pairs || 0), 0);
  const isReturnOrder = order.order_type === 'return';
  const isSampleOrder = Boolean(order.is_sample);
  const orderDate = new Date();
  const day = Number.isNaN(orderDate.getTime()) ? '' : String(orderDate.getDate()).padStart(2, '0');
  const month = Number.isNaN(orderDate.getTime()) ? '' : orderDate.toLocaleDateString('es-EC', { month: 'long' }).toUpperCase();
  const year = Number.isNaN(orderDate.getTime()) ? '' : orderDate.getFullYear();
  const paymentRows = (order.payments || []).filter((payment) => payment.due_date || payment.amount || payment.reference);
  return (
    <article className="prod-delivery-note-page">
      <header>
        <div className="prod-delivery-brand">
          <img className="prod-delivery-brand-logo" src="/producalza/nota-logo-marjorie.png" alt="Marjorie Botas" />
          <img className="prod-delivery-producer-logo" src="/producalza/nota-logo-producalza.jpeg" alt="Producalza" />
        </div>
        <div className="prod-delivery-plant">
          <strong>PLANTA DE PRODUCCION:</strong>
          <span>Imbabura s/n e Isidro Viteri</span>
          <span>WhatsApp: 099 5858297</span>
          <span>Mail: producalza@hotmail.com</span>
          <b>AMBATO - ECUADOR</b>
        </div>
        <div className="prod-delivery-date-grid">
          <span>FECHA</span><span>DIA</span><span>CIUDAD</span><span>MES</span><span>ANO</span>
          <b></b><b>{day}</b><b>AMBATO</b><b>{month}</b><b>{year}</b>
        </div>
      </header>
      <section className="prod-delivery-client">
        <span>CLIENTE:</span><strong>{order.client_name}</strong><span>RUC:</span><strong>{order.tax_id || ''}</strong>
        <span>DIRECCION:</span><strong>{order.address || ''}</strong><span>VEND:</span><strong>{order.seller_name || 'FABRICA'}</strong>
        <span>CIUDAD:</span><strong>{order.city || ''}</strong><span>MARCA:</span><strong>{order.brand || ''}</strong>
        <span>TELEFONO:</span><strong>{order.phone || ''}</strong><span>{isReturnOrder ? 'DEVOLUCION:' : isSampleOrder ? 'MUESTRA:' : 'PEDIDO:'}</span><strong>{order.delivery_note_number ? `${order.order_number} / Nota ${order.delivery_note_number}` : order.order_number}</strong>
      </section>
      <table className="prod-delivery-table">
        <thead><tr><th>CANT.</th><th>DESCRIPCION</th><th>VALOR UNITARIO</th><th>VALOR TOTAL</th></tr></thead>
        <tbody>
          {printableModels.map((model) => (
            <tr key={model.id}>
              <td>{model.total_pairs}</td>
              <td>{[model.model_code, model.material, model.color].filter(Boolean).join(' ')}</td>
              <td>{model.unit_price ? displayMoney(model.unit_price) : ''}</td>
              <td>{model.unit_price ? displayMoney(Number(model.unit_price) * Number(model.total_pairs || 0)) : ''}</td>
            </tr>
          ))}
          {returnedRows.map((row) => (
            <tr className="prod-delivery-return-print-row" key={`return-${row.id}`}>
              <td>{row.total_pairs}</td>
              <td>DEVOLUCION {row.return_order_number || ''} · {[row.model_code, row.material, row.color, shortDestinationName(row.destination)].filter(Boolean).join(' ')}</td>
              <td>{displayMoney(0)}</td>
              <td>{displayMoney(0)}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 11 - printableModels.length - returnedRows.length) }).map((_, index) => (
            <tr className="blank" key={`blank-${index}`}><td></td><td></td><td></td><td></td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="prod-delivery-total-pairs"><td>{totalPairs}</td><td>TOTAL PARES</td><td></td><td></td></tr>
        </tfoot>
      </table>
      <section className="prod-delivery-note-text">
        NOTA: LOS PRECIOS INDICADOS NO INCLUYEN IVA, SI REQUIERE FACTURA SE AGREGA EL VALOR CORRESPONDIENTE DEL IVA.
      </section>
      <section className="prod-delivery-bottom">
        <div className="prod-delivery-payment">
          <strong>FORMA DE PAGO: {order.payment_method || ''}</strong>
          {paymentRows.length > 0 && (
            <div className="prod-delivery-payment-list">
              {paymentRows.slice(0, 5).map((payment) => (
                <span key={payment.id || `${payment.due_date}-${payment.amount}`}>
                  {payment.due_date ? displayDate(payment.due_date) : 'Sin fecha'} - {displayMoney(payment.amount)} - {PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="prod-delivery-totals">
          <span>SUB TOTAL:</span><strong>{displayMoney(subtotal)}</strong>
          <span>DESC.</span><strong>{displayMoney(discount)}</strong>
          <span>TRANSPORTE:</span><strong>{displayMoney(shipping)}</strong>
          <span>TOTAL:</span><strong>{displayMoney(total)}</strong>
        </div>
      </section>
      <footer><span>ENTREGUE CONFORME</span><span>RECIBI CONFORME</span></footer>
    </article>
  );
}

function ProductionOrderSheet({ order }) {
  const totalPairs = order.models.reduce((sum, model) => sum + Number(model.total_pairs || 0), 0);
  const isReturnOrder = order.order_type === 'return';
  const isSampleOrder = Boolean(order.is_sample);
  return (
    <article
      className={`prod-print-page ${order.models.length > 8 ? 'dense' : ''}`}
      style={{ '--order-model-count': Math.max(order.models.length, 1) }}
    >
      <header><div><strong>PRODUCALZA</strong><span>{isReturnOrder ? 'HOJA UNICA DE DEVOLUCION' : isSampleOrder ? 'HOJA UNICA DE MUESTRAS' : 'HOJA UNICA DE PEDIDO Y PRODUCCION'}</span></div><b>{order.order_number}</b></header>
      <section className="prod-print-info">
        <div><span>Cliente</span><strong>{order.client_name}</strong></div>
        <div><span>Ciudad</span><strong>{order.city || 'Sin ciudad'}</strong></div>
        <div><span>Fecha</span><strong>{displayDate(order.order_date)}</strong></div>
        <div><span>Marca</span><strong>{order.brand || '-'}</strong></div>
        <div><span>Etiqueta de origen</span><strong>{order.origin_label || '-'}</strong></div>
        <div className="print-red-field"><span>Entrega</span><strong>{order.delivery_date || ''}</strong></div>
        {isSampleOrder && <div className="print-red-field"><span>Destino</span><strong>{order.sample_destination || ''}</strong></div>}
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
            <td colSpan="13"><strong>{isReturnOrder ? 'TOTAL DE DEVOLUCION' : isSampleOrder ? 'TOTAL DE MUESTRAS' : 'TOTAL DEL PEDIDO'}</strong></td>
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
  const isReturnOrder = order.order_type === 'return';
  const isSampleOrder = Boolean(order.is_sample);
  return (
    <article className="prod-print-card">
      <header><div><strong>PRODUCALZA</strong><span>{isReturnOrder ? 'TARJETA DE DEVOLUCION' : isSampleOrder ? 'TARJETA DE MUESTRA' : 'TARJETA DE PRODUCCION'}</span></div><b>Nro. {model.card_number}</b></header>
      <div className="prod-card-client-row">
        <div className="prod-card-client"><span>Cliente</span><strong>{order.client_name}</strong></div>
        <div className="prod-card-red-alert">
          {order.card_alert && <><span>Entrega / aviso</span><strong>{order.card_alert}</strong></>}
        </div>
      </div>
      <section className="prod-card-main-data">
        <div><span>Modelo</span><strong>{model.model_code}</strong></div>
        <div><span>Color</span><strong>{model.color || '-'}</strong></div>
        <div className="prod-card-plant"><span>Planta</span><strong>{model.plant_area || '-'}</strong></div>
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
