import {IessLogo} from './iess.jsx';
import React, { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  Mic,
  Upload,
  Wallet,
} from "lucide-react";
import { useFinance } from "./context.jsx";
import { Button, Modal } from "./components.jsx";
import { money, dateLabel } from "./api.js";
import { AccountTiles } from "./account-summary.jsx";
import { PushEnrollment } from "./workflows.jsx";
import { pendingReceipt } from "./receipts.jsx";
import { storeReceiptRoute } from "../../../shared/finance-store-receipts.mjs";
import { DirectPaymentUpload } from "./payment-proof.jsx";
import { BankNotificationsShortcut } from "./bank-notifications.jsx";
import { LoanAlertsBar } from "./loans.jsx";
import { FundingAlertBar } from "./funding.jsx";

export function PaymentUploadPicker({ onClose }) {
  const { data, open } = useFinance(),
    requests = data.workflow?.queue || [];
  return (
    <Modal
      title="¿Qué pago realizaste?"
      className="gf-payment-fast-modal"
      onClose={onClose}
    >
      <div className="gf-upload-choices">
        {requests.map((r) => (
          <article key={r.id}>
            <div>
              {r.request_kind==='iess'&&<IessLogo/>}<strong>{r.counterparty}</strong>
              <b>{money(r.remaining_cents)}</b>
              <span>{r.description}</span>
            </div>
            <DirectPaymentUpload request={r} />
          </article>
        ))}
        {!requests.length && <p>No tienes solicitudes pendientes de pago.</p>}
        <Button
          variant="secondary"
          icon={Camera}
          onClick={() => open("quick", { mode: "receipt" })}
        >
          Es un depósito que recibí
        </Button>
      </div>
    </Modal>
  );
}
export function OwnerHome() {
  const { user, data, open, navigate } = useFinance(),
    [tab, setTab] = useState("all");
  const requests = data.workflow?.queue || [];
  const receipts = (data.receipt_inbox || []).filter(
    (r) => pendingReceipt(r) && storeReceiptRoute(r)?.role !== "local-reviewer"
  );
  const p = data.liquidity,
    total = requests.length + receipts.length;
  const extra = data.review_counts || {};
  const upcoming = p?.obligations || [];
  const queue = [
    ...requests.map((r) => ({ kind: "payment", r })),
    ...receipts.map((r) => ({ kind: "receipt", r })),
  ].filter((item) => tab === "all" || item.kind === tab);
  return (
    <div className="gf-owner-home">
      <header className="gf-home-greeting">
        <div>
          <span>
            {dateLabel(data.period.today, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1>Hola, {user.name.split(" ")[0]}.</h1>
        </div>
        <button
          aria-label="Ver todos los pendientes"
          onClick={() =>
            document
              .getElementById("gf-home-pending")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          <Bell size={23} />
          {total > 0 && <b>{total}</b>}
        </button>
      </header>
      <section className="gf-home-hero">
        <div className="gf-between">
          <span>Fondos registrados</span>
          <button onClick={() => navigate("cuentas")}>
            Ver cuentas <ArrowRight size={16} />
          </button>
        </div>
        <strong>{money(p?.cash_cents ?? data.summary.balance_cents)}</strong>
        <div className="gf-home-money-plan">
          <div>
            <span>Pagos próximos</span>
            <b>{money(p?.commitments_cents || 0)}</b>
          </div>
          <div>
            <span>Corriente reservada</span>
            <b>{money(p?.checking_reserved_cents || 0)}</b>
          </div>
        </div>
        {p?.shortfall_cents > 0 && (
          <button
            className="gf-home-shortfall"
            onClick={() => navigate("cheques")}
          >
            Falta cubrir {money(p.shortfall_cents)} <ChevronRight size={17} />
          </button>
        )}
      </section>
      <section className="gf-home-actions" aria-label="Accesos rápidos">
        <button onClick={() => open("upload-payment")}>
          <span className="gf-action-main">
            <Upload size={24} />
          </span>
          <strong>Subir comprobante</strong>
          <small>Pago realizado</small>
        </button>
        <button onClick={() => open("quick", { mode: "receipt" })}>
          <span>
            <Camera size={24} />
          </span>
          <strong>Depósito recibido</strong>
          <small>Foto y datos</small>
        </button>
        <button onClick={() => open("quick")}>
          <span>
            <Mic size={24} />
          </span>
          <strong>Hablar con Gema</strong>
          <small>Registrar o consultar</small>
        </button>
        {user.request_payments&&<button onClick={() => open("quick", { mode: "request" })}>
          <span>
            <ArrowUpRight size={24} />
          </span>
          <strong>Pedir pago</strong>
          <small>Contacto y monto</small>
        </button>}
      </section>
      <section className="gf-home-pending" id="gf-home-pending">
        <div className="gf-between">
          <h2>Por resolver</h2>
          <span>{total} {total===1?'pendiente':'pendientes'}</span>
        </div>
        <div
          className="gf-home-tabs"
          role="group"
          aria-label="Filtrar pendientes"
        >
          {[
            ["all", "Todos", total],
            ["payment", "Transferir", requests.length],
            ["receipt", "Depósitos", receipts.length],
          ].map(([value, label, count]) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
              <b>{count}</b>
            </button>
          ))}
        </div>
        {!queue.length ? (
          <div className="gf-home-empty">
            <CheckCircle2 size={29} />
            <span>
              {total
                ? "No hay pendientes en este grupo."
                : "No tienes transferencias ni depósitos por revisar."}
            </span>
          </div>
        ) : (
          queue.map(({ kind, r }) => (
            <article className="gf-home-pending-card" key={kind + r.id}>
              <button
                className="gf-home-pending-open"
                onClick={() =>
                  open(kind === "payment" ? "pay-request" : "receipt-review", {
                    id: r.id,
                  })
                }
              >
                <span className={`gf-home-pending-icon ${kind}`}>
                  {kind === "payment" ? (
                    <ArrowUpRight size={21} />
                  ) : (
                    <FileCheck2 size={21} />
                  )}
                </span>
                <span>
                  <small>
                    {kind === "payment"
                      ? "Transferencia solicitada"
                      : "Depósito por confirmar"}
                  </small>
                  {r.request_kind==='iess'&&<IessLogo/>}<strong>{r.counterparty}</strong>
                  <span>
                    {kind === "payment"
                      ? r.description
                      : r.creator_name || r.created_by}
                  </span>
                </span>
                <b>
                  {money(
                    kind === "payment" ? r.remaining_cents : r.amount_cents
                  )}
                </b>
                <ChevronRight size={17} />
              </button>
              <footer>
                {kind === "payment" ? (
                  <DirectPaymentUpload request={r} />
                ) : (
                  <Button
                    icon={CheckCircle2}
                    onClick={() => open("receipt-review", { id: r.id })}
                  >
                    Revisar depósito
                  </Button>
                )}
              </footer>
            </article>
          ))
        )}
        {!!upcoming.length && (
          <button
            className="gf-home-reminder"
            onClick={() =>
              navigate(
                upcoming.some((o) => String(o.id).includes("check"))
                  ? "cheques"
                  : "tarjetas"
              )
            }
          >
            <Wallet size={21} />
            <span>
              <strong>Próximos compromisos</strong>
              <small>
                {upcoming.length} pagos · hasta {dateLabel(p.horizon_day)}
              </small>
            </span>
            <b>{money(p.commitments_cents)}</b>
            <ChevronRight size={18} />
          </button>
        )}
        {extra.bank_notifications > 0 && (
          <button
            className="gf-home-reminder"
            onClick={() => navigate("conexiones")}
          >
            <Bell size={21} />
            <span>
              <strong>Avisos bancarios por revisar</strong>
              <small>
                {extra.bank_notifications} avisos detectados en el celular
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
        )}
        {extra.bank_received_unassigned>0&&<button className="gf-home-reminder" onClick={()=>navigate('conexiones')}><Wallet size={21}/><span><strong>Ingresos recibidos por asociar</strong><small>{extra.bank_received_unassigned} ingresos · esperando datos de la cuenta</small></span><ChevronRight size={18}/></button>}
        {extra.mail > 0 && (
          <button
            className="gf-home-reminder"
            onClick={() => open("mail-inbox")}
          >
            <FileCheck2 size={21} />
            <span>
              <strong>Correos bancarios por revisar</strong>
              <small>{extra.mail} avisos pendientes</small>
            </span>
            <ChevronRight size={18} />
          </button>
        )}
      </section>
      <LoanAlertsBar />
      <FundingAlertBar />
      <section className="gf-home-accounts">
        <div className="gf-between">
          <h2>Tus cuentas</h2>
          <button onClick={() => navigate("cuentas")}>
            Ver todas <ArrowRight size={16} />
          </button>
        </div>
        <AccountTiles />
      </section>
      <details className="gf-home-connections">
        <summary>Avisos y conexiones del celular</summary>
        <PushEnrollment />
        <BankNotificationsShortcut />
      </details>
    </div>
  );
}
