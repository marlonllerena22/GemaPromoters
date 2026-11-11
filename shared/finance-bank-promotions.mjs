const plain=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function isBankPromotion(title,text=''){
  const subject=plain(title),body=plain(text),all=subject+'\n'+body;
  // Statements and actual operations can contain advertising in their footer.
  if(/estado[s]? de cuenta|tabla de amortizacion/.test(all))return false;
  const actual=/(?:^|[\n.!?])\s*[^\p{L}\p{N}]*(?:transferencia|pago|compra|deposito) (?:exitosa?|realizad[oa]|recibid[oa]|rechazad[oa]|fallid[oa])\b/u.test(all)
    ||/(?:^|[\n.!])\s*[^\p{L}\p{N}¿?]*(?:pagaste|enviaste|transferiste|consumiste|te pagaron|te depositaron|te enviaron)\b/u.test(all)
    ||/(?:^|[\n.!])\s*[^\p{L}\p{N}¿?]*(?:recibiste|has recibido)\b(?!\s+(?:una?\s+)?(?:oferta|promocion|invitacion|credito preaprobado|prestamo preaprobado|cupo preaprobado))/u.test(all)
    ||(/\brealizaste (?:un|una) (?:transferencia|pago|compra)\b/.test(all)&&!/\bsi realizaste\b/.test(all))
    ||/\btu pago de [\d.,$\s]+fue realizado\b|\bse (?:ha )?(?:debito|acredito|debitado|acreditado)\b/.test(all)
    ||/(?:^|[\n.!?])\s*[^\p{L}\p{N}]*(?:recibiste|pagaste|enviaste|transferiste|consumiste|has recibido|te pagaron|te depositaron|te enviaron)\s*(?:(?:un pago|una transferencia|un abono|un deposito)\s*(?:de|por)?\s*)?(?:usd\s*|\$\s*)?\d/u.test(all);
  if(actual||/transferencia solicitada sera debitada/.test(all)||(/(?:cuenta|tarjeta)[^\n]{0,45}\*{2,}\d{3,}/.test(all)&&/(?:referencia|comprobante|documento)[^\n]{0,15}\d{5,}/.test(all)))return false;
  return /\bpromocion(?:es)?\b|\boferta(?:s)?\b|\bsorteo(?:s)?\b|\b(?:participa|participar|ganate|gana|ganar|aprovecha|canjea|te regalamos|acumula|desbloquea|descubre)\b|\b(?:cashback|cash back|descuento(?:s)?|preaprobado|preaprobada)\b|\brecibe\b[^\n]{0,100}\b(?:al|por|si|comprando|pagando)\b/.test(all);
}
