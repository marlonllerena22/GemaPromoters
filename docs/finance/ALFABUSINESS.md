# Contrato de recepción financiera · AlfaBusiness

Este canal es independiente de los endpoints de promotoras. No cambia sus códigos, puntos ni comisiones. Debe recibir **todas** las ventas de Marjorie, con o sin promotora.

## Endpoint

`POST https://DOMINIO-DEL-PROYECTO/api/finance/integrations/alfabusiness`

Configurar previamente `FINANCE_SALES_WEBHOOK_SECRET`, secreto exclusivo de al menos 32 caracteres aleatorios. No reutilizar credenciales de emprendedoras, usuarios o Payphone.

Encabezados:

- `Content-Type: application/json`
- `X-Finance-Timestamp`: segundos Unix de la entrega. Tolerancia de cinco minutos.
- `X-Finance-Signature`: HMAC-SHA256 hexadecimal de `timestamp + "." + cuerpoJSONExacto`, usando el secreto compartido.

No se utiliza una cookie de usuario ni se transmite el secreto. Firmar los mismos bytes que se envían. Al reintentar, renovar timestamp y firma conservando los identificadores y versión de la venta.

## Ejemplo sin datos personales

```json
{
  "external_id": "FAC-NORTE-1842",
  "document_number": "001-001-000001842",
  "unit_id": "marjorie-norte",
  "day": "2026-11-09",
  "total_cents": 8000,
  "refunded_cents": 0,
  "state": "active",
  "source_updated_at": "2026-11-09T16:57:00.123-05:00",
  "payments": [
    { "method": "cash", "amount_cents": 3000, "refunded_cents": 0 },
    { "method": "card", "amount_cents": 5000, "refunded_cents": 0 }
  ]
}
```

El receptor fija negocio `marjorie` y origen `alfabusiness`; el emisor no puede cambiarlos. Confirmar el mapeo real de locales antes de activar. Los identificadores iniciales son `marjorie-norte`, `marjorie-valle`, `marjorie-bosque`, `marjorie-sur`.

- Todos los importes son enteros en centavos USD; 8000 representa USD 80,00.
- `external_id`: estable, inmutable y único en todo el origen de Marjorie, incluidos todos los locales. Si el proveedor repite números por local, debe componer una clave con el local.
- `day`: fecha operativa de la venta en Ecuador.
- `source_updated_at`: timestamp de actualización con zona explícita y suficiente precisión. Una versión antigua se ignora. Repetir una versión idéntica es seguro; enviar distintos datos con la misma versión devuelve 409.
- `state`: `active`, `cancelled`, `pending` o `refunded`. Cancelar o devolver una venta conserva su identificador.
- `refunded_cents`: devoluciones acumuladas, nunca superiores al total original.
- `payments`: cobros acumulados de la venta, no solo el último abono. Métodos: `cash`, `card`, `transfer`, `payphone`, `other`. Los pagos mixtos se desglosan. La suma no puede exceder el total.
- Las devoluciones de cobros se desglosan por método cuando corresponda. No confundir una nota de crédito con una devolución de efectivo ya realizada.
- El saldo de venta por cobrar se deriva del total y cobros; los movimientos bancarios se concilian por separado.

Puede conservarse información adicional de líneas, impuestos y descuentos para trazabilidad, pero el modelo analítico de esta versión utiliza los campos normalizados anteriores. No enviar tokens, contraseñas ni datos innecesarios de clientes dentro del cuerpo.

## Respuestas y recuperación

- 200: aceptada o repetida; `{ "id": 123, "ignored": false }`.
- 400: datos inválidos; corregir el contenido.
- 401: firma o timestamp inválidos.
- 409: misma versión con datos diferentes; resolver en origen, no cambiar el ID para forzar una venta nueva.
- 503: integración no configurada.

Solicitamos al proveedor reintentos con espera creciente, registro de entregas fallidas, consulta histórica paginada por última modificación y totales diarios por local/medio. Un webhook aislado no garantiza cobertura completa. La importación de históricos debe reutilizar este contrato e identificadores.

Ejemplo de firma del lado emisor:

```js
import crypto from "node:crypto";
const body = JSON.stringify(sale);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = crypto
  .createHmac("sha256", process.env.FINANCE_SALES_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest("hex");
// Enviar body exactamente, con timestamp y signature en los encabezados indicados.
```

El receptor fue comprobado con entregas válidas, repetidas, antiguas, adulteradas y de negocio incorrecto. Falta la prueba de extremo a extremo con la instancia real de AlfaBusiness y el cotejo de un período completo.
