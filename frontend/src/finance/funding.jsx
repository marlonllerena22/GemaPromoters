import React, { useState } from "react";
import {
  Plus,
  Check,
  AlertCircle,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal, SectionHead } from "./components.jsx";
import { financeApi, money, dateLabel, today } from "./api.js";
import { PushEnrollment } from "./workflows.jsx";
import { BankLogo } from "./banks.jsx";
const cents = (s) => Math.round(Number(String(s).replace(",", ".")) * 100);
export function FundingAlertBar() {
  const { data, user, navigate } = useFinance();
  const a = data.funding_overview?.accounts?.find(
    (a) => a.shortfall_now_cents > 0,
  );
  if (!a || (!user.checks_manage && user.role !== "owner")) return null;
  return (
    <button className="gf-loan-alert-bar" onClick={() => navigate("cheques")}>
      <AlertCircle size={23} />
      <span>
        <strong>
          Faltan {money(a.shortfall_now_cents)} para cubrir cheques
        </strong>
        <small>
          Cuenta corriente ··{a.last_four}. Revisa los cheques pendientes.
        </small>
      </span>
      <ArrowRight size={18} />
    </button>
  );
}
export function Checks() {
  const { data, open } = useFinance();
  const f = data.funding_overview || {},
    pending = (f.checks || []).filter((c) => c.status === "pending");
  return (
    <>
      <SectionHead
        eyebrow="EL DINERO, DOS DÍAS ANTES"
        title="Cheques y cuenta corriente"
        description="Solo Germán, Morelia y Marlon administran este apartado."
      >
        <Button icon={Plus} onClick={() => open("check-editor")}>
          Agregar cheque
        </Button>
      </SectionHead>
      <PushEnrollment />
      {(f.accounts || []).map((a) => (
        <section className="gf-panel gf-funding-account" key={a.id}>
          <header>
            <BankLogo bank="Guayaquil" />
            <div>
              <h3>{a.name}</h3>
              <p>Saldo registrado ··{a.last_four}</p>
            </div>
            <strong>{money(a.balance_cents)}</strong>
          </header>
          <div className="gf-funding-shortfall">
            <span>
              Falta depositar para los cheques que ya necesitan fondos
            </span>
            <strong>{money(a.shortfall_now_cents)}</strong>
            <small>
              Se mantienen pendientes hasta comprobar el cobro. Incluye fechas
              vencidas.
            </small>
          </div>
          <div className="gf-table-scroll">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Cobro</th>
                  <th>Dinero listo</th>
                  <th>Cheques</th>
                  <th>Valor</th>
                  <th>Falta acumulada</th>
                </tr>
              </thead>
              <tbody>
                {a.groups.map((g) => (
                  <tr key={g.due_day}>
                    <td>
                      {dateLabel(g.due_day, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td>{dateLabel(g.fund_day)}</td>
                    <td>{g.count}</td>
                    <td>{money(g.amount_cents)}</td>
                    <td>
                      <strong>{money(g.shortfall_cents)}</strong>
                      {g.needs_review && (
                        <small className="gf-block">
                          Incluye un valor por revisar
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <SectionHead
        title={`${pending.length} cheques pendientes`}
        description="Toca un cheque para revisar sus datos o registrar una corrección."
      />
      <div className="gf-check-list">
        {pending.map((c) => (
          <button key={c.id} onClick={() => open("check-editor", { id: c.id })}>
            <span className="gf-check-number">#{c.number}</span>
            <span>
              <strong>{c.payee}</strong>
              <small>
                {dateLabel(c.due_day, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                {Boolean(c.needs_review) && " · Revisar dato"}
              </small>
            </span>
            <b>{money(c.amount_cents)}</b>
          </button>
        ))}
      </div>
      {!pending.length && (
        <p className="gf-note">No hay cheques pendientes registrados.</p>
      )}
      <p className="gf-payee-hint">
        El cálculo acumula todos los cheques anteriores pendientes y usa el
        saldo una sola vez. Los depósitos futuros todavía no se cuentan. Las
        fechas se mantienen según el cuaderno, sin asumir cambios por fines de
        semana.
      </p>
    </>
  );
}
export function CheckEditor({ id, onClose }) {
  const { data, user, refresh, notify } = useFinance(),
    f = data.funding_overview || {},
    old = f.checks?.find((c) => c.id === id),
    account =
      old?.account_id ||
      f.accounts?.[0]?.id ||
      data.accounts?.find(
        (a) => /guayaquil/i.test(a.bank) && /corriente/i.test(a.name),
      )?.id;
  const [number, setNumber] = useState(old?.number || ""),
    [payee, setPayee] = useState(old?.payee || ""),
    [amount, setAmount] = useState(
      old ? (old.amount_cents / 100).toFixed(2) : "",
    ),
    [day, setDay] = useState(old?.due_day || today()),
    [reason, setReason] = useState(""),
    [bank, setBank] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = (data.bank_transactions || []).filter(
    (b) =>
      b.account_id === account && old && b.amount_cents === -old.amount_cents,
  );
  async function run(task) {
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
      notify("Cheque actualizado");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={old ? `Cheque ${old.number}` : "Nuevo cheque"}
      subtitle="Cuenta corriente de Guayaquil"
      onClose={onClose}
    >
      <form
        className="gf-operation-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            financeApi(id ? `/checks/${encodeURIComponent(id)}` : "/checks", {
              account_id: account,
              number,
              payee,
              amount_cents: cents(amount),
              due_day: day,
              version: old?.version,
              reason,
            }),
          );
        }}
      >
        {Boolean(old?.needs_review) && (
          <p className="gf-note">{old.review_note}</p>
        )}
        <Field label="Número de cheque">
          <input
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
        </Field>
        <Field label="A la orden de">
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            required
          />
        </Field>
        <Field label="Valor (USD)">
          <input
            className="gf-operation-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Fecha de cobro">
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </Field>
        {old && (
          <Field label="Motivo de la corrección">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </Field>
        )}
        {error && <p className="gf-error">{error}</p>}
        <Button type="submit" loading={busy}>
          Guardar cheque
        </Button>
      </form>
      {old && user.role === "owner" && (
        <section className="gf-operation-form gf-mt">
          <h3>Comprobar que ya se cobró</h3>
          <Field label="Débito real de esta cuenta">
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Seleccionar débito bancario importado</option>
              {rows.map((b) => (
                <option value={b.id} key={b.id}>
                  {dateLabel(b.day)} · {money(-b.amount_cents)} · {b.reference}
                </option>
              ))}
            </select>
          </Field>
          <Button
            icon={Check}
            variant="secondary"
            disabled={!bank || Boolean(old.needs_review)}
            loading={busy}
            onClick={() =>
              run(() =>
                financeApi(`/checks/${encodeURIComponent(id)}/clear`, {
                  bank_transaction_id: Number(bank),
                }),
              )
            }
          >
            Confirmar cheque cobrado
          </Button>
          <p className="gf-payee-hint">
            Sin el débito bancario, el cheque conserva su reserva.
          </p>
        </section>
      )}
    </Modal>
  );
}
export function Cards() {
  const { data, open } = useFinance(),
    cards = data.funding_overview?.cards || [];
  return (
    <>
      <SectionHead
        eyebrow="CORTES Y FECHAS LÍMITE"
        title="Pagos de tarjetas"
        description="Al corte, registra el pago total del estado de cuenta. Te avisaremos antes del día 9."
      />
      <PushEnrollment />
      <div className="gf-loan-grid">
        {cards.map((c) => (
          <article className="gf-loan-card" key={c.id}>
            <header>
              <BankLogo bank={c.bank} />
              <div>
                <h3>{c.name}</h3>
                <span>
                  Corte {c.cut_day} · fecha máxima {c.due_day}
                </span>
              </div>
            </header>
            <p>
              {c.debit_account_id
                ? `Se paga desde ${c.account_name} ··${c.last_four}`
                : "Eliges la cuenta al pagar. Debes pagar antes del día 9."}
            </p>
            {c.statements.map((s) => (
              <button
                className="gf-card-statement"
                key={s.id}
                onClick={() => open("card-statement", { id: s.id })}
              >
                <span>
                  <strong>
                    {s.total_cents === null
                      ? "Indicar cuánto hay que pagar"
                      : money(s.total_cents)}
                  </strong>
                  <small>
                    Corte {dateLabel(s.cut_date)} · límite{" "}
                    {dateLabel(s.due_date)}
                  </small>
                </span>
                <b>
                  {s.state === "paid"
                    ? "Pagada"
                    : s.total_cents === null
                      ? "Falta total"
                      : "Por pagar"}
                </b>
              </button>
            ))}
          </article>
        ))}
      </div>
      <p className="gf-note">
        Pagar la tarjeta reduce la deuda; no vuelve a registrar como gasto las
        compras que ya constan. Un monto sin estado de cuenta se muestra
        pendiente de indicar.
      </p>
    </>
  );
}
export function CardStatement({ id, onClose }) {
  const { data, refresh, notify } = useFinance(),
    card = data.funding_overview.cards.find((c) =>
      c.statements.some((s) => s.id === id),
    ),
    s = card?.statements.find((s) => s.id === id);
  const [value, setValue] = useState(
      s?.total_cents === null ? "" : ((s?.total_cents || 0) / 100).toFixed(2),
    ),
    [bank, setBank] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!s) return null;
  const rows = (data.bank_transactions || []).filter(
    (b) =>
      (!card.debit_account_id || b.account_id === card.debit_account_id) &&
      b.amount_cents === -s.total_cents,
  );
  async function run(task) {
    setBusy(true);
    try {
      await task();
      await refresh();
      notify("Estado de cuenta actualizado");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={card.name}
      subtitle={`Corte ${dateLabel(s.cut_date)} · límite ${dateLabel(s.due_date)}`}
      onClose={onClose}
    >
      <form
        className="gf-operation-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            financeApi(`/card-statements/${encodeURIComponent(id)}`, {
              total_cents: cents(value),
            }),
          );
        }}
      >
        <Field label="Pago total del estado de cuenta (USD)">
          <input
            className="gf-operation-amount"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            disabled={s.state === "paid"}
          />
        </Field>
        <p className="gf-payee-hint">
          Usa el valor total para pagar, no el pago mínimo.
        </p>
        {error && <p className="gf-error">{error}</p>}
        <Button type="submit" disabled={s.state === "paid"} loading={busy}>
          Guardar total por pagar
        </Button>
      </form>
      {s.total_cents !== null && s.state !== "paid" && (
        <section className="gf-operation-form gf-mt">
          <Field label="Pago realizado desde el banco">
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Elige el débito bancario real</option>
              {rows.map((b) => (
                <option key={b.id} value={b.id}>
                  {data.accounts.find((a) => a.id === b.account_id)?.name} ·{" "}
                  {dateLabel(b.day)} · {money(-b.amount_cents)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="secondary"
            disabled={!bank}
            loading={busy}
            onClick={() =>
              run(() =>
                financeApi(`/card-statements/${encodeURIComponent(id)}/paid`, {
                  bank_transaction_id: Number(bank),
                }),
              )
            }
          >
            Confirmar pago de tarjeta
          </Button>
        </section>
      )}
    </Modal>
  );
}
