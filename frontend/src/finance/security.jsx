import React, { useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { financeApi } from "./api.js";
import { Badge, Button, Field, Modal, SectionHead } from "./components.jsx";

export function SecurityPanel() {
  const { data, notify } = useFinance();
  const [security, setSecurity] = useState(null),
    [dialog, setDialog] = useState(""),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [code, setCode] = useState(""),
    [enrollment, setEnrollment] = useState(null),
    [recovery, setRecovery] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    financeApi("/security")
      .then(setSecurity)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  function open(kind) {
    setDialog(kind);
    setPassword("");
    setNewPassword("");
    setCode("");
    setEnrollment(null);
    setRecovery(null);
    setError("");
  }
  function close() {
    setDialog("");
    setEnrollment(null);
    setRecovery(null);
    setPassword("");
    setNewPassword("");
    setCode("");
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (dialog === "password") {
        await financeApi("/security/password", {
          password,
          new_password: newPassword,
          code,
        });
        notify("Contraseña actualizada y otras sesiones cerradas");
        close();
        load();
      } else if (dialog === "reset") {
        await financeApi("/security/totp/reset", { password, code });
        notify(
          "Autenticador desvinculado. Configura tu nuevo autenticador desde esta pantalla.",
        );
        close();
        load();
      } else if (!enrollment) {
        setEnrollment(await financeApi("/security/totp/start", { password }));
        setPassword("");
      } else {
        const result = await financeApi("/security/totp/confirm", { code });
        setRecovery(result.recovery_codes);
        setEnrollment(null);
        setCode("");
        load();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    try {
      await financeApi("/security/sessions/revoke", {});
      notify("Las otras sesiones quedaron cerradas");
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <section className="gf-panel gf-mb">
        <SectionHead
          title="Protege tu acceso"
          description="Verificación en dos pasos, contraseña y sesiones financieras."
        />
        <div className="gf-security-options">
          <div>
            <span className="gf-soft-icon">
              <Smartphone size={20} />
            </span>
            <div>
              <strong>Verificación en dos pasos</strong>
              <p>
                {security?.mfa_enabled
                  ? `Activa · ${security.recovery_remaining} códigos de recuperación disponibles.`
                  : "Añade un código de tu aplicación de autenticación al iniciar sesión."}
              </p>
            </div>
            {security?.mfa_enabled ? (
              <div className="gf-inline">
                <Badge status="approved">Activada</Badge>
                <Button variant="secondary" onClick={() => open("reset")}>
                  Reconfigurar
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={data.capabilities.demo}
                onClick={() => open("totp")}
              >
                Configurar
              </Button>
            )}
          </div>
          <div>
            <span className="gf-soft-icon">
              <KeyRound size={20} />
            </span>
            <div>
              <strong>Contraseña financiera</strong>
              <p>Al actualizarla se cerrarán tus otras sesiones.</p>
            </div>
            <Button
              variant="secondary"
              disabled={data.capabilities.demo}
              onClick={() => open("password")}
            >
              Cambiar
            </Button>
          </div>
          <div>
            <span className="gf-soft-icon">
              <LockKeyhole size={20} />
            </span>
            <div>
              <strong>Sesiones activas</strong>
              <p>
                {security?.sessions.length || 1} sesiones vigentes. Puedes
                cerrar todas excepto esta.
              </p>
            </div>
            <Button variant="secondary" onClick={revoke}>
              Cerrar otras sesiones
            </Button>
          </div>
        </div>
        {data.capabilities.demo && (
          <small className="gf-muted">
            La demostración usa un acceso local temporal. Configura tu
            contraseña y autenticador con tu cuenta de operación.
          </small>
        )}
        {error && !dialog && <div className="gf-error">{error}</div>}
      </section>
      {dialog && (
        <Modal
          title={
            dialog === "password"
              ? "Actualizar contraseña"
              : "Verificación en dos pasos"
          }
          subtitle={
            dialog === "password"
              ? "Confirma tu acceso para proteger este cambio."
              : dialog === "reset"
                ? "Confirma tu acceso antes de desvincular el autenticador actual."
                : "Vincula una aplicación compatible con códigos temporales."
          }
          onClose={close}
        >
          {recovery ? (
            <div className="gf-form">
              <div className="gf-note success">
                <ShieldCheck size={20} />
                <div>
                  <strong>Verificación activada.</strong>
                  <p>
                    Guarda estos códigos en un lugar privado. Cada uno sirve una
                    sola vez y no volveremos a mostrarlos.
                  </p>
                </div>
              </div>
              <div className="gf-recovery-codes">
                {recovery.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              <Button icon={Check} onClick={close}>
                Ya guardé mis códigos
              </Button>
            </div>
          ) : (
            <form className="gf-form" onSubmit={submit}>
              {!enrollment && (
                <Field
                  label="Tu contraseña actual"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              {dialog === "password" && (
                <>
                  <Field
                    label="Nueva contraseña"
                    hint="Usa 8 caracteres."
                    type="password"
                    minLength={8}
                    maxLength={8}
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  {security?.mfa_enabled && (
                    <Field
                      label="Código de autenticación o recuperación"
                      required
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  )}
                </>
              )}
              {dialog === "reset" && (
                <>
                  <div className="gf-note">
                    Se desactivará el autenticador actual y se invalidarán sus
                    códigos de recuperación. Después configura inmediatamente tu
                    nuevo autenticador.
                  </div>
                  <Field
                    label="Código de autenticación o recuperación"
                    required
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </>
              )}
              {enrollment && (
                <>
                  <div className="gf-totp-enrollment">
                    <img
                      src={enrollment.qr}
                      alt="QR privado para vincular tu autenticador"
                    />
                    <p>
                      Escanea el QR con tu aplicación de autenticación. Si estás
                      usando el mismo teléfono, introduce esta clave
                      manualmente:
                    </p>
                    <code>{enrollment.secret}</code>
                  </div>
                  <Field
                    label="Código de seis dígitos"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </>
              )}
              {error && (
                <div className="gf-error" role="alert">
                  {error}
                </div>
              )}
              <footer className="gf-form-footer">
                <Button variant="secondary" type="button" onClick={close}>
                  Cancelar
                </Button>
                <Button type="submit" loading={busy}>
                  {dialog === "password"
                    ? "Actualizar contraseña"
                    : dialog === "reset"
                      ? "Desvincular autenticador"
                      : enrollment
                        ? "Activar verificación"
                        : "Continuar"}
                </Button>
              </footer>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
