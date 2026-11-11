import { canUseFinanceAssistant } from "../../../shared/finance-workflow.mjs";
import {
  isNativeFinance,
  NativeNotificationBridge,
  disconnectNativePush,
} from "./native-push.jsx";
import {
  BankNotificationsBridge,
  stopBankNotifications,
} from "./bank-notifications.jsx";
import { AccountNumberEditor } from "./account-summary.jsx";
import {PaymentUploadPicker} from './home-action-center.jsx';
import {ReceiptReview,ReceiptComposer} from './receipts.jsx';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  HelpCircle,
  Home,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Mic,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { FinanceContext } from "./context.jsx";
import {
  businessNames,
  dateLabel,
  downloadReport,
  financeApi,
  money,
  today,
} from "./api.js";
import {
  Badge,
  Brand,
  BusinessMark,
  Button,
  Empty,
  IconButton,
  Modal,
} from "./components.jsx";
import {
  BankImport,
  EditPanel,
  OpeningAllocationPanel,
  TransferPanel,
} from "./forms.jsx";
import {
  Accounts,
  Assistant,
  Closings,
  Integrations,
  MovementDetail,
  Movements,
  Overview,
  Reports,
  Review,
  Sales,
  Settings,
  Team,
} from "./pages.jsx";
import "./finance.css";
import "./legibility.css";
import "./security.css";
import { MandatoryPasswordChange, PersonalAccess } from "./security.jsx";
import { QuickCapture } from "./quick.jsx";
import {
  CustodyFunds,
  CustodyEditor,
  StoreReceiptForm,
  StoreReview,
  MailInbox,
  InviteActivation,
} from "./operations.jsx";
import { Loans, LoanDetail, LoanAlertsBar } from "./loans.jsx";
import {
  Checks,
  CheckEditor,
  Cards,
  CardStatement,
  FundingAlertBar,
} from "./funding.jsx";
import "./operations.css";
import "./quick.css";
import {
  Spaces,
  SpacePanel,
  PaymentDesk,
  PersistentPayments,
  WorkSummary,
  RequestDetails,
  RecordPayment,
  SharePayment,
  SpaceSettings,
  NewSpace,
} from "./workflows.jsx";
import "./workflows.css";
import { RequestComposer, EvidenceViewer } from "./payees.jsx";
import "./payees.css";
import "./account-summary.css";
import { SettlementBalanceForm } from "./settlements.jsx";

const pages = [
  {
    id: "cheques",
    label: "Cheques y cuenta corriente",
    icon: FileText,
    component: Checks,
    checksOnly: true,
  },
  {
    id: "tarjetas",
    label: "Pagos de tarjetas",
    icon: CalendarDays,
    component: Cards,
    cardsOnly: true,
  },
  {
    id: "confirmaciones",
    label: "Confirmar transferencias",
    icon: FileCheck2,
    component: StoreReview,
    reviewOnly: true,
  },
  {
    id: "prestamos",
    label: "Préstamos y débitos",
    icon: CalendarDays,
    component: Loans,
    ownerOnly: true,
  },
  {
    id: "espacios",
    label: "Espacios de pagos",
    icon: Users,
    component: Spaces,
  },
  {
    id: "pagos",
    label: "Por transferir",
    icon: Bell,
    component: PaymentDesk,
    hideCollector: true,
  },
  {
    id: "inicio",
    label: "Visión general",
    icon: LayoutDashboard,
    group: "TU OPERACIÓN",
    component: Overview,
  },
  {
    id: "movimientos",
    label: "Movimientos",
    icon: ArrowUpRight,
    component: Movements,
  },
  {
    id: "cuentas",
    label: "Cuentas y fondos",
    icon: Wallet,
    component: Accounts,
    hideCollector: true,
  },
  { id: "pendientes", label: "Revisión", icon: FileCheck2, component: Review },
  {
    id: "ventas",
    label: "Ventas",
    icon: ChartNoAxesCombined,
    group: "GESTIÓN",
    component: Sales,
    hideCollector: true,
  },
  {
    id: "gastos",
    label: "Gastos y presupuestos",
    icon: ArrowDownToLine,
    component: () => <Movements expenses />,
    hideCollector: true,
  },
  {
    id: "cierres",
    label: "Cierres de caja",
    icon: CalendarDays,
    component: Closings,
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: FileText,
    component: Reports,
    hideCollector: true,
  },
  {
    id: "asistente",
    assistantOnly: true,
    label: "Asistente IA",
    icon: Sparkles,
    group: "INTELIGENCIA",
    component: Assistant,
  },
  {
    id: "conexiones",
    label: "Fuentes y conexiones",
    icon: Link2,
    component: Integrations,
    hideCollector: true,
  },
  { id: "equipo", label: "Equipo y permisos", icon: Users, ownerOnly: true },
  {
    id: "mi-acceso",
    label: "Mi contraseña",
    icon: LockKeyhole,
    component: PersonalAccess,
  },
  {
    id: "configuracion",
    label: "Configuración",
    icon: Settings2,
    component: Settings,
  },
];
pages.unshift(
  pages.splice(
    pages.findIndex((p) => p.id === "inicio"),
    1
  )[0]
);
pages.find((p) => p.id === "equipo").component = Team;

function Login({ session, onLogin }) {
  const [username, setUsername] = useState(
      () => localStorage.getItem("gf_finance_username") || ""
    ),
    [remember, setRemember] = useState(
      () => localStorage.getItem("gf_finance_remember") !== "false"
    ),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [mfa, setMfa] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function enter(event, demo = false) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await financeApi(
        demo ? "/demo" : "/login",
        demo ? {} : { username, password, code, remember }
      );
      localStorage.setItem("gf_finance_remember", String(remember));
      if (remember) localStorage.setItem("gf_finance_username", username);
      else localStorage.removeItem("gf_finance_username");
      onLogin(data.user);
    } catch (e) {
      if (e.code === "MFA_REQUIRED") setMfa(true);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="gf-login">
      <section className="gf-login-story">
        <Brand />
        <div className="gf-login-copy">
          <span className="gf-eyebrow">
            EL CONTROL QUE TUS NEGOCIOS MERECEN
          </span>
          <h1>
            Tus negocios.
            <br />
            Una visión
            <br />
            <em>más clara.</em>
          </h1>
          <p>
            Dinero, documentos y decisiones.
            <br />
            Todo encuentra su lugar.
          </p>
          <div className="gf-login-businesses">
            <span>Producalza</span>
            <i />
            <span>Marjorie Botas</span>
            <i />
            <span>Gemashow</span>
          </div>
        </div>
        <div className="gf-login-lines" aria-hidden="true">
          <svg viewBox="0 0 700 400">
            {Array.from({ length: 12 }, (_, i) => (
              <path
                key={i}
                d={`M-100 ${350 + i * 15} C130 ${-80 + i * 20},420 ${
                  650 - i * 20
                },800 ${80 + i * 15}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
          </svg>
        </div>
        <footer>
          <ShieldCheck size={17} />
          Un espacio privado para tu operación financiera.
        </footer>
      </section>
      <section className="gf-login-access">
        <div className="gf-login-mobile-brand">
          <Brand />
        </div>
        <div className="gf-login-form">
          <span className="gf-login-lock">
            <LockKeyhole size={24} />
          </span>
          <span className="gf-eyebrow">BIENVENIDO A GEMA FINANZAS</span>
          <h2>
            Tu tranquilidad
            <br />
            empieza aquí.
          </h2>
          <p>Ingresa con tu acceso financiero.</p>
          <form onSubmit={enter}>
            <label className="gf-field">
              <span>Usuario</span>
              <input
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tu usuario"
              />
            </label>
            <label className="gf-field">
              <span>Contraseña</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña"
              />
            </label>
            {mfa && (
              <label className="gf-field">
                <span>Código de autenticación o recuperación</span>
                <input
                  required
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Código de tu aplicación"
                />
              </label>
            )}
            <label className="gf-remember-device">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>
                Recordar este dispositivo
                <small>Mantener mi sesión durante 30 días</small>
              </span>
            </label>
            {error && (
              <div className="gf-error" role="alert">
                {error}
              </div>
            )}
            <Button type="submit" loading={busy} icon={ArrowRight}>
              Entrar a mi espacio
            </Button>
          </form>
          {!session.configured && !session.demo && (
            <div className="gf-note">
              El acceso del propietario está pendiente de activación. Contacta
              al administrador de la aplicación.
            </div>
          )}
          {session.demo && (
            <div className="gf-demo-entry">
              <span>EXPLORA LA EXPERIENCIA</span>
              <p>
                {session.public_preview
                  ? "Recorre el centro financiero con datos ficticios, sin guardar cambios ni subir documentos."
                  : "Conoce el centro financiero con datos ficticios en un entorno local independiente."}
              </p>
              <Button
                variant="secondary"
                onClick={(e) => enter(e, true)}
                disabled={busy}
                icon={ArrowUpRight}
              >
                Abrir demostración
              </Button>
            </div>
          )}
          <small className="gf-login-privacy">
            <ShieldCheck size={14} />
            Acceso por permisos · sesión privada
          </small>
        </div>
        <footer>
          Gema Finanzas <span>Claridad para cada decisión.</span>
        </footer>
      </section>
    </main>
  );
}

function FinanceApp() {
  const [session, setSession] = useState(null),
    [user, setUser] = useState(null),
    [data, setData] = useState(null),
    [fatal, setFatal] = useState("");
  const [page, setPage] = useState(
      window.location.pathname.split("/")[2] || "inicio"
    ),
    [mobileOpen, setMobileOpen] = useState(false),
    [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null),
    [loading, setLoading] = useState(false),
    [hidden, setHidden] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [installPrompt, setInstallPrompt] = useState(null);
  const [search, setSearch] = useState(""),
    [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState({
    business_id: "all",
    from: `${today().slice(0, 7)}-01`,
    to: today(),
  });
  const loadId = useRef(0),
    toastTimer = useRef();
  const knownPayables = useRef(null);
  const notify = useCallback((message, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const refresh = useCallback(
    async (background = false) => {
      const id = ++loadId.current;
      setLoading(true);
      try {
        const result = await financeApi(
          `/snapshot?${new URLSearchParams(filters)}`,
          undefined,
          undefined,
          { interactive: background !== true }
        );
        if (id === loadId.current) {
          setData(result);
          setFatal("");
        }
        return result;
      } catch (e) {
        if (id === loadId.current) setFatal(e.message);
      } finally {
        if (id === loadId.current) setLoading(false);
      }
    },
    [filters]
  );
  useEffect(() => {
    financeApi("/session")
      .then((s) => {
        setSession(s);
        setUser(s.user);
        if (
          s.user &&
          !s.public_preview &&
          !s.remember_device &&
          localStorage.getItem("gf_finance_remember") !== "false"
        )
          financeApi("/remember-device", { remember: true }).catch(() => {});
        if (s.public_preview && s.period)
          setFilters((f) => ({ ...f, from: s.period.from, to: s.period.to }));
      })
      .catch((e) => setFatal(e.message));
  }, []);
  useEffect(() => {
    if (user && !user.password_change_required) {
      refresh();
      const timer = setInterval(() => refresh(true), 60_000);
      return () => clearInterval(timer);
    }
  }, [user, refresh, page]);
  useEffect(() => {
    if (!user?.password_change_at || user.password_change_required) return;
    const deadline = Date.parse(user.password_change_at),
      check = () => {
        if (Date.now() >= deadline)
          setUser((current) =>
            current ? { ...current, password_change_required: true } : current
          );
      };
    const timer = setTimeout(
      check,
      Math.min(Math.max(0, deadline - Date.now()), 2147483647)
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [user?.id, user?.password_change_at, user?.password_change_required]);
  useEffect(() => {
    if (user?.role !== "owner") {
      knownPayables.current = null;
      return;
    }
    if (!data?.workflow) return;
    const ids = new Set(data.workflow.queue.map((r) => r.id));
    if (
      knownPayables.current &&
      [...ids].some((id) => !knownPayables.current.has(id))
    )
      notify(
        "Tienes una nueva solicitud de transferencia. Quedará visible en Por transferir."
      );
    knownPayables.current = ids;
    navigator.serviceWorker?.controller?.postMessage({
      type: "GEMA_PAYABLES_UPDATED",
      count: data.workflow.summary.pending_count,
    });
  }, [data?.workflow, user?.role]);
  useEffect(() => {
    const ended = () => {
      setUser(null);
      setData(null);
      setModal(null);
    };
    const passwordRequired = (event) => {
      if (event.detail) {
        setUser(event.detail);
        setData(null);
        setModal(null);
        setFatal("");
      }
    };
    const connect = () => setOnline(navigator.onLine);
    const install = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const pop = () =>
      setPage(window.location.pathname.split("/")[2] || "inicio");
    const shortcut = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setModal({ type: "search" });
      }
    };
    window.addEventListener("finance-session-ended", ended);
    window.addEventListener(
      "finance-password-change-required",
      passwordRequired
    );
    window.addEventListener("online", connect);
    window.addEventListener("offline", connect);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("finance-session-ended", ended);
      window.removeEventListener(
        "finance-password-change-required",
        passwordRequired
      );
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", connect);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/finanzas/manifest.webmanifest";
    document.head.appendChild(manifest);
    const icon = document.createElement("link");
    icon.rel = "apple-touch-icon";
    icon.href = "/finanzas/icon-192.png";
    document.head.appendChild(icon);
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#173b30";
    document.head.appendChild(theme);
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow";
    document.head.appendChild(robots);
    if ("serviceWorker" in navigator && !isNativeFinance())
      navigator.serviceWorker
        .register("/finanzas/sw.js", { scope: "/finanzas/" })
        .catch(() => {});
  }, []);
  const navigate = (id) => {
    setPage(id);
    setMobileOpen(false);
    window.history.pushState({}, "", `/finanzas/${id === "inicio" ? "" : id}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const open = (type, initial = {}) => setModal({ type, initial });
  const selectMovement = (movement) =>
    movement.is_payment_request
      ? setModal({
          type: "pay-request",
          initial: { id: movement.id, return_space: movement.space_id },
        })
      : setModal({ type: "detail", movement });
  const run = async (path, body, success) => {
    try {
      const result = await financeApi(path, body);
      await refresh();
      notify(
        result.created !== undefined
          ? `${result.created} pendientes nuevos preparados`
          : success
      );
      return result;
    } catch (e) {
      notify(e.message, true);
    }
  };
  async function logout() {
    await stopBankNotifications();
    await disconnectNativePush();
    try {
      await financeApi("/logout", {});
    } catch {}
    setUser(null);
    setData(null);
    setModal(null);
  }
  async function exportReport() {
    setExporting(true);
    try {
      await downloadReport(filters);
      notify("Reporte descargado");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setExporting(false);
    }
  }
  async function previewPersona(role) {
    if (!data.capabilities.public_preview) return;
    try {
      const result = await financeApi("/preview/persona", { role });
      setModal(null);
      setData(null);
      setUser(result.user);
      setPage("inicio");
      setMobileOpen(false);
      setFilters({
        business_id: "all",
        from: data.period.from,
        to: data.period.to,
      });
      window.history.replaceState({}, "", "/finanzas/");
    } catch (e) {
      notify(e.message, true);
    }
  }
  const visiblePages = pages.filter(
    (p) =>
      (!p.ownerOnly || user?.role === "owner") &&
      (!p.assistantOnly || canUseFinanceAssistant(user)) &&
      (!p.cardsOnly ||
        user?.role === "owner" ||
        (user?.work_view && user?.username === "german")) &&
      (!p.checksOnly || user?.role === "owner" || user?.checks_manage) &&
      (!p.reviewOnly ||
        user?.role === "owner" ||
        user?.review_unit_ids?.length > 0) &&
      (!data?.capabilities.public_preview ||
        !["configuracion"].includes(p.id)) &&
      (user?.role !== "collector" ||
        [
          "inicio",
          "espacios",
          "mi-acceso",
          "confirmaciones",
          ...(user.checks_manage ? ["cheques"] : []),
          ...(canUseFinanceAssistant(user) ? ["asistente"] : []),
        ].includes(p.id)) &&
      (!user?.work_view ||
        [
          "inicio",
          "movimientos",
          "mi-acceso",
          "cuentas",
          "espacios",
          "pagos",
          "reportes",
          "cheques",
          "tarjetas",
          ...(canUseFinanceAssistant(user) ? ["asistente"] : []),
        ].includes(p.id)) &&
      (!p.hideCollector || user?.role !== "collector")
  );
  const current = visiblePages.find((p) => p.id === page) || visiblePages[0];
  const Page = current?.component;
  const close = () => setModal(null);
  const requestClose = () =>
    modal?.initial?.return_space
      ? open("space", { id: modal.initial.return_space })
      : close();
  if (!session)
    return (
      <div className="gf-loading-screen">
        <Brand />
        <Loader2 size={25} className="gf-spin" />
        {fatal && <p>{fatal}</p>}
      </div>
    );
  if (!user)
    return (
      <Login
        session={session}
        onLogin={(member) => {
          setUser(member);
          setPage("inicio");
          setFilters({
            business_id: "all",
            from: `${today().slice(0, 7)}-01`,
            to: today(),
          });
        }}
      />
    );
  if (user.password_change_required)
    return (
      <MandatoryPasswordChange
        user={user}
        onLogout={logout}
        onChanged={(member) => {
          setUser(member);
          setData(null);
          setFatal("");
          setPage("inicio");
        }}
      />
    );
  if (!data)
    return (
      <div className="gf-loading-screen">
        <Brand />
        <Loader2 size={25} className="gf-spin" />
        {fatal ? (
          <>
            <p role="alert">{fatal}</p>
            <Button onClick={refresh}>Reintentar</Button>
            <Button variant="ghost" onClick={logout}>
              Cerrar sesión
            </Button>
          </>
        ) : (
          <p>Preparando tu espacio financiero…</p>
        )}
      </div>
    );
  return (
    <FinanceContext.Provider
      value={{
        data,
        user,
        updateUser: setUser,
        filters,
        notify,
        refresh,
        navigate,
        open,
        selectMovement,
        run,
      }}
    >
      <NativeNotificationBridge />
      <BankNotificationsBridge />
      <div
        className={`gf-app ${hidden ? "gf-values-hidden" : ""} ${
          user.role === "collector" ? "gf-collector" : ""
        } ${user.work_view ? "gf-work-view" : ""}`}
        data-page={current.id}
      >
        {mobileOpen && (
          <div
            className="gf-nav-backdrop"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          className={`gf-sidebar ${mobileOpen ? "open" : ""}`}
          aria-label="Navegación principal"
        >
          <div className="gf-sidebar-brand">
            <Brand />
            <IconButton
              className="gf-mobile-only"
              icon={X}
              label="Cerrar menú"
              onClick={() => setMobileOpen(false)}
            />
          </div>
          <button className="gf-workspace" onClick={() => navigate("inicio")}>
            <span className="gf-workspace-icon">
              <Building2 size={18} />
            </span>
            <span>
              <strong>
                {user.role === "collector"
                  ? "Mi espacio de trabajo"
                  : "Mi grupo de negocios"}
              </strong>
              <small>
                {user.role === "collector"
                  ? "Comprobantes y solicitudes"
                  : "Centro de control financiero"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
          <nav>
            {visiblePages.map((p) => (
              <React.Fragment key={p.id}>
                {p.group && <span className="gf-nav-label">{p.group}</span>}
                <button
                  className={current.id === p.id ? "active" : ""}
                  onClick={() => navigate(p.id)}
                  aria-current={current.id === p.id ? "page" : undefined}
                >
                  <p.icon size={18} />
                  <span>{p.label}</span>
                  {p.id === "pendientes" && data.summary.pending_count > 0 && (
                    <small>{data.summary.pending_count}</small>
                  )}
                  {p.id === "asistente" && (
                    <span className="gf-nav-ai">IA</span>
                  )}
                  {p.id === "pagos" &&
                    user.role === "owner" &&
                    data.workflow?.summary.pending_count > 0 && (
                      <small>{data.workflow.summary.pending_count}</small>
                    )}
                </button>
              </React.Fragment>
            ))}
          </nav>
          <div className="gf-sidebar-bottom">
            <button className="gf-install" onClick={() => open("install")}>
              <span>
                <ArrowDownToLine size={19} />
              </span>
              <div>
                <strong>Lleva tu control contigo</strong>
                <small>Instalar aplicación</small>
              </div>
              <ChevronRight size={15} />
            </button>
            <div className="gf-user">
              <span className="gf-avatar">
                {user.name
                  .split(" ")
                  .slice(0, 2)
                  .map((s) => s[0])
                  .join("")}
              </span>
              <div>
                <strong>{user.name}</strong>
                <small>
                  {
                    {
                      owner: "Propietario",
                      manager: "Administración",
                      collector: "Colaborador",
                      viewer: "Consulta",
                    }[user.role]
                  }
                </small>
              </div>
              <IconButton
                icon={LogOut}
                label="Cerrar sesión"
                onClick={logout}
              />
            </div>
          </div>
        </aside>
        <div className="gf-main-shell">
          <header className="gf-topbar">
            <div className="gf-topbar-left">
              <IconButton
                icon={Menu}
                label="Abrir menú"
                className="gf-mobile-only"
                onClick={() => setMobileOpen(true)}
              />
              <span className="gf-breadcrumb">
                Mi espacio <ChevronRight size={13} />
                <strong>{current.label}</strong>
              </span>
            </div>
            <div className="gf-topbar-right">
              <button
                className="gf-global-search"
                onClick={() => open("search")}
              >
                <Search size={17} />
                <span>Buscar un movimiento</span>
                <kbd>⌘ K</kbd>
              </button>
              <span className="gf-topbar-separator" />
              <IconButton
                icon={hidden ? EyeOff : Eye}
                label={hidden ? "Mostrar cifras" : "Ocultar cifras"}
                onClick={() => setHidden(!hidden)}
              />
              <button
                className="gf-notification"
                aria-label={`${data.summary.pending_count} movimientos pendientes`}
                onClick={() =>
                  navigate(
                    user.role === "collector" ? "movimientos" : "pendientes"
                  )
                }
              >
                <Bell size={19} />
                {data.summary.pending_count > 0 && <i />}
              </button>
              <span className="gf-topbar-avatar">{user.name[0]}</span>
            </div>
          </header>
          {data.capabilities.demo && (
            <div className="gf-demo-banner">
              <span>
                <i />
                DEMOSTRACIÓN
              </span>
              <p>
                {data.capabilities.public_preview
                  ? "Ejemplos · no subas información real."
                  : "Datos ficticios · entorno local separado de tus negocios reales."}
              </p>
              {data.capabilities.persona_preview ? (
                <div
                  className="gf-preview-personas"
                  role="group"
                  aria-label="Vista de demostración"
                >
                  <select
                    aria-label="Probar perfil de ejemplo"
                    value={
                      user.preview_persona ||
                      (user.role === "owner"
                        ? "owner"
                        : user.work_view
                        ? "german"
                        : "norma")
                    }
                    onChange={(e) => previewPersona(e.target.value)}
                  >
                    {(
                      data.preview_personas || [
                        { id: "owner", label: "Mi panel" },
                        { id: "norma", label: "Norma" },
                        { id: "german", label: "Papá" },
                      ]
                    ).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <ShieldCheck size={14} />
              )}
            </div>
          )}
          {!(user.role==='owner'&&current.id==='inicio')&&<><PersistentPayments/><LoanAlertsBar/><FundingAlertBar/></>}
          {!online && (
            <div className="gf-offline">
              <CloudOff size={17} />
              Sin conexión. Los cambios requieren conexión para guardarse.
            </div>
          )}
          <main className="gf-main" id="gf-main" tabIndex={-1}>
            {user.role !== "collector" &&
              !(user.work_view && current.id === "inicio") &&
              !(user.role==='owner'&&current.id==='inicio') &&
              !["espacios", "pagos"].includes(current.id) && (
                <div className="gf-filterbar">
                  <div className="gf-business-filter">
                    <Building2 size={16} />
                    <select
                      aria-label="Filtrar negocio"
                      value={filters.business_id}
                      onChange={(e) =>
                        setFilters((f) => ({
                          ...f,
                          business_id: e.target.value,
                        }))
                      }
                    >
                      <option value="all">Todos mis negocios</option>
                      {user.business_ids.map((id) => (
                        <option key={id} value={id}>
                          {businessNames[id]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="gf-inline gf-period-filter">
                    <CalendarDays size={15} />
                    <input
                      aria-label="Fecha inicial"
                      type="date"
                      disabled={data.capabilities.public_preview}
                      title={
                        data.capabilities.public_preview
                          ? "Período fijo de esta demostración"
                          : undefined
                      }
                      value={filters.from}
                      onChange={(e) => {
                        if (e.target.value)
                          setFilters((f) => ({ ...f, from: e.target.value }));
                      }}
                    />
                    <span>—</span>
                    <input
                      aria-label="Fecha final"
                      type="date"
                      disabled={data.capabilities.public_preview}
                      title={
                        data.capabilities.public_preview
                          ? "Período fijo de esta demostración"
                          : undefined
                      }
                      value={filters.to}
                      onChange={(e) => {
                        if (e.target.value)
                          setFilters((f) => ({ ...f, to: e.target.value }));
                      }}
                    />
                    {loading ? (
                      <Loader2 size={15} className="gf-spin" />
                    ) : (
                      <span
                        className="gf-live-dot"
                        title="Vista actualizada desde el servidor"
                      />
                    )}
                  </div>
                  {user.role !== "viewer" && (
                    <Button
                      icon={Mic}
                      onClick={() => open("quick")}
                      className="gf-top-upload"
                    >
                      Registrar rápido
                    </Button>
                  )}
                </div>
              )}
            {fatal && (
              <div className="gf-error gf-mb" role="alert">
                {fatal} <button onClick={refresh}>Reintentar</button>
              </div>
            )}
            <Page key={current.id} />
            <footer className="gf-main-footer">
              <span>
                Gema Finanzas <i /> Claridad para cada decisión.
              </span>
              <span>
                <ShieldCheck size={13} />
                Espacio privado · USD
              </span>
            </footer>
          </main>
        </div>
        {user.role === "collector" && (
          <nav
            className="gf-bottom-nav gf-staff-nav"
            aria-label="Navegación móvil"
          >
            <button onClick={() => navigate("inicio")}>
              <Home size={22} />
              <span>Inicio</span>
            </button>
            <button onClick={() => open("quick", { mode: "request" })}>
              <ArrowUpRight size={22} />
              <span>Pedir pago</span>
            </button>
            <button onClick={() => navigate("espacios")}>
              <Users size={22} />
              <span>Espacios</span>
            </button>
            {Boolean(user.review_unit_ids?.length) && (
              <button onClick={() => navigate("confirmaciones")}>
                <FileCheck2 size={22} />
                <span>Confirmar</span>
              </button>
            )}
            <button onClick={() => setMobileOpen(true)}>
              <Menu size={22} />
              <span>Más</span>
            </button>
          </nav>
        )}
        {user.role !== "collector" && (
          <nav className="gf-bottom-nav" aria-label="Navegación móvil">
            <button
              className={current.id === "inicio" ? "active" : ""}
              onClick={() => navigate("inicio")}
            >
              <LayoutDashboard size={21} />
              <span>Inicio</span>
            </button>
            <button
              className={current.id === "movimientos" ? "active" : ""}
              onClick={() => navigate("movimientos")}
            >
              <ArrowUpRight size={21} />
              <span>
                {user.work_view
                  ? "Trabajo"
                  : user.role === "collector"
                  ? "Mis envíos"
                  : "Movimientos"}
              </span>
            </button>
            {user.role !== "viewer" && (
              <button
                className="gf-mobile-add"
                aria-label="Registrar rápido"
                onClick={() => open("quick")}
              >
                <Plus size={25} />
              </button>
            )}
            {user.role !== "collector" && (
              <button
                className={
                  current.id === (user.work_view ? "espacios" : "pagos")
                    ? "active"
                    : ""
                }
                onClick={() => navigate(user.work_view ? "espacios" : "pagos")}
              >
                {user.work_view ? <Users size={21} /> : <Bell size={21} />}
                <span>
                  {user.work_view ? "Espacios" : "Por pagar"}
                  {user.role === "owner" &&
                    data.workflow?.summary.pending_count > 0 &&
                    ` · ${data.workflow.summary.pending_count}`}
                </span>
              </button>
            )}
            <button onClick={() => setMobileOpen(true)}>
              <Menu size={21} />
              <span>Más</span>
            </button>
          </nav>
        )}
        {user.role !== "viewer" && (
          <Button
            className="gf-quick-floating"
            icon={Mic}
            onClick={() => open("quick")}
          >
            Registrar rápido
          </Button>
        )}
        {toast && (
          <div
            className={`gf-toast ${toast.error ? "error" : ""}`}
            role="status"
          >
            {toast.error ? <X size={18} /> : <Check size={18} />}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} aria-label="Cerrar aviso">
              <X size={15} />
            </button>
          </div>
        )}
        {modal &&
          [
            "movement",
            "expense",
            "account",
            "verify",
            "recurring",
            "budget",
            "closing",
            "member",
          ].includes(modal.type) && (
            <EditPanel
              key={modal.type}
              type={modal.type}
              initial={modal.initial}
              onClose={close}
            />
          )}
        {modal?.type === "detail" && (
          <MovementDetail movement={modal.movement} onClose={close} />
        )}
        {modal?.type==='upload-payment'&&<PaymentUploadPicker onClose={close}/>}
        {modal?.type==='receipt-review'&&<ReceiptReview id={modal.initial.id} onClose={close}/>}
        {modal?.type==='receipt-edit'&&<ReceiptComposer initial={modal.initial} onClose={close}/>}
        {modal?.type === "quick" && modal.initial?.mode === "request" && (
          <RequestComposer
            initial={modal.initial}
            onClose={
              modal.initial?.space_id
                ? () => open("space", { id: modal.initial.space_id })
                : close
            }
          />
        )}
        {modal?.type === "quick" && modal.initial?.mode !== "request" && (
          <QuickCapture
            initial={modal.initial}
            onClose={
              modal.initial?.space_id
                ? () => open("space", { id: modal.initial.space_id })
                : close
            }
          />
        )}
        {modal?.type === "space" && (
          <SpacePanel id={modal.initial.id} onClose={close} />
        )}
        {modal?.type === "pay-request" && (
          <RequestDetails id={modal.initial.id} onClose={requestClose} />
        )}
        {modal?.type === "record-payment" && (
          <RecordPayment
            id={modal.initial.id}
            initialDestination={modal.initial.destination_index}
            initialFile={modal.initial.initial_file}
            onClose={requestClose}
          />
        )}
        {modal?.type === "share-payment" && (
          <SharePayment id={modal.initial.id} onClose={close} />
        )}
        {modal?.type === "evidence-viewer" && (
          <EvidenceViewer
            path={modal.initial.path}
            title={modal.initial.title}
            onClose={() =>
              modal.initial.return_type
                ? open(
                    modal.initial.return_type,
                    modal.initial.return_initial || {}
                  )
                : close()
            }
          />
        )}
        {modal?.type === "space-settings" && (
          <SpaceSettings
            id={modal.initial.id}
            onClose={() => open("space", { id: modal.initial.id })}
          />
        )}
        {modal?.type === "new-space" && <NewSpace onClose={close} />}
        {modal?.type === "custody" && (
          <CustodyEditor id={modal.initial.id} onClose={close} />
        )}
        {modal?.type === "store-receipt" && (
          <StoreReceiptForm onClose={close} />
        )}
        {modal?.type === "loan-detail" && (
          <LoanDetail id={modal.initial.id} onClose={close} />
        )}
        {modal?.type === "account-number" && (
          <AccountNumberEditor
            id={modal.initial?.id}
            custodyId={modal.initial?.custody_id}
            onClose={close}
          />
        )}
        {modal?.type === "check-editor" && (
          <CheckEditor id={modal.initial?.id} onClose={close} />
        )}
        {modal?.type === "card-statement" && (
          <CardStatement id={modal.initial.id} onClose={close} />
        )}
        {modal?.type === "mail-inbox" && <MailInbox onClose={close} />}
        {modal?.type === "diners-balance" && (
          <SettlementBalanceForm onClose={close} />
        )}
        {modal?.type === "bank" && <BankImport onClose={close} />}
        {modal?.type === "transfer" && <TransferPanel onClose={close} />}
        {modal?.type === "allocation" && (
          <OpeningAllocationPanel account={modal.initial} onClose={close} />
        )}
        {modal?.type === "search" && (
          <Modal
            title="Encuentra un movimiento"
            subtitle="Busca entre los registros del período y negocio seleccionados."
            onClose={close}
          >
            <div className="gf-search gf-search-large">
              <Search size={20} />
              <input
                autoFocus
                aria-label="Búsqueda global"
                placeholder="Cliente, referencia, monto o descripción"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="gf-global-results">
              {data.movements
                .filter((m) =>
                  `${m.counterparty} ${m.reference} ${m.description} ${
                    m.amount_cents / 100
                  }`
                    .toLowerCase()
                    .includes(search.toLowerCase())
                )
                .slice(0, 12)
                .map((m) => (
                  <button key={m.id} onClick={() => selectMovement(m)}>
                    <BusinessMark id={m.business_id} size="small" />
                    <span>
                      <strong>{m.counterparty}</strong>
                      <small>
                        {m.category} · {dateLabel(m.day)}
                      </small>
                    </span>
                    <strong>{money(m.amount_cents)}</strong>
                    <ChevronRight size={15} />
                  </button>
                ))}
            </div>
          </Modal>
        )}
        {modal?.type === "install" && (
          <Modal
            title="Tu centro financiero, siempre a mano"
            subtitle="Instala Gema en tu celular o computadora con un acceso directo propio."
            onClose={close}
          >
            <div className="gf-install-detail">
              <Brand />
              <p>
                Abre la aplicación desde tu pantalla de inicio. Conserva el
                mismo acceso y permisos en todos tus dispositivos.
              </p>
              {installPrompt ? (
                <Button
                  icon={ArrowDownToLine}
                  onClick={async () => {
                    await installPrompt.prompt();
                    setInstallPrompt(null);
                    close();
                  }}
                >
                  Instalar aplicación
                </Button>
              ) : (
                <>
                  <div>
                    <strong>En iPhone o iPad</strong>
                    <p>
                      Abre en Safari, toca Compartir y selecciona «Agregar a
                      inicio».
                    </p>
                  </div>
                  <div>
                    <strong>En Android o computadora</strong>
                    <p>
                      Abre el menú de Chrome o Edge y selecciona «Instalar
                      aplicación» o «Agregar a pantalla de inicio» cuando esté
                      disponible.
                    </p>
                  </div>
                </>
              )}
              <div className="gf-note">
                La operación financiera requiere conexión. La instalación en
                otros dispositivos estará disponible cuando esta versión se
                publique con HTTPS.
              </div>
            </div>
          </Modal>
        )}
      </div>
    </FinanceContext.Provider>
  );
}

class FinanceErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error) {
    console.error("Finance UI:", error.message);
  }
  render() {
    return this.state.error ? (
      <div className="gf-loading-screen">
        <Brand />
        <h1>No se pudo mostrar esta vista.</h1>
        <p>Los registros guardados permanecen en el servidor.</p>
        <Button onClick={() => window.location.reload()}>
          Volver a cargar
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

createRoot(document.getElementById("root")).render(
  <FinanceErrorBoundary>
    {new URLSearchParams(window.location.hash.slice(1)).has("invite") ? (
      <InviteActivation />
    ) : (
      <FinanceApp />
    )}
  </FinanceErrorBoundary>
);
