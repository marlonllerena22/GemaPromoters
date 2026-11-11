import React, { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Smartphone, ShieldCheck, RefreshCw } from "lucide-react";
import { financeApi, money, amount } from "./api.js";
import { useFinance } from "./context.jsx";
import { Button, Field } from "./components.jsx";
import "./bank-notifications.css";

const Native = registerPlugin("BankNotifications");
const available = () =>
  Capacitor.isNativePlatform() &&
  Capacitor.isPluginAvailable("BankNotifications");
const banks = [
  "Pichincha",
  "Guayaquil",
  "Pacífico",
  "Produbanco",
  "Solidario",
  "Deuna",
];
const guess = (s) =>
  banks.find((b) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .includes(
        b
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
      )
  ) || "Pichincha";
const code = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/banco|del|de|[^a-z]/g, "");
export async function stopBankNotifications() {
  if (!available()) return;
  const s = await Native.status().catch(() => null);
  if (s?.device_id)
    await financeApi(
      `/bank-notification-devices/${s.device_id}/revoke`,
      {}
    ).catch(() => {});
  await Native.stop();
}
export function BankNotificationsBridge() {
  const { user,refresh } = useFinance();
  useEffect(() => {
    if (!available()) return;
    let cancelled = false,running=false,first=true,lastUpload=0;
    const check=async()=>{
      if(cancelled||running||document.visibilityState==='hidden')return;
      running=true;
      try{
      let s = await Native.status();
      if (!s.enabled) return;
      if (user.role !== "owner" || s.owner_id !== user.id) {
        await Native.stop();
        return;
      }
      const state = await financeApi(
        "/bank-notifications",
        undefined,
        undefined,
        { interactive: false }
      );
      const device = state.devices.find(
        (d) => d.client_id === s.client_id && !d.revoked
      );
      if (!device) {
        await Native.stop();
        return;
      }
      if (cancelled) return;
      if(first||!s.paired){
        const paired = await financeApi("/bank-notification-devices", {client_id: s.client_id,apps: device.apps});
        if(!cancelled){await Native.configure({ ...paired, owner_id: user.id });s=await Native.status();}
      }
      first=false;
      if(cancelled)return;
      await financeApi(`/bank-notification-devices/${device.id}/health`,{reader_version:s.reader_version,permission:s.permission,enabled:s.enabled,paired:s.paired,listener_connected:s.listener_connected,queued:s.queued,last_capture:s.last_capture,last_upload:s.last_upload,error:s.error||''},undefined,{interactive:false});
      if(lastUpload&&s.last_upload>lastUpload)void refresh(true);
      lastUpload=s.last_upload||lastUpload;
      }catch{}finally{running=false;}
    };
    void check();const timer=setInterval(()=>void check(),30_000);
    const wake=()=>void check();window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
    return () => {
      cancelled = true;
      clearInterval(timer);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);
    };
  }, [user.id]);
  return null;
}
export function BankNotificationsShortcut() {
  const { user, navigate } = useFinance();
  if (user.role !== "owner" || !Capacitor.isNativePlatform()) return null;
  return (
    <button className="gf-bank-shortcut" onClick={() => navigate("conexiones")}>
      <Smartphone size={22} />
      <span>
        <strong>Avisos de tus bancos</strong>
        <small>
          {available()
            ? "Conectar apps y revisar movimientos detectados"
            : "Actualiza la APK para leer los avisos bancarios"}
        </small>
      </span>
      <span aria-hidden="true">→</span>
    </button>
  );
}
function Notice({ event, onChange }) {
  const { data, refresh } = useFinance();
  const [account, setAccount] = useState(String(event.account_id || "")),
    [direction, setDirection] = useState(event.direction || ""),
    [value, setValue] = useState(
      event.amount_cents ? String(event.amount_cents / 100) : ""
    ),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const accounts = data.accounts.filter(
    (a) => a.kind === "bank" && code(a.bank) === code(event.bank)
  );
  const signed = amount(value) * (direction === "outgoing" ? -1 : 1);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.posted_at));
  const candidates = (data.bank_transactions || []).filter(
    (b) =>
      b.account_id === Number(account) &&
      b.amount_cents === signed &&
      (b.day === day || (event.reference && b.reference === event.reference))
  );
  async function action(path, body) {
    setBusy(true);
    setError("");
    try {
      await financeApi(path, body);
      await refresh();
      await onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const state = event.awaiting_mail?'Verificando automáticamente':
    {
      review: "Por revisar",
      applied: "Registrado",
      matched: "Relacionado · sin duplicar",
      dismissed: "Descartado",
    }[event.state] || event.state;
  return (
    <article className="gf-bank-notice">
      <div className="gf-between">
        <strong>
          {event.bank} ·{" "}
          {event.amount_cents ? money(event.amount_cents) : "Revisar importe"}
        </strong>
        <span>{state}</span>
      </div>
      <p className="gf-bank-notice-text">{event.text}</p>
      <small>
        {new Date(event.posted_at).toLocaleString("es-EC", {
          timeZone: "America/Guayaquil",
        })}
      </small>
      <p>{event.awaiting_mail?'Buscando el correo para identificar la cuenta. Se actualizará solo.':event.reason}</p>
      {event.state === "review" && !event.awaiting_mail && (
        <>
          <div className="gf-bank-notice-fields">
            <Field label="Cuenta">
              <select
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setLink("");
                }}
              >
                <option value="">Seleccionar cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Movimiento">
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                disabled={!!event.direction}
              >
                <option value="">Seleccionar</option>
                <option value="incoming">Entró dinero</option>
                <option value="outgoing">Salió dinero</option>
              </select>
            </Field>
            <Field label="Valor en dólares">
              <input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                readOnly={!!event.amount_cents}
              />
            </Field>
          </div>
          {!!candidates.length && (
            <Field label="¿Ya estaba registrado?">
              <select value={link} onChange={(e) => setLink(e.target.value)}>
                <option value="">Seleccionar la coincidencia</option>
                {candidates.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.day} · {money(Math.abs(b.amount_cents))} ·{" "}
                    {b.reference || b.description || "Sin referencia"}
                  </option>
                ))}
                <option value="new">
                  Es otra operación distinta · registrar aparte
                </option>
              </select>
            </Field>
          )}
          {error && (
            <p className="gf-error" role="alert">
              {error}
            </p>
          )}
          <div className="gf-form-actions">
            <Button
              loading={busy}
              disabled={
                event.blocked || !account || !direction || !amount(value)
              }
              onClick={() =>
                action(`/bank-notifications/${event.id}/apply`, {
                  account_id: Number(account),
                  direction,
                  amount_cents: amount(value),
                  ...(link === "new"
                    ? { new_operation: true }
                    : link
                    ? { link_bank_id: Number(link) }
                    : {}),
                })
              }
            >
              {link && link !== "new"
                ? "Relacionar sin sumar"
                : "Confirmar en la cuenta"}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                action(`/bank-notifications/${event.id}/dismiss`, {})
              }
            >
              Descartar
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
export function BankNotificationsPanel() {
  const { user, data, notify,refresh } = useFinance(),
    [local, setLocal] = useState(null),
    [installed, setInstalled] = useState([]),
    [apps, setApps] = useState({}),
    [server, setServer] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showAll, setShowAll] = useState(false);
  async function reload(options={}) {
    const state = await financeApi("/bank-notifications");
    setServer(state);
    if (available()&&!options.quiet) {
      const [s, a] = await Promise.all([Native.status(), Native.apps()]);
      setLocal(s);
      setInstalled(a.apps);
      const device = state.devices.find(
        (d) => d.client_id === s.client_id && !d.revoked
      );
      if (device)
        setApps(
          Object.fromEntries(device.apps.map((p) => [p.package_name, p]))
        );
    }
    return state;
  }
  const waitingIds=(server?.events||[]).filter(e=>e.awaiting_mail).map(e=>e.id).join(',');
  useEffect(()=>{
    if(!waitingIds)return;
    let active=true,running=false;
    const timer=setInterval(async()=>{
      if(running||document.visibilityState==='hidden')return;
      running=true;
      try{
        const next=await reload({quiet:true});
        if(active&&next.events.some(e=>waitingIds.split(',').includes(String(e.id))&&['applied','matched'].includes(e.state))){await refresh();notify('Transferencia verificada automáticamente');}
      }catch{}finally{running=false;}
    },4000);
    return()=>{active=false;clearInterval(timer);};
  },[waitingIds]);
  useEffect(() => {
    if (user.role !== "owner") return;
    void reload().catch((e) => setError(e.message));
    const focus = () => {
      if (available())
        void Native.status()
          .then(setLocal)
          .catch(() => {});
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [user.id]);
  if (user.role !== "owner") return null;
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const selected = Object.values(apps);
      if (!selected.length) throw new Error("Elige al menos una app bancaria");
      const paired = await financeApi("/bank-notification-devices", {
        client_id: local.client_id,
        apps: selected,
      });
      await Native.configure({ ...paired, owner_id: user.id });
      await reload();
      if (!local.permission) await Native.settings();
        notify("Conexión guardada. Los avisos dudosos quedarán para revisar.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const events = server?.events || [],
    pending = events.filter((e) => e.state === "review");
  const updateReader=available()&&local&&(local.reader_version||1)<2;
  return (
    <section className="gf-bank-notifications gf-panel">
      {updateReader&&<div className="gf-panel"><h3>Actualiza el lector bancario</h3><p>Esta actualización reconecta el lector y recupera avisos que sigan visibles en tu celular.</p><a className="gf-button" href="/finanzas/downloads/gema-finanzas-1.1.1.apk">Instalar actualización 1.1.1</a></div>}
      <div className="gf-bank-title">
        <Smartphone size={28} />
        <div>
          <h3>Avisos de tus bancos</h3>
          <p>Ingresos y pagos desde las notificaciones de tu celular.</p>
        </div>
      </div>
      {!available() ? (
        <div>
          <p>
            Instala la APK 1.1.1 para conectar Deuna y tus apps bancarias. El
            correo seguirá funcionando por separado.
          </p>
          <a
            className="gf-button"
            href="/finanzas/downloads/gema-finanzas-1.1.1.apk"
          >
            Descargar APK actualizada
          </a>
        </div>
      ) : (
        <>
          <div className="gf-bank-privacy">
            <ShieldCheck size={23} />
            <p>
              Android concede acceso general a las notificaciones. Gema filtra
              en tu teléfono las apps seleccionadas y descarta códigos de
              seguridad. Solo tu usuario puede ver estos avisos.
            </p>
          </div>
          <p>
            <strong>
              {local?.enabled && local?.permission && local?.paired
                ? local.listener_connected===false?'Reconectando lector de Android…':(local.reader_version||1)<2?'Actualiza el lector para comprobar su conexión':'Lectura conectada'
                : local?.enabled && !local?.permission
                ? "Falta permitir el acceso en Android"
                : "Conecta tus bancos"}
            </strong>
            {local?.queued ? ` · ${local.queued} avisos por enviar` : ""}
          </p>
          {local?.last_upload > 0 && (
            <p>
              Último envío:{" "}
              {new Date(local.last_upload).toLocaleString("es-EC", {
                timeZone: "America/Guayaquil",
              })}
            </p>
          )}
          {local?.error && (
            <p className="gf-error">
              {local.error === "reconnect"
                ? "Vuelve a conectar para renovar el acceso."
                : local.error === "queue_full"
                ? "La cola de avisos está llena. Abre la app con Internet."
                : "Hay avisos pendientes de enviar. Se reintentará con Internet."}
            </p>
          )}
          <div className="gf-bank-apps">
            {installed.map((a) => {
              const p = apps[a.package_name];
              return (
                <div className="gf-bank-app" key={a.package_name}>
                  <label className="gf-bank-app-select">
                    <input
                      type="checkbox"
                      checked={!!p}
                      onChange={(e) =>
                        setApps((old) => {
                          const next = { ...old };
                          if (e.target.checked)
                            next[a.package_name] = {
                              package_name: a.package_name,
                              bank: guess(a.label + " " + a.package_name),
                              account_id: null,
                              automatic: false,
                            };
                          else delete next[a.package_name];
                          return next;
                        })
                      }
                    />
                    <strong>{a.label}</strong>
                  </label>
                  {p && (
                    <div className="gf-bank-app-options">
                      <Field label="Banco">
                        <select
                          value={p.bank}
                          onChange={(e) =>
                            setApps({
                              ...apps,
                              [a.package_name]: {
                                ...p,
                                bank: e.target.value,
                                account_id: null,
                                automatic: false,
                              },
                            })
                          }
                        >
                          {banks.map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label="Cuenta si el aviso no la indica"
                        hint="Déjala sin elegir si la app maneja varias cuentas."
                      >
                        <select
                          value={p.account_id || ""}
                          onChange={(e) =>
                            setApps({
                              ...apps,
                              [a.package_name]: {
                                ...p,
                                account_id: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              },
                            })
                          }
                        >
                          <option value="">
                            Detectar por número · si falta, revisar
                          </option>
                          {data.accounts
                            .filter(
                              (b) =>
                                b.kind === "bank" &&
                                code(b.bank) === code(p.bank)
                            )
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <label className="gf-bank-app-select">
                        <input
                          type="checkbox"
                          checked={p.automatic}
                          onChange={(e) =>
                            setApps({
                              ...apps,
                              [a.package_name]: {
                                ...p,
                                automatic: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>
                          Registrar automáticamente solo avisos claros con
                          referencia
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!installed.length && (
            <p>
              No encontramos apps bancarias compatibles instaladas. Comprueba
              que estén instaladas en este mismo celular y actualiza esta
              pantalla.
            </p>
          )}
          <p>
            Empieza en revisión. Activa el registro automático después de
            comprobar avisos reales. Si hay dudas o posibles duplicados, siempre
            se pedirá revisión.
          </p>
          <div className="gf-form-actions">
            <Button
              loading={busy}
              disabled={!local || !Object.keys(apps).length}
              onClick={connect}
            >
              {local?.enabled ? "Guardar conexión" : "Conectar bancos"}
            </Button>
            <Button variant="secondary" onClick={() => Native.settings()}>
              Permiso de Android
            </Button>
            {local?.enabled && (
              <Button
                variant="secondary"
                onClick={async () => {
                  await stopBankNotifications();
                  await reload();
                }}
              >
                Desconectar
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="gf-error" role="alert">
          {error}
        </p>
      )}
      <div className="gf-between gf-bank-inbox-title">
        <h4>
          {pending.length
            ? pending.every(e=>e.awaiting_mail)?`${pending.length} avisos verificándose`:`${pending.filter(e=>!e.awaiting_mail).length} avisos por revisar`
            : "Avisos recibidos"}
        </h4>
        <Button
          variant="secondary"
          icon={RefreshCw}
          onClick={() => reload().catch((e) => setError(e.message))}
        >
          Actualizar
        </Button>
      </div>
      {!events.length && (
        <p>
          Aún no ha llegado ningún aviso de este celular. Después de conectarlo,
          haz una operación normal y vuelve aquí para comprobarla.
        </p>
      )}
      {(showAll ? events : pending).map((e) => (
        <Notice key={e.id} event={e} onChange={reload} />
      ))}
      {!!events.length && (
        <Button variant="secondary" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Ver solo pendientes" : "Ver historial de avisos"}
        </Button>
      )}
      {!!server?.devices.filter((d) => !d.revoked && d.id !== local?.device_id)
        .length && (
        <details>
          <summary>Otros celulares conectados</summary>
          {server.devices
            .filter((d) => !d.revoked && d.id !== local?.device_id)
            .map((d) => (
              <p key={d.id}>
                {d.apps.map((a) => a.bank).join(", ")} ·{" "}
                {d.last_seen
                  ? new Date(d.last_seen).toLocaleString("es-EC")
                  : "Sin avisos todavía"}{" "}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await financeApi(
                      `/bank-notification-devices/${d.id}/revoke`,
                      {}
                    );
                    await reload();
                  }}
                >
                  Revocar acceso
                </Button>
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
