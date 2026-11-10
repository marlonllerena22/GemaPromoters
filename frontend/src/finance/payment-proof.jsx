import React, { useEffect, useRef, useState } from "react";
import { Download, Share2, Image as ImageIcon } from "lucide-react";
import { Button } from "./components.jsx";
import { money, saveBlob, shareBlob, dateLabel } from "./api.js";
import { useFinance } from "./context.jsx";
export function PaymentProofActions({ payment, request, showView = true }) {
  const { open, notify } = useFinance(),
    [file, setFile] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    root = useRef();
  useEffect(() => {
    let stop = false;
    const controller = new AbortController();
    async function load() {
      try {
        const r = await fetch(`/api/finance/payments/${payment.id}/evidence`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error("No se pudo abrir el comprobante");
        const blob = await r.blob();
        if (!stop)
          setFile(
            new File(
              [blob],
              payment.evidence_name ||
                `comprobante-${payment.id}.${
                  blob.type === "application/pdf"
                    ? "pdf"
                    : blob.type === "image/png"
                    ? "png"
                    : "jpg"
                }`,
              { type: blob.type }
            )
          );
      } catch (e) {
        if (!stop && e.name !== "AbortError") setError(e.message);
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "120px" }
    );
    if (root.current) observer.observe(root.current);
    return () => {
      stop = true;
      controller.abort();
      observer.disconnect();
    };
  }, [payment.id, retry]);
  const caption = `${request?.counterparty || "Pago"} · ${money(
    payment.amount_cents
  )}\nFecha: ${dateLabel(payment.paid_day)}\nReferencia: ${
    payment.reference || "Ver comprobante"
  }`;
  async function act(kind) {
    setError("");
    setBusy(true);
    try {
      if (kind === "share") await shareBlob(file, file.name, caption);
      else {
        const location = await saveBlob(file, file.name);
        if (location) notify(`Comprobante guardado en ${location}`);
      }
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (payment.voided_at) return null;
  return (
    <div
      className="gf-proof-quick"
      ref={root}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="gf-proof-quick-buttons">
        <Button
          type="button"
          icon={Share2}
          loading={busy}
          disabled={!file}
          onClick={() => act("share")}
        >
          Compartir
        </Button>
        <Button
          type="button"
          variant="secondary"
          icon={Download}
          loading={busy}
          disabled={!file}
          onClick={() => act("save")}
        >
          Guardar
        </Button>
        {showView && (
          <Button
            type="button"
            variant="ghost"
            icon={ImageIcon}
            onClick={() =>
              open("evidence-viewer", {
                path: `/payments/${payment.id}/evidence`,
                title: "Comprobante de pago",
                return_type: "pay-request",
                return_initial: { id: payment.request_id },
              })
            }
          >
            Ver
          </Button>
        )}
      </div>
      {!file && !error && <small>Preparando comprobante…</small>}
      {error && (
        <p className="gf-error" role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setRetry(retry + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      )}
    </div>
  );
}
