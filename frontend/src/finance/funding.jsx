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
  const { data, open, user, refresh, notify } = useFinance(),
    f = data.funding_overview || {},
    [busy, setBusy] = useState(null),
    [error, setError] = useState("");
  async function mark(c, cleared) {
    setBusy(c.id);
    setError("");
    try {
      await financeApi(`/checks/${encodeURIComponent(c.id)}/settlement`, {
        cleared,
        version: c.version,
        request_key: crypto.randomUUID(),
      });
      await refresh();
      notify(
        cleared ? "Cheque marcado cobrado" : "Cheque nuevamente pendiente",
      );
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <SectionHead
        eyebrow="EL DINERO, DOS DÍAS ANTES"
        title="Cheques y cuenta corriente"
        description="Toca una fecha para abrir sus cheques, como en el cuaderno."
      >
        <Button icon={Plus} onClick={() => open("check-editor")}>
          Agregar cheque
        </Button>
      </SectionHead>
      <PushEnrollment />
      {error && <p className="gf-error">{error}</p>}
      {(f.accounts || []).map((a) => (
        <section className="gf-panel gf-funding-account" key={a.id}>
          <header>
            <BankLogo bank="Guayaquil" />
            <div>
              <h3>{a.name}</h3>
              <p>Dinero apartado en corriente</p>
            </div>
            <strong>{money(a.balance_cents)}</strong>
          </header>
          <div className="gf-funding-shortfall">
            <span>
              Falta depositar para los cheques que ya necesitan fondos
            </span>
            <strong>{money(a.shortfall_now_cents)}</strong>
            <small>
              Los cheques pendientes mantienen su reserva. Corriente no se suma
              al disponible para gastar.
            </small>
          </div>
          <div className="gf-cheque-groups">
            {a.groups.map((g) => (
              <details key={g.due_day} className="gf-cheque-group">
                <summary>
                  <span>
                    <strong>
                      {dateLabel(g.due_day, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    <small>
                      Dinero listo desde {dateLabel(g.fund_day)} ·{" "}
                      {g.cleared_count} de {g.count} cobrados
                    </small>
                  </span>
                  <span>
                    <b>{money(g.total_cents ?? g.amount_cents)}</b>
                    <small>
                      {g.pending_count === 0
                        ? "Completado"
                        : `${g.pending_count ?? g.count} pendientes`}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </summary>
                <div className="gf-cheque-paper">
                  <table>
                    <thead>
                      <tr>
                        <th>A la orden de</th>
                        <th>N.º</th>
                        <th>Valor</th>
                        <th>Cobrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        g.checks ||
                        f.checks.filter(
                          (c) =>
                            c.account_id === a.id && c.due_day === g.due_day,
                        )
                      ).map((c) => (
                        <tr
                          key={c.id}
                          className={c.status === "cleared" ? "is-cleared" : ""}
                        >
                          <td>
                            <button
                              onClick={() => open("check-editor", { id: c.id })}
                            >
                              {c.payee}
                            </button>
                            {c.status === "cleared" && (
                              <small>
                                {c.clearing_source === "bank"
                                  ? "Comprobado con el banco"
                                  : `Marcado por ${c.cleared_by_name || c.cleared_by || "responsable"}`}
                              </small>
                            )}
                          </td>
                          <td>{c.number}</td>
                          <td>{money(c.amount_cents)}</td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Cheque ${c.number} de ${c.payee} cobrado`}
                              checked={c.status === "cleared"}
                              disabled={
                                busy === c.id ||
                                !(user.role === "owner" || user.checks_clear) ||
                                Boolean(c.cleared_bank_id)
                              }
                              onChange={(e) => mark(c, e.target.checked)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={2}>Total del grupo</th>
                        <td>{money(g.total_cents ?? g.amount_cents)}</td>
                        <td />
                      </tr>
                      <tr>
                        <th colSpan={2}>Pendiente de cobrar</th>
                        <td>{money(g.amount_cents)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="gf-payee-hint">
        Marlon y Germán pueden marcar los cobrados. Las coincidencias bancarias
        completas se confirman automáticamente; lo dudoso queda para revisar.
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
        <Button
          type="submit"
          loading={busy}
          disabled={old && old.status !== "pending"}
        >
          Guardar cheque
        </Button>
      </form>
      {old && !old.cleared_bank_id && user.role === "owner" && (
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
            Si lo marcaste cobrado, este débito reemplaza esa marca sin volver a
            restar el dinero.
          </p>
        </section>
      )}
    </Modal>
  );
}
export function Cards() {
  const { data, open, user } = useFinance(),
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
              {c.debit_account_id || c.fixed_debit_account
                ? `Se paga desde ${c.account_name}${c.last_four ? ` ··${c.last_four}` : ""}`
                : "Eliges la cuenta al pagar. Debes pagar antes del día 9."}
            </p>
            {c.statements.map((s) => (
              <button
                className="gf-card-statement"
                key={s.id}
                onClick={() =>
                  user.role === "owner" && open("card-statement", { id: s.id })
                }
              >
                <span>
                  <strong>
                    {s.total_cents === null
                      ? "Indicar cuánto hay que pagar"
                      : money(s.remaining_cents ?? s.total_cents)}
                  </strong>
                  <small>
                    Corte {dateLabel(s.cut_date)} · límite{" "}
                    {dateLabel(s.due_date)}
                    {s.paid_cents > 0 &&
                      ` · Pago recibido ${money(s.paid_cents)}`}
                  </small>
                </span>
                <b>
                  {["paid", "paid_before_start"].includes(s.state)
                    ? "Pagada"
                    : s.total_cents === null
                      ? s.paid_cents > 0
                        ? "Pago recibido · falta estado"
                        : "Falta total"
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
            disabled={["paid", "paid_before_start"].includes(s.state)}
          />
        </Field>
        <p className="gf-payee-hint">
          Usa el valor total para pagar, no el pago mínimo.
        </p>
        {error && <p className="gf-error">{error}</p>}
        <Button
          type="submit"
          disabled={["paid", "paid_before_start"].includes(s.state)}
          loading={busy}
        >
          Guardar total por pagar
        </Button>
      </form>
      {s.total_cents !== null &&
        !["paid", "paid_before_start"].includes(s.state) && (
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
                  financeApi(
                    `/card-statements/${encodeURIComponent(id)}/paid`,
                    {
                      bank_transaction_id: Number(bank),
                    },
                  ),
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
