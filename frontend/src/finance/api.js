import {Capacitor,registerPlugin} from "@capacitor/core";
async function nativeFile(blob,name){
  if(!Capacitor.isNativePlatform())return false;
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(blob);});
  const Filesystem=registerPlugin("Filesystem"),Share=registerPlugin("Share");
  const safe=String(name||"comprobante").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100);
  const file=await Filesystem.writeFile({path:`gema/${Date.now()}-${safe}`,data,directory:"CACHE",recursive:true});
  await Share.share({title:"Gema Finanzas",url:file.uri});
  return true;
}
export async function financeApi(path, body, method, options = {}) {
  const response = await fetch(`/api/finance${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "X-Finance-Request": "1",
      ...(options.interactive === false
        ? {}
        : { "X-Finance-Interactive": "1" }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.code === "PASSWORD_CHANGE_REQUIRED")
      window.dispatchEvent(
        new CustomEvent("finance-password-change-required", {
          detail: data.user,
        }),
      );
    if (
      response.status === 401 &&
      !["/session", "/login"].includes(path) &&
      !path.startsWith("/security/")
    )
      window.dispatchEvent(new Event("finance-session-ended"));
    const error = new Error(
      data.message || "No se pudo completar la operación",
    );
    error.code = data.code;
    throw error;
  }
  return data;
}
export const money = (value) =>
  new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format((value || 0) / 100);
export const amount = (value) =>
  Math.round(Number(String(value).replace(",", ".")) * 100);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const dateLabel = (day, options = { day: "2-digit", month: "short" }) =>
  day
    ? new Intl.DateTimeFormat("es-EC", options).format(
        new Date(`${String(day).slice(0, 10)}T12:00:00`),
      )
    : "Sin fecha";
export const businessNames = {
  producalza: "Producalza",
  marjorie: "Marjorie Botas",
  gemashow: "Gemashow",
  personal: "Personal",
};
export const businessColors = {
  producalza: "#4d7b66",
  marjorie: "#b88759",
  gemashow: "#8671b0",
  personal: "#628da9",
};
export const statusNames = {
  pending: "Por revisar",
  approved: "Aprobado",
  reported: "Sin contrastar",
  reconciled: "Conciliado",
  rejected: "Rechazado",
  active: "Vigente",
  cancelled: "Anulada",
  refunded: "Devuelta",
};
export const kindNames = {
  income: "Cobro",
  expense: "Gasto",
  transfer: "Traslado",
  refund: "Devolución",
};
export const methodNames = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  payphone: "Payphone",
  other: "Otro",
};
export const categories = [
  "Abono de pedido",
  "Ventas de local",
  "Materiales",
  "Sueldos",
  "Arriendo",
  "Servicios",
  "Publicidad",
  "Producción de evento",
  "Transporte",
  "Gasolina",
  "Alimentación",
  "Gasto personal",
  "Traslado interno",
  "Otros",
];

export async function downloadEvidence(id, name) {
  const response = await fetch(`/api/finance/evidence/${id}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("No se pudo descargar el comprobante");
  const blob=await response.blob();
  if(await nativeFile(blob,name||"comprobante"))return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "comprobante";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export async function downloadReport(filters) {
  const response = await fetch(
    `/api/finance/export?${new URLSearchParams(filters)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message);
  }
  const blob=await response.blob();
  if(await nativeFile(blob,`finanzas-${filters.from}-${filters.to}.csv`))return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finanzas-${filters.from}-${filters.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
