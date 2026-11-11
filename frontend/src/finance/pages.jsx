import {
  AccountTiles,
  LiquidityPlan,
  CardPaymentsPreview,
} from "./account-summary.jsx";
import React, { useEffect, useMemo, useState, useRef } from "react";
import { TransferFees } from "./fees.jsx";
import {
  Activity,
  Camera,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudDownload,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  History,
  Landmark,
  Link2,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { CustodyFunds, GmailPanel, IncomingNotices } from "./operations.jsx";
import { SettlementFunds } from "./settlements.jsx";
import {
  amount,
  businessColors,
  businessNames,
  dateLabel,
  downloadEvidence,
  downloadReport,
  financeApi,
  kindNames,
  methodNames,
  money,
  statusNames,
  today,
} from "./api.js";
import {
  Badge,
  Brand,
  BusinessDonut,
  BusinessMark,
  Button,
  Empty,
  Field,
  FlowChart,
  IconButton,
  Modal,
  MovementTable,
  SectionHead,
  Stat,
} from "./components.jsx";
import { SecurityPanel } from "./security.jsx";
import { CollaboratorHome, QuickAccess } from "./quick.jsx";
import { BankLogo } from "./banks.jsx";
import { WorkSummary, AssistantAvatar, PushEnrollment } from "./workflows.jsx";
import {BankNotificationsPanel,BankNotificationsShortcut} from './bank-notifications.jsx';
import {OwnerHome} from './home-action-center.jsx';

export function Overview() {
  const { data, user, open, navigate, selectMovement, filters } = useFinance();
  const s = data.summary;
  if (user.work_view) return <WorkSummary />;
  if (user.role === "collector") return <CollaboratorHome />;
  if (user.role === "owner") return <OwnerHome/>;
  return (
    <>
      <div className="gf-welcome gf-owner-greeting">
        <div>
          <span className="gf-eyebrow">TU CENTRO FINANCIERO</span>
          <h1>
            Hola, {user.name.split(" ")[0]}
            <span>.</span>
          </h1>
        </div>
        <div className="gf-welcome-date">
          <CalendarDays size={17} />
          <span>
            {dateLabel(data.period.today, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
      <PushEnrollment />
      <BankNotificationsShortcut />
      <LiquidityPlan />
      {user.role !== "viewer" && <QuickAccess />}
      <IncomingNotices />
      <SettlementFunds />
      <div className="gf-stats">
        <Stat
          label={
            filters.business_id === "all"
              ? "Fondos sin corriente"
              : "Fondos atribuidos al negocio"
          }
          value={
            s.balances_visible
              ? money(
                  filters.business_id === "all" && data.liquidity
                    ? data.liquidity.cash_cents
                    : s.balance_cents,
                )
              : "Acceso limitado"
          }
          detail={
            filters.business_id === "all"
              ? "Corriente reservada aparte para cheques"
              : "Cuentas exclusivas y fondos identificados en compartidas"
          }
          icon={Wallet}
          tone="primary"
        />
        <Stat
          label="Cobros conciliados"
          value={money(s.income_cents)}
          detail={`${s.reconciled_count} movimientos conciliados en el período`}
          icon={ArrowDownLeft}
        />
        <Stat
          label="Gastos registrados"
          value={money(s.expense_cents)}
          detail="Aceptados en el período · incluye pendientes de pago"
          icon={ArrowUpRight}
        />
        <Stat
          label="Compromisos pendientes"
          value={money(s.pending_cents)}
          detail="Gastos por aprobar o pagar · todas las fechas"
          icon={Clock3}
        />
      </div>
      {s.balances_visible && s.unassigned_cents !== 0 && (
        <div className="gf-unassigned-note">
          <ArrowLeftRight size={16} />
          <span>
            {money(s.unassigned_cents)} en fondos compartidos tienen su
            propiedad pendiente de identificar.
          </span>
          <button onClick={() => navigate("cuentas")}>
            Organizar fondos <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="gf-overview-grid">
        <section className="gf-panel gf-flow-panel">
          <SectionHead
            title="El pulso de tu operación"
            description="Cobros conciliados y gastos registrados"
          >
            <span className="gf-period-chip">
              {dateLabel(data.period.from)} — {dateLabel(data.period.to)}
            </span>
          </SectionHead>
          <div className="gf-flow-summary">
            <strong className="gf-amount">{money(s.income_cents)}</strong>
            <span>
              <i className="gf-dot" />
              Cobros
            </span>
            <span>
              <i className="gf-dot sand" />
              Gastos
            </span>
          </div>
          <FlowChart daily={data.daily} period={data.period} />
        </section>
        <section className="gf-panel">
          <SectionHead
            title="De dónde viene"
            description="Distribución de cobros conciliados"
          />
          <BusinessDonut businesses={data.businesses} />
        </section>
      </div>
      <div className="gf-overview-lower">
        <section className="gf-panel">
          <SectionHead title="Movimientos recientes">
            <Button
              variant="ghost small"
              icon={ArrowRight}
              onClick={() => navigate("movimientos")}
            >
              Ver todos
            </Button>
          </SectionHead>
          <MovementTable
            compact
            rows={data.movements.slice(0, 5)}
            onSelect={selectMovement}
          />
        </section>
        <section className="gf-panel gf-attention">
          <div className="gf-attention-head">
            <span className="gf-soft-icon">
              <Bell size={19} />
            </span>
            <Badge status="pending">{s.pending_count} pendientes</Badge>
          </div>
          <h2>
            Tu atención hace
            <br />
            la diferencia.
          </h2>
          <p>Lo que necesita revisión, en un solo lugar.</p>
          {data.pending
            .filter((m) => ["pending", "reported"].includes(m.status))
            .slice(0, 3)
            .map((m) => (
              <button
                className="gf-attention-item"
                key={m.id}
                onClick={() => selectMovement(m)}
              >
                <BusinessMark id={m.business_id} size="small" />
                <span>
                  <strong>{m.counterparty}</strong>
                  <small>
                    {m.status === "reported"
                      ? "Contrastar acreditación"
                      : kindNames[m.kind]}{" "}
                    · {money(m.amount_cents)}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          {!s.pending_count && (
            <p className="gf-positive">No tienes movimientos por revisar.</p>
          )}
          <Button
            variant="secondary"
            onClick={() => navigate("pendientes")}
            icon={ArrowRight}
          >
            Abrir bandeja de revisión
          </Button>
        </section>
      </div>
      <section className="gf-account-preview">
        <SectionHead
          title="Tus cuentas, conectadas a tu control"
          description="Las cifras se calculan con saldos iniciales y movimientos importados."
        >
          <Button
            variant="ghost small"
            onClick={() => navigate("cuentas")}
            icon={ArrowRight}
          >
            Ver cuentas
          </Button>
        </SectionHead>
        <AccountTiles />
      </section>
      <div className="gf-data-footnote">
        <ShieldCheck size={15} />
        <span>
          {s.unverified_accounts
            ? s.unverified_accounts + " cuentas requieren comprobación."
            : "Consulta la fecha de comprobación de cada cuenta."}{" "}
          Los saldos calculados no equivalen a dinero libre para gastar.
        </span>
        <button onClick={() => navigate("conexiones")}>
          Estado de las fuentes <ArrowRight size={13} />
        </button>
      </div>
    </>
  );
}

export function Movements({ expenses = false }) {
  const { data, open, selectMovement, user } = useFinance();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [kind, setKind] = useState("all");
  const rows = data.movements.filter(
    (m) =>
      (!expenses || m.kind === "expense") &&
      (status === "all" || m.status === status) &&
      (kind === "all" || m.kind === kind) &&
      `${m.counterparty} ${m.reference} ${m.category} ${m.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <SectionHead
        eyebrow={
          expenses ? "PLANIFICA Y CONTROLA" : "EL DETALLE DE TU OPERACIÓN"
        }
        title={expenses ? "Gastos y compromisos" : "Movimientos"}
        description={
          expenses
            ? "Desde la solicitud hasta su pago comprobado."
            : "Cada registro, su contexto y la evidencia que lo respalda."
        }
      >
        {user.role !== "viewer" && (
          <Button
            icon={Plus}
            onClick={() => open(expenses ? "expense" : "movement")}
          >
            {expenses ? "Registrar gasto" : "Nuevo movimiento"}
          </Button>
        )}
      </SectionHead>
      {expenses && (
        <div className="gf-stats three">
          <Stat
            label="Gastos aceptados del período"
            value={money(data.summary.expense_cents)}
            detail="Incluye aprobados, históricos y conciliados"
            icon={ArrowUpRight}
          />
          <Stat
            label="Compromisos de todas las fechas"
            value={money(data.summary.pending_cents)}
            detail="Por aprobar o completar pago"
            icon={CalendarDays}
          />
          <Stat
            label="Plantillas recurrentes"
            value={String(data.recurring.length)}
            detail="Pendientes preparados para revisión"
            icon={RefreshCw}
          />
        </div>
      )}
      <section className="gf-panel">
        <div className="gf-toolbar">
          <div className="gf-search">
            <Search size={17} />
            <input
              aria-label="Buscar movimientos"
              placeholder="Buscar cliente, referencia o categoría…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="gf-inline">
            <select
              aria-label="Filtrar estado"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Todos los estados</option>
              {Object.entries(statusNames)
                .filter(([v]) =>
                  [
                    "pending",
                    "approved",
                    "reported",
                    "reconciled",
                    "rejected",
                  ].includes(v),
                )
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </select>
            {!expenses && (
              <select
                aria-label="Filtrar tipo"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">Todos los tipos</option>
                {Object.entries(kindNames).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <MovementTable rows={rows} onSelect={selectMovement} />
        <div className="gf-table-footer">
          <span>
            {rows.length} registros mostrados · {data.movements_total} en el
            período
          </span>
          <span>USD · America/Guayaquil</span>
        </div>
      </section>
      {expenses && <RecurringAndBudgets />}
    </>
  );
}

export function Review() {
  const { data, selectMovement } = useFinance();
  const [tab, setTab] = useState("all");
  const rows = data.pending.filter(
    (m) =>
      tab === "all" ||
      (tab === "income"
        ? m.kind === "income"
        : tab === "expense"
          ? m.kind === "expense"
          : m.status === "reported"),
  );
  return (
    <>
      <SectionHead
        eyebrow="ENFOQUE EN LO IMPORTANTE"
        title="Bandeja de revisión"
        description="Comprueba las evidencias y decide con el contexto completo."
      />
      <div className="gf-tabs">
        {[
          ["all", "Todo"],
          ["income", "Cobros"],
          ["expense", "Gastos"],
          ["reported", "Históricos por contrastar"],
        ].map(([v, l]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            onClick={() => setTab(v)}
          >
            {l}
            {v === "all" && <span>{data.pending.length}</span>}
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="gf-review-grid">
          {rows.map((m) => (
            <button
              className="gf-review-card"
              key={m.id}
              onClick={() => selectMovement(m)}
            >
              <div className="gf-between">
                <BusinessMark id={m.business_id} />
                <Badge status={m.status} />
              </div>
              <small>
                {businessNames[m.business_id]} · {dateLabel(m.day)}
              </small>
              <h3>{m.counterparty}</h3>
              <strong className="gf-amount">{money(m.amount_cents)}</strong>
              <p>{m.description || m.category}</p>
              <footer>
                <span>
                  {m.evidence_id ? (
                    <>
                      <FileCheck2 size={15} />
                      Comprobante adjunto
                    </>
                  ) : (
                    <>
                      <FileText size={15} />
                      Sin archivo adjunto
                    </>
                  )}
                </span>
                <ChevronRight size={17} />
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <section className="gf-panel">
          <Empty
            title="Sin pendientes en esta vista"
            description="Los nuevos comprobantes y solicitudes aparecerán aquí."
          />
        </section>
      )}
    </>
  );
}

export function Accounts() {
  const { data, user, open } = useFinance();
  const [kind, setKind] = useState("all");
  const accounts = data.accounts.filter(
    (a) =>
      kind === "all" ||
      (kind === "bank"
        ? ["bank", "wallet"].includes(a.kind)
        : kind === "cash"
          ? ["cash", "custody"].includes(a.kind)
          : a.kind === kind),
  );
  return (
    <div className="gf-account-page">
      {user.role === "owner" && <TransferFees />}
      <SettlementFunds />
      <SectionHead
        eyebrow="DÓNDE ESTÁ TU DINERO"
        title="Cuentas y fondos"
        description="Bancos, billeteras, efectivo y dinero bajo responsabilidad de terceros."
      >
        {user.role === "owner" && (
          <details className="gf-account-tools">
            <summary>
              Gestionar cuentas <ChevronRight size={14} />
            </summary>
            <div>
              <Button
                variant="secondary"
                icon={ArrowLeftRight}
                onClick={() => open("transfer")}
              >
                Trasladar fondos
              </Button>
              <Button
                variant="secondary"
                icon={Upload}
                onClick={() => open("bank")}
              >
                Importar movimientos
              </Button>
              <Button icon={Plus} onClick={() => open("account")}>
                Añadir cuenta
              </Button>
            </div>
          </details>
        )}
      </SectionHead>
      <LiquidityPlan />
      <CardPaymentsPreview />
      <AccountTiles custodyOnly />
      <div className="gf-stats three">
        <Stat
          label="Fondos sin corriente"
          value={
            data.summary.balances_visible
              ? money(data.liquidity?.cash_cents ?? data.summary.balance_cents)
              : "Acceso limitado"
          }
          detail="Corriente apartada para los cheques"
          icon={Landmark}
        />
        <Stat
          label="Efectivo y custodia"
          value={
            data.summary.balances_visible
              ? money(data.summary.custody_cents)
              : "Acceso limitado"
          }
          detail="Fondos registrados fuera de bancos"
          icon={Wallet}
        />
        <Stat
          label="Deuda calculada en tarjetas"
          value={
            data.summary.balances_visible
              ? money(data.summary.card_debt_cents)
              : "Acceso limitado"
          }
          detail="Se muestra separada de tus fondos"
          icon={CreditCard}
        />
      </div>
      <div className="gf-tabs">
        {[
          ["all", "Todas las cuentas"],
          ["bank", "Bancos y billeteras"],
          ["cash", "Efectivo y custodia"],
          ["card", "Tarjetas"],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={kind === v ? "active" : ""}
          >
            {l}
          </button>
        ))}
      </div>
      {accounts.length ? (
        <div className="gf-accounts-grid">
          {accounts.map((a) => (
            <article className="gf-account-card" key={a.id}>
              <div className="gf-between">
                <span className="gf-bank-wordmark">
                  <BankLogo bank={a.bank} kind={a.kind} />
                  <span>{a.bank}</span>
                </span>
                <span className="gf-account-owner">
                  {a.business_id ? businessNames[a.business_id] : "Compartida"}
                </span>
              </div>
              <p
                className="gf-account-subtitle"
                title={`${a.name}${a.last_four ? ` · ${a.last_four}` : ""}`}
              >
                <span>{a.name}</span>
                <small className="gf-account-number">
                  {a.provider_auto_receipts
                    ? "Automático · ProTickets"
                    : a.manual_provider
                    ? `Saldo manual · ${dateLabel(a.balance_as_of)}`
                    : a.account_number ||
                      (a.grouped
                        ? `${a.account_count} cuentas agrupadas`
                        : a.last_four
                          ? `··${a.last_four} · por completar`
                          : "Número por completar")}
                </small>
              </p>
              <strong className="gf-account-balance">
                {money(a.balance_cents)}
              </strong>
              <small>
                {a.provider_auto_receipts
                  ? "Saldo calculado · cobros menos comisión PayPhone"
                  : a.manual_provider
                  ? "Informado por Marlon · conexión pendiente"
                  : a.kind === "card"
                    ? "Saldo calculado · deuda si es negativo"
                    : "Saldo calculado al día de hoy"}
              </small>
              <div
                className={`gf-account-compact-status ${
                  a.verified_at && a.discrepancy_cents === 0 ? "verified" : ""
                }`}
              >
                {a.verified_at && a.discrepancy_cents === 0 ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <Clock3 size={13} />
                )}
                {a.provider_auto_receipts
                  ? a.provider_calculation.review_count
                    ? `${a.provider_calculation.review_count} cobros requieren revisión`
                    : "Se actualiza cada minuto"
                  : a.manual_provider
                  ? "Actualización manual"
                  : a.discrepancy_cents !== null && a.discrepancy_cents !== 0
                    ? `Diferencia: ${money(a.discrepancy_cents)}`
                    : a.verified_at && a.discrepancy_cents === 0
                      ? "Saldo comprobado"
                      : "Por comprobar"}
              </div>
              <details className="gf-account-more">
                <summary>
                  Ver detalles <ChevronRight size={12} />
                </summary>
                <div>
                  <div className="gf-account-status">
                    <small>
                      Cuenta: {a.name}
                      {a.last_four ? ` · terminada en ${a.last_four}` : ""}
                    </small>
                    <small>
                      Negocio:{" "}
                      {a.business_id
                        ? businessNames[a.business_id]
                        : "Cuenta compartida"}
                    </small>
                    <span
                      className={
                        a.verified_at && a.discrepancy_cents === 0
                          ? "verified"
                          : "unverified"
                      }
                    >
                      {a.verified_at && a.discrepancy_cents === 0 ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <Clock3 size={15} />
                      )}{" "}
                      {a.verified_at
                        ? `Comparado al ${dateLabel(a.verified_at)}`
                        : "Saldo pendiente de comprobar"}
                    </span>
                    {a.discrepancy_cents !== null &&
                      a.discrepancy_cents !== 0 && (
                        <span className="gf-negative">
                          Diferencia: {money(a.discrepancy_cents)}
                        </span>
                      )}
                    {a.custodian && <small>Responsable: {a.custodian}</small>}
                    {a.provider_fee_policy && (
                      <small>{a.provider_fee_policy}</small>
                    )}
                    {a.provider_auto_receipts && a.provider_calculation.receipts.length > 0 && (
                      <div className="gf-ticketing-receipts">
                        <strong>Cobros desde el saldo inicial</strong>
                        <dl>
                          <div><dt>Total cobrado</dt><dd>{money(a.provider_calculation.gross_cents)}</dd></div>
                          <div><dt>Comisión PayPhone calculada</dt><dd>−{money(a.provider_calculation.fee_cents)}</dd></div>
                          <div><dt>Aumento neto</dt><dd>{money(a.provider_calculation.net_cents)}</dd></div>
                        </dl>
                        <small>La comisión usa la tarifa guardada al vender. No se descuenta tu parte de ProTickets.</small>
                        {a.provider_calculation.receipts.map((r) => (
                          <p key={r.document_number}>{r.document_number} · {r.state === "attention" ? "Requiere revisión · dinero reservado" : `${money(r.gross_cents)} − ${money(r.fee_cents)} = ${money(r.net_cents)}`}</p>
                        ))}
                      </div>
                    )}
                    {!a.business_id && (
                      <div className="gf-account-positions">
                        {Object.entries(a.positions || {}).map(
                          ([id, value]) => (
                            <div key={id}>
                              <span>{businessNames[id]}</span>
                              <strong>{money(value)}</strong>
                            </div>
                          ),
                        )}
                        <div>
                          <span>
                            {a.personal_details_private
                              ? "Detalles personales"
                              : "Propiedad sin identificar"}
                          </span>
                          <strong>
                            {a.personal_details_private
                              ? "Privados"
                              : money(a.unassigned_cents)}
                          </strong>
                        </div>
                        {user.role === "owner" && (
                          <Button
                            variant="ghost small"
                            onClick={() => open("allocation", a)}
                          >
                            Asignar saldo inicial
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {user.role === "owner" && (
                    <Button
                      variant="secondary"
                      onClick={() => open("account-number", { id: a.id })}
                    >
                      {a.account_number
                        ? "Editar número de cuenta"
                        : "Completar número de cuenta"}
                    </Button>
                  )}
                  {user.role === "owner" && (
                    <footer>
                      <Button
                        variant="ghost small"
                        onClick={() => open("verify", a)}
                      >
                        Actualizar saldo real
                      </Button>
                      <span>{a.transaction_count} movimientos</span>
                    </footer>
                  )}
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <section className="gf-panel">
          <Empty
            title="Cuentas por configurar"
            description="Añade tus cuentas con un saldo inicial comprobado. Las cuentas compartidas solo las ve el propietario."
          />
        </section>
      )}
      <div className="gf-note gf-mt">
        <ShieldCheck size={17} />
        Registrar o comparar un saldo no conecta automáticamente el banco.
        Consulta las fuentes activas y sus fechas de actualización.
      </div>
    </div>
  );
}

export function MovementDetail({ movement, onClose }) {
  const { data, user, notify, refresh, open } = useFinance();
  const m =
    data.movements.find((x) => x.id === movement.id) ||
    data.pending.find((x) => x.id === movement.id) ||
    movement;
  const [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [value, setValue] = useState(
      ((m.amount_cents - m.allocated_cents) / 100).toFixed(2),
    ),
    [allocations, setAllocations] = useState([]);
  useEffect(() => {
    if (user.role === "owner")
      financeApi(`/allocations/${m.id}`)
        .then((r) => setAllocations(r.allocations))
        .catch(() => {});
  }, [m.id, data.generated_at]);
  const candidates = data.bank_transactions
    .filter(
      (b) =>
        data.accounts.some(
          (a) =>
            a.id === b.account_id &&
            (!a.business_id || a.business_id === m.business_id || m.cross_account),
        ) && !allocations.some((a) => a.bank_transaction_id === b.id),
    )
    .filter(
      (b) =>
        Math.abs(b.amount_cents) > b.allocated_cents &&
        Math.sign(b.amount_cents) ===
          (m.kind === "income" || m.transfer_side === "incoming" ? 1 : -1) &&
        (!m.account_id || m.account_id === b.account_id),
    )
    .filter(b=>!(m.kind==='income'&&m.evidence_id)||(m.account_id&&b.account_id===m.account_id&&Math.abs(b.amount_cents)-b.allocated_cents===m.amount_cents-m.allocated_cents&&Math.abs(Date.parse(b.day+'T12:00:00Z')-Date.parse(m.day+'T12:00:00Z'))<=86400000))
    .sort(
      (a, b) =>
        Number(b.reference === m.reference) -
          Number(a.reference === m.reference) ||
        Math.abs(Math.abs(a.amount_cents) - m.amount_cents) -
          Math.abs(Math.abs(b.amount_cents) - m.amount_cents),
    );
  const candidateKey=candidates.map(b=>b.id).join(',');
  useEffect(()=>{
    if(m.kind==='income'&&m.evidence_id&&candidates.length===1){setSelected(String(candidates[0].id));setValue(((m.amount_cents-m.allocated_cents)/100).toFixed(2));}
    else if(selected&&!candidates.some(b=>String(b.id)===selected))setSelected('');
  },[m.id,candidateKey]);
  async function action(path, body, method) {
    setBusy(true);
    setError("");
    try {
      await financeApi(path, body, method);
      await refresh();
      notify("Revisión guardada");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const canReview =
    ["owner", "manager"].includes(user.role) &&
    ["pending", "reported", "approved"].includes(m.status) &&
    m.allocated_cents === 0;
  return (
    <Modal
      title={m.counterparty}
      subtitle={`${kindNames[m.kind]} · ${businessNames[m.business_id]} · #${
        m.id
      }`}
      onClose={onClose}
      wide
    >
      <div className="gf-detail">
        <div className="gf-detail-top">
          <strong className="gf-amount">{money(m.amount_cents)}</strong>
          <Badge status={m.status} />
        </div>
        <div className="gf-detail-grid">
          {[
            [
              "Fecha",
              dateLabel(m.day, {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
            ],
            ["Categoría", m.category],
            ["Medio", methodNames[m.payment_method]],
            ["Referencia", m.reference || "Por identificar"],
            ["Registrado por", m.created_by],
            [
              "Vencimiento",
              m.due_date ? dateLabel(m.due_date) : "Sin vencimiento",
            ],
            [
              "Unidad",
              data.units.find((u) => u.id === m.unit_id)?.name || "General",
            ],
            ["Origen", m.source_system || "Registro directo"],
          ].map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        {m.description && (
          <p className="gf-detail-description">{m.description}</p>
        )}
        {m.evidence_id ? (
          <Button
            variant="secondary"
            icon={Download}
            onClick={() =>
              downloadEvidence(m.evidence_id, m.evidence_name).catch((e) =>
                setError(e.message),
              )
            }
          >
            Descargar comprobante
          </Button>
        ) : (
          <div className="gf-note">
            Este registro no tiene un comprobante adjunto.
          </div>
        )}
        {user.role === "owner" &&
          ["cash", "custody"].includes(
            data.accounts.find((a) => a.id === m.account_id)?.kind,
          ) &&
          !["reconciled", "rejected"].includes(m.status) && (
            <section className="gf-detail-section">
              <h3>Confirmar movimiento físico</h3>
              <p>
                Registra quién entregó o recibió el efectivo. Esta confirmación
                actualiza el saldo registrado de caja o custodia.
              </p>
              <Field label="Responsable y detalle de la entrega">
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <Button
                disabled={busy || !note.trim()}
                onClick={() =>
                  action("/cash/confirm", { movement_id: m.id, note })
                }
                icon={Check}
              >
                Confirmar entrega / recepción
              </Button>
            </section>
          )}
        {m.allocated_cents > 0 && (
          <div className="gf-note success">
            <CheckCheck size={18} />
            {money(m.allocated_cents)} asociados a movimientos bancarios.
            Pendiente: {money(m.amount_cents - m.allocated_cents)}.
          </div>
        )}
        {canReview && (
          <section className="gf-detail-section">
            <h3>Revisión del movimiento</h3>
            <Field label="Observación" hint="Obligatoria para rechazar.">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Resultado de la revisión o motivo del rechazo"
              />
            </Field>
            <div className="gf-inline">
              <Button
                loading={busy}
                icon={Check}
                onClick={() =>
                  action(`/movements/${m.id}/review`, {
                    status: "approved",
                    note,
                  })
                }
              >
                {m.kind==='income'&&m.evidence_id?'Confirmar depósito':'Aprobar registro'}
              </Button>
              {user.role==='owner'&&m.kind==='income'&&m.evidence_id&&<Button variant="secondary" disabled={busy} onClick={()=>action(`/receipts/${m.id}/confirm`,{already_in_balance:true})}>Ya está contemplado</Button>}
              <Button
                variant="danger"
                disabled={busy || !note.trim()}
                onClick={() =>
                  action(`/movements/${m.id}/review`, {
                    status: "rejected",
                    note,
                  })
                }
              >
                Rechazar
              </Button>
            </div>
            <small className="gf-muted">
              {m.kind==='income'&&m.evidence_id?'Confirmar registra el depósito si todavía no está en la cuenta. «Ya está contemplado» conserva el saldo actual.':'Aprobar una solicitud no ejecuta un pago ni confirma acreditación bancaria.'}
            </small>
          </section>
        )}
        {user.role === "owner" &&
          m.status !== "rejected" &&
          m.status !== "reconciled" && (
            <section className="gf-detail-section">
              <h3>Asociar un movimiento de cuenta</h3>
              <p>
                Compara cuenta, fecha, referencia y monto. Las coincidencias
                propuestas requieren tu revisión.
              </p>
              {candidates.length ? (
                <>
                  <div className="gf-match-list">
                    {candidates.slice(0, 12).map((b) => (
                      <label
                        key={b.id}
                        className={selected === String(b.id) ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name="bank-match"
                          value={b.id}
                          checked={selected === String(b.id)}
                          onChange={(e) => {
                            setSelected(e.target.value);
                            setValue(
                              (
                                Math.min(
                                  Math.abs(b.amount_cents) - b.allocated_cents,
                                  m.amount_cents - m.allocated_cents,
                                ) / 100
                              ).toFixed(2),
                            );
                          }}
                        />
                        <span>
                          <strong>{b.account_name}</strong>
                          <small>
                            {dateLabel(b.day)} · {b.reference || b.description}
                          </small>
                        </span>
                        <strong>
                          {money(Math.abs(b.amount_cents) - b.allocated_cents)}
                        </strong>
                      </label>
                    ))}
                  </div>
                  <div className="gf-form-grid">
                    <Field
                      label="Monto a asignar (USD)"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                    <div className="gf-align-end">
                      <Button
                        disabled={!selected || busy}
                        onClick={() =>
                          action("/reconcile", {
                            movement_id: m.id,
                            bank_transaction_id: Number(selected),
                            amount_cents: amount(value),
                          })
                        }
                        icon={Link2}
                      >
                        Confirmar asociación
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="gf-note">
                  {m.kind==='income'&&m.evidence_id?(m.account_id?'La cuenta receptora está identificada. Aún no hay un abono bancario disponible que coincida en cuenta, monto y fecha. Se relacionará al recibir evidencia bancaria coincidente.':'Falta identificar la cuenta receptora del comprobante para buscar su abono.'): 'No hay movimientos bancarios disponibles de la dirección y cuenta correspondientes. Importa el archivo del banco desde Cuentas.'}
                </div>
              )}
            </section>
          )}
        {allocations.length > 0 && (
          <section className="gf-detail-section">
            <h3>Asociaciones registradas</h3>
            {allocations.map((a) => (
              <div className="gf-allocation" key={a.id}>
                <span>
                  {a.reference || `Movimiento #${a.bank_transaction_id}`} ·{" "}
                  {money(a.amount_cents)}
                </span>
                <button
                  onClick={() => {
                    if (note.trim())
                      action(
                        `/allocations/${a.id}`,
                        { reason: note },
                        "DELETE",
                      );
                    else
                      setError(
                        "Escribe el motivo de la corrección antes de revertir.",
                      );
                  }}
                >
                  Revertir asociación
                </button>
              </div>
            ))}
            <Field label="Motivo de corrección">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </Field>
          </section>
        )}
        {m.reviewed_by && (
          <small className="gf-muted">
            Revisado por {m.reviewed_by}
            {m.review_note ? ` · ${m.review_note}` : ""}
          </small>
        )}
        {error && (
          <div className="gf-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function Sales() {
  const { data } = useFinance();
  const [query, setQuery] = useState("");
  const rows = data.sales.filter((s) =>
    `${s.document_number} ${data.units.find((u) => u.id === s.unit_id)?.name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const totals = {};
  for (const sale of rows.filter((s) => s.state === "active"))
    for (const p of sale.payments)
      totals[p.method] =
        (totals[p.method] || 0) + p.amount_cents - (p.refunded_cents || 0);
  return (
    <>
      <SectionHead
        eyebrow="VENTAS DESDE SU ORIGEN"
        title="Ventas y recaudación"
        description="Información de los sistemas de venta, separada de su acreditación bancaria."
      />
      <div className="gf-stats three">
        <Stat
          label="Ventas vigentes netas de devoluciones"
          value={money(data.summary.sales_cents)}
          detail="Según fuentes disponibles del período"
          icon={TrendingUp}
        />
        <Stat
          label="Ventas registradas"
          value={String(data.sales_total)}
          detail="Incluye pendientes y anuladas"
          icon={FileText}
        />
        <Stat
          label="Cobros declarados en efectivo"
          value={money(totals.cash || 0)}
          detail="Requieren cierre y seguimiento del depósito"
          icon={Wallet}
        />
      </div>
      <div className="gf-payment-strip">
        {Object.entries(methodNames).map(([id, name]) => (
          <div key={id}>
            <span>{name}</span>
            <strong className="gf-amount">{money(totals[id] || 0)}</strong>
          </div>
        ))}
      </div>
      <section className="gf-panel">
        <div className="gf-toolbar">
          <div className="gf-search">
            <Search size={17} />
            <input
              aria-label="Buscar ventas"
              placeholder="Buscar documento o local…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="gf-muted">{rows.length} ventas mostradas</span>
        </div>
        {rows.length ? (
          <div className="gf-table-scroll">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Local / evento</th>
                  <th>Fecha</th>
                  <th>Medios de cobro</th>
                  <th>Estado</th>
                  <th className="gf-right">Total neto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.document_number || s.external_id}</strong>
                      <small className="gf-block gf-muted">
                        {s.source_system}
                      </small>
                    </td>
                    <td>
                      {data.units.find((u) => u.id === s.unit_id)?.name ||
                        businessNames[s.business_id]}
                    </td>
                    <td>{dateLabel(s.day)}</td>
                    <td>
                      {s.payments.map((p, i) => (
                        <small className="gf-block" key={i}>
                          {methodNames[p.method]} ·{" "}
                          {money(p.amount_cents - (p.refunded_cents || 0))}
                        </small>
                      ))}
                    </td>
                    <td>
                      <Badge status={s.state} />
                    </td>
                    <td className="gf-right gf-amount">
                      {money(s.total_cents - s.refunded_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Ventas listas para conectarse"
            description="AlfaBusiness necesita habilitar todas las ventas. ProTickets se incorpora desde las fuentes internas."
          />
        )}
      </section>
      <div className="gf-note gf-mt">
        Los pedidos de Producalza conservan su gestión en Promoters. Sus abonos
        se consultan en Movimientos; un pedido no se convierte automáticamente
        en ingreso bancario.
      </div>
    </>
  );
}

export function Closings() {
  const { data, user, open, run } = useFinance();
  const [reason, setReason] = useState("");
  return (
    <>
      <SectionHead
        eyebrow="EL EFECTIVO TAMBIÉN CUENTA"
        title="Cierres de caja"
        description="Lo esperado, lo contado y las diferencias de cada local."
      >
        {user.role !== "viewer" && (
          <Button icon={Plus} onClick={() => open("closing")}>
            Nuevo cierre
          </Button>
        )}
      </SectionHead>
      <div className="gf-closing-guide">
        <span>
          01 <strong>Ventas registradas</strong>
        </span>
        <ArrowRight size={18} />
        <span>
          02 <strong>Gastos y entregas</strong>
        </span>
        <ArrowRight size={18} />
        <span>
          03 <strong>Efectivo contado</strong>
        </span>
        <ArrowRight size={18} />
        <span>
          04 <strong>Revisión de diferencias</strong>
        </span>
      </div>
      <section className="gf-panel">
        {data.closings.length ? (
          <div className="gf-table-scroll">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Fecha</th>
                  <th>Esperado</th>
                  <th>Contado</th>
                  <th>Diferencia</th>
                  <th>Responsable</th>
                  {user.role === "owner" && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {data.closings.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.unit_name}</strong>
                    </td>
                    <td>{dateLabel(c.day)}</td>
                    <td className="gf-amount">{money(c.expected_cents)}</td>
                    <td className="gf-amount">{money(c.counted_cents)}</td>
                    <td>
                      <Badge
                        status={
                          c.difference_cents === 0 ? "reconciled" : "pending"
                        }
                      >
                        {money(c.difference_cents)}
                      </Badge>
                    </td>
                    <td>
                      {c.created_by}
                      {c.needs_review === 1 && (
                        <Badge status="pending">
                          Ventas actualizadas · revisar cierre
                        </Badge>
                      )}
                    </td>
                    {user.role === "owner" && (
                      <td>
                        <Button
                          variant="ghost small"
                          disabled={!reason.trim()}
                          onClick={() =>
                            run(
                              `/closings/${c.id}/reopen`,
                              { reason },
                              "Cierre reabierto con historial",
                            )
                          }
                        >
                          Reabrir
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Cada cierre deja todo claro"
            description="Crea el primer cierre cuando estén cargadas las ventas y revisados los gastos de efectivo."
          />
        )}
      </section>
      {user.role === "owner" && data.closings.length > 0 && (
        <div className="gf-panel gf-mt">
          <Field
            label="Motivo para reabrir un cierre"
            hint="Se guardará en el historial. Después podrás generar un cierre corregido."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
      <div className="gf-note gf-mt">
        Una integración incompleta produce un efectivo esperado incompleto.
        Verifica cobertura de ventas, gastos y entregas antes de cerrar el día.
      </div>
    </>
  );
}

export function RecurringAndBudgets() {
  const { data, user, open, run, filters } = useFinance();
  const manager = ["owner", "manager"].includes(user.role);
  return (
    <div className="gf-two-columns gf-mt">
      <section className="gf-panel">
        <SectionHead
          title="Gastos que se repiten"
          description="Plantillas para preparar cada mes."
        >
          {manager && (
            <IconButton
              icon={Plus}
              label="Nuevo gasto recurrente"
              onClick={() => open("recurring")}
            />
          )}
        </SectionHead>
        {data.recurring.map((r) => (
          <div className="gf-recurring-row" key={r.id}>
            <span className="gf-soft-icon">
              <RefreshCw size={17} />
            </span>
            <div>
              <strong>{r.name}</strong>
              <small>
                {businessNames[r.business_id]} · vence el día {r.due_day}
              </small>
            </div>
            <strong className="gf-amount">{money(r.amount_cents)}</strong>
          </div>
        ))}
        {!data.recurring.length && (
          <p className="gf-muted">
            Configura arriendos, servicios y otros compromisos habituales.
          </p>
        )}
        {manager && (
          <Button
            variant="secondary"
            icon={CalendarDays}
            onClick={() =>
              run(
                "/recurring/generate",
                { month: filters.from.slice(0, 7) },
                "Pendientes mensuales preparados sin duplicados",
              )
            }
          >
            Preparar pendientes de{" "}
            {dateLabel(`${filters.from.slice(0, 7)}-01`, { month: "long" })}
          </Button>
        )}
      </section>
      <section className="gf-panel">
        <SectionHead
          title="Presupuesto del mes"
          description="Referencia frente a gastos aceptados."
        >
          {manager && (
            <IconButton
              icon={Plus}
              label="Definir presupuesto"
              onClick={() => open("budget")}
            />
          )}
        </SectionHead>
        {data.budgets.map((b) => {
          const spent = b.actual_cents || 0;
          const pct = Math.round((spent / b.amount_cents) * 100);
          return (
            <div className="gf-budget-row" key={b.id}>
              <div>
                <strong>{b.category}</strong>
                <span>{pct}%</span>
              </div>
              <div className={`gf-progress ${pct > 100 ? "over" : ""}`}>
                <span style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <small>
                {businessNames[b.business_id]} · {money(spent)} de{" "}
                {money(b.amount_cents)}
              </small>
            </div>
          );
        })}
        {!data.budgets.length && (
          <p className="gf-muted">
            Define límites por negocio y categoría para ver tu avance.
          </p>
        )}
        <small className="gf-muted">
          Gastos aceptados del mes completo, según los registros disponibles.
        </small>
      </section>
    </div>
  );
}

export function Reports() {
  const { data, filters, notify } = useFinance();
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadReport(filters);
      notify("Reporte descargado");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="INFORMACIÓN PARA DECIDIR"
        title="Reportes"
        description="Cifras con período, alcance y respaldo verificable."
      >
        <Button
          variant="secondary"
          icon={FileText}
          onClick={() => window.print()}
        >
          Imprimir / guardar PDF
        </Button>
        <Button icon={Download} loading={exporting} onClick={exportCsv}>
          Exportar movimientos
        </Button>
      </SectionHead>
      <section className="gf-report-document gf-panel">
        <div className="gf-report-heading">
          <Brand />
          <div>
            <span>REPORTE FINANCIERO</span>
            <strong>
              {dateLabel(data.period.from, { day: "numeric", month: "long" })} —{" "}
              {dateLabel(data.period.to, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </strong>
            <small>
              USD · America/Guayaquil
              {data.capabilities.demo ? " · DEMOSTRACIÓN" : ""}
            </small>
          </div>
        </div>
        <h2>Una mirada a tus negocios.</h2>
        <SettlementFunds editable={false} />
        <p className="gf-muted">
          Cobros conciliados y gastos aceptados según las fuentes disponibles.
        </p>
        <div className="gf-stats three">
          <Stat
            label="Fondos en bancos y billeteras · hoy"
            value={
              data.summary.balances_visible
                ? money(data.summary.balance_cents)
                : "Acceso limitado"
            }
            detail="Saldo calculado, pendiente de comprobación donde se indique"
          />
          <Stat
            label="Efectivo y fondos en custodia · hoy"
            value={
              data.summary.balances_visible
                ? money(data.summary.custody_cents)
                : "Acceso limitado"
            }
            detail="Saldo según registros de cuentas de efectivo y responsables"
          />
          <Stat
            label="Compromisos pendientes · todas las fechas"
            value={money(data.summary.pending_cents)}
            detail="Solicitudes y gastos aún no conciliados por completo"
          />
        </div>
        <div className="gf-table-scroll">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Negocio</th>
                <th className="gf-right">Fondos atribuidos · hoy</th>
                <th className="gf-right">Ventas netas registradas</th>
                <th className="gf-right">Cobros conciliados</th>
                <th className="gf-right">Gastos aceptados</th>
                <th className="gf-right">Por revisar</th>
              </tr>
            </thead>
            <tbody>
              {data.businesses.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="gf-business-inline">
                      <BusinessMark id={b.id} size="small" />
                      <strong>{b.name}</strong>
                    </span>
                  </td>
                  <td className="gf-right gf-amount">{money(b.funds_cents)}</td>
                  <td className="gf-right gf-amount">{money(b.sales_cents)}</td>
                  <td className="gf-right gf-amount">
                    {money(b.income_cents)}
                  </td>
                  <td className="gf-right gf-amount">
                    {money(b.expense_cents)}
                  </td>
                  <td className="gf-right">{b.pending_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Comprobación de cuentas</h3>
        <div className="gf-table-scroll">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Entidad / cuenta</th>
                <th className="gf-right">Saldo calculado · hoy</th>
                <th>Última comparación</th>
                <th className="gf-right">Diferencia en esa fecha</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.bank} · {a.name}
                  </td>
                  <td className="gf-right gf-amount">
                    {money(a.balance_cents)}
                  </td>
                  <td>
                    {a.verified_at ? dateLabel(a.verified_at) : "Pendiente"}
                  </td>
                  <td className="gf-right">
                    {a.discrepancy_cents === null
                      ? "Sin comprobar"
                      : money(a.discrepancy_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gf-report-notes">
          <ShieldCheck size={20} />
          <div>
            <strong>Alcance del reporte</strong>
            <p>
              Fondos de propiedad pendiente en cuentas compartidas:{" "}
              {money(data.summary.unassigned_cents)}. Se muestran separados de
              los fondos atribuidos a los negocios.
            </p>
            <p>
              Las cuentas compartidas pueden contener fondos de varios negocios.
              Los cobros y las ventas se presentan por separado y no se suman
              entre sí. Los gastos aceptados pueden estar pendientes de pago.
              Este reporte no representa utilidad contable ni disponibilidad
              libre. Revisa fuentes incompletas y saldos sin comprobar antes de
              decidir.
            </p>
            <small>
              Generado:{" "}
              {new Date(data.generated_at).toLocaleString("es-EC", {
                timeZone: "America/Guayaquil",
              })}{" "}
              · {data.movements_total} movimientos en el período.
            </small>
          </div>
        </div>
      </section>
    </>
  );
}

export function Assistant() {
  const { data, filters, selectMovement, open } = useFinance();
  const photoPicker=useRef(null);
  const [messages, setMessages] = useState([]),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const suggestions = [
    "¿Qué gastos tengo pendientes de pago?",
    "Dame un resumen de cada negocio.",
    "¿Qué cuentas necesitan comprobar su saldo?",
    "¿Qué movimientos debo revisar primero?",
  ];
  async function send(value = question) {
    if (!value.trim() || busy) return;
    setQuestion("");
    setError("");
    setMessages((m) => [...m, { role: "user", text: value }]);
    setBusy(true);
    try {
      const response = await financeApi("/assistant", {
        question: value,
        filters,
        history: messages
          .slice(-8)
          .map((m) => ({ role: m.role, text: m.text, topic: m.topic })),
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: response.answer,
          ids: response.movement_ids,
          mode: response.mode,
          topic: response.topic,
          references: response.references,
        },
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    document
      .getElementById("gf-chat-bottom")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  return (
    <>
      <SectionHead
        eyebrow="TU INFORMACIÓN, EN CONVERSACIÓN"
        title="Asistente financiero"
        description="Consulta tus registros y abre los movimientos que respaldan las respuestas."
      >
        <Badge status={data.capabilities.ai ? "approved" : "reported"}>
          {data.capabilities.ai
            ? "IA configurada"
            : "Resumen de datos disponible"}
        </Badge>
      </SectionHead>
      <div className="gf-assistant-layout">
        <section className="gf-chat-panel">
          {!messages.length ? (
            <div className="gf-chat-welcome">
              <span className="gf-ai-orb">
                <AssistantAvatar size={112} />
              </span>
              <span className="gf-eyebrow">MÁS CLARIDAD. MENOS BÚSQUEDAS.</span>
              <h2>Hablemos de tus finanzas.</h2>
              <p>
                Desde una pregunta puntual hasta una visión de tus negocios,
                empieza por lo que necesitas saber.
              </p>
              <div className="gf-suggestions">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="gf-chat-messages">
              {messages.map((m, i) => (
                <article key={i} className={`gf-chat-message ${m.role}`}>
                  <span className="gf-chat-avatar">
                    {m.role === "assistant" ? (
                      <AssistantAvatar size={36} />
                    ) : (
                      <Users size={16} />
                    )}
                  </span>
                  <div>
                    <small>
                      {m.role === "assistant"
                        ? m.mode === "ai"
                          ? "Asistente Gema"
                          : "Resumen calculado de datos"
                        : "Tú"}
                    </small>
                    <p>{m.text}</p>
                    {m.references?.length > 0 && (
                      <div className="gf-chat-sources">
                        {m.references.map((r) => (
                          <span key={`${r.kind}:${r.id}`}>
                            <FileText size={13} /> {r.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.ids?.length > 0 && (
                      <div className="gf-chat-sources">
                        {m.ids.map((id) => {
                          const movement = data.movements.find(
                            (x) => x.id === id,
                          );
                          return (
                            movement && (
                              <button
                                key={id}
                                onClick={() => selectMovement(movement)}
                              >
                                <FileText size={13} />
                                Movimiento #{id}
                              </button>
                            )
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="gf-chat-thinking">
                  <Loader2 size={17} className="gf-spin" />
                  Consultando los registros autorizados…
                </div>
              )}
              <div id="gf-chat-bottom" />
            </div>
          )}
          {error && <div className="gf-error">{error}</div>}
          <div className="gf-assistant-photo-action"><input type="file" accept="image/jpeg,image/png,image/webp" hidden ref={photoPicker} aria-label="Foto para registrar con Gema" onChange={e=>{const photo=e.target.files?.[0];if(photo){open("quick",{photo,text:question.trim()||"Ayúdame a actualizar los fondos o registrar la operación de esta foto."});setQuestion("");}e.target.value="";}}/><Button variant="secondary" icon={Camera} onClick={()=>photoPicker.current?.click()} disabled={busy}>Foto · registrar o actualizar fondos</Button></div>
          <form
            className="gf-chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              aria-label="Pregunta al asistente"
              placeholder="Pregunta sobre tus negocios…"
              rows={2}
              maxLength={1500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="submit"
              aria-label="Enviar consulta"
              disabled={!question.trim() || busy}
            >
              {busy ? (
                <Loader2 size={19} className="gf-spin" />
              ) : (
                <ArrowUpRight size={21} />
              )}
            </button>
          </form>
          <small className="gf-chat-disclaimer">
            Período: {dateLabel(filters.from)} — {dateLabel(filters.to)}. Las
            respuestas respetan tus permisos. Verifica el respaldo antes de
            decidir.
          </small>
        </section>
        <aside className="gf-assistant-aside">
          <div className="gf-panel">
            <span className="gf-soft-icon">
              <ShieldCheck size={21} />
            </span>
            <h3>
              Con tus datos.
              <br />
              Con contexto.
            </h3>
            <p>
              El asistente consulta registros autorizados y distingue cobros,
              ventas, gastos y saldos.
            </p>
            <div className="gf-aside-line">
              <Check size={15} />
              Fuentes identificadas
            </div>
            <div className="gf-aside-line">
              <Check size={15} />
              Período visible
            </div>
            <div className="gf-aside-line">
              <Check size={15} />
              Sin ejecución de pagos
            </div>
          </div>
          {!data.capabilities.ai && (
            <div className="gf-note">
              La IA conversacional y lectura de archivos requieren configurar el
              proveedor en el servidor. Mientras tanto, el asistente ofrece un
              resumen calculado de los registros.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

export function Integrations() {
  const { data, user, run } = useFinance();
  const icons = {
    internal: Building2,
    protickets: CreditCard,
    alfabusiness: Building2,
    payphone: CreditCard,
    bank: Landmark,
    email: MessageSquare,
  };
  const names = {
    internal: "Promoters y ProTickets",
    protickets: "PayPhone y transferencias · ProTickets",
    alfabusiness: "AlfaBusiness",
    payphone: "Liquidaciones Payphone",
    bank: "Movimientos bancarios",
    email: "Avisos por correo",
  };
  const descriptions = {
    internal: "Pedidos y abonos de Producalza; ventas y pagos de la ticketera.",
    protickets: "Cobros de entradas confirmados en ProTickets, separados por evento y forma de pago.",
    alfabusiness:
      "Todas las ventas de los locales, con cobros, cambios y devoluciones.",
    payphone:
      "Contrastar cobros aprobados con comisiones y liquidaciones reales.",
    bank: "Importación CSV y asociación con comprobantes y gastos.",
    email: "Lectura automática de avisos bancarios con permisos específicos.",
  };
  const sources = [
    {
      source: "internal",
      state: "pending",
      detail: "Disponible mediante sincronización interna.",
    },
    ...data.integrations.filter((i) => i.source !== "internal"),
  ];
  const internal = data.integrations.find((i) => i.source === "internal");
  if (internal) sources[0] = internal;
  return (
    <>
      <SectionHead
        eyebrow="CADA CIFRA TIENE UN ORIGEN"
        title="Fuentes y conexiones"
        description="Estado real de las integraciones y de su última actualización."
      />
      <GmailPanel />
      <BankNotificationsPanel />
      <div className="gf-integrations-grid">
        {sources.map((s) => {
          const Icon = icons[s.source] || Link2;
          return (
            <article className="gf-panel gf-integration-card" key={s.source}>
              <div className="gf-between">
                <span className="gf-integration-icon">
                  <Icon size={25} />
                </span>
                <Badge
                  status={
                    s.state === "ready" || s.state === "manual"
                      ? "approved"
                      : s.state === "demo"
                        ? "reported"
                        : "pending"
                  }
                >
                  {s.state === "ready"
                    ? "Disponible"
                    : s.state === "attention"
                      ? "Requiere revisión"
                    : s.state === "manual"
                      ? "Importación manual"
                      : s.state === "demo"
                        ? "Demostración"
                        : "Por configurar"}
                </Badge>
              </div>
              <h3>{names[s.source] || s.source}</h3>
              <p>{descriptions[s.source]}</p>
              {s.source === "protickets" && data.ticketing_receipts && (
                <div className="gf-ticketing-receipts">
                  <small>COBROS DEL PERÍODO SELECCIONADO</small>
                  <dl>
                    <div><dt>PayPhone confirmado</dt><dd>{money(data.ticketing_receipts.payphone_cents)}</dd></div>
                    <div><dt>Transferencias verificadas</dt><dd>{money(data.ticketing_receipts.transfer_cents)}</dd></div>
                    <div><dt>Pedidos por pagar</dt><dd>{data.ticketing_receipts.pending_orders}</dd></div>
                  </dl>
                  <small>
                    Los cobros incluyen la parte de ProTickets, que también es tuya.
                    El saldo PayPhone se calcula automáticamente con los cobros nuevos,
                    descontando su tarifa una sola vez. Las liquidaciones reales se comprueban aparte.
                  </small>
                </div>
              )}
              <div className="gf-integration-meta">
                <small>{s.detail}</small>
                <span>
                  {s.last_run
                    ? `Última actualización: ${new Date(
                        s.last_run,
                      ).toLocaleString("es-EC", {
                        timeZone: "America/Guayaquil",
                      })}`
                    : "Sin sincronización comprobada"}
                </span>
              </div>
              {s.source === "internal" && user.role === "owner" && (
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() =>
                    run("/sync", {}, "Fuentes internas sincronizadas")
                  }
                >
                  Sincronizar fuentes internas
                </Button>
              )}
            </article>
          );
        })}
        <article className="gf-panel gf-integration-card gf-ai-integration">
          <div className="gf-between">
            <span className="gf-integration-icon">
              <Sparkles size={25} />
            </span>
            <Badge status={data.capabilities.ai ? "approved" : "pending"}>
              {data.capabilities.ai ? "Configurada" : "Por configurar"}
            </Badge>
          </div>
          <h3>Inteligencia financiera</h3>
          <p>
            Lectura de imágenes y PDF, propuestas de datos y consultas sobre
            registros autorizados.
          </p>
          <div className="gf-integration-meta">
            <small>
              {data.capabilities.ai
                ? "Proveedor configurado en el servidor. La disponibilidad depende del servicio."
                : "Requiere OPENAI_API_KEY y un modelo compatible en el servidor."}
            </small>
            <span>
              Los resultados de documentos siempre requieren revisión.
            </span>
          </div>
        </article>
      </div>
      <div className="gf-note gf-mt">
        <LockKeyhole size={17} />
        Las credenciales se configuran en el servidor. No compartas contraseñas
        bancarias ni tokens en el chat o en los comprobantes.
      </div>
    </>
  );
}

export function Team() {
  const { open, notify, data } = useFinance();
  const [members, setMembers] = useState([]),
    [invite, setInvite] = useState(null),
    [loading, setLoading] = useState(true);
  const load = () =>
    financeApi("/members")
      .then((r) => setMembers(r.members))
      .catch((e) => notify(e.message, true))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, [data.generated_at]);
  const roles = {
    owner: "Propietario",
    manager: "Administrador",
    collector: "Colaborador",
    viewer: "Consulta",
  };
  async function change(member) {
    try {
      await financeApi(`/members/${member.id}/status`, {
        active: !member.active,
      });
      notify(
        member.active
          ? "Acceso suspendido y sesiones cerradas"
          : "Acceso activado",
      );
      load();
    } catch (e) {
      notify(e.message, true);
    }
  }
  async function inviteMember(m) {
    try {
      const r = await financeApi(`/members/${m.id}/invite`, {});
      setInvite({
        name: m.name,
        url: `${window.location.origin}/finanzas/activar#invite=${r.token}`,
      });
    } catch (e) {
      notify(e.message, true);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="CADA PERSONA, EL ACCESO ADECUADO"
        title="Personas y permisos"
        description="Controla quién registra, revisa y consulta la información."
      >
        <Button icon={Plus} onClick={() => open("member")}>
          Crear acceso
        </Button>
        <Button variant="secondary" icon={RefreshCw} onClick={load}>
          Actualizar
        </Button>
      </SectionHead>
      {invite && (
        <section className="gf-panel gf-operation-form">
          <h3>Acceso de {invite.name}</h3>
          <p>
            Enlace privado de un solo uso, válido por 7 días. Esta persona elige
            su contraseña.
          </p>
          <input
            readOnly
            value={invite.url}
            onFocus={(e) => e.target.select()}
          />
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite.url);
                notify("Enlace copiado");
              } catch {
                notify("Mantén presionado el enlace para copiarlo");
              }
            }}
          >
            Copiar enlace
          </Button>
        </section>
      )}
      {data.workflow?.profiles?.length > 0 && (
        <section className="gf-profile-presets">
          <h3>Un perfil para cada persona</h3>
          <p>
            Propuesta basada en tus grupos. Tú decides cuándo crear o activar
            cada acceso.
          </p>
          <div>
            {data.workflow.profiles.map((p) => (
              <button
                key={p.id}
                onClick={() =>
                  open("member", {
                    name: p.name,
                    username: p.id,
                    role: p.role,
                    business_ids: p.business_ids,
                    work_view: p.work_view,
                    space_ids: p.spaces,
                    space_role:
                      p.id === "morelia"
                        ? "coordinator"
                        : p.role === "viewer"
                          ? "observer"
                          : "requester",
                  })
                }
              >
                <strong>{p.name}</strong>
                <span>{p.label}</span>
                <small>{p.description}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="gf-panel">
        {loading ? (
          <Empty title="Consultando accesos…" description="" />
        ) : (
          <div className="gf-table-scroll">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Permisos</th>
                  <th>Negocios</th>
                  <th>Estado</th>
                  <th>Acceso</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small className="gf-block gf-muted">{m.username}</small>
                    </td>
                    <td>{roles[m.role]}</td>
                    <td>
                      {m.business_ids.map((b) => businessNames[b]).join(" · ")}
                      {m.unit_ids.length > 0 && (
                        <small className="gf-block gf-muted">
                          Limitado a {m.unit_ids.length} unidades
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge status={m.active ? "approved" : "rejected"}>
                        {m.active ? "Activo" : "Suspendido"}
                      </Badge>
                    </td>
                    <td>
                      {m.role === "owner" ? (
                        <LockKeyhole size={17} />
                      ) : (
                        <>
                          <Button
                            variant="ghost small"
                            onClick={() => open("member", m)}
                          >
                            Permisos
                          </Button>
                          <Button
                            variant="ghost small"
                            disabled={data.capabilities.public_preview}
                            onClick={() => inviteMember(m)}
                          >
                            Enlace de acceso
                          </Button>
                          <Button
                            variant="ghost small"
                            disabled={data.capabilities.public_preview}
                            onClick={() => change(m)}
                          >
                            {m.active ? "Suspender" : "Activar"}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="gf-note gf-mt">
        Los colaboradores consultan sus propios movimientos. Administradores y
        lectores se limitan a negocios y unidades asignados. La conciliación y
        las cuentas compartidas requieren al propietario.
      </div>
    </>
  );
}

export function Settings() {
  const { user, data, notify } = useFinance();
  const [events, setEvents] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (user.role === "owner")
      financeApi("/audit")
        .then((r) => setEvents(r.events))
        .catch((e) => setError(e.message));
  }, [data.generated_at]);
  const actions = {
    "movement.created": "Movimiento registrado",
    "bank.imported": "Archivo bancario importado",
    "movement.reconciled": "Movimiento conciliado",
    "movement.reviewed": "Movimiento revisado",
    "account.created": "Cuenta registrada",
    "account.verified": "Saldo comparado",
    "evidence.uploaded": "Comprobante guardado",
    "cash.closed": "Caja cerrada",
    "cash.reopened": "Caja reabierta",
    "session.started": "Sesión iniciada",
    "member.created": "Acceso creado",
    "sale.imported": "Venta incorporada",
    "sources.synced": "Fuentes sincronizadas",
    "demo.created": "Demostración preparada",
  };
  return (
    <>
      <SectionHead
        eyebrow="CONTROL Y TRAZABILIDAD"
        title="Configuración y seguridad"
        description="Tu espacio de trabajo y el historial de las operaciones."
      />
      <SecurityPanel />
      <div className="gf-two-columns">
        <section className="gf-panel">
          <SectionHead title="Tu espacio financiero" />
          <div className="gf-summary-lines">
            <div>
              <span>Moneda de operación</span>
              <strong>Dólar estadounidense · USD</strong>
            </div>
            <div>
              <span>Zona horaria de reportes</span>
              <strong>America/Guayaquil</strong>
            </div>
            <div>
              <span>Acceso actual</span>
              <strong>{user.name}</strong>
            </div>
            <div>
              <span>Sesión</span>
              <strong>Privada · cierre por inactividad</strong>
            </div>
            <div>
              <span>Entorno</span>
              <Badge status={data.capabilities.demo ? "reported" : "approved"}>
                {data.capabilities.demo ? "Demostración local" : "Operación"}
              </Badge>
            </div>
          </div>
        </section>
        <section className="gf-panel">
          <SectionHead title="Protección de la información" />
          <div className="gf-security-item">
            <ShieldCheck size={22} />
            <div>
              <strong>Comprobantes cifrados</strong>
              <p>
                Archivos privados con cifrado autenticado y acceso según
                permisos.
              </p>
            </div>
          </div>
          <div className="gf-security-item">
            <History size={22} />
            <div>
              <strong>Operaciones con historial</strong>
              <p>
                Revisiones, conciliaciones y cambios relevantes conservan actor
                y fecha.
              </p>
            </div>
          </div>
          <div className="gf-security-item">
            <LockKeyhole size={22} />
            <div>
              <strong>Sesiones financieras independientes</strong>
              <p>
                Accesos específicos para finanzas, sin heredar permisos de
                compradores o promotoras.
              </p>
            </div>
          </div>
        </section>
      </div>
      {user.role === "owner" && (
        <section className="gf-panel gf-mt">
          <SectionHead
            title="Historial de actividad"
            description="Últimas 100 operaciones registradas."
          />
          {error ? (
            <div className="gf-error">{error}</div>
          ) : (
            <div className="gf-audit-list">
              {events.map((e) => (
                <div key={e.id}>
                  <span className="gf-audit-dot" />
                  <div>
                    <strong>{actions[e.action] || e.action}</strong>
                    <small>
                      {e.actor} · {e.entity} #{e.entity_id}
                    </small>
                  </div>
                  <time>
                    {new Date(e.created_at).toLocaleString("es-EC", {
                      timeZone: "America/Guayaquil",
                    })}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
