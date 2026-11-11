import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  FileCheck2,
  Pencil,
  Upload,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal } from "./components.jsx";
import {
  financeApi,
  money,
  amount,
  today,
  dateLabel,
  businessNames,
} from "./api.js";
import { EvidenceThumbnail, uploadEvidence } from "./payees.jsx";
import { BankLogo } from "./banks.jsx";
import { storeReceiptRoute } from "../../../shared/finance-store-receipts.mjs";
import "./receipt-home.css";

export const pendingReceipt = (r) =>
  ["pending", "reported"].includes(r.status) && !r.confirmed_at;
export function ReceiptList({
  compact = false,
  onlyPending = false,
  productionOnly = false,
}) {
  const { data, user, open } = useFinance(),
    [history, setHistory] = useState(false);
  const rows = (data.receipt_inbox || [])
    .filter((r) => !productionOnly || r.business_id === "producalza")
    .filter((r) => !onlyPending || pendingReceipt(r));
  const visible = onlyPending || history ? rows : rows.slice(0, 5);
  if (!rows.length && compact) return null;
  return (
    <section
      className="gf-receipt-list"
      aria-label={
        user.role === "owner" ? "Depósitos por revisar" : "Mis comprobantes"
      }
    >
      <div className="gf-between">
        <h2>
          {user.role === "owner" ? "Depósitos de clientes" : "Mis comprobantes"}
        </h2>
        <span>{rows.length}</span>
      </div>
      {!rows.length ? (
        <p className="gf-muted">
          Tus comprobantes aparecerán aquí al enviarlos.
        </p>
      ) : (
        visible.map((r) => (
          <button
            className="gf-receipt-row"
            key={r.id}
            onClick={() => open("receipt-review", { id: r.id })}
          >
            <span className="gf-receipt-icon">
              <FileCheck2 size={22} />
            </span>
            <span>
              <strong>{r.counterparty}</strong>
              <small>
                {dateLabel(r.day)} ·{" "}
                {r.status === "reconciled"
                  ? "Conciliado"
                  : r.status === "approved" || r.confirmed_at
                  ? "Confirmado"
                  : r.status === "rejected"
                  ? "Rechazado"
                  : "Enviado · por confirmar"}
              </small>
              {user.role === "owner" && (
                <small>{r.creator_name || r.created_by}</small>
              )}
            </span>
            <b>{money(r.amount_cents)}</b>
            <ChevronRight size={18} />
          </button>
        ))
      )}
      {!onlyPending && rows.length > 5 && (
        <Button variant="ghost" onClick={() => setHistory(!history)}>
          {history ? "Mostrar menos" : "Ver todos mis comprobantes"}
        </Button>
      )}
    </section>
  );
}
export function ReceiptComposer({ initial = {}, onClose }) {
  const { user, data, refresh, notify } = useFinance(),
    picker = useRef(),
    key = useRef(crypto.randomUUID());
  const current = initial.id
    ? (data.receipt_inbox || []).find((r) => r.id === Number(initial.id))
    : null;
  const [business, setBusiness] = useState(
    current?.business_id ||
      initial.business_id ||
      (user.business_ids.length === 1 ? user.business_ids[0] : "producalza")
  );
  const units = data.units.filter(
    (u) =>
      u.business_id === business &&
      (!user.unit_ids.length || user.unit_ids.includes(u.id))
  );
  const [unit, setUnit] = useState(
    current?.unit_id ||
      initial.unit_id ||
      (units.length === 1 ? units[0].id : "")
  );
  const [evidence, setEvidence] = useState(
      current ? { id: current.evidence_id, name: current.evidence_name } : null
    ),
    [value, setValue] = useState(
      current ? String(current.amount_cents / 100) : ""
    ),
    [client, setClient] = useState(current?.counterparty || ""),
    [account, setAccount] = useState(
      current?.account_id ? String(current.account_id) : ""
    ),
    [day, setDay] = useState(current?.day || today()),
    [reference, setReference] = useState(current?.reference || ""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [detected, setDetected] = useState("");
  const accounts = data.receipt_accounts || [];
  async function upload(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    setAccount("");
    setDetected("");
    try {
      const saved = await uploadEvidence(file, business, unit || null);
      setEvidence({ id: saved.id, name: file.name });
      if (data.capabilities.ai) {
        try {
          const { analysis, destination_account } = await financeApi(
            `/evidence/${saved.id}/analyze`,
            {}
          );
          if (analysis.amount_cents)
            setValue(String(analysis.amount_cents / 100));
          if (analysis.payer_name) setClient(analysis.payer_name);
          if (analysis.reference) setReference(analysis.reference);
          if (analysis.day) setDay(analysis.day);
          if (destination_account?.state === "matched") {
            setAccount(String(destination_account.account_id));
            setDetected(`Cuenta detectada · ${destination_account.suffix}`);
          } else setDetected("Elige la cuenta que recibió el depósito.");
        } catch {
          setError(
            "El comprobante está guardado. Completa los datos que faltan."
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
      if (current) {
        await financeApi(`/receipts/${current.id}/edit`, {
          counterparty: client,
          amount_cents: amount(value),
          day,
          reference,
          account_id: account ? Number(account) : null,
          expected_updated_at: current.updated_at,
        });
      } else {
        await financeApi("/quick/register", {
          request_id: key.current,
          text: `Abono de cliente ${client}`,
          evidence_id: evidence.id,
          request: false,
          overrides: {
            business_id: business,
            unit_id: unit || null,
            kind: "income",
            amount_cents: amount(value),
            counterparty: client,
            account_id: account ? Number(account) : null,
            day,
            reference,
            category:
              business === "producalza" ? "Abono de pedido" : "Ventas de local",
            payment_method: "transfer",
          },
        });
      }
      await refresh();
      notify(
        current
          ? "Datos del comprobante corregidos"
          : "Comprobante enviado para confirmar"
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={current ? "Editar comprobante" : "Depósito de cliente"}
      className="gf-payment-fast-modal"
      onClose={onClose}
    >
      <form className="gf-receipt-compose" onSubmit={submit}>
        {!current && (
          <>
            <input
              hidden
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            {!evidence && (
              <div className="gf-receipt-capture">
                <Camera size={34} />
                <strong>Sube el comprobante</strong>
                <span>Revisa los datos que lea Gema.</span>
              </div>
            )}
            <Button
              type="button"
              icon={Upload}
              loading={uploading}
              onClick={() => picker.current.click()}
            >
              {evidence ? "Cambiar comprobante" : "Elegir foto o archivo"}
            </Button>
          </>
        )}
        {evidence && (
          <>
            <p className="gf-receipt-file">
              <FileCheck2 size={18} />
              {evidence.name}
            </p>
            <div className="gf-receipt-main-fields">
              <Field label="Cliente que depositó">
                <input
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="Nombre del cliente"
                  maxLength={200}
                  required
                />
              </Field>
              <Field label="Monto en dólares">
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  required
                />
              </Field>
            </div>
            <Field label="Cuenta que recibió el dinero">
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">Pendiente de identificar</option>
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.bank} · {a.name} · {a.last_four}
                  </option>
                ))}
              </select>
            </Field>
            {detected && <small role="status">{detected}</small>}
            <details>
              <summary>Fecha, referencia y negocio</summary>
              <Field label="Fecha">
                <input
                  type="date"
                  value={day}
                  max={today()}
                  onChange={(e) => setDay(e.target.value)}
                  required
                />
              </Field>
              <Field label="Referencia">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={200}
                />
              </Field>
              {!current && (
                <>
                  <Field label="Negocio">
                    <select
                      value={business}
                      onChange={(e) => {
                        setBusiness(e.target.value);
                        setUnit("");
                        setEvidence(null);
                        setAccount("");
                      }}
                    >
                      {user.business_ids.map((b) => (
                        <option key={b} value={b}>
                          {businessNames[b]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Local">
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    >
                      <option value="">Sin local</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
            </details>
            <Button
              type="submit"
              icon={Check}
              disabled={!client.trim() || amount(value) <= 0 || uploading}
              loading={busy}
            >
              {current ? "Guardar cambios" : "Enviar comprobante"}
            </Button>
          </>
        )}
        {error && (
          <p className="gf-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
export function ReceiptReview({ id, onClose }) {
  const { data, user, open, refresh, notify } = useFinance(),
    r =
      (data.receipt_inbox || []).find((row) => row.id === Number(id)) ||
      (data.store_receipts || []).find((row) => row.id === Number(id));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const storeRow = (data.store_receipts || []).find(
    (row) => row.id === Number(id)
  );
  const retailReceipt =
    r?.business_id === "marjorie" && r?.unit_id?.startsWith("marjorie-");
  const canConfirm = retailReceipt
    ? storeRow?.can_confirm && storeRow.assigned_to_me !== false
    : user.role === "owner";
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      if (retailReceipt)
        await financeApi(`/store-receipts/${r.id}/confirm`, {});
      else
        await financeApi(`/movements/${r.id}/review`, {
          status: "approved",
          note: "Comprobante revisado desde Inicio",
        });
      await refresh();
      notify("Depósito confirmado");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Comprobante de cliente"
      className="gf-payment-fast-modal"
      onClose={onClose}
    >
      {!r ? (
        <p>Actualiza el Inicio para consultar este comprobante.</p>
      ) : (
        <div className="gf-receipt-review">
          <header>
            <span>
              {r.creator_name || r.created_by} · {dateLabel(r.day)}
            </span>
            <strong>{money(r.amount_cents)}</strong>
            <h3>{r.counterparty}</h3>
          </header>
          {r.bank && (
            <div className="gf-receipt-bank">
              <BankLogo bank={r.bank} />
              <span>
                {r.account_name}
                <small>
                  {r.bank} · {r.last_four}
                </small>
              </span>
            </div>
          )}
          {canConfirm && pendingReceipt(r) && (
            <Button icon={Check} loading={busy} onClick={confirm}>
              Confirmar depósito revisado
            </Button>
          )}
          {r.can_edit && (
            <Button
              variant="secondary"
              icon={Pencil}
              onClick={() => open("receipt-edit", { id: r.id })}
            >
              Editar cliente, monto o cuenta
            </Button>
          )}
          <EvidenceThumbnail
            path={`/evidence/${r.evidence_id}`}
            title="Comprobante recibido"
            returnType="receipt-review"
            returnInitial={{ id: r.id }}
          />
          <p className="gf-receipt-status">
            {r.confirmed_at || ["approved", "reconciled"].includes(r.status)
              ? "Confirmado"
              : r.status === "rejected"
              ? "Rechazado"
              : "Enviado · pendiente de confirmación"}
          </p>
          {r.reference && <small>Referencia {r.reference}</small>}
          {error && <p className="gf-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
