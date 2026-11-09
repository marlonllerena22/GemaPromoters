import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  Plus,
  Search,
  Send,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Field, Modal } from "./components.jsx";
import { financeApi, money, amount, businessNames } from "./api.js";
import { BankLogo } from "./banks.jsx";
import {
  payeeBanks,
  accountTypes,
  normalizePayee,
  payeeError,
} from "../../../shared/finance-payees.mjs";
const blankAccount = () => ({
  bank: "Pichincha",
  type: "savings",
  number: "",
  holder: "",
});
const blankContact = () => ({
  name: "",
  document: "",
  email: "",
  accounts: [blankAccount()],
});
export function CopyDatum({ label, value }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  const timer = useRef(),
    reset = useRef(),
    held = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(reset.current);
    },
    []
  );
  if (!value) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError(false);
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="gf-copy-datum">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`Copiar ${label}: ${value}`}
        onPointerDown={() => {
          held.current = false;
          timer.current = setTimeout(() => {
            held.current = true;
            copy();
          }, 450);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onPointerLeave={() => clearTimeout(timer.current)}
        onClick={() => {
          if (!held.current) copy();
        }}
      >
        <strong>{value}</strong>
        {copied ? <Check size={19} /> : <Copy size={19} />}
      </button>
      {copied && <small role="status">Copiado</small>}
      {error && (
        <small>Selecciona el número y usa Copiar en tu dispositivo.</small>
      )}
    </div>
  );
}
export function BeneficiaryDetails({ beneficiary, selected, onSelect }) {
  if (!beneficiary) return null;
  return (
    <section className="gf-beneficiary" aria-label="Datos para transferir">
      <div className="gf-beneficiary-heading">
        <span>DATOS PARA TRANSFERIR</span>
        <h3>{beneficiary.name}</h3>
      </div>
      {beneficiary.accounts.length > 1 && (
        <p className="gf-account-choice-note">
          Todas sus cuentas. Elige la que más te convenga.
        </p>
      )}
      <div className="gf-beneficiary-accounts">
        {beneficiary.accounts.map((a, i) => (
          <div
            className={`gf-beneficiary-account ${
              selected === i ? "selected" : ""
            }`}
            key={`${a.bank}-${i}`}
          >
            <header>
              <BankLogo bank={a.bank} />
              <div>
                <strong>{a.bank}</strong>
                <span>{accountTypes[a.type] || a.type}</span>
              </div>
              {onSelect && (
                <button
                  type="button"
                  className="gf-choose-destination"
                  aria-pressed={selected === i}
                  onClick={() => onSelect(i)}
                >
                  {selected === i ? (
                    <>
                      <Check size={16} />
                      Elegida
                    </>
                  ) : (
                    "Usar esta cuenta"
                  )}
                </button>
              )}
            </header>
            {a.holder && (
              <p className="gf-account-holder">Titular: {a.holder}</p>
            )}
            <CopyDatum label="Número de cuenta" value={a.number} />
          </div>
        ))}
      </div>
      <CopyDatum label="Cédula o RUC" value={beneficiary.document} />
      <CopyDatum label="Correo" value={beneficiary.email} />
    </section>
  );
}
export async function uploadEvidence(file, business, unit) {
  if (file.size > 6 * 1024 * 1024)
    throw new Error("El archivo debe pesar hasta 6 MB");
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
  return financeApi("/evidence", {
    business_id: business,
    unit_id: unit || null,
    name: file.name,
    mime: file.type,
    data,
  });
}
export function RequestComposer({ initial = {}, onClose }) {
  const { data, user, refresh, open } = useFinance();
  const preview = data.capabilities.public_preview;
  const writable = (data.workflow?.spaces || []).filter(
    (s) =>
      s.active &&
      (user.role === "owner" ||
        (s.is_member &&
          s.members?.find((m) => m.member_id === user.id)?.role !== "observer"))
  );
  const [spaceId, setSpaceId] = useState(
      initial.space_id || writable[0]?.id || ""
    ),
    [business, setBusiness] = useState(
      initial.business_id ||
        writable.find((s) => s.id === (initial.space_id || writable[0]?.id))
          ?.business_ids[0] ||
        user.business_ids[0]
    );
  const space = writable.find((s) => s.id === spaceId);
  const units = data.units.filter(
    (u) =>
      u.business_id === business &&
      (!user.unit_ids.length || user.unit_ids.includes(u.id))
  );
  const unit =
    (initial.unit_id && units.some((u) => u.id === initial.unit_id)
      ? initial.unit_id
      : null) ||
    space?.unit_id ||
    (units.length === 1 ? units[0].id : null);
  const [unitChoice, setUnitChoice] = useState("");
  const chosenUnit = unitChoice || unit || null;
  const [contacts, setContacts] = useState([]),
    [contact, setContact] = useState(null),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(blankContact),
    [value, setValue] = useState(""),
    [reason, setReason] = useState(""),
    [warnings, setWarnings] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [evidence, setEvidence] = useState(null),
    [done, setDone] = useState(null),
    [loading, setLoading] = useState(true);
  const key = useRef(crypto.randomUUID()),
    file = useRef(),
    scope = useRef(0);
  useEffect(() => {
    const version = ++scope.current;
    setLoading(true);
    setContact(null);
    setContacts([]);
    setEvidence(null);
    setError("");
    setUnitChoice("");
    financeApi(
      `/payees?business_id=${encodeURIComponent(
        business
      )}&space_id=${encodeURIComponent(spaceId)}`
    )
      .then((r) => {
        if (scope.current === version) setContacts(r.contacts);
      })
      .catch((e) => {
        if (scope.current === version) setError(e.message);
      })
      .finally(() => {
        if (scope.current === version) setLoading(false);
      });
    return () => {
      scope.current++;
    };
  }, [business, spaceId]);
  function changeSpace(id) {
    const s = writable.find((s) => s.id === id);
    setSpaceId(id);
    if (s && !s.business_ids.includes(business)) setBusiness(s.business_ids[0]);
  }
  function account(i, k, v) {
    setDraft((p) => ({
      ...p,
      accounts: p.accounts.map((a, n) => (n === i ? { ...a, [k]: v } : a)),
    }));
  }
  async function readPhoto(selected) {
    if (!selected || preview) return;
    const version = scope.current;
    setBusy(true);
    setError("");
    try {
      const saved = await uploadEvidence(selected, business, chosenUnit);
      if (scope.current !== version) return;
      setEvidence({ id: saved.id, name: selected.name });
      if (data.capabilities.ai) {
        const { analysis } = await financeApi(
          `/evidence/${saved.id}/bank-details`,
          {}
        );
        if (scope.current !== version) return;
        setDraft({
          ...analysis,
          accounts: analysis.accounts.length
            ? analysis.accounts
            : [blankAccount()],
        });
        setWarnings(analysis.warnings || []);
      } else {
        setWarnings([
          "Imagen guardada. La lectura con IA está pendiente de configuración; puedes completar los datos aquí.",
        ]);
      }
    } catch (e) {
      if (scope.current === version) setError(e.message);
    } finally {
      if (scope.current === version) setBusy(false);
    }
  }
  async function saveContact(e) {
    e.preventDefault();
    const p = normalizePayee(draft),
      message = payeeError(p);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await financeApi("/payees", {
        ...p,
        business_id: business,
        space_id: spaceId || null,
      });
      setContacts((p) => [
        r.contact,
        ...p.filter((c) => c.id !== r.contact.id),
      ]);
      setContact(r.contact);
      setEditing(false);
      setWarnings([]);
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
      const r = await financeApi("/payment-requests", {
        request_id: key.current,
        contact_id: contact.id,
        business_id: business,
        unit_id: chosenUnit,
        space_id: spaceId || null,
        amount_cents: amount(value),
        description: reason.trim() || "Pago solicitado",
        category: space?.kind === "materials" ? "Materiales" : "Otros",
        evidence_id: evidence?.id || null,
      });
      await refresh();
      setDone(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const results = contacts.filter((c) =>
    `${c.name} ${c.document} ${c.accounts
      .map((a) => a.number + " " + a.bank)
      .join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  return (
    <Modal
      title={
        done
          ? "Solicitud enviada"
          : editing
          ? "Nuevo contacto"
          : "Pedir una transferencia"
      }
      subtitle={
        done
          ? undefined
          : editing
          ? "Guárdalo una vez y vuelve a elegirlo cuando lo necesites."
          : "Contacto, monto y motivo. Listo."
      }
      onClose={busy ? () => {} : onClose}
    >
      {done ? (
        <div className="gf-transfer-request-done">
          <CheckCircle2 size={46} />
          <h3>Ya quedó por transferir</h3>
          <strong>{money(amount(value))}</strong>
          <p>{contact.name}</p>
          <p>
            {preview
              ? "Simulación: no se realizó ningún pago real."
              : "Administración verá esta petición y añadirá aquí el comprobante al pagar."}
          </p>
          <Button
            onClick={() =>
              open("pay-request", {
                id: done.movement.id,
                return_space: spaceId,
              })
            }
          >
            Ver mi petición
          </Button>
        </div>
      ) : editing ? (
        <form className="gf-payee-editor" onSubmit={saveContact}>
          <button
            type="button"
            className="gf-back-link"
            onClick={() => {
              setEditing(false);
              setError("");
            }}
            disabled={busy}
          >
            <ArrowLeft size={16} />
            Volver a contactos
          </button>
          <div className="gf-bank-photo">
            <Camera size={27} />
            <strong>¿Te mandaron una foto?</strong>
            <p>
              {preview
                ? "Prueba la lectura con una imagen ficticia."
                : "Sube la imagen y revisa los datos detectados antes de guardarlos."}
            </p>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              hidden
              onChange={(e) => readPhoto(e.target.files?.[0])}
            />
            {preview ? (
              <Button
                type="button"
                variant="secondary"
                icon={Camera}
                onClick={() => {
                  setDraft({
                    name: "Proveedor de ejemplo",
                    document: "",
                    email: "pagos@example.invalid",
                    accounts: [
                      {
                        bank: "Pichincha",
                        type: "savings",
                        number: "0012345678",
                        holder: "Titular de ejemplo",
                      },
                      {
                        bank: "Produbanco",
                        type: "checking",
                        number: "0098765432",
                        holder: "Titular de ejemplo",
                      },
                    ],
                  });
                  setWarnings([
                    "Ejemplo preparado: no es una lectura real de tus imágenes. Revisa las dos cuentas antes de guardar.",
                  ]);
                }}
              >
                Probar lectura de ejemplo
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                icon={Upload}
                disabled={busy}
                onClick={() => file.current.click()}
              >
                {busy ? "Leyendo…" : "Subir foto de datos bancarios"}
              </Button>
            )}
            {!preview && data.capabilities.ai && (
              <small>
                Al subir, la imagen se envía al servicio de IA configurado para
                leer sus datos.
              </small>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="gf-note">
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <Field label="Nombre del contacto">
            <input
              autoComplete="off"
              value={draft.name}
              onChange={(e) =>
                setDraft((p) => ({ ...p, name: e.target.value }))
              }
              placeholder="Persona o proveedor"
              required
              maxLength={150}
              disabled={busy}
            />
          </Field>
          {draft.accounts.map((a, i) => (
            <fieldset className="gf-edit-bank" key={i}>
              <legend>Cuenta {draft.accounts.length > 1 ? i + 1 : ""}</legend>
              <div className="gf-inline">
                <Field
                  label={`Banco${
                    draft.accounts.length > 1 ? " " + (i + 1) : ""
                  }`}
                >
                  <input
                    list="gf-bank-names"
                    value={a.bank}
                    onChange={(e) => account(i, "bank", e.target.value)}
                    required
                    maxLength={80}
                  />
                </Field>
                <Field
                  label={`Tipo de cuenta${
                    draft.accounts.length > 1 ? " " + (i + 1) : ""
                  }`}
                >
                  <select
                    value={a.type}
                    onChange={(e) => account(i, "type", e.target.value)}
                    required
                  >
                    <option value="">Elegir</option>
                    {Object.entries(accountTypes).map(([v, t]) => (
                      <option value={v} key={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label={`Número de cuenta${
                  draft.accounts.length > 1 ? " " + (i + 1) : ""
                }`}
              >
                <input
                  className="gf-account-input"
                  inputMode="text"
                  autoComplete="off"
                  value={a.number}
                  onChange={(e) => account(i, "number", e.target.value)}
                  required
                  maxLength={45}
                  placeholder="Número completo"
                />
              </Field>
              <details>
                <summary>El titular tiene otro nombre</summary>
                <Field
                  label={`Titular bancario${
                    draft.accounts.length > 1 ? " " + (i + 1) : ""
                  }`}
                >
                  <input
                    value={a.holder}
                    onChange={(e) => account(i, "holder", e.target.value)}
                    maxLength={150}
                  />
                </Field>
              </details>
              {draft.accounts.length > 1 && (
                <button
                  className="gf-remove-account"
                  type="button"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      accounts: p.accounts.filter((_, n) => n !== i),
                    }))
                  }
                >
                  Quitar esta cuenta
                </button>
              )}
            </fieldset>
          ))}
          <datalist id="gf-bank-names">
            {payeeBanks.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          {draft.accounts.length < 12 && (
            <Button
              type="button"
              variant="secondary"
              icon={Plus}
              onClick={() =>
                setDraft((p) => ({
                  ...p,
                  accounts: [...p.accounts, blankAccount()],
                }))
              }
            >
              Añadir otra cuenta
            </Button>
          )}
          <details className="gf-contact-optional">
            <summary>Cédula, RUC o correo · opcional</summary>
            <Field label="Cédula o RUC">
              <input
                inputMode="numeric"
                value={draft.document}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, document: e.target.value }))
                }
                maxLength={30}
              />
            </Field>
            <Field label="Correo del contacto">
              <input
                type="email"
                value={draft.email}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, email: e.target.value }))
                }
                maxLength={180}
              />
            </Field>
          </details>
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="gf-full-width"
            icon={Check}
            loading={busy}
          >
            Guardar contacto
          </Button>
          <p className="gf-payee-hint">
            Revisa los números completos. La lectura de una foto no verifica al
            titular.
          </p>
        </form>
      ) : (
        <form className="gf-request-composer" onSubmit={submit}>
          {preview && (
            <p className="gf-quick-preview-note">
              Ejemplos ficticios · no ingreses datos reales.
            </p>
          )}
          <div className="gf-request-scope">
            {writable.length > 1 ? (
              <Field label="Espacio">
                <select
                  value={spaceId}
                  onChange={(e) => changeSpace(e.target.value)}
                  disabled={busy}
                >
                  {writable.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <span>{space?.name || businessNames[business]}</span>
            )}
            {(space?.business_ids || user.business_ids).length > 1 && (
              <Field label="Negocio">
                <select
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                  disabled={busy}
                >
                  {(space?.business_ids || user.business_ids).map((b) => (
                    <option value={b} key={b}>
                      {businessNames[b]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!unit && user.unit_ids.length > 0 && (
              <Field label="Local">
                <select
                  value={unitChoice}
                  onChange={(e) => setUnitChoice(e.target.value)}
                  required
                >
                  <option value="">Elige tu local</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <label className="gf-request-amount">
            <span>¿Cuánto necesitas transferir?</span>
            <div>
              <b>$</b>
              <input
                aria-label="Monto de la transferencia"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0,00"
                required
              />
            </div>
          </label>
          <div className="gf-contact-picker">
            <header>
              <h3>¿A quién pagamos?</h3>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(blankContact());
                  setEditing(true);
                  setError("");
                  setWarnings([]);
                }}
              >
                <Plus size={17} />
                Nuevo contacto
              </button>
            </header>
            {contact ? (
              <div className="gf-selected-payee">
                <strong>{contact.name}</strong>
                <span>{contact.accounts.map((a) => a.bank).join(" · ")}</span>
                <small>
                  {contact.accounts.length}{" "}
                  {contact.accounts.length === 1
                    ? "cuenta disponible"
                    : "cuentas disponibles"}{" "}
                  ·{" "}
                  {user.role === "owner"
                    ? "tú eliges al pagar"
                    : "administración elige al pagar"}
                </small>
                <button type="button" onClick={() => setContact(null)}>
                  Cambiar contacto
                </button>
              </div>
            ) : (
              <>
                <div className="gf-contact-search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar contacto guardado"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nombre o cuenta"
                  />
                </div>
                <div className="gf-contact-results">
                  {loading ? (
                    <p>Cargando contactos…</p>
                  ) : results.length ? (
                    results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContact(c)}
                      >
                        <span className="gf-contact-initial">
                          {c.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>
                            {c.accounts
                              .map((a) => `${a.bank} ··${a.number.slice(-4)}`)
                              .join(" / ")}
                          </small>
                        </div>
                        <Plus size={18} />
                      </button>
                    ))
                  ) : (
                    <p>
                      No hay contactos todavía. Pulsa «Nuevo contacto» o sube la
                      foto allí.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <Field
            label="¿Para qué es?"
            hint="Una frase, por ejemplo: pago del bus para Loja."
          >
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo del pago"
              maxLength={1000}
            />
          </Field>
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="gf-full-width"
            icon={Send}
            loading={busy}
            disabled={
              !contact ||
              !Number.isSafeInteger(amount(value)) ||
              amount(value) <= 0 ||
              (user.unit_ids.length > 0 && !chosenUnit)
            }
          >
            {preview ? "Probar solicitud" : "Enviar petición"}
            {amount(value) > 0 ? ` · ${money(amount(value))}` : ""}
          </Button>
        </form>
      )}
    </Modal>
  );
}
export function EvidenceViewer({ path, title = "Comprobante", onClose }) {
  const [file, setFile] = useState(null),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1);
  let mounted = useRef(true);
  useEffect(() => {
    let object;
    mounted.current = true;
    fetch(`/api/finance${path}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("No se pudo abrir el documento");
        const blob = await r.blob();
        object = URL.createObjectURL(blob);
        if (mounted.current) setFile({ url: object, mime: blob.type });
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [path]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div
      className="gf-evidence-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Comprobante ampliado"
    >
      <header>
        <strong>{title}</strong>
        <div>
          {file && (
            <a
              href={file.url}
              download={`comprobante.${
                {
                  "application/pdf": "pdf",
                  "image/png": "png",
                  "image/jpeg": "jpg",
                  "image/webp": "webp",
                  "image/svg+xml": "svg",
                }[file.mime] || "bin"
              }`}
            >
              <Download size={19} />
              Descargar
            </a>
          )}
          <button
            type="button"
            aria-label="Cerrar comprobante ampliado"
            onClick={onClose}
            autoFocus
          >
            <X size={23} />
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !file ? (
        <p>Abriendo comprobante…</p>
      ) : (
        <>
          <div className="gf-evidence-full-image">
            {file.mime.startsWith("image/") ? (
              <img
                src={file.url}
                alt="Comprobante de la transferencia"
                style={{ width: `${zoom * 100}%` }}
              />
            ) : (
              <object data={file.url} type={file.mime}>
                <a href={file.url} download>
                  Descargar documento
                </a>
              </object>
            )}
          </div>
          {file.mime.startsWith("image/") && (
            <footer>
              <button
                type="button"
                onClick={() => setZoom((p) => Math.max(1, p - 0.5))}
                aria-label="Reducir comprobante"
              >
                <ZoomOut size={21} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((p) => Math.min(3, p + 0.5))}
                aria-label="Ampliar comprobante"
              >
                <ZoomIn size={21} />
              </button>
            </footer>
          )}
        </>
      )}
    </div>
  );
}
export function EvidenceThumbnail({ path, title, returnType, returnInitial }) {
  const { open } = useFinance();
  const [url, setUrl] = useState(null);
  const thumbnail = useRef();
  useEffect(() => {
    let cancelled = false,
      object;
    const controller = new AbortController();
    const load = () =>
      fetch(`/api/finance${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) return;
          const b = await r.blob();
          if (cancelled || !b.type.startsWith("image/")) return;
          object = URL.createObjectURL(b);
          if (!cancelled) setUrl(object);
        })
        .catch(() => {});
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "100px" }
    );
    if (thumbnail.current) observer.observe(thumbnail.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      controller.abort();
      if (object) URL.revokeObjectURL(object);
    };
  }, [path]);
  return (
    <button
      ref={thumbnail}
      className="gf-evidence-thumb"
      type="button"
      aria-label={`Ampliar ${title || "comprobante"}`}
      onClick={() =>
        open("evidence-viewer", {
          path,
          title,
          return_type: returnType,
          return_initial: returnInitial,
        })
      }
    >
      {url ? (
        <img src={url} alt={title || "Comprobante"} />
      ) : (
        <FileImage size={32} />
      )}
      <span>
        Toca para ver grande <ZoomIn size={17} />
      </span>
    </button>
  );
}
