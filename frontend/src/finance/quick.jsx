import { canUseFinanceAssistant } from "../../../shared/finance-workflow.mjs";
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
import { QuickConversation } from "./conversation.jsx";
import {ReceiptList,ReceiptComposer} from './receipts.jsx';
import { RetailBrand, isStoreUser, IncomingNotices } from "./operations.jsx";
import {
  businessNames,
  categories,
  dateLabel,
  financeApi,
  money,
  today,
} from "./api.js";
import { Badge, Button, Field, Modal } from "./components.jsx";
import { AssistantAvatar, SpaceTiles } from "./workflows.jsx";

export function QuickAccess() {
  const { open, navigate, user } = useFinance();
  return (
    <section className="gf-owner-actions" aria-label="Acciones rápidas">
      <button onClick={() => open("quick")}>
        <Mic size={22} />
        <span>Registrar gasto</span>
      </button>
      <button onClick={() => open("quick", { mode: "request" })}>
        <ArrowUpRight size={22} />
        <span>Pedir pago</span>
      </button>
      {canUseFinanceAssistant(user) && (
        <button onClick={() => navigate("asistente")}>
          <AssistantAvatar size={27} />
          <span>Consultar IA</span>
        </button>
      )}
    </section>
  );
}

export function CollaboratorHome() {
  const { user, data, open, navigate } = useFinance();
  const store = isStoreUser(user),
    reviews = (data.store_receipts || []).filter(
      (r) =>
        user.review_unit_ids?.includes(r.unit_id) &&
        r.assigned_to_me !== false &&
        !r.confirmed_at &&
        r.status !== "reconciled",
    );
  return (
    <div className="gf-collaborator-home">
      {store && <RetailBrand />}
      <div className="gf-collaborator-heading">
        <span className="gf-eyebrow">TU ESPACIO, SIN COMPLICACIONES</span>
        <h1>Hola, {user.name.split(" ")[0]}.</h1>
        <p>
          {store || user.username === "norma"
            ? "Sube los depósitos de tus clientes en pocos pasos."
            : "Pide una transferencia en pocos pasos."}
        </p>
        <span className="gf-assigned-business">
          {user.unit_ids.length
            ? user.unit_ids
                .map((id) => data.units.find((u) => u.id === id)?.name)
                .filter(Boolean)
                .join(" · ")
            : user.business_ids.map((id) => businessNames[id]).join(" · ")}
        </span>
      </div>
      <IncomingNotices />
      <div className="gf-simple-actions">
        {["norma","normita"].includes(user.username) && (
          <button onClick={() => open("quick", { mode: "receipt" })}>
            <span className="gf-simple-action-icon">
              <Camera size={27} />
            </span>
            <div>
              <strong>Subir depósito de cliente</strong>
              <p>Producalza · sube el comprobante recibido.</p>
            </div>
            <ArrowRight size={20} />
          </button>
        )}
        {store && (
          <button onClick={() => open("store-receipt")}>
            <span className="gf-simple-action-icon">
              <Camera size={27} />
            </span>
            <div>
              <strong>Subir transferencia de cliente</strong>
              <p>
                {user.auto_confirm_unit_ids?.length
                  ? "Súbela y quedará confirmada por ti."
                  : "Elige el local y envía el comprobante."}
              </p>
            </div>
            <ArrowRight size={20} />
          </button>
        )}
        <button onClick={() => open("quick", { mode: "request" })}>
          <span className="gf-simple-action-icon amber">
            <ArrowUpRight size={27} />
          </span>
          <div>
            <strong>Pedir pago</strong>
            <p>Contacto, valor y motivo.</p>
          </div>
          <ArrowRight size={20} />
        </button>
        {Boolean(user.review_unit_ids?.length) && (
          <button onClick={() => navigate("confirmaciones")}>
            <span className="gf-simple-action-icon lilac">
              <CheckCircle2 size={27} />
            </span>
            <div>
              <strong>Confirmar transferencias</strong>
              <p>
                {reviews.length
                  ? `${reviews.length} por confirmar en Sur`
                  : "Revisión de transferencias del Sur."}
              </p>
            </div>
            <ArrowRight size={20} />
          </button>
        )}
      </div>
      {canUseFinanceAssistant(user) && (
        <button
          className="gf-collaborator-assistant"
          onClick={() => navigate("asistente")}
        >
          <AssistantAvatar size={32} /> Consultar a Gema{" "}
          <ArrowRight size={18} />
        </button>
      )}
      {["norma","normita"].includes(user.username)&&<Button variant="secondary" icon={FileText} onClick={()=>open('quick',{mode:'request',business_id:'producalza',space_id:'producalza-pagos',description:'Servicios básicos',category:'Servicios'})}>Pedir pago de servicios básicos</Button>}
      <ReceiptList/>
      <section className="gf-collaborator-spaces">
        <h2>Mis espacios</h2>
        <p>Solicitudes, pagos y comprobantes de tus grupos.</p>
        <SpaceTiles compact />
      </section>
      <p className="gf-simple-private">
        Los contactos que guardas son propios de tu usuario. No se mezclan con
        los de tus compañeros.
      </p>
    </div>
  );
}

export function QuickCapture({ initial = {}, onClose }) {
  const { user, data } = useFinance();
  const [form, setForm] = useState(false);
  if(initial.mode==='receipt')return <ReceiptComposer initial={initial} onClose={onClose}/>;
  return !form && (!initial.mode || initial.mode === "message") && canUseFinanceAssistant(user) && !data.capabilities.public_preview
    ? <QuickConversation initial={initial} onClose={onClose} onForm={() => setForm(true)} />
    : <QuickCaptureForm initial={initial} onClose={onClose} />;
}

function QuickCaptureForm({ initial = {}, onClose }) {
  const { user, data, filters, refresh, notify, navigate, open } = useFinance();
  const [mode, setMode] = useState(initial.mode || "message"),
    [text, setText] = useState(initial.text || "");
  const [overrides, setOverrides] = useState(
      initial.business_id
        ? {
            business_id: initial.business_id,
            ...(data.workflow?.spaces.find((s) => s.id === initial.space_id)
              ?.unit_id
              ? {
                  unit_id: data.workflow.spaces.find(
                    (s) => s.id === initial.space_id,
                  ).unit_id,
                }
              : {}),
          }
        : {},
    ),
    [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [listening, setListening] = useState(false);
  const [error, setError] = useState(""),
    [evidence, setEvidence] = useState(null),
    [success, setSuccess] = useState(null);
  const [spaceId, setSpaceId] = useState(initial.space_id || "");
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
        allow_cross_account: user.role === "owner",
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
  const availableSpaces = (data.workflow?.spaces || []).filter(
    (s) =>
      s.active &&
      s.business_ids.includes(d.business_id) &&
      (user.role === "owner" ||
        s.members?.some(
          (m) => m.member_id === user.id && m.role !== "observer",
        )),
  );
  const selectedSpace = availableSpaces.find((s) => s.id === spaceId);
  useEffect(() => {
    if (!parsed.is_request) return;
    if (initial.space_id && spaceId === initial.space_id) return;
    if (!availableSpaces.some((s) => s.id === spaceId))
      setSpaceId(
        availableSpaces.find(
          (s) =>
            s.kind ===
            (/exterior|dani/i.test(text)
              ? "international"
              : d.category === "Materiales"
                ? "materials"
                : "general"),
        )?.id || (availableSpaces.length === 1 ? availableSpaces[0].id : ""),
      );
  }, [d.business_id, d.category, parsed.is_request]);
  const accounts = data.accounts.filter(
    (a) =>
      user.role === "owner" ||
      !a.business_id ||
      a.business_id === d.business_id,
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
    setOverrides(
      initial.business_id ? { business_id: initial.business_id } : {},
    );
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
    if (
      parsed.is_request &&
      ((spaceId && !selectedSpace) || (!spaceId && availableSpaces.length))
    ) {
      setError("Selecciona el espacio donde corresponde pedir este pago.");
      return;
    }
    setBusy(true);
    setError("");
    recognition.current?.abort();
    try {
      const result = await financeApi("/quick/register", {
        request_id: requestId.current,
        text,
        request: mode === "request",
        evidence_id: evidence?.id || null,
        space_id: parsed.is_request ? spaceId || null : null,
        overrides: {
          ...overrides,
          business_id: d.business_id,
          unit_id: d.unit_id,
          kind: d.kind,
        },
      });
      if (!mounted.current) return;
      setSuccess(result);
      if (!result.preview || result.workflow_changed) await refresh();
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
            {success.preview
              ? success.workflow_changed
                ? "SIMULACIÓN · DATOS DE PRUEBA"
                : "SIMULACIÓN · NO SE GUARDÓ"
              : "LISTO"}
          </small>
          <h3>
            {success.preview
              ? success.workflow_changed
                ? "Solicitud de ejemplo enviada"
                : "Así quedaría tu registro"
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
              ? success.workflow_changed
                ? "Quedó pendiente en este ejemplo. Tus finanzas reales no se modificaron."
                : "Puedes probar el flujo. Tus finanzas reales no se modificaron."
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
              if (!success.preview && !initial.space_id)
                navigate("movimientos");
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
                onClick={() =>
                  id === "request"
                    ? open("quick", { mode: "request" })
                    : switchMode(id)
                }
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
          {parsed.is_request && availableSpaces.length > 0 && (
            <Field label="Espacio de este pago">
              <select
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
              >
                {!selectedSpace && (
                  <option value="">Selecciona el espacio</option>
                )}
                {availableSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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
