import {
  AccountTiles,
  LiquidityPlan,
  CardPaymentsPreview,
} from "./account-summary.jsx";
import React, { useEffect, useRef, useState } from "react";
import { isNativeFinance, NativePushEnrollment } from "./native-push.jsx";
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
import { DirectPaymentUpload, PaymentProofActions } from "./payment-proof.jsx";
import "./payment-fast.css";
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
    (s) => s.active && (!pinned || s.is_member || user.role === "owner")
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
  const lastPayment = (data.workflow?.payments || [])
    .filter((p) => p.request_id === request.id && !p.voided_at)
    .sort((a, b) => b.id - a.id)[0];
  const showRequest = () =>
    open("pay-request", { id: request.id, return_space: returnSpace });
  return (
    <article className="gf-pay-request-card gf-request-tappable" role="group">
      <button
        type="button"
        className="gf-request-open"
        onClick={showRequest}
        aria-label={`Abrir petición de ${request.counterparty} por ${money(
          request.amount_cents
        )}`}
      >
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
              {request.due_date
                ? ` · Vence ${dateLabel(request.due_date)}`
                : ""}
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
      </button>
      {lastPayment && (
        <PaymentProofActions payment={lastPayment} request={request} />
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
        {user.role === "owner" && request.remaining_cents > 0 && <DirectPaymentUpload request={request}/>}

      </footer>
    </article>
  );
}
export function PaymentRow({ payment }) {
  const { data, open } = useFinance();
  const request = data.workflow?.requests.find(
    (r) => r.id === payment.request_id
  );
  return (
    <div className="gf-paid-quick-wrap">
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
      {!payment.voided_at && (
        <PaymentProofActions payment={payment} request={request} />
      )}
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
                  space
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
    ["bank", "wallet"].includes(a.kind)
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
      <PushEnrollment />
      <LiquidityPlan />
      <AccountTiles />
      <CardPaymentsPreview />
      <SettlementFunds />
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
  const proofPicker = useRef();
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
    <Modal
      title="Petición de pago"
      className="gf-payment-fast-modal"
      onClose={onClose}
    >
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
            {r.observation&&<div className="gf-request-observation"><strong>Detalle u observación</strong><p>{r.observation}</p></div>}
            <small>
              Solicitado por {r.requester_name || r.created_by} ·{" "}
              {dateLabel(r.day)}
            </small>
          </div>
          {detail.payments.filter((p) => !p.voided_at).length > 0 && (
            <div className="gf-request-proof-first">
              {detail.payments
                .filter((p) => !p.voided_at)
                .map((p) => (
                  <div key={p.id}>
                    <strong>
                      {money(p.amount_cents)} · {dateLabel(p.paid_day)}
                    </strong>
                    <PaymentProofActions payment={p} request={r} />
                  </div>
                ))}
            </div>
          )}
          {user.role === "owner" && r.remaining_cents > 0 && (
            <div className="gf-request-primary-action">
              <input
                hidden
                type="file"
                ref={proofPicker}
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    open("record-payment", {
                      id: r.id,
                      return_space: r.space_id,
                      destination_index: destination,
                      initial_file: file,
                    });
                }}
              />
              <Button
                icon={Upload}
                className="gf-full-width"
                onClick={() => proofPicker.current.click()}
              >
                Subir comprobante
              </Button>
            </div>
          )}
          {r.remaining_cents > 0 && (
            <BeneficiaryDetails
              compact
              beneficiary={detail.beneficiary}
              selected={destination}
              onSelect={user.role === "owner" ? setDestination : undefined}
            />
          )}
          <details className="gf-request-more">
            <summary>Historial, documentos y notas</summary>
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
          </details>
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
export function RecordPayment({
  id,
  initialDestination,
  initialFile,
  onClose,
}) {
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
      request ? (request.remaining_cents / 100).toFixed(2) : ""
    ),
    [account, setAccount] = useState(""),
    [day, setDay] = useState(
      data.capabilities.public_preview ? data.period.today : today()
    ),
    [reference, setReference] = useState(""),
    [evidence, setEvidence] = useState(null),
    [origin, setOrigin] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [done, setDone] = useState(null);
  const file = useRef(),
    initialUploaded = useRef(false),
    key = useRef(crypto.randomUUID());
  const preview = data.capabilities.public_preview,
    accounts = data.accounts.filter(
      (a) =>
        ["bank", "wallet", "card"].includes(a.kind) &&
        (user.role === "owner" ||
          !a.business_id ||
          a.business_id === request?.business_id)
    );
  async function upload(selected) {
    if (!selected || preview) return;
    if (origin?.account_id === Number(account)) setAccount("");
    setOrigin(null);
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
          const { analysis, origin_account } = await financeApi(
            `/evidence/${result.id}/analyze`,
            {}
          );
          setOrigin(origin_account);
          if (
            origin_account?.state === "matched" &&
            accounts.some((a) => a.id === origin_account.account_id)
          )
            setAccount(String(origin_account.account_id));
          if (analysis.reference) setReference(analysis.reference);
          if (analysis.day) setDay(analysis.day);
          if (
            analysis.amount_cents &&
            analysis.amount_cents <= request.remaining_cents
          )
            setValue((analysis.amount_cents / 100).toFixed(2));
        } catch {
          setError(
            "El comprobante se guardó. Completa la referencia y revisa el monto."
          );
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  useEffect(() => {
    if (initialFile && request && !initialUploaded.current) {
      initialUploaded.current = true;
      void upload(initialFile);
    }
  }, [initialFile]);
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
        confirm_paid: true,
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
      className="gf-payment-fast-modal"
      title={done ? "Pago registrado" : "Subir comprobante"}
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
          <PaymentProofActions payment={done.payment} request={request} />
          <Button variant="secondary" onClick={onClose}>
            Terminar
          </Button>
        </div>
      ) : (
        <form
          className="gf-record-payment gf-record-payment-fast"
          onSubmit={submit}
        >
          <div className="gf-pay-target">
            <span>{request.counterparty}</span>
            <strong>{money(amount(value))}</strong>
            <small>{request.description}</small>
          </div>
          <input
            type="file"
            ref={file}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button
            type="button"
            icon={Upload}
            loading={uploading}
            variant={evidence ? "secondary" : ""}
            onClick={() =>
              preview
                ? setEvidence({ id: -1, name: "Comprobante de ejemplo" })
                : file.current.click()
            }
          >
            {uploading
              ? "Leyendo comprobante…"
              : evidence
              ? "Cambiar comprobante"
              : "Elegir comprobante"}
          </Button>
          {!evidence && (
            <BeneficiaryDetails
              compact
              beneficiary={beneficiary}
              selected={destination}
              onSelect={setDestination}
            />
          )}
          {evidence && (
            <>
              <p className="gf-fast-file">
                <FileCheck2 size={19} /> {evidence.name}
              </p>
              <Field label="Sale de">
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  disabled={uploading || busy}
                  required
                >
                  <option value="">Selecciona la cuenta de origen</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bank} · {a.name} · {a.last_four}
                    </option>
                  ))}
                </select>
              </Field>
              {origin && (
                <p className="gf-fast-origin" role="status">
                  {origin.state === "matched"
                    ? `Cuenta detectada por el comprobante · ${origin.suffix}`
                    : origin.state === "ambiguous"
                    ? "Coincide con varias cuentas; elige la correcta."
                    : "Revisa y elige la cuenta desde la que pagaste."}
                </p>
              )}
              <Field label="Referencia">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Número de operación"
                  maxLength={200}
                  required
                />
              </Field>
              {beneficiary && beneficiary.accounts.length > 1 && (
                <Field label="Cuenta del beneficiario">
                  <select
                    value={destination ?? ""}
                    onChange={(e) => setDestination(Number(e.target.value))}
                    required
                  >
                    <option value="">
                      Elige la cuenta que recibió el pago
                    </option>
                    {beneficiary.accounts.map((a, i) => (
                      <option key={i} value={i}>
                        {a.bank} · {a.number}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <details className="gf-fast-edit">
                <summary>Editar monto o fecha · {dateLabel(day)}</summary>
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
              </details>
            </>
          )}
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <div className="gf-fast-confirm">
            <Button
              type="submit"
              icon={Check}
              loading={busy}
              disabled={
                !evidence ||
                !destinationLoaded ||
                (beneficiary && beneficiary.kind!=='employee' && destination === null) ||
                uploading ||
                !account ||
                !reference.trim() ||
                amount(value) <= 0 ||
                amount(value) > request.remaining_cents
              }
              className="gf-full-width"
            >
              {preview ? "Simular registro" : "Confirmar pago realizado"}
            </Button>
            <small>
              Se guardará este comprobante y se actualizará el pendiente.
            </small>
          </div>
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
        payment.paid_day
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
            })
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
    file && navigator.share && navigator.canShare?.({ files: [file] })
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
                payment.evidence_name
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
                          payment.evidence_name
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
                            space?.share_phone || ""
                          ).replace(/\D/g, "")}?text=${encodeURIComponent(
                            message
                          )}`,
                          "_blank",
                          "noopener,noreferrer"
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
      space?.members?.map((m) => m.member_id) || []
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
              m.business_ids.some((b) => space?.business_ids.includes(b))
          )
        )
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
                      : p.filter((id) => id !== m.id)
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
      user.business_ids.filter((id) => id !== "personal").slice(0, 1)
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
                    e.target.checked ? [...p, id] : p.filter((b) => b !== id)
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
  if (isNativeFinance()) return <NativePushEnrollment />;
  const { data, user, notify } = useFinance();
  const allowed = user.role === "owner" || user.checks_manage;
  const [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState(null),
    [detail, setDetail] = useState(
      "Comprobando los avisos de este dispositivo…"
    );
  const mounted = useRef(true),
    timers = useRef([]);
  const supported =
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "serviceWorker" in navigator &&
    "Notification" in window;
  async function registration() {
    const reg = await navigator.serviceWorker.register("/finanzas/sw.js", {
      scope: "/finanzas/",
      updateViaCache: "none",
    });
    if (!reg.active)
      await new Promise((resolve, reject) => {
        const worker = reg.installing || reg.waiting;
        const id = setTimeout(() => {
          worker?.removeEventListener("statechange", changed);
          reject(
            new Error(
              "La app sigue preparando los avisos. Reabre Gema e inténtalo de nuevo."
            )
          );
        }, 15000);
        timers.current.push(id);
        const changed = () => {
          if (reg.active || worker?.state === "activated") {
            clearTimeout(id);
            worker?.removeEventListener("statechange", changed);
            resolve();
          }
        };
        worker?.addEventListener("statechange", changed);
        changed();
      });
    return reg;
  }
  async function inspect() {
    if (!supported || !allowed || data.capabilities.public_preview) return;
    try {
      const cfg = await financeApi("/push/config");
      if (!mounted.current) return;
      setConfig(cfg);
      if (!cfg.enabled) {
        setDetail("Los avisos están pendientes de configurar en el servidor.");
        return;
      }
      if (Notification.permission === "denied") {
        setDetail(
          "Los avisos están bloqueados. En Chrome: configuración de este sitio → Notificaciones → Permitir. Revisa también Ajustes de Android → Notificaciones → Chrome o Gema."
        );
        return;
      }
      if (Notification.permission !== "granted") {
        setDetail(
          "Actívalos aquí para recibir pendientes aunque Gema esté cerrada."
        );
        return;
      }
      const reg = await registration(),
        sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setEnabled(false);
        setDetail("El permiso está concedido; falta activar este dispositivo.");
        return;
      }
      await financeApi("/push/subscribe", { subscription: sub.toJSON() });
      const status = await financeApi("/push/status", {
        endpoint: sub.endpoint,
      });
      if (!mounted.current) return;
      setEnabled(status.registered);
      setDetail(
        status.latest_test?.displayed_at
          ? "La última prueba llegó al navegador de este dispositivo."
          : "Dispositivo conectado. Envía una prueba para comprobar que aparece en tu celular."
      );
    } catch (e) {
      if (mounted.current) setDetail(e.message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void inspect();
    const visible = () => {
      if (document.visibilityState === "visible") void inspect();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [user.id]);
  async function test(sub) {
    await financeApi("/push/test", { endpoint: sub.endpoint });
    if (!mounted.current) return;
    setDetail("Prueba enviada. Comprobando si este dispositivo la recibe…");
    const poll = async (attempt) => {
      if (!mounted.current) return;
      try {
        const status = await financeApi("/push/status", {
          endpoint: sub.endpoint,
        });
        if (!mounted.current) return;
        if (status.latest_test?.displayed_at) {
          setDetail(
            "Prueba recibida por este dispositivo. Revisa la barra de notificaciones del celular."
          );
          return;
        }
        if (attempt < 7) {
          timers.current.push(setTimeout(() => void poll(attempt + 1), 2000));
          return;
        }
        setDetail(
          "El servicio aceptó la prueba, pero el celular no confirmó recepción. Revisa los avisos de Chrome/Gema en Ajustes de Android, la conexión y el ahorro de batería."
        );
      } catch (e) {
        if (mounted.current) setDetail(e.message);
      }
    };
    void poll(0);
  }
  async function enable() {
    if (!supported || !config?.enabled) return;
    // Ask synchronously in the tap handler: awaiting an API first can lose the gesture.
    const permission =
      Notification.permission === "granted"
        ? Promise.resolve("granted")
        : Notification.requestPermission();
    setBusy(true);
    try {
      if ((await permission) !== "granted")
        throw new Error(
          "Permite las notificaciones de Gema en Chrome y en los ajustes de tu celular. Tus pendientes seguirán visibles dentro de la app."
        );
      const reg = await registration();
      const key = config.public_key.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(
        atob(key + "=".repeat((4 - (key.length % 4)) % 4)),
        (c) => c.charCodeAt(0)
      );
      let sub = await reg.pushManager.getSubscription();
      if (
        sub?.options.applicationServerKey &&
        String(new Uint8Array(sub.options.applicationServerKey)) !==
          String(bytes)
      ) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ||= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await financeApi("/push/subscribe", { subscription: sub.toJSON() });
      if (!mounted.current) return;
      setEnabled(true);
      notify("Avisos activados para este dispositivo");
      await test(sub);
    } catch (e) {
      if (mounted.current) {
        setDetail(e.message);
        notify(e.message, true);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function sendTest() {
    setBusy(true);
    try {
      const reg = await registration(),
        sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setEnabled(false);
        throw new Error("Vuelve a activar los avisos de este dispositivo.");
      }
      await test(sub);
    } catch (e) {
      if (mounted.current) {
        setDetail(e.message);
        notify(e.message, true);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!allowed || data.capabilities.public_preview) return null;
  return (
    <section
      className="gf-push-enrollment"
      aria-label="Notificaciones de este dispositivo"
    >
      <Bell size={22} />
      <div>
        <strong>
          {enabled ? "Avisos conectados" : "Activa tus avisos al celular"}
        </strong>
        <p>
          {supported
            ? detail
            : "Este navegador no permite avisos. Abre Gema en Chrome de Android, o añádela a Inicio en Safari de iPhone. Los pendientes siempre quedan en la app."}
        </p>
      </div>
      {supported && config?.enabled && (
        <Button
          variant="secondary"
          loading={busy}
          onClick={enabled ? sendTest : enable}
        >
          {enabled ? "Probar aviso" : "Activar avisos"}
        </Button>
      )}
    </section>
  );
}
