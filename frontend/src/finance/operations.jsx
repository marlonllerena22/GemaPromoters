import React, { useEffect, useRef, useState } from "react";
import { payeeBanks } from "../../../shared/finance-payees.mjs";
import { receivingBank, storeReceiptRoute } from "../../../shared/finance-store-receipts.mjs";
import {ReceiptList} from './receipts.jsx';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal, SectionHead } from "./components.jsx";
import {
  amount,
  dateLabel,
  financeApi,
  money,
  today,
  businessNames,
} from "./api.js";
import { uploadEvidence, EvidenceThumbnail } from "./payees.jsx";
export const isStoreUser = (user) =>
  user.business_ids.includes("marjorie") &&
  (user.unit_ids?.some((id) => id.startsWith("marjorie-")) ||
    user.username === "morelia");
export function RetailBrand() {
  return (
    <img
      className="gf-retail-brand"
      src="/marjorie-botas-logo-transparent.png"
      alt="Calzado Marjorie Botas"
    />
  );
}
export function CustodyFunds() {
  const { data, user, open } = useFinance();
  if (!data.custody_funds?.length) return null;
  return (
    <section className="gf-custody-section">
      <SectionHead
        title="Fondos y efectivo"
        description="Dinero bajo responsabilidad de cada persona."
      />
      <div className="gf-custody-grid">
        {data.custody_funds.map((f) => (
          <div className="gf-custody-card" key={f.id}>
            <span>
              {f.kind === "cash" ? <Banknote size={21} /> : <Wallet size={21} />}
              {f.name}
            </span>
            <strong>
              {f.balance_cents === null
                ? "Sin actualizar"
                : money(f.balance_cents)}
            </strong>
            <small>
              {f.updated_at
                ? `Actualizado ${new Date(f.updated_at).toLocaleString(
                    "es-EC",
                    { timeZone: "America/Guayaquil" },
                  )}`
                : "Pendiente del primer saldo"}
            </small>
            <Button
              variant="secondary"
              onClick={() => open("custody", { id: f.id })}
            >
              {f.can_adjust ? "Actualizar / historial" : "Ver historial"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
export function CustodyEditor({ id, onClose }) {
  const { data, user, refresh, notify, open } = useFinance(),
    fund = data.custody_funds.find((f) => f.id === id);
  const [value, setValue] = useState(
      fund?.balance_cents === null
        ? ""
        : ((fund?.balance_cents || 0) / 100).toFixed(2),
    ),
    [reason, setReason] = useState(""),
    [history, setHistory] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID()),
    can = fund.can_adjust ?? (user.role === "owner" || user.custody_adjust);
  useEffect(() => {
    financeApi("/custody")
      .then((r) => setHistory(r.adjustments.filter((a) => a.custody_id === id)))
      .catch((e) => setError(e.message));
  }, [id, data.generated_at]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi(`/custody/${id}/adjust`, {
        balance_cents: amount(value),
        version: fund.version,
        reason,
        request_key: key.current,
      });
      await refresh();
      key.current = crypto.randomUUID();
      setReason("");
      notify("Saldo actualizado; diferencia registrada");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const delta = amount(value) - (fund.balance_cents || 0);
  return (
    <Modal title={`Fondos de ${fund.name}`} onClose={onClose}>
      <div className="gf-custody-current">
        <span>Saldo registrado</span>
        <strong>
          {fund.balance_cents === null
            ? "Sin actualizar"
            : money(fund.balance_cents)}
        </strong>
      </div>
      <p>
        {fund.kind === "cash"
          ? "Dinero físico · actualización manual por Marlon o Germán"
          : `${fund.bank} · ${fund.account_number || "Número de cuenta por completar"}`}
      </p>
      {user.role === "owner" && fund.kind !== "cash" && (
        <Button
          variant="secondary"
          onClick={() => open("account-number", { custody_id: id })}
        >
          {fund.account_number ? "Editar número" : "Agregar número de cuenta"}
        </Button>
      )}
      {can && (
        <form className="gf-operation-form" onSubmit={save}>
          <Field label="Nuevo saldo real (USD)">
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </Field>
          {value && Number.isSafeInteger(delta) && (
            <p className="gf-note">
              {fund.balance_cents === null
                ? "Saldo inicial"
                : delta >= 0
                  ? "Se registrará una suma"
                  : "Se registrará una resta"}
              : {money(Math.abs(delta))}
            </p>
          )}
          <Field label="Motivo">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ingreso por entradas, entrega de dinero…"
              required
              maxLength={500}
            />
          </Field>
          {error && <p className="gf-error">{error}</p>}
          <Button
            type="submit"
            loading={busy}
            disabled={
              value.trim() === "" || amount(value) < 0 || !reason.trim()
            }
            icon={Check}
          >
            Guardar ajuste
          </Button>
        </form>
      )}
      <h3>Historial de ajustes</h3>
      <div className="gf-custody-history">
        {history.map((a) => (
          <article key={a.id}>
            <strong>
              {a.before_cents === null
                ? "Saldo inicial"
                : a.delta_cents >= 0
                  ? "Suma"
                  : "Resta"}{" "}
              · {money(Math.abs(a.delta_cents))}
            </strong>
            <p>{a.reason}</p>
            <small>
              {a.actor_name || a.actor} ·{" "}
              {new Date(a.created_at).toLocaleString("es-EC", {
                timeZone: "America/Guayaquil",
              })}
            </small>
            <span>Saldo: {money(a.after_cents)}</span>
          </article>
        ))}
        {!history.length && <p>Todavía no hay ajustes registrados.</p>}
      </div>
    </Modal>
  );
}
export function StoreReceiptForm({ onClose }) {
  const { data, user, refresh } = useFinance(),
    units = data.units.filter(
      (u) =>
        u.business_id === "marjorie" &&
        (!user.unit_ids.length || user.unit_ids.includes(u.id)),
    );
  const [unit, setUnit] = useState(units.length === 1 ? units[0].id : ""),
    [bank, setBank] = useState(""),
    [purpose,setPurpose]=useState("client"),
    [value, setValue] = useState(""),
    [evidence, setEvidence] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(null);
  const input = useRef(),
    preview = data.capabilities.public_preview,
    auto = user.auto_confirm_unit_ids?.includes(unit);
  async function upload(file) {
    if (!file || preview) return;
    setBusy(true);
    setError("");
    try {
      const e = await uploadEvidence(file, "marjorie", unit);
      setEvidence({ ...e, name: file.name });
      if (data.capabilities.ai) {
        try {
          const { analysis } = await financeApi(
            `/evidence/${e.id}/analyze`,
            {},
          );
          if (analysis.amount_cents)
            setValue((analysis.amount_cents / 100).toFixed(2));
          setBank(receivingBank(analysis.receiving_bank));
        } catch {}
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await financeApi("/store-receipts", {
        unit_id: unit,
        amount_cents: amount(value),
        evidence_id: evidence.id,
        day: data.period.today,
        receiving_bank: bank,
        purpose,
      });
      await refresh();
      setDone(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={done ? "Comprobante registrado" : "Transferencia de un cliente"}
      subtitle={done ? undefined : "Elige el local y sube el comprobante."}
      onClose={onClose}
    >
      <RetailBrand />
      {!done&&<label className="gr-field">Este comprobante corresponde a<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="client">Transferencia de un cliente</option><option value="cash_remittance">Depósito desde la caja del local</option></select></label>}
      {done ? (
        <div className="gf-transfer-request-done">
          <CheckCircle2 size={44} />
          <strong>{money(amount(value))}</strong>
          <p>
            {done.confirmed
              ? "Confirmada por ti al subir el comprobante. No necesitas otro paso."
              : done.responsible
                ? `Enviada a ${done.responsible} para confirmar.`
                : "Enviada a confirmación del responsable."}
          </p>
          <Button onClick={onClose}>Listo</Button>
        </div>
      ) : (
        <form className="gf-operation-form" onSubmit={submit}>
          <Field label="Local">
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setEvidence(null);
                setBank("");
              }}
              required
              disabled={busy}
            >
              <option value="">Selecciona el local</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor de la transferencia (USD)">
            <input
              className="gf-operation-amount"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
              required
            />
          </Field>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="secondary"
            icon={Camera}
            disabled={!unit || busy}
            onClick={() =>
              preview
                ? setEvidence({ id: -1, name: "Comprobante ficticio" })
                : input.current.click()
            }
          >
            {evidence
              ? evidence.name
              : preview
                ? "Usar comprobante de ejemplo"
                : "Subir comprobante del cliente"}
          </Button>
          <Field label="Banco que recibió el dinero">
            <select value={bank} onChange={(e) => setBank(e.target.value)} required={unit === "marjorie-sur" || auto} disabled={busy}>
              <option value="">Selecciona el banco receptor</option>
              {payeeBanks.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          {!auto && storeReceiptRoute({ unit_id: unit, receiving_bank: bank }) && (
            <p className="gf-note">La revisará {storeReceiptRoute({ unit_id: unit, receiving_bank: bank }).name}.</p>
          )}
          {auto && (
            <p className="gf-note">
              Al enviar, quedará confirmada por {user.name}. La comprobación
              bancaria se conserva como un paso separado.
            </p>
          )}
          {!preview && data.capabilities.ai && (
            <p className="gf-payee-hint">
              La imagen se enviará al servicio de IA configurado para leer el
              monto y el banco receptor. Revisa los datos detectados antes de enviar.
            </p>
          )}
          {error && <p className="gf-error">{error}</p>}
          <Button
            type="submit"
            icon={Check}
            loading={busy}
            disabled={
              !unit ||
              !evidence ||
              ((unit === "marjorie-sur" || auto) && !bank) ||
              !Number.isSafeInteger(amount(value)) ||
              amount(value) <= 0
            }
          >
            {auto ? "Registrar confirmada" : "Enviar a confirmación"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
export function StoreReview() {
  const { data, user, open, refresh, notify } = useFinance();
  const [tab, setTab] = useState("pending"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(null);
  const rows = (data.store_receipts || [])
    .filter(
      (r) => user.role === "owner" || user.review_unit_ids?.includes(r.unit_id),
    )
    .filter((r) =>
      tab === "pending"
        ? r.assigned_to_me !== false && !r.confirmed_at &&
          r.status !== "reconciled" &&
          r.status !== "rejected"
        : true,
    );
  async function confirm(id,alreadyIncluded=false) {
    setBusy(id);
    try {
      const result=await financeApi(`/store-receipts/${id}/confirm`, {already_in_balance:alreadyIncluded});
      await refresh();
      notify(result.disposition==='credited'?'Depósito confirmado y sumado a la cuenta':result.disposition==='included'?'Confirmado sin cambiar el saldo':'Transferencia confirmada sin duplicar el abono');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <SectionHead
        title="Confirmar transferencias"
        description={
          user.role === "owner"
            ? "Transferencias de clientes enviadas desde los locales."
            : "Transferencias del Sur para tu confirmación."
        }
      />
      {user.role==='owner'&&<ReceiptList onlyPending={tab==='pending'} productionOnly/>}
      <RetailBrand />
      <div className="gf-tabs">
        <button
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          Por confirmar
        </button>
        <button
          className={tab === "all" ? "active" : ""}
          onClick={() => setTab("all")}
        >
          Historial
        </button>
      </div>
      {error && <p className="gf-error">{error}</p>}
      <div className="gf-store-review-list">
        {rows.map((r) => (
          <article key={r.id}>
            <div>
              <span>{data.units.find((u) => u.id === r.unit_id)?.name}</span>
              <h3>{money(r.amount_cents)}</h3>
              <p>
                {r.creator_name || r.created_by} · {dateLabel(r.day)}
              </p>
              {r.receiving_bank && <small>{r.receiving_bank}{r.confirmation_responsible ? ` · Confirma ${r.confirmation_responsible}` : ""}</small>}
              {r.confirmed_at && (
                <small>
                  Confirmada por {r.confirmed_by}
                  {r.confirmation_mode === "on_upload" ? " al subir" : ""}
                </small>
              )}
            </div>
            <EvidenceThumbnail
              path={`/store-receipts/${r.id}/evidence`}
              title="Transferencia del cliente"
              returnInitial={{}}
            />
            {!r.confirmed_at && r.status !== "reconciled" && r.can_confirm !== false && (
              <>
              <Button
                icon={Check}
                loading={busy === r.id}
                onClick={() => confirm(r.id)}
              >
                Confirmar transferencia
              </Button>
              <Button variant="secondary" disabled={busy===r.id} onClick={()=>confirm(r.id,true)}>Ya está contemplado</Button>
              {!r.account_id&&<Button variant="secondary" onClick={()=>open('receipt-review',{id:r.id})}>Revisar cuenta del depósito</Button>}
              </>
            )}
          </article>
        ))}
        {!rows.length && (
          <div className="gf-note">
            No hay transferencias pendientes en esta vista.
          </div>
        )}
      </div>
    </>
  );
}
export function GmailPanel() {
  const { data, user, open, refresh, notify } = useFinance();
  if (user.role !== "owner") return null;
  const state = data.mail_status || {};
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const r = await financeApi("/integrations/gmail/start", {});
      window.location.assign(r.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    try {
      const r = await financeApi("/integrations/gmail/sync", {});
      await refresh();
      notify(`${r.imported} avisos nuevos revisados`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="gf-gmail-panel">
      <div className="gf-gmail-title">
        <Mail size={26} />
        <div>
          <h3>Correo bancario</h3>
          <p>{state.email || "Correo del propietario"}</p>
        </div>
        <span>
          {state.last_error
            ? "Revisar conexión"
            : state.connected
              ? "Lectura conectada"
              : "Por activar"}
        </span>
      </div>
      <p>
        {state.auto_posting_enabled === false
          ? state.auto_posting_after
            ? `Por ahora se revisan los avisos sin cambiar saldos. La aplicación automática empieza el ${new Date(state.auto_posting_after).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
            : "Por ahora se revisan los avisos sin cambiar saldos."
          : "Los avisos bancarios reconocidos actualizan tus movimientos. Los dudosos quedan para revisar; los intentos fallidos no cambian saldos."}
      </p>
      <p className="gf-payee-hint">
        Conexión de solo lectura. La IA puede leer los estados de tarjeta
        adjuntos para completar sus pagos.{" "}
        <a href="/finanzas/privacidad.html" target="_blank" rel="noreferrer">
          Ver uso de datos
        </a>
      </p>
      <div className="gf-inline">
        <Button
          icon={state.connected ? RefreshCw : Mail}
          loading={busy}
          onClick={state.connected ? sync : connect}
          disabled={!state.connected && !state.configured}
        >
          {state.connected ? "Actualizar correo" : "Conectar con Google"}
        </Button>
        <Button variant="secondary" onClick={() => open("mail-inbox")}>
          Ver avisos {state.draft_count ? `· ${state.draft_count}` : ""}
        </Button>
      </div>
      {!state.configured && !state.connected && (
        <p className="gf-payee-hint">
          Falta configurar el cliente OAuth de Google del servidor para
          autorizar la lectura continua. El correo conectado al chat ya permite
          la revisión inicial.
        </p>
      )}
      {state.last_error && <p className="gf-error">{state.last_error}</p>}
      {state.last_sync && (
        <small>
          Última revisión:{" "}
          {new Date(state.last_sync).toLocaleString("es-EC", {
            timeZone: "America/Guayaquil",
          })}
        </small>
      )}
      {error && <p className="gf-error">{error}</p>}
    </section>
  );
}
export function MailInbox({ onClose }) {
  const { data, refresh, notify } = useFinance();
  const [selected, setSelected] = useState(null),
    [account, setAccount] = useState(""),
    [direction, setDirection] = useState("outgoing"),
    [business, setBusiness] = useState(""),
    [at, setAt] = useState(""),
    [linkedBank, setLinkedBank] = useState(""),
    [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    financeApi("/mail")
      .then((r) => setMessages(r.messages))
      .catch((e) => setError(e.message));
  }, []);
  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await financeApi(`/mail/${selected.id}/apply`, {
        account_id: Number(account),
        direction,
        business_id: business || null,
        ...(linkedBank ? {link_bank_id:Number(linkedBank)} : {}),
        occurred_at: at ? `${at}:00-05:00` : undefined,
      });
      await refresh();
      const next = await financeApi("/mail");
      setMessages(next.messages);
      setSelected(null);
      notify("Movimiento bancario revisado y registrado");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(message){
    setBusy(true);setError('');
    try{await financeApi(`/mail/${message.id}/archive`,{});setMessages(list=>list.filter(m=>m.id!==message.id));if(selected?.id===message.id)setSelected(null);await refresh();notify('Aviso quitado de la bandeja');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return (
    <Modal
      title="Avisos bancarios"
      subtitle="Las promociones se filtran solas. Puedes quitar un aviso sin cambiar saldos ni borrar el correo de Gmail."
      onClose={onClose}
      wide
    >
      {error && <p className="gf-error">{error}</p>}
      {selected && (
        <form className="gf-operation-form gf-panel" onSubmit={apply}>
          <h3>Registrar {money(selected.amount_cents)}</h3>
          <p>
            Comprueba el aviso en el banco antes de guardarlo.{" "}
            {selected.fee_cents
              ? `También se registrará la comisión explícita de ${money(selected.fee_cents)}.`
              : ""}
          </p>
          <Field label="Cuenta del movimiento">
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
            >
              <option value="">Seleccionar cuenta</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank} · {a.name} ··{a.last_four}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dirección">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="outgoing">Dinero que sale</option>
              <option value="incoming">Dinero que entra</option>
            </select>
          </Field>
          {!selected.occurred_at && (
            <Field label="Fecha y hora reales de la operación (Ecuador)">
              <input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                required
              />
            </Field>
          )}
          <Field label="Relacionar con un movimiento ya registrado" hint="Si este aviso corresponde a un registro de Android o a un comprobante anterior, elígelo para no sumar otra vez.">
            <select value={linkedBank} onChange={e=>setLinkedBank(e.target.value)}><option value="">Sin relación manual</option>{(data.bank_transactions||[]).filter(b=>b.account_id===Number(account)&&b.amount_cents===selected.amount_cents*(direction==='outgoing'?-1:1)).slice(0,30).map(b=><option value={b.id} key={b.id}>{b.day} · {money(Math.abs(b.amount_cents))} · {b.reference||b.description||'Sin referencia'}</option>)}</select>
          </Field>
          <Field label="Asignar ingreso o gasto a">
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
            >
              <option value="">
                Solo movimiento bancario, asociar después
              </option>
              {data.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="gf-payee-hint">
            Un traslado propio o pago de tarjeta no crea ingresos ni repite
            compras. Si ya registraste el pago, conserva solo el movimiento
            bancario para conciliarlo.
          </p>
          <Button type="submit" loading={busy}>
            Confirmar registro
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSelected(null)}
          >
            Cancelar revisión
          </Button>
        </form>
      )}
      <div className="gf-mail-list">
        {messages.map((m) => (
          <article key={m.id}>
            <span>
              {m.bank} ·{" "}
              {m.state === "historical"
                ? "Anterior al punto de partida"
                : m.state === "failed"
                  ? "Intento fallido"
                  : m.state === "applied"
                    ? "Registrado"
                    : m.state === "statement"
                      ? "Total de tarjeta registrado"
                      : m.state === "pending"
                        ? "En proceso en el banco"
                        : "Por revisar"}
            </span>
            <Button variant="ghost" disabled={busy} onClick={()=>archive(m)}>Quitar aviso</Button>
            <h3>
              {m.amount_cents
                ? money(m.amount_cents)
                : "Sin salida de dinero confirmada"}
            </h3>
            <p>{m.subject}</p>
            <small>
              {new Date(m.received_at).toLocaleString("es-EC", {
                timeZone: "America/Guayaquil",
              })}
              {m.event === "internal_transfer"
                ? " · Posible traslado entre cuentas propias"
                : ""}
            </small>
            <details>
              <summary>Ver datos del aviso</summary>
              <p>{m.body}</p>
            </details>
            {m.state === "draft" && (
              <Button
                variant="secondary"
                disabled={!m.trusted || !m.amount_cents}
                onClick={() => {
                  setSelected(m);
                  setLinkedBank("");
                  setAccount(m.account_id ? String(m.account_id) : "");
                  setDirection(m.event === "income" ? "incoming" : "outgoing");
                  setAt("");
                  setBusiness("");
                }}
              >
                Revisar y registrar
              </Button>
            )}
          </article>
        ))}
        {!messages.length && <p>No hay avisos importados todavía.</p>}
      </div>
    </Modal>
  );
}
export function InviteActivation() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get(
    "invite",
  );
  const [info, setInfo] = useState(null),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    financeApi("/access/invite", { token })
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [token]);
  async function activate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (password !== repeat) throw new Error("Las contraseñas no coinciden");
      await financeApi("/access/activate", { token, password });
      window.location.replace("/finanzas/");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gf-activation">
      <div>
        <ShieldCheck size={34} />
        <h1>{info ? `Bienvenida/o, ${info.name}` : "Tu acceso financiero"}</h1>
        {info && (
          <>
            <p>
              Usuario: <strong>{info.username}</strong>
            </p>
            {info.units.length > 0 && <p>{info.units.join(" · ")}</p>}
            <form className="gf-operation-form" onSubmit={activate}>
              <Field label="Crea tu contraseña">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="Repite la contraseña">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={8}
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  required
                />
              </Field>
              <p>Usa 8 caracteres. Este enlace se utiliza una sola vez.</p>
              <Button type="submit" icon={Check} loading={busy}>
                Activar mi acceso
              </Button>
            </form>
          </>
        )}
        {error && <p className="gf-error">{error}</p>}
      </div>
    </div>
  );
}

export function IncomingNotices() {
  const { data, open, selectMovement } = useFinance(),
    notices = data.incoming_notices || [];
  if (!notices.length) return null;
  return (
    <section className="gf-incoming-notices">
      <h3>Depósitos por respaldar</h3>
      {notices.map((n) => (
        <article key={n.id}>
          <div>
            <strong>{n.counterparty}</strong>
            <span>
              {n.bank} ··{n.last_four} ·{" "}
              {n.state === "receipt_received"
                ? "Hay un comprobante para contrastar"
                : "Esperando el comprobante"}
            </span>
          </div>
          <b>{money(n.amount_cents)}</b>
          {n.possible_movement_id &&
          data.movements.some((m) => m.id === n.possible_movement_id) ? (
            <Button
              variant="secondary small"
              onClick={() =>
                selectMovement(
                  data.movements.find((m) => m.id === n.possible_movement_id),
                )
              }
            >
              Comparar
            </Button>
          ) : (
            <Button
              variant="secondary small"
              onClick={() =>
                open("quick", {
                  mode: "receipt",
                  business_id: n.business_id,
                  text: `Abono de ${n.counterparty} por $${n.amount_cents / 100}`,
                })
              }
            >
              Subir comprobante
            </Button>
          )}
        </article>
      ))}
      <p>
        El dinero ya está incluido en el saldo confirmado. Subir el comprobante
        permite identificarlo y no vuelve a sumarlo.
      </p>
    </section>
  );
}
