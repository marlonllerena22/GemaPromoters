import {isWarehouse,isStoreStaff,canRequestPayments} from './finance-access.mjs';
export const WORK_BUSINESSES = ["producalza", "marjorie", "gemashow"];
export const SPACE_TEMPLATES = [
  {
    id: "producalza-pagos",
    name: "Pagos Producalza",
    kind: "general",
    business_ids: ["producalza"],
    unit_id: "producalza-fabrica",
    description: "Cajas, servicios, proveedores, adelantos y transportes.",
    suggested_members: ["Norma", "Morelia", "Germán", "Tú"],
  },
  {
    id: "producalza-materiales",
    name: "Materiales de bodega",
    kind: "materials",
    business_ids: ["producalza"],
    unit_id: "producalza-fabrica",
    description: "Compras de materiales para bodega.",
    suggested_members: ["Ana", "José", "Tú"],
  },
  {
    id: "gema-mago-loja",
    name: "Mago de Oz · Loja",
    kind: "event",
    business_ids: ["gemashow"],
    unit_id: null,
    description: "Solicitudes, pagos y comprobantes de este evento.",
    suggested_members: ["Tú", "Personas que asignes"],
  },
  {
    id: "gema-exterior-dani",
    name: "Dani Manager · Exterior",
    kind: "international",
    business_ids: ["gemashow"],
    unit_id: null,
    description: "Pagos al exterior y consumos con tarjeta.",
    suggested_members: ["Tú", "Personas que asignes"],
  },
  {
    id: "trabajo-varios",
    name: "Depósitos varios",
    kind: "misc",
    business_ids: WORK_BUSINESSES,
    unit_id: null,
    description: "Pagos de trabajo coordinados con papá.",
    suggested_members: ["Germán", "Tú"],
  },
];
export const PROFILE_TEMPLATES = [
  {
    id: "german",
    name: "Germán",
    label: "Papá · Consulta de negocios",
    role: "viewer",
    work_view: true,
    business_ids: WORK_BUSINESSES,
    spaces: ["producalza-pagos", "trabajo-varios"],
    description:
      "Saldos de negocios y, en un apartado separado, movimientos de trabajo. Sin detalles personales.",
  },
  {
    id: "norma",
    name: "Norma",
    label: "Normita · Cobros y solicitudes",
    role: "collector",
    work_view: false,
    business_ids: ["producalza"],
    spaces: ["producalza-pagos"],
    description: "Sube cobros y solicita pagos en sus espacios.",
  },
  {
    id: "morelia",
    name: "Morelia",
    label: "Organización",
    role: "collector",
    work_view: false,
    business_ids: WORK_BUSINESSES,
    spaces: ["producalza-pagos"],
    description:
      "Organiza solicitudes y revisa el historial de los espacios asignados. El propietario realiza los pagos.",
  },
  {
    id: "ana",
    name: "Ana",
    label: "Jefa de bodega",
    role: "collector",
    work_view: false,
    business_ids: ["producalza"],
    spaces: ["producalza-materiales"],
    description: "Solicita materiales y consulta el estado de sus compras.",
  },
  {
    id: "jose",
    name: "José",
    label: "Bodega",
    role: "collector",
    work_view: false,
    business_ids: ["producalza"],
    spaces: ["producalza-materiales"],
    description: "Solicitudes y comprobantes de materiales.",
  },
];
PROFILE_TEMPLATES.find((p) => p.id === "german").request_payments = true;
PROFILE_TEMPLATES.find((p) => p.id === "german").custody_adjust = true;
PROFILE_TEMPLATES.find((p) => p.id === "german").checks_manage = true;
PROFILE_TEMPLATES.find((p) => p.id === "german").checks_clear = true;
PROFILE_TEMPLATES.find((p) => p.id === "morelia").checks_manage = true;
PROFILE_TEMPLATES.find((p) => p.id === "morelia").review_unit_ids = [
  "marjorie-sur",
];
export const STORE_PROFILES = [
  {
    id: "lili",
    name: "Lili",
    unit_ids: ["marjorie-norte"],
    auto_confirm_unit_ids: ["marjorie-norte"],
  },
  {
    id: "martha",
    name: "Martha",
    unit_ids: ["marjorie-norte", "marjorie-bosque"],
  },
  { id: "nayeli", name: "Nayeli", unit_ids: ["marjorie-valle"] },
  {
    id: "yamileth",
    name: "Yamileth",
    unit_ids: ["marjorie-valle", "marjorie-sur"],
  },
  { id: "selena", name: "Selena", unit_ids: ["marjorie-sur"] },
  { id: "belen", name: "Belén", unit_ids: ["marjorie-bosque"] },
];
PROFILE_TEMPLATES.push(
  ...STORE_PROFILES.map((p) => ({
    ...p,
    label: "Locales · Marjorie",
    role: "collector",
    business_ids: ["marjorie"],
    spaces: [],
    description: "Registra gastos de caja y envía depósitos de clientes para confirmar.",
  })),
);
SPACE_TEMPLATES.push({
  id: "marjorie-pagos",
  name: "Pagos de locales",
  kind: "general",
  business_ids: ["marjorie"],
  unit_id: null,
  description: "Solicitudes de transferencias de los locales asignados.",
  suggested_members: [
    "Lili",
    "Martha",
    "Nayeli",
    "Yamileth",
    "Selena",
    "Belén",
    "Morelia",
    "Tú",
  ],
});
export function paymentProgress(request, payments = []) {
  const paid = payments
    .filter((p) => Number(p.request_id) === Number(request.id) && !p.voided_at)
    .reduce((s, p) => s + p.amount_cents, Number(request.bank_paid_cents || 0));
  const cancelled = request.status === "rejected";
  return {
    paid_cents: paid,
    remaining_cents: cancelled ? 0 : Math.max(0, request.amount_cents - paid),
    payment_state: cancelled
      ? "cancelled"
      : paid >= request.amount_cents
        ? "paid"
        : paid > 0
          ? "partial"
          : "pending",
  };
}
export function canSeeSpace(space, user, members = []) {
  if(isStoreStaff(user))return false;
  const scope = space.business_ids.filter((id) =>
    user.business_ids.includes(id),
  );
  return (
    scope.length > 0 &&
    (user.role === "owner" ||
      (user.work_view && scope.some((id) => WORK_BUSINESSES.includes(id))) ||
      members.some(
        (m) =>
          m.space_id === space.id && Number(m.member_id) === Number(user.id),
      ))
  );
}
export function canSeePaymentRequest(request, user, spaces = [], members = []) {
  if(isStoreStaff(user))return false;
  if(isWarehouse(user)&&request.created_by!==user.username)return false;
  if (!user.business_ids.includes(request.business_id)) return false;
  if (user.unit_ids?.length && !user.unit_ids.includes(request.unit_id))
    return false;
  return (
    user.role === "owner" ||
    request.created_by === user.username ||
    user.work_view === true ||
    (request.space_id &&
      spaces.some(
        (s) => s.id === request.space_id && canSeeSpace(s, user, members),
      ))
  );
}
export function workflowView(source, user) {
  const spaces = source.spaces.filter((s) =>
    canSeeSpace(s, user, source.members),
  );
  const requests = source.requests
    .filter((r) => canSeePaymentRequest(r, user, source.spaces, source.members))
    .map((r) => ({ ...r, ...paymentProgress(r, source.payments) }));
  const ids = new Set(requests.map((r) => Number(r.id)));
  const payments = source.payments.filter((p) => ids.has(Number(p.request_id)));
  const queue = requests
    .filter((r) => r.remaining_cents > 0)
    .sort(
      (a, b) =>
        (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
        a.id - b.id,
    );
  const described = spaces.map((s) => {
    const rows = requests.filter((r) => r.space_id === s.id);
    const members = source.members
      .filter((m) => m.space_id === s.id)
      .map(({ member_id, name, role }) => ({ member_id, name, role }));
    return {
      ...s,
      business_ids: s.business_ids.filter((id) =>
        user.business_ids.includes(id),
      ),
      members,
      is_member: members.some((m) => Number(m.member_id) === Number(user.id)),
      pending_count: rows.filter((r) => r.remaining_cents > 0).length,
      pending_cents: rows.reduce((n, r) => n + r.remaining_cents, 0),
      paid_cents: rows.reduce((n, r) => n + r.paid_cents, 0),
    };
  });
  return {
    spaces: described,
    requests,
    payments,
    queue,
    summary: {
      pending_count: queue.length,
      pending_cents: queue.reduce((s, r) => s + r.remaining_cents, 0),
      paid_cents: payments
        .filter((p) => !p.voided_at)
        .reduce((s, p) => s + p.amount_cents, 0),
    },
    profiles: user.role === "owner" ? PROFILE_TEMPLATES : [],
  };
}

// Conversational access is separate from document OCR and quick-entry helpers.
export const canUseFinanceAssistant = (user) =>
  Boolean(
    user &&
      (user.role === "owner" ||
        ["german", "morelia", "norma", "normita"].includes(user.username)),
  );

PROFILE_TEMPLATES.forEach(p=>{p.request_payments=canRequestPayments({username:p.id});if(p.id==="norma")p.checks_manage=true;if(p.id==="morelia")p.review_unit_ids=["marjorie-sur"];});
