import React from "react";
import { BANK_TRANSFER_FEES } from "../../../shared/finance-fees.mjs";
import { BankLogo } from "./banks.jsx";
import { money } from "./api.js";
export function TransferFees() {
  return (
    <details className="gf-panel gf-fees">
      <summary>¿Cuánto cuesta transferir entre mis bancos?</summary>
      <p>
        Referencia SPI digital con IVA, revisada el 9 de noviembre de 2026. El
        cargo real o la exoneración del banco prevalecen.
      </p>
      <div>
        {BANK_TRANSFER_FEES.map((r) => (
          <article key={r.bank}>
            <BankLogo bank={r.bank} />
            <span>
              <strong>{r.bank}</strong>
              <small>{r.channel}</small>
            </span>
            <b>{money(r.cents)}</b>
            <a href={r.source} target="_blank" rel="noreferrer">
              Fuente
            </a>
            {r.note && <p>{r.note}</p>}
          </article>
        ))}
      </div>
      <p>
        Una transferencia ordinaria dentro de la misma entidad es sin costo.
        Enviar a otro banco sigue siendo interbancario aunque ambas cuentas sean
        tuyas. El valor enviado y los cargos se guardan por separado cuando el
        comprobante los identifica.
      </p>
    </details>
  );
}
