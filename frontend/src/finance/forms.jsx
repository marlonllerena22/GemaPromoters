import React, { useEffect, useRef, useState } from "react";
import {RETAIL_CATEGORIES} from '../../../shared/finance-retail.mjs';
import { transferFeeQuote } from "../../../shared/finance-fees.mjs";
import {
  Camera,
  Check,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import {
  amount,
  businessNames,
  categories,
  financeApi,
  money,
  today,
} from "./api.js";
import { Badge, Button, Field, Modal } from "./components.jsx";

export function EditPanel({ type, initial = {}, onClose }) {
  const { data, user, filters, notify, refresh } = useFinance();
  const firstBusiness =
    filters.business_id !== "all" ? filters.business_id : user.business_ids[0];
  const [form, setForm] = useState({
    business_id: firstBusiness,
    unit_id: "",
    kind: type === "expense" ? "expense" : "income",
    day: today(),
    due_date: "",
    amount: "",
    category: type === "expense" ? "Materiales" : "Abono de pedido",
    counterparty: "",
    description: "",
    reference: "",
    payment_method: "transfer",
    account_id: "",
    evidence_id: null,
    order_id: "",
    name: "",
    bank: "",
    last_four: "",
    custodian: "",
    opening: "0",
    opening_date: today(),
    account_kind: "bank",
    balance: "",
    due_day: "5",
    month: filters.from.slice(0, 7),
    role: "collector",
    work_view: false,
    space_ids: [],
    space_role: "requester",
    username: "",
    password: "",
    business_ids: ["producalza"],
    unit_ids: [],
    closing_opening: "0",
    closing_deposits: "0",
    closing_counted: "",
    note: "",
    ...initial,
  });
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(""),
    [file, setFile] = useState(null),
    [analysis, setAnalysis] = useState(null),
    [orders, setOrders] = useState([]);
  const [figures, setFigures] = useState(null);
  useEffect(() => {
    if (type !== "closing" || !form.unit_id) {
      setFigures(null);
      return;
    }
    let current = true;
    setFigures(null);
    financeApi(
      `/closings/preview?${new URLSearchParams({ unit_id: form.unit_id, day: form.day })}`,
    )
      .then((result) => {
        if (current) setFigures(result);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [type, form.unit_id, form.day]);
  const fileRef = useRef();
  const cameraRef = useRef();
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const units = data.units.filter((u) => u.business_id === form.business_id);
  const titles = {
    movement: "Subir un comprobante",
    expense: "Registrar un gasto",
    account: "Añadir una cuenta",
    verify: "Actualizar saldo real",
    recurring: "Nuevo gasto recurrente",
    budget: "Definir presupuesto",
    closing: "Cerrar caja",
    member: initial.id ? "Editar acceso" : "Crear un acceso",
  };
  const subtitles = {
    movement:
      "Relaciona el cobro con su negocio. La acreditación se verifica por separado.",
    expense: "Registra una solicitud o gasto y conserva su respaldo.",
    account: "El saldo inicial corresponde al inicio de la fecha elegida.",
    verify:
      "Guarda el saldo real que ves en tu banco y relaciona el depósito pendiente que explique exactamente el aumento.",
    recurring:
      "Crearemos pendientes para revisar; ningún pago se ejecuta automáticamente.",
    budget: "Un límite de referencia para organizar tus gastos mensuales.",
    closing:
      "Confirma el efectivo contado y registra las entregas para depósito.",
    member: "Crea un acceso con permisos exclusivos para su trabajo.",
  };
  const businessField = (
    <Field label="Negocio">
      <select
        value={form.business_id}
        onChange={(e) => {
          set("business_id", e.target.value);
          set("unit_id", "");
          set("evidence_id", null);
          setFile(null);
          setAnalysis(null);
          set("account_id", "");
        }}
        required
      >
        {user.business_ids.map((id) => (
          <option key={id} value={id}>
            {businessNames[id]}
          </option>
        ))}
      </select>
    </Field>
  );
  const unitField = units.length > 0 && (
    <Field label="Local o unidad">
      <select
        value={form.unit_id}
        onChange={(e) => set("unit_id", e.target.value)}
        required={Boolean(user.unit_ids.length) || type === "closing"}
      >
        <option value="">
          {type === "closing" ? "Selecciona el local" : "General del negocio"}
        </option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const amountField = (
    <Field label="Monto (USD)">
      <div className="gf-money-input">
        <span>$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
          placeholder="0.00"
        />
      </div>
    </Field>
  );

  async function upload(selected) {
    if (!selected) return;
    setError("");
    setUploading(true);
    setAnalysis(null);
    set("evidence_id", null);
    try {
      if (selected.size > 6 * 1024 * 1024)
        throw new Error("El archivo debe pesar hasta 6 MB");
      if (user.unit_ids.length && !form.unit_id)
        throw new Error("Selecciona tu local antes de subir el archivo");
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(selected);
      });
      const result = await financeApi("/evidence", {
        business_id: form.business_id,
        unit_id: form.unit_id || null,
        name: selected.name,
        mime: selected.type,
        data: String(dataUrl).split(",")[1],
      });
      setFile({ name: selected.name, size: selected.size });
      set("evidence_id", result.id);
      if (result.duplicate)
        notify("El archivo ya estaba guardado; conservamos una sola copia.");
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  async function analyze() {
    setAnalyzing(true);
    setError("");
    try {
      const { analysis: a } = await financeApi(
        `/evidence/${form.evidence_id}/analyze`,
        {},
      );
      setAnalysis(a);
      setForm((f) => ({
        ...f,
        amount: a.amount_cents ? (a.amount_cents / 100).toFixed(2) : f.amount,
        day: a.day || f.day,
        reference: a.reference || f.reference,
        counterparty: a.counterparty || f.counterparty,
        description: a.description || f.description,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }
  async function searchOrders(q) {
    try {
      const result = await financeApi(`/orders?q=${encodeURIComponent(q)}`);
      setOrders(result.orders);
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (["movement", "expense"].includes(type))
        await financeApi("/movements", {
          business_id: form.business_id,
          unit_id: form.unit_id || null,
          kind: form.kind,
          amount_cents: amount(form.amount),
          day: form.day,
          due_date: form.due_date || null,
          category: form.category,
          counterparty: form.counterparty,
          description: form.description,
          reference: form.reference,
          payment_method: form.payment_method,
          account_id: form.account_id ? Number(form.account_id) : null,
          evidence_id: form.evidence_id,
          order_id: form.order_id ? Number(form.order_id) : null,
        });
      if (type === "account")
        await financeApi("/accounts", {
          business_id: form.business_id === "shared" ? null : form.business_id,
          name: form.name,
          bank: form.bank,
          kind: form.account_kind,
          last_four: form.last_four,
          custodian: form.custodian,
          opening_cents: amount(form.opening),
          opening_date: form.opening_date,
        });
      if (type === "verify")
        await financeApi(`/accounts/${initial.id}/verify`, {
          balance_cents: amount(form.balance),
          day: form.day,
          update_balance: true,
          expected_balance_cents: initial.balance_cents,
        });
      if (type === "recurring")
        await financeApi("/recurring", {
          business_id: form.business_id,
          unit_id: form.unit_id || null,
          name: form.name,
          category: form.category,
          counterparty: form.counterparty,
          amount_cents: amount(form.amount),
          due_day: Number(form.due_day),
        });
      if (type === "budget")
        await financeApi("/budgets", {
          business_id: form.business_id,
          month: form.month,
          category: form.category,
          amount_cents: amount(form.amount),
        });
      if (type === "closing")
        await financeApi("/closings", {
          unit_id: form.unit_id,
          day: form.day,
          opening_cents: amount(form.closing_opening),
          deposits_cents: amount(form.closing_deposits),
          counted_cents: amount(form.closing_counted),
          note: form.note,
        });
      if (type === "member")
        await financeApi(
          initial.id ? `/members/${initial.id}/access` : "/members",
          {
            name: form.name,
            username: form.username,
            password: form.password,
            role: form.role,
            business_ids: form.business_ids,
            unit_ids: form.unit_ids,
            work_view: form.work_view,
            space_ids: form.space_ids,
            space_role: form.space_role,
          },
        );
      notify(
        type === "member"
          ? initial.id
            ? "Permisos actualizados. Sus sesiones anteriores se cerraron."
            : "Acceso creado. Comparte sus credenciales por un canal privado."
          : "Guardado correctamente",
      );
      await refresh();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const isMovement = ["movement", "expense"].includes(type);
  const closingSales = figures?.sales_cents || 0;
  const closingExpenses = figures?.expenses_cents || 0;
  return (
    <Modal title={titles[type]} subtitle={subtitles[type]} onClose={onClose}>
      <form onSubmit={submit} className="gf-form">
        {(isMovement || ["recurring", "budget", "closing"].includes(type)) && (
          <div className="gf-form-grid">
            {businessField}
            {type !== "budget" && unitField}
          </div>
        )}
        {isMovement && (
          <>
            <div
              className={`gf-upload-zone ${file ? "has-file" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!uploading) upload(e.dataTransfer.files[0]);
              }}
            >
              <span className="gf-upload-icon">
                {uploading ? (
                  <Loader2 className="gf-spin" size={26} />
                ) : file ? (
                  <FileText size={26} />
                ) : (
                  <UploadCloud size={27} />
                )}
              </span>
              <strong>
                {uploading
                  ? "Guardando comprobante…"
                  : file
                    ? file.name
                    : "Tu comprobante empieza aquí"}
              </strong>
              <p>
                {file
                  ? `${Math.ceil(file.size / 1024)} KB · archivo guardado`
                  : "Arrastra una imagen o PDF. Máximo 6 MB."}
              </p>
              <div className="gf-inline">
                <Button
                  type="button"
                  variant="secondary small"
                  disabled={uploading}
                  onClick={() => fileRef.current.click()}
                >
                  Elegir archivo
                </Button>
                <Button
                  type="button"
                  variant="ghost small"
                  icon={Camera}
                  disabled={uploading}
                  onClick={() => cameraRef.current.click()}
                >
                  Tomar foto
                </Button>
              </div>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => upload(e.target.files[0])}
              />
              <input
                ref={cameraRef}
                hidden
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => upload(e.target.files[0])}
              />
            </div>
            {file && data.capabilities.ai && (
              <Button
                type="button"
                variant="ai"
                icon={Sparkles}
                loading={analyzing}
                onClick={analyze}
              >
                Leer datos con IA
              </Button>
            )}
            {file && !data.capabilities.ai && (
              <div className="gf-note">
                <Sparkles size={16} />
                La lectura con IA está pendiente de configuración. Puedes
                completar los datos y guardar el respaldo.
              </div>
            )}
            {analysis && (
              <div className="gf-note success">
                <Check size={17} />
                <div>
                  Datos extraídos como borrador. Revisa monto, fecha y
                  referencia antes de guardar.
                  {analysis.warnings?.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="gf-form-grid">
              <Field label="Tipo">
                <select
                  value={form.kind}
                  onChange={(e) => set("kind", e.target.value)}
                >
                  {[
                    ["income", "Cobro de cliente"],
                    ["expense", "Gasto / solicitud de pago"],
                    ["refund", "Devolución"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {amountField}
            </div>
            <div className="gf-form-grid">
              <Field
                label="Fecha del movimiento"
                type="date"
                required
                max={today()}
                value={form.day}
                onChange={(e) => set("day", e.target.value)}
              />
              <Field
                label="Vencimiento (opcional)"
                type="date"
                value={form.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
            <Field
              label="Cliente, proveedor o responsable"
              required
              value={form.counterparty}
              onChange={(e) => set("counterparty", e.target.value)}
              placeholder="¿Con quién se relaciona?"
            />
            <div className="gf-form-grid">
              <Field label="Categoría">
                <select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {(form.business_id==='marjorie'?[...new Set([form.category,...RETAIL_CATEGORIES.map(([,label])=>label)])]:categories).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Medio de pago">
                <select
                  value={form.payment_method}
                  onChange={(e) => set("payment_method", e.target.value)}
                >
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="payphone">Payphone</option>
                  <option value="other">Otro</option>
                </select>
              </Field>
            </div>
            <Field
              label="Referencia del comprobante"
              value={form.reference}
              onChange={(e) => set("reference", e.target.value)}
              placeholder="Número de transacción o referencia"
            />
            {data.accounts.length > 0 && (
              <Field label="Cuenta relacionada (opcional)">
                <select
                  value={form.account_id}
                  onChange={(e) => set("account_id", e.target.value)}
                >
                  <option value="">Por identificar</option>
                  {data.accounts
                    .filter(
                      (a) =>
                        !a.business_id || a.business_id === form.business_id,
                    )
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.bank} · {a.name}{" "}
                        {a.last_four ? `··${a.last_four}` : ""}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {form.business_id === "producalza" && (
              <div className="gf-order-search">
                <Field
                  label="Relacionar con un pedido (opcional)"
                  hint="Consulta los pedidos de Producalza ya registrados en Promoters."
                >
                  <input
                    type="search"
                    placeholder="Buscar número o cliente"
                    onChange={(e) => searchOrders(e.target.value)}
                  />
                </Field>
                {orders.length > 0 && (
                  <select
                    aria-label="Pedido de Producalza"
                    value={form.order_id}
                    onChange={(e) => {
                      set("order_id", e.target.value);
                      const o = orders.find(
                        (x) => x.id === Number(e.target.value),
                      );
                      if (o) set("counterparty", o.customer_name);
                    }}
                  >
                    <option value="">Seleccionar pedido</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.order_number} · {o.customer_name} · saldo{" "}
                        {money(Math.round((o.total - o.paid) * 100))}
                      </option>
                    ))}
                  </select>
                )}
                {form.order_id && (
                  <Badge status="approved">Pedido seleccionado</Badge>
                )}
              </div>
            )}
            <Field label="Detalle (opcional)">
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                placeholder="Añade el contexto que ayudará a revisar este movimiento"
              />
            </Field>
            <div className="gf-note">
              Se guardará por revisar. Subir un comprobante no confirma
              acreditación ni ejecuta un pago.
              {form.kind === "transfer" &&
                " Un traslado cambia la ubicación del dinero; no genera una venta ni un gasto."}
            </div>
          </>
        )}
        {type === "account" && (
          <>
            <Field
              label="Nombre de la cuenta"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ej. Operación Producalza"
            />
            <div className="gf-form-grid">
              <Field
                label="Entidad"
                required
                value={form.bank}
                onChange={(e) => set("bank", e.target.value)}
                placeholder="Banco o billetera"
              />
              <Field label="Tipo">
                <select
                  value={form.account_kind}
                  onChange={(e) => set("account_kind", e.target.value)}
                >
                  <option value="bank">Cuenta bancaria</option>
                  <option value="wallet">Billetera</option>
                  <option value="card">Tarjeta de crédito</option>
                  <option value="cash">Caja de efectivo</option>
                  <option value="custody">Dinero en custodia</option>
                </select>
              </Field>
            </div>
            <Field label="Propiedad de los fondos">
              <select
                value={form.business_id}
                onChange={(e) => set("business_id", e.target.value)}
              >
                <option value="shared">Cuenta compartida entre negocios</option>
                {user.business_ids.map((id) => (
                  <option key={id} value={id}>
                    {businessNames[id]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="gf-form-grid">
              <Field
                label="Últimos cuatro dígitos (opcional)"
                maxLength={4}
                inputMode="numeric"
                value={form.last_four}
                onChange={(e) => set("last_four", e.target.value)}
              />
              <Field
                label="Responsable"
                value={form.custodian}
                onChange={(e) => set("custodian", e.target.value)}
              />
            </div>
            <div className="gf-form-grid">
              <Field
                label="Saldo inicial (USD)"
                hint="En tarjetas, usa negativo para la deuda."
                type="number"
                step="0.01"
                required
                value={form.opening}
                onChange={(e) => set("opening", e.target.value)}
              />
              <Field
                label="Fecha de inicio"
                type="date"
                max={today()}
                required
                value={form.opening_date}
                onChange={(e) => set("opening_date", e.target.value)}
              />
            </div>
            <div className="gf-note">
              Importa movimientos desde esta fecha, después del saldo inicial.
              Las cuentas compartidas solo muestran su saldo al propietario.
            </div>
          </>
        )}
        {type === "verify" && (
          <>
            <div className="gf-form-highlight">
              <small>
                {initial.bank} · {initial.name}
              </small>
              <strong>{money(initial.balance_cents)}</strong>
              <span>Saldo calculado al día de hoy</span>
            </div>
            <Field
              label="Fecha del saldo real"
              type="date"
              max={today()}
              min={initial.opening_date}
              required
              value={form.day}
              onChange={(e) => set("day", e.target.value)}
            />
            <Field
              label="Saldo real en el banco (USD)"
              type="number"
              step="0.01"
              required
              value={form.balance}
              onChange={(e) => set("balance", e.target.value)}
            />
            <div className="gf-note">
              Al guardar se actualizarán los fondos. Si el aumento coincide con un único comprobante pendiente de esta cuenta, quedará confirmado por ti. El cambio se conserva en el historial.
            </div>
          </>
        )}
        {["recurring", "budget"].includes(type) && (
          <>
            {type === "recurring" && (
              <Field
                label="Nombre del gasto"
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ej. Arriendo del local Norte"
              />
            )}
            <div className="gf-form-grid">
              {amountField}
              <Field label="Categoría">
                <select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            {type === "recurring" ? (
              <>
                <Field
                  label="Proveedor"
                  required
                  value={form.counterparty}
                  onChange={(e) => set("counterparty", e.target.value)}
                />
                <Field
                  label="Día de vencimiento mensual"
                  type="number"
                  required
                  min="1"
                  max="28"
                  value={form.due_day}
                  onChange={(e) => set("due_day", e.target.value)}
                />
              </>
            ) : (
              <Field
                label="Mes"
                type="month"
                required
                value={form.month}
                onChange={(e) => set("month", e.target.value)}
              />
            )}
          </>
        )}
        {type === "closing" && (
          <>
            <Field
              label="Fecha de caja"
              type="date"
              required
              max={today()}
              value={form.day}
              onChange={(e) => set("day", e.target.value)}
            />
            <div className="gf-form-grid">
              <Field
                label="Efectivo inicial (USD)"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.closing_opening}
                onChange={(e) => set("closing_opening", e.target.value)}
              />
              <Field
                label="Entregado para depósito (USD)"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.closing_deposits}
                onChange={(e) => set("closing_deposits", e.target.value)}
              />
            </div>
            <div className="gf-summary-lines">
              <div>
                <span>Ventas cobradas en efectivo cargadas</span>
                <strong>{money(closingSales)}</strong>
              </div>
              <div>
                <span>Gastos de efectivo confirmados</span>
                <strong>−{money(closingExpenses)}</strong>
              </div>
              <div>
                <span>Efectivo esperado · vista previa</span>
                <strong>
                  {money(
                    amount(form.closing_opening) +
                      closingSales -
                      closingExpenses -
                      amount(form.closing_deposits),
                  )}
                </strong>
              </div>
            </div>
            <Field
              label="Efectivo contado al cierre (USD)"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.closing_counted}
              onChange={(e) => set("closing_counted", e.target.value)}
            />
            <Field label="Novedades o explicación de diferencias">
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
            <div className="gf-note">
              {figures?.pending_count > 0
                ? `Hay ${figures.pending_count} movimientos de efectivo por revisar o confirmar. `
                : ""}
              El servidor recalculará el cierre con las ventas y gastos
              disponibles. Verifica que la integración esté completa. Una
              entrega para depósito no confirma que el banco la haya recibido.
            </div>
          </>
        )}
        {type === "member" && (
          <>
            <Field
              label="Nombre"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
            <Field
              label="Usuario"
              required
              autoComplete="off"
              disabled={Boolean(initial.id) || data.capabilities.public_preview}
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
            {!initial.id && (
              <Field
                label="Contraseña inicial"
                hint="8 caracteres. Compártela por un canal privado."
                type="password"
                required
                minLength={8}
                maxLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                disabled={data.capabilities.public_preview}
              />
            )}
            <Field label="Permisos">
              <select
                value={form.role}
                onChange={(e) => {
                  set("role", e.target.value);
                  if (e.target.value !== "viewer") set("work_view", false);
                }}
              >
                <option value="collector">
                  Colaborador · registra y ve sus movimientos
                </option>
                <option value="manager">
                  Administrador · revisa negocios asignados
                </option>
                <option value="viewer">
                  Consulta · reportes de negocios asignados
                </option>
              </select>
            </Field>
            {form.role === "viewer" && (
              <label className="gf-profile-workview">
                <input
                  type="checkbox"
                  checked={form.work_view}
                  onChange={(e) => {
                    set("work_view", e.target.checked);
                    if (e.target.checked)
                      set(
                        "business_ids",
                        form.business_ids.filter((id) => id !== "personal"),
                      );
                  }}
                />
                <span>
                  Resumen de saldos de trabajo, incluidas cuentas compartidas.
                  Detalles personales privados.
                </span>
              </label>
            )}
            <fieldset className="gf-checks">
              <legend>Negocios autorizados</legend>
              {user.business_ids.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={form.business_ids.includes(id)}
                    disabled={form.work_view && id === "personal"}
                    onChange={(e) =>
                      set(
                        "business_ids",
                        e.target.checked
                          ? [...form.business_ids, id]
                          : form.business_ids.filter((x) => x !== id),
                      )
                    }
                  />
                  {businessNames[id]}
                </label>
              ))}
            </fieldset>
            <fieldset className="gf-checks">
              <legend>Limitar a locales o unidades (opcional)</legend>
              {data.units
                .filter((u) => form.business_ids.includes(u.business_id))
                .map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.unit_ids.includes(u.id)}
                      onChange={(e) =>
                        set(
                          "unit_ids",
                          e.target.checked
                            ? [...form.unit_ids, u.id]
                            : form.unit_ids.filter((x) => x !== u.id),
                        )
                      }
                    />
                    {u.name}
                  </label>
                ))}
            </fieldset>
            <fieldset className="gf-large-checks">
              <legend>Espacios asignados</legend>
              {(data.workflow?.spaces || [])
                .filter((s) =>
                  s.business_ids.some((b) => form.business_ids.includes(b)),
                )
                .map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={form.space_ids.includes(s.id)}
                      onChange={(e) =>
                        set(
                          "space_ids",
                          e.target.checked
                            ? [...form.space_ids, s.id]
                            : form.space_ids.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
            </fieldset>
            {form.role !== "viewer" && (
              <Field label="Trabajo dentro de sus espacios">
                <select
                  value={form.space_role}
                  onChange={(e) => set("space_role", e.target.value)}
                >
                  <option value="requester">Solicitar y consultar pagos</option>
                  <option value="coordinator">
                    Organizar solicitudes del equipo
                  </option>
                  <option value="observer">Solo consultar</option>
                </select>
              </Field>
            )}
            <div className="gf-profile-privacy">
              Solo el propietario registra transferencias realizadas y
              administra los accesos. El perfil de consulta de trabajo puede ver
              saldos de cuentas compartidas sin acceder a tus movimientos
              personales.
            </div>
            {data.capabilities.public_preview && (
              <div className="gf-note">
                Perfil de ejemplo. Los accesos reales se activarán en la
                aplicación operativa; no escribas contraseñas reales aquí.
              </div>
            )}
          </>
        )}
        {error && (
          <div className="gf-error" role="alert">
            {error}
          </div>
        )}
        <footer className="gf-form-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            disabled={
              (type === "member" && data.capabilities.public_preview) ||
              uploading ||
              analyzing ||
              (type === "closing" && (!figures || figures.pending_count > 0))
            }
            type="submit"
            icon={Check}
          >
            {type === "closing"
              ? "Confirmar cierre"
              : type === "verify"
                ? "Guardar comprobación"
                : type === "member"
                  ? "Crear acceso"
                  : "Guardar registro"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function parseCsv(text) {
  const first = text.split(/\r?\n/)[0];
  const delimiter = first.includes(";")
    ? ";"
    : first.includes("\t")
      ? "\t"
      : ",";
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if (c === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("El CSV contiene comillas sin cerrar");
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("El archivo no contiene movimientos");
  const headers = rows.shift().map((h) =>
    h
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );
  const index = (name) => headers.indexOf(name);
  if (index("fecha") < 0 || index("valor") < 0)
    throw new Error(
      "El CSV debe tener columnas fecha y valor. También admite referencia, descripcion e id.",
    );
  return rows.map((r, i) => {
    let day = String(r[index("fecha")] || "").trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(day)) {
      const [d, m, y] = day.split("/");
      day = `${y}-${m}-${d}`;
    }
    let value = String(r[index("valor")] || "")
      .trim()
      .replace(/[$\s]/g, "");
    if (value.includes(",") && value.includes(".")) {
      if (value.lastIndexOf(",") > value.lastIndexOf("."))
        value = value.replaceAll(".", "").replace(",", ".");
      else value = value.replaceAll(",", "");
    } else value = value.replace(",", ".");
    if (!/^-?\d+(\.\d{1,2})?$/.test(value))
      throw new Error(
        `Valor inválido en la fila ${i + 2}. Usa hasta dos decimales.`,
      );
    return {
      day,
      amount_cents: amount(value),
      reference: r[index("referencia")] || "",
      description: r[index("descripcion")] || "",
      external_id: r[index("id")] || "",
    };
  });
}

export function BankImport({ onClose }) {
  const { data, notify, refresh } = useFinance();
  const [account, setAccount] = useState(""),
    [rows, setRows] = useState([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function read(file) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Máximo 5 MB por archivo");
      const parsed = parseCsv(await file.text());
      if (parsed.length > 5000)
        throw new Error("Máximo 5000 movimientos por archivo");
      setRows(parsed);
      setName(file.name);
    } catch (e) {
      setError(e.message);
      setRows([]);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await financeApi("/bank/import", {
        account_id: Number(account),
        rows,
      });
      notify(
        `${result.imported} movimientos importados · ${result.duplicates} ya existentes`,
      );
      await refresh();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Importar movimientos bancarios"
      subtitle="Revisa el archivo y la cuenta antes de incorporarlo."
      onClose={onClose}
      wide
    >
      <form className="gf-form" onSubmit={submit}>
        <Field label="Cuenta receptora del archivo">
          <select
            required
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Seleccionar cuenta</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank} · {a.name} {a.last_four ? `··${a.last_four}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <label className="gf-upload-zone gf-upload-label">
          <UploadCloud size={28} />
          <strong>{name || "Seleccionar archivo CSV"}</strong>
          <p>Exportado desde tu banco · hasta 5000 filas</p>
          <input
            type="file"
            accept=".csv,text/csv,.tsv"
            onChange={(e) => read(e.target.files[0])}
          />
        </label>
        <div className="gf-note">
          Columnas: <strong>fecha, valor, referencia, descripcion, id</strong>.
          Fecha AAAA-MM-DD o DD/MM/AAAA. Ingresos positivos y salidas negativas.
          Usa el identificador bancario cuando exista. La importación no
          concilia automáticamente.
        </div>
        {rows.length > 0 && (
          <>
            <Badge status="approved">{rows.length} filas para revisar</Badge>
            <div className="gf-table-scroll">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Referencia</th>
                    <th>Descripción</th>
                    <th className="gf-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      <td>{r.day}</td>
                      <td>{r.reference || "—"}</td>
                      <td>{r.description || "—"}</td>
                      <td className="gf-right gf-amount">
                        {money(r.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 8 && (
              <small className="gf-muted">
                Mostrando las primeras 8 filas.
              </small>
            )}
          </>
        )}
        {error && (
          <div className="gf-error" role="alert">
            {error}
          </div>
        )}
        <footer className="gf-form-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!rows.length || !account}
          >
            Importar {rows.length || ""} movimientos
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function OpeningAllocationPanel({ account, onClose }) {
  const { user, notify, refresh } = useFinance();
  const [values, setValues] = useState(
    Object.fromEntries(
      user.business_ids.map((id) => [
        id,
        (
          (account.opening_allocations?.find((a) => a.business_id === id)
            ?.amount_cents || 0) / 100
        ).toFixed(2),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const total = Object.values(values).reduce((s, v) => s + amount(v), 0);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi(`/accounts/${account.id}/allocate-opening`, {
        allocations: user.business_ids.map((id) => ({
          business_id: id,
          amount_cents: amount(values[id]),
        })),
      });
      await refresh();
      notify("Propiedad del saldo inicial actualizada sin mover dinero");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="¿A quién pertenece el saldo inicial?"
      subtitle={`${account.bank} · ${account.name}. Esta clasificación no realiza transferencias.`}
      onClose={onClose}
    >
      <form className="gf-form" onSubmit={submit}>
        <div className="gf-form-highlight">
          <small>Saldo al inicio del {account.opening_date}</small>
          <strong>{money(account.opening_cents)}</strong>
          <span>Distribuye solo la propiedad de estos fondos iniciales.</span>
        </div>
        <div className="gf-form-grid">
          {user.business_ids.map((id) => (
            <Field
              key={id}
              label={`${businessNames[id]} (USD)`}
              required
              type="number"
              step="0.01"
              value={values[id]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [id]: e.target.value }))
              }
            />
          ))}
        </div>
        <div className="gf-summary-lines">
          <div>
            <span>Asignado</span>
            <strong>{money(total)}</strong>
          </div>
          <div>
            <span>Sin asignar del saldo inicial</span>
            <strong>{money(account.opening_cents - total)}</strong>
          </div>
        </div>
        <div className="gf-note">
          Los movimientos posteriores se atribuyen al negocio al conciliarlos.
          Los fondos que todavía no tengan dueño identificado se muestran
          separados. La corrección de esta distribución queda registrada.
        </div>
        {error && <div className="gf-error">{error}</div>}
        <footer className="gf-form-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Guardar distribución
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function TransferPanel({ onClose }) {
  const { data, user, notify, refresh } = useFinance();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [value, setValue] = useState(""),
    [day, setDay] = useState(today()),
    [description, setDescription] = useState("");
  const [fromBusiness, setFromBusiness] = useState("producalza"),
    [toBusiness, setToBusiness] = useState("producalza"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const source = data.accounts.find((a) => a.id === Number(from)),
    target = data.accounts.find((a) => a.id === Number(to));
  const fee = transferFeeQuote(source?.bank, target?.bank);
  const cash = [source, target].some(
    (a) => a && ["cash", "custody"].includes(a.kind),
  );
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi("/transfers", {
        idempotency_key: idempotencyKey,
        from_account_id: Number(from),
        to_account_id: Number(to),
        from_business_id: fromBusiness,
        to_business_id: toBusiness,
        amount_cents: amount(value),
        day,
        description,
        confirm_cash: confirmed,
      });
      await refresh();
      notify(
        "Traslado registrado. Los movimientos bancarios quedan pendientes de contrastar.",
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const options = data.accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.bank} · {a.name} · {money(a.balance_cents)}
    </option>
  ));
  const businesses = user.business_ids.map((id) => (
    <option key={id} value={id}>
      {businessNames[id]}
    </option>
  ));
  return (
    <Modal
      title="Registrar un traslado de fondos"
      subtitle="Deja constancia del movimiento entre cuentas o responsables. Esta acción no envía dinero."
      onClose={onClose}
    >
      <form className="gf-form" onSubmit={submit}>
        <Field label="Cuenta de origen">
          <select
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">¿De dónde salió?</option>
            {options}
          </select>
        </Field>
        {source && !source.business_id && (
          <Field label="Negocio propietario de los fondos de origen">
            <select
              value={fromBusiness}
              onChange={(e) => setFromBusiness(e.target.value)}
            >
              {businesses}
            </select>
          </Field>
        )}
        <Field label="Cuenta o responsable de destino">
          <select required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">¿A dónde llegó?</option>
            {options.filter((o) => String(o.props.value) !== from)}
          </select>
        </Field>
        {target && !target.business_id && (
          <Field label="Negocio al que se asignan los fondos de destino">
            <select
              value={toBusiness}
              onChange={(e) => setToBusiness(e.target.value)}
            >
              {businesses}
            </select>
          </Field>
        )}
        <div className="gf-form-grid">
          <Field
            label="Monto (USD)"
            type="number"
            required
            min="0.01"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Field
            label="Fecha del traslado"
            type="date"
            required
            max={today()}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        {source && target && (
          <p className="gf-note">
            Comisión de referencia:{" "}
            {fee.cents === null ? "Por comprobar" : money(fee.cents)}.{" "}
            {fee.note || fee.label}{" "}
            {fee.cents !== null && value
              ? `Salida prevista: ${money(amount(value) + fee.cents)}.`
              : ""}{" "}
            Este estimado no modifica el saldo.
          </p>
        )}
        <Field label="Motivo y propiedad de los fondos">
          <textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej. Entrega de recaudación del evento, traslado propio o fondos prestados entre negocios"
          />
        </Field>
        {cash && (
          <fieldset className="gf-checks">
            <label>
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confirmo la entrega o recepción física indicada y su responsable.
            </label>
          </fieldset>
        )}
        <div className="gf-note">
          Se registran origen y destino sin generar ventas ni gastos. Los lados
          bancarios se contrastan con sus movimientos importados. Las entregas
          físicas confirmadas actualizan el registro de efectivo o custodia.
          Para ver cuentas de otros negocios, selecciona «Todos mis negocios».
        </div>
        {error && (
          <div className="gf-error" role="alert">
            {error}
          </div>
        )}
        <footer className="gf-form-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} type="submit">
            Registrar traslado
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
