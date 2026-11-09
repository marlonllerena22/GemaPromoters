import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  FileText,
  ListChecks,
  Loader2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Upload,
  Wallet,
} from "lucide-react";
import {
  interpretQuickEntry,
  quickMoney,
} from "../../../shared/finance-quick.mjs";
import { useFinance } from "./context.jsx";
import {
  businessNames,
  categories,
  dateLabel,
  financeApi,
  money,
  today,
} from "./api.js";
import { Badge, Button, Field, Modal } from "./components.jsx";

export function QuickAccess() {
  const { open } = useFinance();
  return (
    <section className="gf-quick-access" aria-label="Registro rápido">
      <div className="gf-quick-access-symbol">
        <Sparkles size={23} />
      </div>
      <div>
        <span className="gf-eyebrow">MENOS PASOS. MÁS CLARIDAD.</span>
        <h2>Cuéntamelo en una frase.</h2>
        <p>«Registra un gasto personal de $80 en gasolina»</p>
      </div>
      <div className="gf-quick-access-actions">
        <Button icon={Mic} onClick={() => open("quick")}>
          Registrar rápido
        </Button>
        <button onClick={() => open("quick", { mode: "receipt" })}>
          <Camera size={14} /> Subir un comprobante <ArrowRight size={13} />
        </button>
      </div>
    </section>
  );
}

export function CollaboratorHome() {
  const { user, data, open, navigate, selectMovement } = useFinance();
  const pending = data.movements.filter((m) =>
    ["pending", "reported", "approved"].includes(m.status),
  ).length;
  return (
    <div className="gf-collaborator-home">
      <div className="gf-collaborator-heading">
        <span className="gf-eyebrow">TU ESPACIO, SIN COMPLICACIONES</span>
        <h1>Hola, {user.name.split(" ")[0]}.</h1>
        <p>Sube, envía y sigue con tu día. Nosotros organizamos lo demás.</p>
        <span className="gf-assigned-business">
          {user.business_ids.map((id) => businessNames[id]).join(" · ")}
          {user.unit_ids.length === 1
            ? ` · ${data.units.find((u) => u.id === user.unit_ids[0])?.name || ""}`
            : ""}
        </span>
      </div>
      <div className="gf-simple-actions">
        <button onClick={() => open("quick", { mode: "receipt" })}>
          <span className="gf-simple-action-icon">
            <Camera size={26} />
          </span>
          <div>
            <strong>Subir un cobro</strong>
            <p>Toma una foto o adjunta el comprobante.</p>
          </div>
          <ArrowRight size={19} />
        </button>
        <button onClick={() => open("quick", { mode: "request" })}>
          <span className="gf-simple-action-icon amber">
            <ArrowUpRight size={26} />
          </span>
          <div>
            <strong>Pedir un pago</strong>
            <p>Di cuánto necesitas y para qué.</p>
          </div>
          <ArrowRight size={19} />
        </button>
        <button onClick={() => navigate("movimientos")}>
          <span className="gf-simple-action-icon lilac">
            <ListChecks size={26} />
          </span>
          <div>
            <strong>Mis envíos</strong>
            <p>
              {pending
                ? `${pending} por revisar · consulta su estado.`
                : "Revisa lo que ya enviaste."}
            </p>
          </div>
          <ArrowRight size={19} />
        </button>
      </div>
      <button className="gf-simple-dictation" onClick={() => open("quick")}>
        <Mic size={20} />
        <span>
          ¿Prefieres contarlo?<strong>Hablar o escribir un movimiento</strong>
        </span>
        <ArrowRight size={17} />
      </button>
      <section className="gf-panel gf-simple-history">
        <div className="gf-simple-history-head">
          <h2>Tus últimos envíos</h2>
          <button onClick={() => navigate("movimientos")}>
            Ver todos <ArrowRight size={14} />
          </button>
        </div>
        {data.movements.slice(0, 5).map((m) => (
          <button
            className="gf-simple-record"
            key={m.id}
            onClick={() => selectMovement(m)}
          >
            <span className="gf-simple-record-icon">
              <FileText size={19} />
            </span>
            <span>
              <strong>{m.counterparty}</strong>
              <small>
                {dateLabel(m.day)} · {m.category}
              </small>
            </span>
            <span>
              <strong>{money(m.amount_cents)}</strong>
              <Badge status={m.status} />
            </span>
          </button>
        ))}
        {!data.movements.length && (
          <div className="gf-simple-empty">
            <CheckCircle2 size={27} />
            <p>Tu espacio está listo. Aquí verás el estado de cada envío.</p>
          </div>
        )}
      </section>
      <p className="gf-simple-private">
        Solo ves tus envíos. Administración se encarga de aprobar y verificar
        los pagos.
      </p>
    </div>
  );
}

export function QuickCapture({ initial = {}, onClose }) {
  const { user, data, filters, refresh, notify, navigate } = useFinance();
  const [mode, setMode] = useState(initial.mode || "message"),
    [text, setText] = useState(initial.text || "");
  const [overrides, setOverrides] = useState({}),
    [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [listening, setListening] = useState(false);
  const [error, setError] = useState(""),
    [evidence, setEvidence] = useState(null),
    [success, setSuccess] = useState(null);
  const recognition = useRef(),
    fileInput = useRef(),
    cameraInput = useRef(),
    mounted = useRef(true),
    requestId = useRef(crypto.randomUUID()),
    scope = useRef("");
  const preview = data.capabilities.public_preview;
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const defaultBusiness =
    filters.business_id !== "all"
      ? filters.business_id
      : mode !== "message" && user.business_ids.includes("producalza")
        ? "producalza"
        : user.business_ids.includes("personal")
          ? "personal"
          : user.business_ids.length === 1
            ? user.business_ids[0]
            : null;
  const parsed = useMemo(
    () =>
      interpretQuickEntry(text, {
        business_ids: user.business_ids,
        unit_ids: user.unit_ids,
        units: data.units,
        accounts: data.accounts,
        default_business_id: defaultBusiness,
        default_kind: mode === "receipt" ? "income" : "expense",
        day: preview ? data.period.today : today(),
        overrides,
        request: mode === "request",
      }),
    [text, overrides, mode, user, data, defaultBusiness, preview],
  );
  const d = parsed.draft,
    currentScope = `${d.business_id}:${d.unit_id || ""}`;
  scope.current = currentScope;
  const units = data.units.filter((u) => u.business_id === d.business_id);
  const accounts = data.accounts.filter(
    (a) => !a.business_id || a.business_id === d.business_id,
  );
  const update = (key, value) => setOverrides((p) => ({ ...p, [key]: value }));
  useEffect(
    () => () => {
      mounted.current = false;
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onend = null;
        recognition.current.onerror = null;
        recognition.current.abort();
      }
    },
    [],
  );
  useEffect(() => {
    setEvidence(null);
  }, [currentScope]);
  function switchMode(value) {
    recognition.current?.abort();
    setListening(false);
    setMode(value);
    setText("");
    setOverrides({});
    setAmountText("");
    setEvidence(null);
    setError("");
    requestId.current = crypto.randomUUID();
  }
  function speak() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    if (!Speech) {
      setError(
        "Puedes escribir aquí o usar el micrófono del teclado de tu celular.",
      );
      return;
    }
    setError("");
    const r = new Speech();
    recognition.current = r;
    r.lang = "es-EC";
    r.continuous = false;
    r.interimResults = true;
    const prefix = text.trim() ? `${text.trim()} ` : "";
    r.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ");
      if (mounted.current) setText(prefix + transcript);
    };
    r.onend = () => {
      if (mounted.current) setListening(false);
    };
    r.onerror = (event) => {
      if (!mounted.current) return;
      setListening(false);
      if (event.error !== "aborted")
        setError(
          event.error === "not-allowed"
            ? "El micrófono no tiene permiso. Puedes habilitarlo en el navegador o escribir tu registro."
            : event.error === "no-speech"
              ? "No escuché una frase. Inténtalo de nuevo o escribe aquí."
              : "El dictado no está disponible en este momento. Puedes escribir o usar el micrófono de tu teclado.",
        );
    };
    try {
      r.start();
      setListening(true);
    } catch {
      setError("No se pudo iniciar el dictado. Puedes usar el teclado.");
    }
  }
  async function upload(file) {
    if (!file) return;
    if (preview) {
      setError(
        "Esta vista es de prueba. No subas documentos reales; puedes probar escribiendo el monto.",
      );
      return;
    }
    if (!d.business_id || (user.unit_ids.length && !d.unit_id)) {
      setError(
        "Selecciona el negocio y tu local antes de adjuntar el comprobante.",
      );
      return;
    }
    const uploadScope = scope.current;
    setUploading(true);
    setError("");
    try {
      if (file.size > 6 * 1024 * 1024)
        throw new Error("El archivo debe pesar hasta 6 MB.");
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      });
      const saved = await financeApi("/evidence", {
        business_id: d.business_id,
        unit_id: d.unit_id || null,
        name: file.name,
        mime: file.type,
        data: encoded,
      });
      if (!mounted.current || scope.current !== uploadScope) return;
      setEvidence({ id: saved.id, name: file.name });
      if (data.capabilities.ai) {
        try {
          const { analysis } = await financeApi(
            `/evidence/${saved.id}/analyze`,
            {},
          );
          if (!mounted.current || scope.current !== uploadScope) return;
          setOverrides((previous) => ({
            ...previous,
            ...(analysis.amount_cents
              ? { amount_cents: analysis.amount_cents }
              : {}),
            ...(analysis.counterparty
              ? { counterparty: analysis.counterparty }
              : {}),
            ...(analysis.reference ? { reference: analysis.reference } : {}),
            ...(analysis.day ? { day: analysis.day } : {}),
          }));
          if (analysis.amount_cents)
            setAmountText((analysis.amount_cents / 100).toFixed(2));
        } catch (e) {
          if (mounted.current)
            setError(
              `Comprobante guardado. Completa el monto manualmente: ${e.message}`,
            );
        }
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setUploading(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (!parsed.ready || busy) return;
    setBusy(true);
    setError("");
    recognition.current?.abort();
    try {
      const result = await financeApi("/quick/register", {
        request_id: requestId.current,
        text,
        request: mode === "request",
        evidence_id: evidence?.id || null,
        overrides: {
          ...overrides,
          business_id: d.business_id,
          unit_id: d.unit_id,
          kind: d.kind,
        },
      });
      if (!mounted.current) return;
      setSuccess(result);
      if (!result.preview) await refresh();
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const examples = user.business_ids.includes("personal")
    ? ["Gasto personal de $80 en gasolina", "Pagué $25 de almuerzo personal"]
    : [
        `Recibí $250 de abono ${businessNames[user.business_ids[0]]}`,
        "Solicito pagar $80 en materiales",
      ];
  return (
    <Modal
      title={
        success
          ? "Todo en su lugar."
          : mode === "receipt"
            ? "Subir un cobro"
            : mode === "request"
              ? "Pedir un pago"
              : "Registrar rápido"
      }
      subtitle={
        success
          ? undefined
          : "Una frase o un comprobante. Sin recorrer formularios."
      }
      onClose={onClose}
    >
      {success ? (
        <div className="gf-quick-success" role="status">
          <span>
            <CheckCircle2 size={39} />
          </span>
          <small>
            {success.preview ? "SIMULACIÓN · NO SE GUARDÓ" : "LISTO"}
          </small>
          <h3>
            {success.preview
              ? "Así quedaría tu registro"
              : user.role === "collector" ||
                  success.movement.status === "pending"
                ? "Enviado para revisión"
                : "Gasto registrado"}
          </h3>
          <strong>{money(success.movement.amount_cents)}</strong>
          <p>
            {businessNames[success.movement.business_id]} ·{" "}
            {success.movement.category}
          </p>
          <div>
            {success.preview
              ? "Puedes probar el flujo. Tus finanzas reales no se modificaron."
              : success.movement.kind === "income"
                ? "El comprobante está organizado para su verificación."
                : "Quedó registrado. La cuenta y el pago se comprueban por separado."}
          </div>
          <Button
            icon={Plus}
            onClick={() => {
              setSuccess(null);
              switchMode(mode);
            }}
          >
            Registrar otro
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              if (!success.preview) navigate("movimientos");
            }}
          >
            Terminar
          </Button>
        </div>
      ) : (
        <form className="gf-quick-form" onSubmit={submit}>
          <div
            className="gf-quick-tabs"
            role="group"
            aria-label="Forma de registro"
          >
            {[
              ["message", "Escribir o hablar", Mic],
              ["receipt", "Comprobante", Camera],
              ["request", "Pedir pago", ArrowUpRight],
            ].map(([id, label, Icon]) => (
              <button
                type="button"
                key={id}
                aria-pressed={mode === id}
                onClick={() => switchMode(id)}
                disabled={busy || uploading}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          {preview && (
            <div className="gf-quick-preview-note">
              Modo de prueba · usa información ficticia.
            </div>
          )}
          {mode === "receipt" && (
            <div className="gf-quick-upload">
              <span>
                <Camera size={29} />
              </span>
              <strong>
                {evidence ? evidence.name : "Sube el comprobante del cliente"}
              </strong>
              <p>
                {uploading
                  ? "Guardando y preparando el comprobante…"
                  : data.capabilities.ai
                    ? "Leemos sus datos y los dejamos listos para revisar."
                    : "Adjunta la foto y escribe el monto. El negocio ya está seleccionado."}
              </p>
              <div>
                <Button
                  type="button"
                  icon={Camera}
                  variant="secondary"
                  disabled={uploading || busy || preview}
                  onClick={() => cameraInput.current.click()}
                >
                  Tomar foto
                </Button>
                <Button
                  type="button"
                  icon={Upload}
                  variant="ghost"
                  disabled={uploading || busy || preview}
                  onClick={() => fileInput.current.click()}
                >
                  Elegir archivo
                </Button>
              </div>
            </div>
          )}
          <input
            ref={cameraInput}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <div className={`gf-quick-compose ${listening ? "listening" : ""}`}>
            <label htmlFor="gf-quick-text">
              {mode === "receipt"
                ? "Añade el monto o contexto"
                : mode === "request"
                  ? "¿Qué necesitas pagar?"
                  : "¿Qué registramos?"}
            </label>
            <textarea
              id="gf-quick-text"
              value={text}
              maxLength={1000}
              disabled={busy || listening}
              onChange={(e) => {
                setText(e.target.value);
                setError("");
                if (mode !== "receipt") {
                  setOverrides((previous) => {
                    const { amount_cents, day, category, ...rest } = previous;
                    return rest;
                  });
                  setAmountText("");
                }
              }}
              placeholder={
                mode === "receipt"
                  ? "Recibí $250 de abono de un cliente"
                  : mode === "request"
                    ? "Necesito pagar $80 de materiales para Producalza"
                    : "Registra un gasto personal de $80 en gasolina"
              }
              rows={3}
            />
            <div>
              <span>
                {listening
                  ? "Escuchando… habla con naturalidad."
                  : "También puedes usar el micrófono de tu teclado."}
              </span>
              <button
                type="button"
                aria-label={
                  listening ? "Terminar dictado" : "Dictar movimiento"
                }
                className={listening ? "active" : ""}
                onClick={speak}
                disabled={busy || uploading}
              >
                {listening ? <Square size={19} /> : <Mic size={20} />}
              </button>
            </div>
          </div>
          {!listening && mode === "message" && !text && (
            <div className="gf-quick-examples">
              {examples.map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => setText(example)}
                >
                  {example}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          )}
          {Speech && (
            <p className="gf-quick-voice-note">
              El dictado usa el servicio de voz del navegador, que puede
              procesar el audio en línea. Revisa el monto antes de guardar.
            </p>
          )}
          {user.business_ids.length > 1 && (
            <div
              className="gf-quick-businesses"
              role="group"
              aria-label="Negocio del registro"
            >
              {user.business_ids.map((id) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={d.business_id === id}
                  onClick={() =>
                    setOverrides((p) => ({
                      ...p,
                      business_id: id,
                      unit_id: undefined,
                      account_id: undefined,
                    }))
                  }
                >
                  {businessNames[id]}
                </button>
              ))}
            </div>
          )}
          {(mode === "receipt" || parsed.missing.includes("amount_cents")) && (
            <Field label="Monto (USD)">
              <input
                type="text"
                inputMode="decimal"
                value={amountText}
                placeholder="0.00"
                onChange={(e) => {
                  setAmountText(e.target.value);
                  update("amount_cents", quickMoney(e.target.value));
                }}
              />
            </Field>
          )}
          {parsed.missing.includes("kind") && (
            <Field label="¿Qué ocurrió?">
              <select value="" onChange={(e) => update("kind", e.target.value)}>
                <option value="">Selecciona cobro o gasto</option>
                <option value="expense">Gasto</option>
                <option value="income">Cobro de cliente</option>
              </select>
            </Field>
          )}
          {parsed.missing.includes("unit_id") && (
            <Field label="Tu local">
              <select
                value={d.unit_id || ""}
                onChange={(e) => update("unit_id", e.target.value)}
              >
                <option value="">Selecciona tu local</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {parsed.missing.includes("account_id") && (
            <Field label="¿Cuál de las cuentas?">
              <select
                value={d.account_id || ""}
                onChange={(e) => update("account_id", Number(e.target.value))}
              >
                <option value="">Selecciona una cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.bank} {a.last_four}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div
            className={`gf-quick-summary ${parsed.ready ? "ready" : ""}`}
            aria-live="polite"
          >
            <div>
              <span>
                {d.kind === "income"
                  ? "COBRO"
                  : parsed.is_request
                    ? "SOLICITUD DE PAGO"
                    : "GASTO"}
              </span>
              <strong>{d.amount_cents ? money(d.amount_cents) : "$ —"}</strong>
            </div>
            <div>
              <strong>
                {businessNames[d.business_id] || "Elige un negocio"}
              </strong>
              <p>
                {d.category} · {dateLabel(d.day)}
                {d.unit_id
                  ? ` · ${units.find((u) => u.id === d.unit_id)?.name || ""}`
                  : ""}
              </p>
              <small>
                <Wallet size={12} />
                {d.account_id
                  ? accounts.find((a) => a.id === d.account_id)?.name
                  : "Cuenta por asignar"}
              </small>
            </div>
            <CheckCircle2 size={21} />
          </div>
          {parsed.error && (
            <p className="gf-error" role="alert">
              {parsed.error}
            </p>
          )}
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <details className="gf-quick-details">
            <summary>
              Ajustar detalles <span>Opcional</span>
            </summary>
            <div>
              <Field label="Monto (USD)">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={
                    d.amount_cents ? (d.amount_cents / 100).toFixed(2) : "0.00"
                  }
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value);
                    update("amount_cents", quickMoney(e.target.value));
                  }}
                />
              </Field>
              <Field label="Categoría">
                <select
                  value={d.category}
                  onChange={(e) => update("category", e.target.value)}
                >
                  {[...new Set([d.category, ...categories])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha">
                <input
                  type="date"
                  value={d.day}
                  max={preview ? data.period.today : today()}
                  onChange={(e) => update("day", e.target.value)}
                />
              </Field>
              <Field
                label={d.kind === "income" ? "Cliente" : "Proveedor o destino"}
              >
                <input
                  placeholder={d.counterparty}
                  value={overrides.counterparty || ""}
                  onChange={(e) => update("counterparty", e.target.value)}
                />
              </Field>
              {!!accounts.length && (
                <Field label="Cuenta">
                  <select
                    value={d.account_id || ""}
                    onChange={(e) =>
                      update(
                        "account_id",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">Asignar después</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.bank}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Forma de pago">
                <select
                  value={d.payment_method}
                  onChange={(e) => update("payment_method", e.target.value)}
                >
                  <option value="other">Sin especificar</option>
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                  <option value="card">Tarjeta</option>
                  <option value="payphone">Payphone</option>
                </select>
              </Field>
              {units.length > 1 && (
                <Field label="Local o unidad">
                  <select
                    value={d.unit_id || ""}
                    onChange={(e) => update("unit_id", e.target.value || null)}
                  >
                    <option value="">General del negocio</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Referencia">
                <input
                  value={overrides.reference || ""}
                  onChange={(e) => update("reference", e.target.value)}
                />
              </Field>
            </div>
          </details>
          {mode !== "receipt" && (
            <button
              type="button"
              className="gf-quick-attach"
              disabled={uploading || preview}
              onClick={() => fileInput.current.click()}
            >
              <FileText size={16} />
              {evidence ? evidence.name : "Adjuntar respaldo (opcional)"}
              {uploading && <Loader2 className="gf-spin" size={14} />}
            </button>
          )}
          <div className="gf-quick-submit">
            <Button
              type="submit"
              icon={Send}
              loading={busy}
              disabled={!parsed.ready || uploading || listening}
            >
              {preview
                ? "Probar registro"
                : parsed.is_request
                  ? "Enviar solicitud"
                  : d.kind === "income"
                    ? "Enviar cobro"
                    : "Registrar gasto"}
              {parsed.ready && ` · ${money(d.amount_cents)}`}
            </Button>
            <p>
              {user.role === "collector"
                ? "Administración revisará tu envío. No tienes que conciliar ni aprobar."
                : "Registra el movimiento. No ejecuta pagos ni confirma acreditaciones."}
            </p>
          </div>
        </form>
      )}
    </Modal>
  );
}
