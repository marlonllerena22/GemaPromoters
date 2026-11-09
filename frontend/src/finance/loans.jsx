import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ShieldCheck,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal, SectionHead } from "./components.jsx";
import { money, dateLabel, financeApi } from "./api.js";
import { BankLogo } from "./banks.jsx";
import { PushEnrollment } from "./workflows.jsx";
export function LoanAlertsBar() {
  const { data, user, navigate } = useFinance();
  if (user.role !== "owner") return null;
  const short = (data.loan_overview?.loans || []).filter(
    (l) => l.next && l.shortfall_cents > 0,
  );
  if (!short.length) return null;
  return (
    <button className="gf-loan-alert-bar" onClick={() => navigate("prestamos")}>
      <AlertCircle size={22} />
      <span>
        <strong>Revisa el dinero para tus préstamos</strong>
        <small>
          {short.length}{" "}
          {short.length === 1 ? "cuenta necesita" : "cuentas necesitan"} fondos
          para el próximo débito.
        </small>
      </span>
      <ArrowRight size={18} />
    </button>
  );
}
export function Loans() {
  const { data, open } = useFinance(),
    loans = data.loan_overview?.loans || [];
  return (
    <>
      <SectionHead
        eyebrow="TUS CUOTAS, A TIEMPO"
        title="Préstamos y débitos"
        description="Aviso el día anterior y alerta si el saldo registrado no alcanza."
      />
      <PushEnrollment />
      <div className="gf-loan-grid">
        {loans.map((l) => (
          <article className="gf-loan-card" key={l.id}>
            <header>
              <BankLogo bank={l.bank} />
              <div>
                <h3>{l.name}</h3>
                <span>
                  {l.bank} · cuenta ··{l.last_four}
                </span>
              </div>
              <ShieldCheck size={21} />
            </header>
            {l.next ? (
              <>
                <div className="gf-loan-next">
                  <span>
                    Próxima cuota ·{" "}
                    {dateLabel(l.next.due_day, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <strong>{money(l.next.total_cents)}</strong>
                  <small>
                    Cuota {l.next.sequence} · débito de {l.account_name}
                  </small>
                </div>
                <div className="gf-loan-funding">
                  <span>
                    Saldo registrado en esa cuenta{" "}
                    <b>{money(l.balance_cents)}</b>
                  </span>
                  <span className={l.shortfall_cents ? "short" : "enough"}>
                    {l.shortfall_cents
                      ? "Falta para cubrir el débito"
                      : "Saldo suficiente para la próxima cuota"}
                    <b>
                      {l.shortfall_cents ? (
                        money(l.shortfall_cents)
                      ) : (
                        <Check size={18} />
                      )}
                    </b>
                  </span>
                </div>
                <p className="gf-loan-remind">
                  <Bell size={16} />
                  Aviso:{" "}
                  {dateLabel(l.remind_day, { day: "numeric", month: "long" })} ·
                  09:00
                </p>
                <Button
                  variant="secondary"
                  onClick={() => open("loan-detail", { id: l.id })}
                >
                  Ver cuotas y confirmar débito
                </Button>
              </>
            ) : (
              <p>Todas las cuotas registradas están resueltas.</p>
            )}
            {Boolean(l.variable_rate) && (
              <small className="gf-loan-variable">
                Tabla informativa con tasa reajustable. El valor final se
                comprueba con el débito del banco.
              </small>
            )}
          </article>
        ))}
      </div>
      {!loans.length && (
        <div className="gf-note">
          Los préstamos aparecerán al cargar sus tablas y cuentas de débito.
        </div>
      )}
      <p className="gf-payee-hint">
        Las alertas usan el saldo registrado en Gema. Los avisos externos
        requieren autorizar notificaciones en este dispositivo. Una cuota no se
        marca pagada por la fecha: debe vincularse al débito real.
      </p>
    </>
  );
}
export function LoanDetail({ id, onClose }) {
  const { data, refresh, notify } = useFinance(),
    l = data.loan_overview?.loans.find((l) => l.id === id);
  const [bank, setBank] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!l) return <Modal title="Préstamo no disponible" onClose={onClose} />;
  const rows =
    data.bank_transactions?.filter(
      (b) =>
        b.account_id === l.account_id &&
        b.amount_cents < 0 &&
        l.next &&
        Math.abs(b.amount_cents) === l.next.total_cents,
    ) || [];
  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await financeApi(`/loans/${id}/installments/${l.next.sequence}/confirm`, {
        bank_transaction_id: Number(bank),
      });
      await refresh();
      notify("Cuota vinculada al débito bancario");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={l.name}
      subtitle={`${l.bank} · cuenta ··${l.last_four}`}
      onClose={onClose}
      wide
    >
      {l.next && (
        <form className="gf-operation-form" onSubmit={confirm}>
          <h3>
            Confirmar cuota {l.next.sequence} · {money(l.next.total_cents)}
          </h3>
          <Field label="Débito bancario real">
            <select
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              required
            >
              <option value="">Seleccionar el movimiento importado</option>
              {rows.map((b) => (
                <option key={b.id} value={b.id}>
                  {dateLabel(b.day)} · {money(Math.abs(b.amount_cents))} ·{" "}
                  {b.reference}
                </option>
              ))}
            </select>
          </Field>
          {!rows.length && (
            <p className="gf-note">
              Todavía no se ha importado el débito de esta cuota. No se marcará
              pagada sin comprobarlo.
            </p>
          )}
          {error && <p className="gf-error">{error}</p>}
          <Button type="submit" icon={Check} loading={busy} disabled={!bank}>
            Confirmar débito de esta cuota
          </Button>
        </form>
      )}
      <details className="gf-loan-schedule" open>
        <summary>Tabla de cuotas</summary>
        <div className="gf-table-scroll">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Cuota</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Capital</th>
                <th>Interés</th>
                <th>Seguros</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {l.installments.map((i) => (
                <tr key={i.sequence}>
                  <td>{i.sequence}</td>
                  <td>
                    {dateLabel(i.due_day, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td>{money(i.total_cents)}</td>
                  <td>{money(i.principal_cents)}</td>
                  <td>{money(i.interest_cents)}</td>
                  <td>{money(i.insurance_cents)}</td>
                  <td>
                    {i.status === "prior_paid"
                      ? "Anterior · al día según tabla"
                      : i.status === "paid"
                        ? "Débito confirmado"
                        : "Pendiente de débito"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Modal>
  );
}
