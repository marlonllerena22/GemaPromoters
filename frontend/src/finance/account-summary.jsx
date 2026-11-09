import React, { useState } from "react";
import { ArrowRight, CalendarDays, LockKeyhole } from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal } from "./components.jsx";
import { BankLogo } from "./banks.jsx";
import { financeApi, money, dateLabel } from "./api.js";
export function LiquidityPlan() {
  const { data, navigate, user } = useFinance(),
    p = data.liquidity;
  if (!p) return null;
  return (
    <section className="gf-liquidity-panel">
      <header>
        <div>
          <span className="gf-eyebrow">ANTES DE USAR EL DINERO</span>
          <h2>Disponibilidad general</h2>
        </div>
        <CalendarDays size={23} />
      </header>
      <div className="gf-liquidity-stats">
        <div>
          <span>Actualmente hay</span>
          <strong>{money(p.cash_cents)}</strong>
          <small>Fondos conocidos, sin sumar corriente</small>
        </div>
        <div className="reserved">
          <span>Apartado en corriente</span>
          <strong>{money(p.checking_reserved_cents)}</strong>
          <small>Reservado para cubrir los cheques</small>
        </div>
        <div>
          <span>Pagos hasta el {dateLabel(p.horizon_day)}</span>
          <strong>{money(p.commitments_cents)}</strong>
          <small>Incluye lo pendiente y los próximos 3 días</small>
        </div>
        <div className={p.shortfall_cents ? "short" : "remaining"}>
          <span>
            {p.shortfall_cents
              ? "Faltaría para esos pagos"
              : "Quedaría tras los pagos conocidos"}
          </span>
          <strong>
            {money(p.shortfall_cents || p.after_known_payments_cents)}
          </strong>
          <small>
            {p.unknown_commitments
              ? "Hay pagos cuyo monto todavía falta indicar"
              : "Según los saldos y compromisos registrados"}
          </small>
        </div>
      </div>
      {p.unknown_commitments > 0 && (
        <button
          className="gf-liquidity-missing"
          onClick={() => navigate("tarjetas")}
        >
          Falta indicar el monto de {p.unknown_commitments}{" "}
          {p.unknown_commitments === 1 ? "pago" : "pagos"} de tarjeta{" "}
          <ArrowRight size={17} />
        </button>
      )}
      <details className="gf-liquidity-detail">
        <summary>Ver qué hay que cubrir</summary>
        {p.obligations.map((o) => (
          <div key={o.id}>
            <span>
              <strong>{o.title}</strong>
              <small>
                {o.day < p.as_of
                  ? "Pendiente de cubrir"
                  : dateLabel(o.day, { day: "numeric", month: "long" })}
              </small>
            </span>
            <b>
              {o.amount_cents === null ? "Por indicar" : money(o.amount_cents)}
            </b>
          </div>
        ))}
        {!p.obligations.length && (
          <p>No hay pagos registrados para estos próximos tres días.</p>
        )}
      </details>
      <p>
        La corriente se aparta una sola vez. Para cheques se reserva únicamente
        lo que falta completar desde las demás cuentas.
      </p>
    </section>
  );
}
export function CardPaymentsPreview() {
  const { data, user, navigate, open } = useFinance(),
    cards = data.funding_overview?.cards || [];
  if (!cards.length) return null;
  return (
    <section className="gf-card-preview">
      <header>
        <h2>Pagos de tarjetas</h2>
        <Button variant="ghost small" onClick={() => navigate("tarjetas")}>
          Ver pagos <ArrowRight size={16} />
        </Button>
      </header>
      <div>
        {cards.map((c) => {
          const s =
            [...c.statements]
              .sort((a, b) => a.due_date.localeCompare(b.due_date))
              .find((s) => !["paid", "paid_before_start"].includes(s.state)) ||
            c.statements[0];
          return (
            <button
              key={c.id}
              onClick={() =>
                user.role === "owner" && s
                  ? open("card-statement", { id: s.id })
                  : navigate("tarjetas")
              }
            >
              <BankLogo bank={c.bank} />
              <span>
                <strong>{c.name}</strong>
                <small>
                  {s
                    ? `Fecha máxima ${dateLabel(s.due_date)}`
                    : `Corte ${c.cut_day} · pago ${c.due_day}`}
                </small>
              </span>
              <b>
                {!s || s.total_cents === null
                  ? "Por indicar"
                  : money(s.total_cents)}
              </b>
            </button>
          );
        })}
      </div>
    </section>
  );
}
export function AccountTiles({ custodyOnly = false }) {
  const { data, user, navigate, open } = useFinance();
  const rows = [
    ...(custodyOnly
      ? []
      : data.accounts.filter((a) =>
          ["bank", "wallet", "card"].includes(a.kind),
        )),
    ...(data.custody_funds || []).map((f) => ({
      ...f,
      id: `custody:${f.id}`,
      custody_id: f.id,
      bank: "Pichincha",
      kind: "custody",
      account_name: f.name,
    })),
  ];
  return (
    <div className="gf-mini-accounts gf-unified-accounts">
      {rows.map((a) => (
        <button
          key={a.id}
          onClick={() =>
            a.custody_id
              ? open("custody", { id: a.custody_id })
              : navigate("cuentas")
          }
        >
          <BankLogo bank={a.bank} kind={a.kind} />
          <span>
            <strong>{a.bank}</strong>
            <small className="gf-account-short-name">
              {a.grouped
                ? `${a.account_count} cuentas de Marlon`
                : a.account_name || a.name.replace(/^.*? · /, "")}
            </small>
            {!a.grouped && (
              <small className="gf-account-number">
                {a.account_number ||
                  (a.last_four
                    ? `··${a.last_four} · por completar`
                    : "Número por completar")}
              </small>
            )}
          </span>
          <span className="gf-amount">
            {a.balance_cents === null ? "Por indicar" : money(a.balance_cents)}
          </span>
          {(a.checking_reserved || a.reserved_cents > 0) && (
            <small className="gf-bank-reserve-label">
              {a.grouped
                ? `${money(a.reserved_cents)} apartados en corriente`
                : "Apartado para cheques"}
            </small>
          )}
        </button>
      ))}
    </div>
  );
}
export function AccountNumberEditor({ id, custodyId, onClose }) {
  const { data, refresh, notify } = useFinance(),
    row = custodyId
      ? data.custody_funds.find((f) => f.id === custodyId)
      : data.accounts.find((a) => a.id === id);
  const [value, setValue] = useState(row?.account_number || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await financeApi(
        custodyId
          ? `/custody/${custodyId}/account-number`
          : `/accounts/${id}/number`,
        { number: value },
      );
      await refresh();
      notify("Número de cuenta guardado");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Cuenta ${row?.name || ""}`}
      subtitle={custodyId ? "Banco Pichincha" : row?.bank}
      onClose={onClose}
    >
      <form className="gf-operation-form" onSubmit={save}>
        <Field label="Número de cuenta completo">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={30}
            required
            placeholder="Conserva los ceros iniciales"
          />
        </Field>
        <p className="gf-payee-hint">
          <LockKeyhole size={15} /> El número se conserva cifrado y se muestra
          según los permisos del perfil.
        </p>
        {error && <p className="gf-error">{error}</p>}
        <Button type="submit" loading={busy}>
          Guardar número de cuenta
        </Button>
      </form>
    </Modal>
  );
}
