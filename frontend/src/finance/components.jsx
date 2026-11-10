import React, { useEffect, useRef } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Check,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  businessColors,
  businessNames,
  dateLabel,
  kindNames,
  money,
  statusNames,
} from "./api.js";

export function Brand({ compact = false }) {
  return (
    <div className="gf-brand">
      <span className="gf-brand-symbol">
        <i />
        <i />
        <i />
      </span>
      {!compact && (
        <span>
          gema<span className="gf-brand-dot">.</span>
          <small>FINANZAS</small>
        </span>
      )}
    </div>
  );
}
export function Button({
  children,
  variant = "",
  loading = false,
  icon: Icon,
  ...props
}) {
  return (
    <button
      {...props}
      className={`gf-button ${variant} ${props.className || ""}`}
      disabled={props.disabled || loading}
    >
      {loading ? (
        <Loader2 size={17} className="gf-spin" />
      ) : Icon ? (
        <Icon size={17} />
      ) : null}
      {children}
    </button>
  );
}
export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`gf-icon-button ${props.className || ""}`}
    >
      <Icon size={19} />
    </button>
  );
}
export function Badge({ status, children }) {
  return (
    <span className={`gf-badge ${status || ""}`}>
      <i />
      {children || statusNames[status] || status}
    </span>
  );
}
export function BusinessMark({ id, size = "" }) {
  return (
    <span
      className={`gf-business-mark ${size}`}
      style={{ "--business-color": businessColors[id] || "#687a74" }}
    >
      {businessNames[id]?.slice(0, 1) || "G"}
    </span>
  );
}
export function Empty({
  title = "Todavía no hay registros",
  description = "Los movimientos aparecerán aquí cuando se registren.",
  action,
}) {
  return (
    <div className="gf-empty">
      <span>
        <ShieldCheck size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionHead({ eyebrow, title, description, children }) {
  return (
    <div className="gf-section-head">
      <div>
        {eyebrow && <span className="gf-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="gf-inline">{children}</div>
    </div>
  );
}
export function Field({ label, hint, children, ...props }) {
  return (
    <label className={`gf-field ${props.className || ""}`}>
      <span>{label}</span>
      {children || <input {...props} />}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  className = "",
}) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = () =>
      ref.current
        ?.querySelector('input:not([type="file"]),select,textarea,button')
        ?.focus();
    const timer = setTimeout(first, 40);
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'
          ),
        ].filter((n) => n.offsetParent !== null);
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", key);
      document.body.style.overflow = saved;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="gf-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`gf-modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gf-dialog-title"
      >
        <header>
          <div>
            <span className="gf-eyebrow">GEMA FINANZAS</span>
            <h2 id="gf-dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Cerrar ventana" onClick={onClose} />
        </header>
        <div className="gf-modal-body">{children}</div>
      </section>
    </div>
  );
}
export function MovementTable({ rows, onSelect, compact = false }) {
  if (!rows.length)
    return (
      <Empty
        title="Todo listo para empezar"
        description="Los registros que coincidan con tus filtros aparecerán aquí."
      />
    );
  return (
    <div className={`gf-table-scroll ${compact ? "compact" : ""}`}>
      <table className="gf-table">
        <thead>
          <tr>
            <th>Movimiento</th>
            <th>Negocio</th>
            <th>Fecha</th>
            <th>Estado</th>
            <th className="gf-right">Monto</th>
            <th>
              <span className="gf-sr">Detalles</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} onClick={() => onSelect(m)}>
              <td>
                <button
                  className="gf-table-main"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(m);
                  }}
                >
                  <span className={`gf-transaction-icon ${m.kind}`}>
                    {m.kind === "income" ? (
                      <ArrowDownLeft size={18} />
                    ) : m.kind === "transfer" ? (
                      <ArrowLeftRight size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{m.counterparty}</strong>
                    <small>
                      {m.is_payment_request ? "Solicitud · " : ""}
                      {m.category} {m.evidence_id ? "· Adjunto" : ""}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <span className="gf-business-inline">
                  <BusinessMark id={m.business_id} size="small" />
                  {businessNames[m.business_id]}
                </span>
              </td>
              <td>
                <span className="gf-date-cell">{dateLabel(m.day)}</span>
              </td>
              <td>
                <Badge status={m.status}>
                  {m.is_payment_request
                    ? m.status === "reported"
                      ? "Pagado"
                      : m.status === "rejected"
                      ? "Anulado"
                      : m.paid_total_cents > 0
                      ? "Pago parcial"
                      : "Por pagar"
                    : undefined}
                </Badge>
              </td>
              <td
                className={`gf-right gf-amount ${
                  m.kind === "income" ? "positive" : ""
                }`}
              >
                {m.is_payment_request
                  ? ""
                  : m.kind === "income"
                  ? "+"
                  : m.kind === "transfer"
                  ? ""
                  : "−"}
                {money(m.amount_cents)}
              </td>
              <td>
                <ChevronRight size={15} className="gf-muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Stat({ label, value, detail, icon: Icon, tone = "" }) {
  return (
    <article className={`gf-stat ${tone}`}>
      <div className="gf-stat-top">
        <span>{label}</span>
        {Icon && <Icon size={18} />}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function FlowChart({ daily, period }) {
  const width = 700,
    height = 190,
    pad = 12,
    days = Number(period.to.slice(-2));
  const start = new Date(`${period.from}T12:00:00Z`),
    end = new Date(`${period.to}T12:00:00Z`);
  const span = Math.max(1, Math.round((end - start) / 86400000));
  const map = new Map(daily.map((d) => [d.day, d]));
  const rows = [];
  for (let i = 0; i <= Math.min(span, 92); i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + Math.round((i * span) / Math.min(span, 92)));
    const key = d.toISOString().slice(0, 10);
    rows.push(map.get(key) || { day: key, income_cents: 0, expense_cents: 0 });
  }
  if (rows.length === 1) rows.push({ ...rows[0] });
  const max = Math.max(
    10000,
    ...rows.flatMap((r) => [r.income_cents, r.expense_cents])
  );
  const point = (r, i, key) => [
    pad + (i * (width - pad * 2)) / (rows.length - 1),
    height - pad - (r[key] / max) * (height - pad * 2),
  ];
  const path = (key) =>
    rows
      .map((r, i) => `${i ? "L" : "M"}${point(r, i, key).join(",")}`)
      .join(" ");
  const fill = `${path("income_cents")} L${
    width - pad
  },${height} L${pad},${height} Z`;
  return (
    <div
      className="gf-chart"
      role="img"
      aria-label="Cobros conciliados y gastos registrados por fecha"
    >
      <div className="gf-chart-axis">
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <span key={v}>
            {new Intl.NumberFormat("es-EC", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format((v * max) / 100)}
          </span>
        ))}
      </div>
      <div className="gf-chart-content">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="gf-flow-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5c9477" stopOpacity=".18" />
              <stop offset="100%" stopColor="#5c9477" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((v) => (
            <line
              key={v}
              x1="0"
              x2={width}
              y1={pad + (v * (height - pad * 2)) / 4}
              y2={pad + (v * (height - pad * 2)) / 4}
              stroke="#e8ece8"
              strokeDasharray="3 5"
            />
          ))}
          <path d={fill} fill="url(#gf-flow-fill)" />
          <path
            d={path("expense_cents")}
            fill="none"
            stroke="#c5ad8c"
            strokeWidth="2.2"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          <path
            d={path("income_cents")}
            fill="none"
            stroke="#4d7b66"
            strokeWidth="2.8"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {rows.map((r, i) =>
            i === rows.length - 1 ? (
              <circle
                key={i}
                cx={point(r, i, "income_cents")[0]}
                cy={point(r, i, "income_cents")[1]}
                r="4"
                fill="#4d7b66"
                stroke="white"
                strokeWidth="2"
              />
            ) : null
          )}
        </svg>
        <div className="gf-chart-labels">
          {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
            <span key={i}>
              {dateLabel(
                rows[
                  Math.min(rows.length - 1, Math.round(v * (rows.length - 1)))
                ].day
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BusinessDonut({ businesses }) {
  const values = businesses.filter((b) => b.income_cents > 0);
  const total = values.reduce((s, b) => s + b.income_cents, 0);
  let offset = 0;
  return (
    <div className="gf-distribution">
      <div className="gf-donut">
        <svg viewBox="0 0 180 180">
          <circle
            cx="90"
            cy="90"
            r="68"
            fill="none"
            stroke="#edf0ec"
            strokeWidth="20"
          />
          {values.map((b) => {
            const length = (b.income_cents / total) * 427.2566;
            const part = (
              <circle
                key={b.id}
                cx="90"
                cy="90"
                r="68"
                fill="none"
                stroke={b.color}
                strokeWidth="20"
                strokeDasharray={`${Math.max(0, length - 5)} ${
                  427.2566 - length + 5
                }`}
                strokeDashoffset={-offset}
                transform="rotate(-90 90 90)"
              />
            );
            offset += length;
            return part;
          })}
        </svg>
        <div>
          <small>Cobros conciliados</small>
          <strong>{money(total)}</strong>
          <span>{values.length} negocios</span>
        </div>
      </div>
      <div className="gf-donut-legend">
        {businesses
          .filter((b) => b.id !== "personal")
          .map((b) => (
            <div key={b.id}>
              <span>
                <i style={{ background: b.color }} />
                {b.name}
              </span>
              <strong>
                {total ? Math.round((b.income_cents / total) * 100) : 0}%
              </strong>
            </div>
          ))}
      </div>
    </div>
  );
}
