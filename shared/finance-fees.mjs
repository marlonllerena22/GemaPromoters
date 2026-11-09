// Reference SPI retail tariffs. A quote never creates a ledger charge.
export const BANK_TRANSFER_FEES = [
  {
    bank: "Pichincha",
    cents: 41,
    channel: "Internet / CNB",
    source:
      "https://www.pichincha.com/sites/default/files/documents/2026-10/tarifario-web-noviembre-2026.pdf",
  },
  {
    bank: "Produbanco",
    cents: 41,
    channel: "Banca celular / Internet",
    source:
      "https://www.produbanco.com.ec/media/1aeieqch/tarifario-tc-y-tarifas-oct-02-20262.pdf",
  },
  {
    bank: "Solidario",
    cents: 41,
    channel: "Internet",
    source:
      "https://www.banco-solidario.com/sites/default/files/tarifario/Banco_Solidario_TARIFARIO_%20OCTUBRE_2026_Servicios%20Fiancieros_0.pdf",
  },
  {
    bank: "Pacífico",
    cents: 41,
    channel: "Internet / Banca celular",
    source:
      "https://www.bancodelpacifico.com/BancoPacifico/media/pdf/TranspInformacion/2026/Tabla_de_remuneraciones_x_servicios.pdf",
  },
  {
    bank: "Guayaquil",
    cents: 41,
    channel: "SPI por Internet",
    note: "Tarifario publicado de junio de 2026. La app puede ofrecer transferencias sin costo según producto/canal; comprueba la pantalla antes de enviar.",
    source:
      "https://assets.ctfassets.net/jhuukrkt1w7q/6ZE5gSTute00w7lxCPOilb/bb243ec833d8c434653b0023a35923a3/TARIFARIO_JUNIO_2026.pdf",
  },
  {
    bank: "Deuna",
    cents: 41,
    channel: "Envíos a otros bancos",
    source:
      "https://soporte.deunaapp.com/hc/es-419/articles/16289488109204--Puedo-transferir-a-cuentas-de-otros-bancos-con-Deuna",
  },
  {
    bank: "Diners",
    cents: 41,
    channel: "SPI digital desde ahorros",
    note: "No equivale a la comisión por liquidar ventas de tarjetas ni a un avance de efectivo.",
    source:
      "https://dce-documents.s3.amazonaws.com/tarifario-pizarra-multimarca-noviembre-2026.pdf",
  },
];
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/banco|\s|!/g, "");
export function transferFeeQuote(from, to, channel = "digital") {
  const a = norm(from),
    b = norm(to);
  if (!a || !b) return { cents: null, estimated: true };
  if (a === b)
    return {
      cents: 0,
      estimated: true,
      label: "Dentro de la misma entidad; verifica el canal",
    };
  const r = BANK_TRANSFER_FEES.find((r) => norm(r.bank) === a);
  return {
    cents: channel === "digital" ? (r?.cents ?? null) : null,
    estimated: true,
    source: r?.source,
    note: r?.note,
    label: "Referencia con IVA; confirma el cargo real",
  };
}
