import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  Box,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  Globe,
  LockKeyhole,
  MessageCircle,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  SectionHead,
} from "./components.jsx";
import {
  businessNames,
  dateLabel,
  financeApi,
  money,
  amount,
  today,
} from "./api.js";
import { BankLogo } from "./banks.jsx";
import { transferFeeQuote } from "../../../shared/finance-fees.mjs";
import { CustodyFunds } from "./operations.jsx";
import { SettlementFunds } from "./settlements.jsx";
import { BeneficiaryDetails, EvidenceThumbnail } from "./payees.jsx";
const emptyWorkflow = {
  spaces: [],
  requests: [],
  payments: [],
  queue: [],
  summary: { pending_count: 0, pending_cents: 0 },
  profiles: [],
};
const icons = {
  general: Wallet,
  materials: Box,
  event: CalendarDays,
  international: Globe,
  misc: FolderOpen,
};
export function AssistantAvatar({ className = "", size = 56 }) {
  return (
    <img
      className={`gf-assistant-avatar ${className}`}
      src="/finanzas/assistant/gema-assistant-v1.webp"
      width={size}
      height={size}
      alt="Gema, tu asistente financiero"
    />
  );
}
export function PersistentPayments() {
  const { data, user, navigate } = useFinance();
  const w = data.workflow || emptyWorkflow;
  if (user.role !== "owner" || !w.summary.pending_count) return null;
  return (
    <button
      className="gf-durable-payments"
      onClick={() => navigate("pagos")}
      aria-label={`${
        w.summary.pending_count
      } transferencias pendientes, ${money(w.summary.pending_cents)}`}
    >
      <span>
        <BellRing size={20} />
        <i>{w.summary.pending_count}</i>
      </span>
      <div>
        <strong>
          {w.summary.pending_count === 1
            ? "Tienes una transferencia pendiente"
            : `${w.summary.pending_count} transferencias pendientes`}
        </strong>
        <small>Se resuelven al registrar el pago</small>
      </div>
      <b>{money(w.summary.pending_cents)}</b>
      <ArrowRight size={17} />
    </button>
  );
}
export function SpaceTiles({ pinned = false, compact = false }) {
  const { data, user, open } = useFinance();
  const w = data.workflow || emptyWorkflow;
  const spaces = w.spaces.filter(
    (s) => s.active && (!pinned || s.is_member || user.role === "owner"),
  );
  if (!spaces.length)
    return (
      <div className="gf-space-empty">
        <FolderOpen size={26} />
        <p>Tu espacio aparecerá aquí cuando te lo asignen.</p>
      </div>
    );
  return (
    <div className={`gf-space-grid ${compact ? "compact" : ""}`}>
      {spaces.map((s) => {
        const Icon = icons[s.kind] || FolderOpen;
        return (
          <button
            key={s.id}
            className={`gf-space-tile kind-${s.kind}`}
            onClick={() => open("space", { id: s.id })}
          >
            <div className="gf-space-tile-top">
              <span>
                <Icon size={24} />
              </span>
              {s.pending_count > 0 && <b>{s.pending_count} por pagar</b>}
            </div>
            <h3>{s.name}</h3>
            <p>{s.description}</p>
            <div className="gf-space-participants">
              <Users size={14} />
              {s.members?.length
                ? s.members
                    .map((m) => m.name)
                    .slice(0, 4)
                    .join(" · ")
                : s.suggested_members?.join(" · ")}
            </div>
            <footer>
              <span>
                {s.pending_count
                  ? money(s.pending_cents)
                  : "Ver pagos y comprobantes"}
              </span>
              <ArrowRight size={18} />
            </footer>
          </button>
        );
      })}
    </div>
  );
}
export function Spaces() {
  const { data, user, open } = useFinance();
  return (
    <>
      <SectionHead
        eyebrow="COMO TUS GRUPOS, MEJOR ORGANIZADOS"
        title="Espacios de pagos"
        description="Pide, paga y encuentra cada comprobante en su lugar."
      >
        {user.role === "owner" && (
          <Button icon={Plus} onClick={() => open("new-space")}>
            Nuevo espacio
          </Button>
        )}
      </SectionHead>
      <SpaceTiles />
      <div className="gf-space-how">
        <span>
          <b>1</b>Pide el pago
        </span>
        <ArrowRight size={16} />
        <span>
          <b>2</b>Registra la transferencia
        </span>
        <ArrowRight size={16} />
        <span>
          <b>3</b>Comparte el comprobante
        </span>
      </div>
    </>
  );
}
export function RequestCard({ request, returnSpace = null }) {
  const { data, user, open } = useFinance();
  const space = data.workflow?.spaces.find((s) => s.id === request.space_id);
  return (
    <article className="gf-pay-request-card">
      <div className="gf-pay-request-top">
        <span className={`gf-pay-state ${request.payment_state}`}>
          {request.payment_state === "partial"
            ? "Pago parcial"
            : request.payment_state === "paid"
              ? "Pagado"
              : request.payment_state === "cancelled"
                ? "Anulado"
                : "Por transferir"}
        </span>
        <span>{space?.name || businessNames[request.business_id]}</span>
      </div>
      <div className="gf-pay-request-main">
        <div>
          <h3>{request.counterparty}</h3>
          <p>{request.description}</p>
          <small>
            {request.requester_name || request.created_by}
            {request.due_date ? ` · Vence ${dateLabel(request.due_date)}` : ""}
          </small>
        </div>
        <strong>
          {money(request.remaining_cents || request.amount_cents)}
        </strong>
      </div>
      {request.paid_cents > 0 && request.remaining_cents > 0 && (
        <p className="gf-pay-partial">
          Ya pagado: {money(request.paid_cents)} · queda{" "}
          {money(request.remaining_cents)}
        </p>
      )}
      <footer>
        <Button
          variant="ghost"
          icon={FileText}
          onClick={() =>
            open("pay-request", { id: request.id, return_space: returnSpace })
          }
        >
          Ver detalles
        </Button>
        {user.role === "owner" && request.remaining_cents > 0 && (
          <Button
            icon={ArrowUpRight}
            onClick={() =>
              open("record-payment", {
                id: request.id,
                return_space: returnSpace,
              })
            }
          >
            Ya transferí
          </Button>
        )}
      </footer>
    </article>
  );
}
export function PaymentRow({ payment }) {
  const { data, open } = useFinance();
  const request = data.workflow?.requests.find(
    (r) => r.id === payment.request_id,
  );
  return (
    <div className={`gf-paid-row ${payment.voided_at ? "voided" : ""}`}>
      {!payment.voided_at ? (
        <EvidenceThumbnail
          path={`/payments/${payment.id}/evidence`}
          title="Comprobante de pago"
          returnType="pay-request"
          returnInitial={{ id: payment.request_id }}
        />
      ) : (
        <span className="gf-paid-check">
          {payment.voided_at ? <X size={19} /> : <CheckCircle2 size={19} />}
        </span>
      )}
      <div>
        <strong>{request?.counterparty || "Pago registrado"}</strong>
        <p>
          {dateLabel(payment.paid_day)} ·{" "}
          {payment.payer_name || payment.created_by}
        </p>
        <small>
          {payment.voided_at
            ? "Corregido, historial conservado"
            : payment.verification_status === "reconciled"
              ? "Pago conciliado"
              : "Pago informado · por conciliar"}
        </small>
        {payment.destination_bank && (
          <small>
            Destino: {payment.destination_bank} ··
            {payment.destination_last_four}
          </small>
        )}
      </div>
      <div>
        <b>{money(payment.amount_cents)}</b>
        {!payment.voided_at && (
          <button onClick={() => open("share-payment", { id: payment.id })}>
            <MessageCircle size={15} /> Comprobante
          </button>
        )}
      </div>
    </div>
  );
}
export function PaymentDesk() {
  const { data, user } = useFinance();
  const w = data.workflow || emptyWorkflow;
  const [tab, setTab] = useState("pending"),
    [space, setSpace] = useState("all");
  const rows = w.queue.filter((r) => space === "all" || r.space_id === space);
  return (
    <>
      <SectionHead
        eyebrow="NINGUNA SOLICITUD SE PIERDE"
        title={user.role === "owner" ? "Por transferir" : "Pagos de trabajo"}
        description={
          user.role === "owner"
            ? "Realiza el pago en tu banco y guarda aquí su comprobante."
            : "Consulta las solicitudes y el historial cuando lo necesites."
        }
      />
      <div className="gf-pay-desk-summary">
        <span>
          <BellRing size={27} />
        </span>
        <div>
          <strong>
            {w.summary.pending_count}{" "}
            {w.summary.pending_count === 1
              ? "solicitud pendiente"
              : "solicitudes pendientes"}
          </strong>
          <p>No desaparecen al borrar avisos o cerrar la aplicación.</p>
        </div>
        <b>{money(w.summary.pending_cents)}</b>
      </div>
      <div className="gf-workflow-filter">
        <div className="gf-workflow-tabs">
          <button
            aria-pressed={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            Por transferir <b>{w.summary.pending_count}</b>
          </button>
          <button aria-pressed={tab === "paid"} onClick={() => setTab("paid")}>
            Pagos realizados
          </button>
        </div>
        <select
          aria-label="Filtrar espacio"
          value={space}
          onChange={(e) => setSpace(e.target.value)}
        >
          <option value="all">Todos los espacios</option>
          {w.spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {tab === "pending" ? (
        <div className="gf-request-list">
          {rows.length ? (
            rows.map((r) => <RequestCard key={r.id} request={r} />)
          ) : (
            <div className="gf-panel">
              <Empty
                title="Todo al día"
                description="Las nuevas solicitudes aparecerán aquí hasta que registres su pago."
              />
            </div>
          )}
        </div>
      ) : (
        <section className="gf-panel gf-paid-history">
          {w.payments
            .filter(
              (p) =>
                space === "all" ||
                w.requests.find((r) => r.id === p.request_id)?.space_id ===
                  space,
            )
            .map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          {!w.payments.length && (
            <Empty
              title="El historial empieza con el primer pago"
              description="Cada transferencia conservará su fecha, comprobante y responsable."
            />
          )}
        </section>
      )}
      {user.role === "owner" && <PushEnrollment />}
    </>
  );
}
export function SpacePanel({ id, onClose }) {
  const { data, user, open } = useFinance();
  const w = data.workflow || emptyWorkflow,
    space = w.spaces.find((s) => s.id === id);
  const [tab, setTab] = useState("pending");
  if (!space)
    return (
      <Modal title="Espacio no disponible" onClose={onClose}>
        <p>Revisa tus permisos o actualiza la vista.</p>
      </Modal>
    );
  const requests = w.requests.filter((r) => r.space_id === id),
    requestIds = new Set(requests.map((r) => r.id)),
    payments = w.payments.filter((p) => requestIds.has(p.request_id));
  const member = space.members?.find((m) => m.member_id === user.id);
  const canRequest =
    user.role === "owner" ||
    (user.role !== "viewer" && member && member.role !== "observer");
  return (
    <Modal
      title={space.name}
      subtitle={space.description}
      onClose={onClose}
      wide
    >
      <div className="gf-space-panel-head">
        <div>
          <Users size={17} />
          <span>
            {space.members?.length
              ? space.members.map((m) => m.name).join(" · ")
              : space.suggested_members?.join(" · ")}
          </span>
        </div>
        {user.role === "owner" && (
          <Button
            variant="ghost"
            icon={Settings2}
            onClick={() => open("space-settings", { id })}
          >
            Configurar
          </Button>
        )}
      </div>
      <div className="gf-space-pay-overview">
        <div>
          <span>Por pagar</span>
          <strong>{money(space.pending_cents)}</strong>
        </div>
        <div>
          <span>Pagado</span>
          <strong>{money(space.paid_cents)}</strong>
        </div>
        {canRequest && (
          <Button
            icon={Plus}
            onClick={() =>
              open("quick", {
                mode: "request",
                space_id: id,
                business_id: space.business_ids[0],
              })
            }
          >
            Pedir un pago
          </Button>
        )}
      </div>
      <div className="gf-workflow-tabs">
        <button
          aria-pressed={tab === "pending"}
          onClick={() => setTab("pending")}
        >
          Por pagar {space.pending_count > 0 && <b>{space.pending_count}</b>}
        </button>
        <button aria-pressed={tab === "paid"} onClick={() => setTab("paid")}>
          Pagado
        </button>
        <button aria-pressed={tab === "all"} onClick={() => setTab("all")}>
          Todo
        </button>
      </div>
      <div className="gf-space-content">
        {tab === "paid"
          ? payments.map((p) => <PaymentRow key={p.id} payment={p} />)
          : requests
              .filter((r) => tab === "all" || r.remaining_cents > 0)
              .map((r) => (
                <RequestCard key={r.id} request={r} returnSpace={id} />
              ))}
        {(tab === "paid"
          ? !payments.length
          : !requests.filter((r) => tab === "all" || r.remaining_cents > 0)
              .length) && (
          <Empty
            title={
              tab === "pending"
                ? "Nada pendiente por ahora"
                : "Aquí encontrarás el historial"
            }
            description="Cada solicitud y comprobante queda organizado por fecha."
          />
        )}
      </div>
      <p className="gf-space-share-hint">
        <MessageCircle size={16} />
        Destino sugerido:{" "}
        {space.share_type === "number"
          ? space.share_phone
          : space.share_label || "Elegir al compartir"}
      </p>
    </Modal>
  );
}
export function WorkSummary() {
  const { data, user, navigate, open } = useFinance();
  const accounts = data.accounts.filter((a) =>
    ["bank", "wallet"].includes(a.kind),
  );
  return (
    <div className="gf-work-summary">
      <span className="gf-eyebrow">LOS NEGOCIOS, A TU ALCANCE</span>
      <h1>Hola, {user.name.split(" ")[0]}.</h1>
      <p>Los saldos primero. El detalle, solo cuando lo necesites.</p>
      {user.request_payments && (
        <Button
          icon={ArrowUpRight}
          onClick={() => open("quick", { mode: "request" })}
        >
          Pedir pago
        </Button>
      )}
      <div className="gf-work-total">
        <Wallet size={25} />
        <div>
          <small>Saldo calculado en cuentas de trabajo</small>
          <strong>{money(data.summary.balance_cents)}</strong>
        </div>
        <Button variant="ghost" onClick={() => navigate("cuentas")}>
          Ver cuentas <ArrowRight size={16} />
        </Button>
      </div>
      <div className="gf-work-bank-grid">
        {accounts.map((a) => (
          <div key={a.id}>
            <BankLogo bank={a.bank} kind={a.kind} />
            <div>
              <span>
                {a.bank} {a.last_four && <small>··{a.last_four}</small>}
              </span>
              <strong>{money(a.balance_cents)}</strong>
            </div>
            {a.personal_details_private && <small>Cuenta compartida</small>}
          </div>
        ))}
      </div>
      <SettlementFunds />
      <CustodyFunds />
      <div className="gf-work-explore">
        <div>
          <h2>Movimientos de trabajo</h2>
          <p>
            Pagos, fechas y comprobantes de los negocios, en un apartado
            separado.
          </p>
        </div>
        <Button icon={ArrowRight} onClick={() => navigate("movimientos")}>
          Abrir detalle
        </Button>
      </div>
      <SectionHead
        title="Tus espacios"
        description="El historial de los grupos que sigues."
      />
      <SpaceTiles pinned compact />
      <p className="gf-work-private">
        <LockKeyhole size={16} />
        Los detalles de los movimientos personales permanecen privados.
      </p>
    </div>
  );
}
export function RequestDetails({ id, onClose }) {
  const { data, user, open, refresh, notify } = useFinance();
  const [detail, setDetail] = useState(null),
    [destination, setDestination] = useState(null),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false),
    [reason, setReason] = useState("");
  const load = () =>
    financeApi(`/payment-requests/${id}`)
      .then(setDetail)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id, data.generated_at]);
  async function addNote(e) {
    e.preventDefault();
    try {
      await financeApi(`/payment-requests/${id}/notes`, { body: note });
      setNote("");
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function cancelRequest() {
    try {
      await financeApi(`/payment-requests/${id}/cancel`, { reason });
      await refresh();
      notify("Solicitud anulada. El historial se conserva.");
      setCancel(false);
    } catch (e) {
      setError(e.message);
    }
  }
  const r = detail?.request;
  return (
    <Modal title="Detalle de solicitud" onClose={onClose}>
      {error && <p className="gf-error">{error}</p>}
      {!detail ? (
        <p>Consultando solicitud…</p>
      ) : (
        <>
          <div className="gf-request-detail-summary">
            <span>{detail.space?.name || businessNames[r.business_id]}</span>
            <h3>{r.counterparty}</h3>
            <strong>{money(r.amount_cents)}</strong>
            <p>{r.description}</p>
            <small>
              Solicitado por {r.requester_name || r.created_by} ·{" "}
              {dateLabel(r.day)}
            </small>
          </div>
          <BeneficiaryDetails
            beneficiary={detail.beneficiary}
            selected={destination}
            onSelect={user.role === "owner" ? setDestination : undefined}
          />
          <div className="gf-request-progress">
            <div>
              Pagado <b>{money(r.paid_cents)}</b>
            </div>
            <div>
              Por pagar <b>{money(r.remaining_cents)}</b>
            </div>
          </div>
          {r.evidence_id && (
            <EvidenceThumbnail
              path={`/payment-requests/${id}/evidence`}
              title="Documento de la solicitud"
              returnType="pay-request"
              returnInitial={{ id }}
            />
          )}
          {user.role === "owner" && r.remaining_cents > 0 && (
            <Button
              className="gf-full-width gf-mt"
              icon={ArrowUpRight}
              onClick={() =>
                open("record-payment", {
                  id: r.id,
                  return_space: r.space_id,
                  destination_index: destination,
                })
              }
            >
              Ya realicé la transferencia
            </Button>
          )}
          <h3 className="gf-workflow-section-title">Pagos y comprobantes</h3>
          {detail.payments.length ? (
            detail.payments.map((p) => <PaymentRow key={p.id} payment={p} />)
          ) : (
            <p className="gf-workflow-empty-line">
              Todavía no se ha registrado un pago.
            </p>
          )}
          {r.status === "rejected" && (
            <div className="gf-note">Solicitud anulada: {r.review_note}</div>
          )}
          <h3 className="gf-workflow-section-title">Notas de este pago</h3>
          <div className="gf-space-notes">
            {detail.notes.map((n) => (
              <div key={n.id}>
                <strong>{n.actor_name || n.actor}</strong>
                <p>{n.body}</p>
                <small>
                  {new Date(n.created_at).toLocaleString("es-EC", {
                    timeZone: "America/Guayaquil",
                  })}
                </small>
              </div>
            ))}
          </div>
          {user.role !== "viewer" && (
            <form className="gf-space-note-form" onSubmit={addNote}>
              <input
                aria-label="Nota de la solicitud"
                placeholder="Añadir un dato o una aclaración…"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                required
              />
              <Button type="submit" icon={Send}>
                Enviar
              </Button>
            </form>
          )}
          {user.role === "owner" && r.remaining_cents > 0 && (
            <div className="gf-request-cancel">
              {cancel ? (
                <>
                  <Field label="Motivo de anulación">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={1000}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={!reason.trim()}
                    onClick={cancelRequest}
                  >
                    Anular y conservar historial
                  </Button>
                </>
              ) : (
                <button onClick={() => setCancel(true)}>
                  Anular una solicitud que ya no corresponde
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
async function downloadPrivate(path, name = "comprobante") {
  const response = await fetch(`/api/finance${path}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo abrir el comprobante");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RecordPayment({ id, initialDestination, onClose }) {
  const { data, user, refresh, open } = useFinance();
  const request = data.workflow?.requests.find((r) => r.id === Number(id));
  const [beneficiary, setBeneficiary] = useState(null),
    [destination, setDestination] = useState(initialDestination ?? null),
    [destinationLoaded, setDestinationLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    financeApi(`/payment-requests/${id}`)
      .then((r) => {
        if (cancelled) return;
        setBeneficiary(r.beneficiary);
        if (r.beneficiary?.accounts.length === 1) setDestination(0);
        setDestinationLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  const [value, setValue] = useState(
      request ? (request.remaining_cents / 100).toFixed(2) : "",
    ),
    [account, setAccount] = useState(""),
    [day, setDay] = useState(
      data.capabilities.public_preview ? data.period.today : today(),
    ),
    [reference, setReference] = useState(""),
    [evidence, setEvidence] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [done, setDone] = useState(null);
  const file = useRef(),
    key = useRef(crypto.randomUUID());
  const preview = data.capabilities.public_preview,
    accounts = data.accounts.filter(
      (a) =>
        ["bank", "wallet", "card"].includes(a.kind) &&
        (user.role === "owner" ||
          !a.business_id ||
          a.business_id === request?.business_id),
    );
  async function upload(selected) {
    if (!selected || preview) return;
    setUploading(true);
    setError("");
    try {
      if (selected.size > 6 * 1024 * 1024)
        throw new Error("El comprobante debe pesar hasta 6 MB");
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selected);
      });
      const result = await financeApi("/evidence", {
        business_id: request.business_id,
        unit_id: request.unit_id,
        name: selected.name,
        mime: selected.type,
        data: encoded,
      });
      setEvidence({ id: result.id, name: selected.name });
      if (data.capabilities.ai) {
        try {
          const { analysis } = await financeApi(
            `/evidence/${result.id}/analyze`,
            {},
          );
          if (analysis.reference) setReference(analysis.reference);
          if (analysis.day) setDay(analysis.day);
          if (
            analysis.amount_cents &&
            analysis.amount_cents <= request.remaining_cents
          )
            setValue((analysis.amount_cents / 100).toFixed(2));
        } catch {
          setError(
            "El comprobante se guardó. Completa la referencia y revisa el monto.",
          );
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await financeApi(`/payment-requests/${id}/payments`, {
        request_key: key.current,
        amount_cents: amount(value),
        account_id: Number(account),
        paid_day: day,
        reference,
        evidence_id: evidence?.id,
        confirm_paid: confirmed,
        destination_index: destination,
      });
      await refresh();
      setDone(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!request)
    return (
      <Modal title="Solicitud no disponible" onClose={onClose}>
        <p>Actualiza los pendientes y vuelve a abrirla.</p>
      </Modal>
    );
  return (
    <Modal
      title={done ? "Pago registrado" : "Registrar transferencia realizada"}
      subtitle={
        done
          ? undefined
          : "El pago lo realizas en tu banco. Aquí guardas su comprobante."
      }
      onClose={onClose}
    >
      {done ? (
        <div className="gf-payment-done">
          <CheckCircle2 size={48} />
          <h3>
            {done.remaining_cents > 0
              ? "Abono guardado"
              : "Este pendiente quedó resuelto"}
          </h3>
          <strong>{money(amount(value))}</strong>
          <p>
            {done.preview
              ? "Simulación con datos de ejemplo. No se realizó ninguna transferencia real."
              : "Comprobante y fecha guardados. La conciliación bancaria sigue por separado."}
          </p>
          {done.remaining_cents > 0 && (
            <div>Queda por transferir: {money(done.remaining_cents)}</div>
          )}
          <Button
            icon={MessageCircle}
            onClick={() => open("share-payment", { id: done.payment.id })}
          >
            Compartir comprobante
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Terminar
          </Button>
        </div>
      ) : (
        <form className="gf-record-payment" onSubmit={submit}>
          <div className="gf-pay-target">
            <span>{request.counterparty}</span>
            <strong>Pendiente: {money(request.remaining_cents)}</strong>
          </div>
          {preview && (
            <div className="gf-quick-preview-note">
              Ejemplo: prueba registrar el pago sin utilizar datos reales.
            </div>
          )}
          <BeneficiaryDetails
            beneficiary={beneficiary}
            selected={destination}
            onSelect={setDestination}
          />
          <div className="gf-payment-fields">
            <Field label="Monto transferido (USD)">
              <input
                type="number"
                min="0.01"
                max={request.remaining_cents / 100}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </Field>
            <Field label="Fecha del pago">
              <input
                type="date"
                max={preview ? data.period.today : today()}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Cuenta o tarjeta desde la que pagaste">
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
            >
              <option value="">Selecciona la cuenta de salida</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank} · {a.name} · {a.last_four}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Referencia de la transferencia">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                preview
                  ? "EJEMPLO-TRANSFERENCIA-123"
                  : "Número de operación del comprobante"
              }
              maxLength={200}
              required
            />
          </Field>
          {account &&
            beneficiary?.accounts?.[destination] &&
            (() => {
              const fee = transferFeeQuote(
                accounts.find((a) => a.id === Number(account))?.bank,
                beneficiary.accounts[destination].bank,
              );
              return (
                <p className="gf-note">
                  Comisión de referencia:{" "}
                  {fee.cents === null ? "Por comprobar" : money(fee.cents)}.{" "}
                  {fee.note ||
                    "Se comprobará con el cargo real del banco y se registrará aparte del monto enviado."}
                </p>
              );
            })()}
          <div className="gf-payment-evidence">
            <FileCheck2 size={27} />
            <strong>
              {evidence?.name || "Comprobante del pago realizado"}
            </strong>
            <p>
              Adjunta el comprobante de la transferencia, no la factura que te
              pidieron pagar.
            </p>
            <input
              type="file"
              ref={file}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              hidden
              onChange={(e) => upload(e.target.files?.[0])}
            />
            {preview ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setEvidence({
                    id: -1,
                    name: "Comprobante ficticio · demostración",
                  })
                }
              >
                Usar comprobante de ejemplo
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                icon={Upload}
                disabled={uploading}
                onClick={() => file.current.click()}
              >
                {uploading ? "Guardando…" : "Adjuntar comprobante"}
              </Button>
            )}
          </div>
          <label className="gf-paid-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              required
            />
            <span>
              {preview
                ? "Simular que esta transferencia ya fue realizada"
                : "Confirmo que ya realicé esta transferencia en el banco"}
            </span>
          </label>
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            icon={Check}
            loading={busy}
            disabled={
              !evidence ||
              !destinationLoaded ||
              (beneficiary && destination === null) ||
              !confirmed ||
              uploading ||
              !account ||
              amount(value) <= 0 ||
              amount(value) > request.remaining_cents
            }
            className="gf-full-width"
          >
            {preview
              ? "Simular registro del pago"
              : "Guardar pago y resolver pendiente"}
          </Button>
          <p className="gf-payment-proof-note">
            El pendiente se actualiza con el valor pagado. Un abono parcial
            conserva el resto por transferir.
          </p>
        </form>
      )}
    </Modal>
  );
}
export function SharePayment({ id, onClose }) {
  const { data } = useFinance();
  const payment = data.workflow?.payments.find((p) => p.id === Number(id)),
    request = data.workflow?.requests.find((r) => r.id === payment?.request_id),
    space = data.workflow?.spaces.find((s) => s.id === request?.space_id);
  const [file, setFile] = useState(null),
    [error, setError] = useState(""),
    [shared, setShared] = useState(false);
  const preview = data.capabilities.public_preview;
  const message = payment
    ? `${space?.name || businessNames[request?.business_id] || "Pago"}\n${
        request?.counterparty || "Pago registrado"
      } · ${money(payment.amount_cents)}\nFecha: ${dateLabel(
        payment.paid_day,
      )}\nReferencia: ${payment.reference}\nComprobante del pago adjunto.`
    : "";
  useEffect(() => {
    if (preview || !payment) return;
    let current = true;
    fetch(`/api/finance/payments/${id}/evidence`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error("No se pudo preparar el comprobante");
        return r.blob();
      })
      .then((blob) => {
        if (current)
          setFile(
            new File([blob], payment.evidence_name || "comprobante", {
              type: blob.type,
            }),
          );
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, preview]);
  async function share() {
    setError("");
    try {
      await navigator.share({
        files: [file],
        title: "Comprobante de pago",
        text: message,
      });
      setShared(true);
    } catch (e) {
      if (e.name !== "AbortError")
        setError("Puedes descargar el archivo y adjuntarlo en WhatsApp.");
    }
  }
  const native = Boolean(
    file && navigator.share && navigator.canShare?.({ files: [file] }),
  );
  return (
    <Modal
      title="Compartir comprobante"
      subtitle="Envía solo este pago a quienes lo necesitan, aunque no tengan acceso al sistema."
      onClose={onClose}
    >
      {!payment ? (
        <p>Pago no disponible.</p>
      ) : (
        <>
          <div className="gf-share-payment-preview">
            <MessageCircle size={28} />
            <strong>{money(payment.amount_cents)}</strong>
            <span>{request?.counterparty}</span>
            <p>
              {space?.share_type === "number"
                ? `Número sugerido: ${space.share_phone}`
                : `Grupo sugerido: ${
                    space?.share_label ||
                    "Elige el grupo o contacto al compartir"
                  }`}
            </p>
          </div>
          <pre className="gf-share-caption">{message}</pre>
          <EvidenceThumbnail
            path={`/payments/${id}/evidence`}
            title="Comprobante del pago"
            returnType="share-payment"
            returnInitial={{ id }}
          />
          <Button
            variant="secondary"
            icon={Download}
            onClick={() =>
              downloadPrivate(
                `/payments/${id}/evidence`,
                payment.evidence_name,
              ).catch((e) => setError(e.message))
            }
          >
            Descargar comprobante{preview ? " de ejemplo" : ""}
          </Button>
          {preview ? (
            <div className="gf-note">
              Esta demostración no envía mensajes ni comparte documentos reales.
              En la aplicación operativa se preparará el comprobante para
              compartirlo.
            </div>
          ) : (
            <>
              {!file && !error && <p>Preparando el archivo privado…</p>}
              {native ? (
                <>
                  <Button
                    className="gf-full-width"
                    icon={MessageCircle}
                    onClick={share}
                  >
                    Compartir y elegir WhatsApp
                  </Button>
                  <p className="gf-share-instructions">
                    Elige WhatsApp y selecciona el grupo o número. Revisa el
                    destinatario antes de enviar.
                  </p>
                </>
              ) : (
                file && (
                  <>
                    <Button
                      variant="secondary"
                      icon={Download}
                      onClick={() =>
                        downloadPrivate(
                          `/payments/${id}/evidence`,
                          payment.evidence_name,
                        )
                      }
                    >
                      Descargar comprobante
                    </Button>
                    <Button
                      icon={MessageCircle}
                      onClick={() =>
                        window.open(
                          `https://wa.me/${String(
                            space?.share_phone || "",
                          ).replace(/\D/g, "")}?text=${encodeURIComponent(
                            message,
                          )}`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      Abrir WhatsApp con el mensaje
                    </Button>
                    <p className="gf-share-instructions">
                      Adjunta el comprobante descargado en el chat que elijas.
                      El texto preparado no adjunta el archivo automáticamente.
                    </p>
                  </>
                )
              )}
              {shared && (
                <p className="gf-success">
                  Comprobante entregado al menú de compartir. Verifica el envío
                  en WhatsApp.
                </p>
              )}
            </>
          )}
          {error && <p className="gf-error">{error}</p>}
        </>
      )}
    </Modal>
  );
}
export function SpaceSettings({ id, onClose }) {
  const { data, refresh, notify } = useFinance();
  const space = data.workflow?.spaces.find((s) => s.id === id);
  const [name, setName] = useState(space?.name || ""),
    [kind, setKind] = useState("group"),
    [label, setLabel] = useState(space?.share_label || ""),
    [phone, setPhone] = useState(space?.share_phone || ""),
    [members, setMembers] = useState([]),
    [selected, setSelected] = useState(
      space?.members?.map((m) => m.member_id) || [],
    ),
    [error, setError] = useState("");
  useEffect(() => {
    setKind(space?.share_type || "group");
    financeApi("/members")
      .then((r) =>
        setMembers(
          r.members.filter(
            (m) =>
              m.active &&
              m.role !== "owner" &&
              m.business_ids.some((b) => space?.business_ids.includes(b)),
          ),
        ),
      )
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit(e) {
    e.preventDefault();
    try {
      await financeApi(`/spaces/${id}/settings`, {
        name,
        share_type: kind,
        share_label: label,
        share_phone: phone,
        members: selected.map((member_id) => ({
          member_id,
          role:
            members.find((m) => m.id === member_id)?.role === "viewer"
              ? "observer"
              : space.members.find((m) => m.member_id === member_id)?.role ||
                "requester",
        })),
      });
      await refresh();
      notify("Espacio actualizado");
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal title="Configurar espacio" onClose={onClose}>
      <form className="gf-space-settings" onSubmit={submit}>
        <Field label="Nombre">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <fieldset className="gf-large-checks">
          <legend>¿Quién participa?</legend>
          {members.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={(e) =>
                  setSelected((p) =>
                    e.target.checked
                      ? [...p, m.id]
                      : p.filter((id) => id !== m.id),
                  )
                }
              />
              <span>
                {m.name}
                <small>
                  {m.role === "viewer"
                    ? "Consulta"
                    : "Solicita y consulta pagos"}
                </small>
              </span>
            </label>
          ))}
          {!members.length && (
            <p>Crea primero sus accesos en Personas y permisos.</p>
          )}
        </fieldset>
        <Field label="Destino habitual al compartir">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="group">Grupo de WhatsApp</option>
            <option value="number">Número de WhatsApp</option>
            <option value="manual">Elegir cada vez</option>
          </select>
        </Field>
        {kind === "group" && (
          <Field label="Nombre del grupo">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Depósitos materiales"
            />
          </Field>
        )}
        {kind === "number" && (
          <Field label="Número con código de país">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+593…"
              required
            />
          </Field>
        )}
        <p className="gf-share-instructions">
          El destinatario se elige y confirma en WhatsApp. Los envíos
          automáticos requieren una integración oficial adicional.
        </p>
        {error && <p className="gf-error">{error}</p>}
        <Button type="submit" icon={Check}>
          Guardar configuración
        </Button>
      </form>
    </Modal>
  );
}
export function NewSpace({ onClose }) {
  const { user, refresh, notify } = useFinance();
  const [name, setName] = useState(""),
    [business, setBusiness] = useState(
      user.business_ids.filter((id) => id !== "personal").slice(0, 1),
    ),
    [kind, setKind] = useState("event"),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      await financeApi("/spaces", { name, kind, business_ids: business });
      await refresh();
      notify("Espacio creado. Asigna sus participantes.");
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal
      title="Nuevo espacio"
      subtitle="Crea un espacio para un evento, equipo o grupo de pagos."
      onClose={onClose}
    >
      <form className="gf-space-settings" onSubmit={submit}>
        <Field label="Nombre">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ejemplo: evento · ciudad"
            required
          />
        </Field>
        <Field label="Tipo">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="event">Evento</option>
            <option value="materials">Materiales</option>
            <option value="general">Pagos generales</option>
            <option value="international">Pagos al exterior</option>
            <option value="misc">Varios</option>
          </select>
        </Field>
        <fieldset className="gf-large-checks">
          <legend>Negocios de este espacio</legend>
          {user.business_ids.map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={business.includes(id)}
                onChange={(e) =>
                  setBusiness((p) =>
                    e.target.checked ? [...p, id] : p.filter((b) => b !== id),
                  )
                }
              />
              <span>{businessNames[id]}</span>
            </label>
          ))}
        </fieldset>
        {error && <p className="gf-error">{error}</p>}
        <Button type="submit" disabled={!business.length} icon={Plus}>
          Crear espacio
        </Button>
      </form>
    </Modal>
  );
}
export function PushEnrollment() {
  const { data, notify } = useFinance();
  const [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      if (
        !("PushManager" in window) ||
        !("serviceWorker" in navigator) ||
        !("Notification" in window)
      )
        throw new Error(
          "Este navegador no permite activar estos avisos. Los pendientes seguirán visibles dentro de la app.",
        );
      const config = await financeApi("/push/config");
      if (!config.enabled)
        throw new Error(
          "Los avisos al celular están pendientes de configurar en el servidor.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "No se activaron los avisos. La bandeja de transferencias seguirá funcionando.",
        );
      const registration = await navigator.serviceWorker.ready;
      const key = config.public_key.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(
        atob(key + "=".repeat((4 - (key.length % 4)) % 4)),
        (c) => c.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await financeApi("/push/subscribe", {
        subscription: subscription.toJSON(),
      });
      setEnabled(true);
      notify("Avisos activados para este dispositivo");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gf-push-enrollment">
      <Bell size={22} />
      <div>
        <strong>
          {enabled
            ? "Avisos activados en este dispositivo"
            : "Tus pendientes siempre visibles"}
        </strong>
        <p>
          {data.capabilities.push
            ? "Activa también el aviso en este celular cuando la aplicación esté cerrada."
            : "Los avisos fuera de la app requieren configurar el servicio de notificaciones. La bandeja de pagos ya es independiente de los avisos."}
        </p>
      </div>
      {data.capabilities.push && !enabled && (
        <Button variant="secondary" loading={busy} onClick={enable}>
          Activar avisos
        </Button>
      )}
    </div>
  );
}
