import React, { useState } from "react";
import { Check, Clock3, Pencil } from "lucide-react";
import { useFinance } from "./context.jsx";
import { BankLogo } from "./banks.jsx";
import { Button, Field, Modal } from "./components.jsx";
import { amount, dateLabel, financeApi, money, today } from "./api.js";
export function SettlementFunds({ editable = true }) {
  const { data, user, open } = useFinance();
  if (
    user.role === "collector" ||
    !data.businesses.some((b) => b.id === "marjorie")
  )
    return null;
  const balance = data.settlement_funds?.find((s) => s.provider === "diners");
  return (
    <section className="gf-settlement-funds" aria-label="Fondos de Diners">
      <header>
        <BankLogo bank="Diners" />
        <div>
          <strong>Diners</strong>
          <span>Cobros de Marjorie Botas</span>
        </div>
        {editable && user.role === "owner" && (
          <button onClick={() => open("diners-balance")}>
            <Pencil size={15} />
            {balance ? "Actualizar" : "Ingresar saldos"}
          </button>
        )}
      </header>
      <div className="gf-settlement-values">
        <div>
          <span>Efectivizado</span>
          <strong>
            {balance ? money(balance.available_cents) : "Sin actualizar"}
          </strong>
        </div>
        <div>
          <span>Por efectivizar</span>
          <strong>
            {balance ? money(balance.pending_cents) : "Sin actualizar"}
          </strong>
        </div>
      </div>
      <footer>
        <Clock3 size={14} />
        {balance
          ? `Saldo manual al ${dateLabel(balance.as_of)} · separado de bancos`
          : "Actualización manual · sin número de cuenta"}
      </footer>
    </section>
  );
}
export function SettlementBalanceForm({ onClose }) {
  const { data, refresh, notify } = useFinance();
  const saved = data.settlement_funds?.find((s) => s.provider === "diners");
  const [available, setAvailable] = useState(
      saved ? (saved.available_cents / 100).toFixed(2) : ""
    ),
    [pending, setPending] = useState(
      saved ? (saved.pending_cents / 100).toFixed(2) : ""
    ),
    [day, setDay] = useState(
      saved?.as_of ||
        (data.capabilities.public_preview ? data.period.today : today())
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi("/settlement-funds/diners", {
        available_cents: amount(available),
        pending_cents: amount(pending),
        as_of: day,
      });
      await refresh();
      notify("Saldos de Diners actualizados");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Saldos de Diners"
      subtitle="Solo los cobros de Marjorie. Sin número de cuenta."
      onClose={onClose}
    >
      <form className="gf-diners-balance-form" onSubmit={submit}>
        {data.capabilities.public_preview && (
          <div className="gf-note">
            Prueba con valores ficticios. Se reinician al recargar.
          </div>
        )}
        <Field label="Dinero efectivizado (USD)">
          <input
            inputMode="decimal"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
            placeholder="0,00"
            required
          />
        </Field>
        <Field label="Dinero por efectivizar (USD)">
          <input
            inputMode="decimal"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            placeholder="0,00"
            required
          />
        </Field>
        <Field label="Fecha de estos saldos">
          <input
            type="date"
            value={day}
            max={data.period.today}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </Field>
        <p className="gf-payee-hint">
          Son los saldos que quedan en Diners, después de los retiros. Lo
          pendiente se muestra separado del dinero disponible. Actualizarlos no
          crea una venta ni un depósito en Pichincha.
        </p>
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
            available.trim() === "" ||
            pending.trim() === "" ||
            ![amount(available), amount(pending)].every(
              (n) => Number.isSafeInteger(n) && n >= 0
            )
          }
          className="gf-full-width"
        >
          Guardar saldos
        </Button>
      </form>
    </Modal>
  );
}
