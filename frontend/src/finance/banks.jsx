import React, { useState } from "react";
import { Banknote, Landmark, Users } from "lucide-react";
const brands = [
  [/pichincha/, "pichincha.ico"],
  [/produbanco|promerica/, "produbanco.png"],
  [/solidario/, "solidario.ico"],
  [/pac[ií]fico/, "pacifico.ico"],
  [/guayaquil/, "guayaquil.svg"],
  [/de\s*una/, "deuna.png"],
  [/payphone/, "payphone.png"],
  [/dinn?ers/, "diners.png"],
];
export function BankLogo({ bank = "", kind = "bank" }) {
  const [failed, setFailed] = useState(false);
  const file = brands.find(([pattern]) =>
    pattern.test(bank.toLowerCase()),
  )?.[1];
  const Icon = kind === "cash" ? Banknote : kind === "custody" ? Users : Landmark;
  return (
    <span className="gf-bank-logo gf-bank-official" aria-hidden="true">
      {file && !failed ? (
        <img
          src={`/finanzas/banks/${file}`}
          alt=""
          width="28"
          height="28"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={20} />
      )}
    </span>
  );
}
