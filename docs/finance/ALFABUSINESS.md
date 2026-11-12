# Contrato de recepción financiera · AlfaBusiness

Este canal es independiente de los endpoints de promotoras. No cambia sus códigos, puntos ni comisiones. Debe recibir **todas** las ventas de Marjorie, con o sin promotora.

## Endpoint

`POST https://gemapromoters.onrender.com/api/finance/integrations/alfabusiness`

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

## Campo exacto del local y formato alternativo

El campo recomendado es **`unit_id` en la raíz del JSON**, por ejemplo `"unit_id": "marjorie-sur"`. Los cuatro locales ya están dados de alta:

| Local | `unit_id` |
| --- | --- |
| Quito Norte | `marjorie-norte` |
| Quito Sur | `marjorie-sur` |
| Valle | `marjorie-valle` |
| JC Sebastián / Paseo El Bosque | `marjorie-bosque` |

También se aceptan `local`, `location`, `sucursal`, `unitId`, `branch_name`, `branchName`, `store_name` o `storeName`, tanto en la raíz como dentro de `sale`. Se reconocen los identificadores anteriores y los nombres de la tabla. Un objeto `local` puede identificarlo mediante `name`, `nombre`, `code` o `unit_id`. Si dos campos señalan locales distintos, el envío se rechaza. El local debe venir en el **cuerpo firmado**; los parámetros de la URL no se usan.

En un sobre `{ "event": "sale.registered", "sale": { ... } }`, se admiten `sale.id` como identificador original, `sale.total` expresado en dólares con hasta dos decimales, `sale.invoice_number` y `sale.sold_at` con zona horaria. `source_updated_at` conserva la versión de origen; si falta se usa `updated_at`, `occurred_at` del sobre o `sold_at`. Sin `day`, se toma el día de Ecuador de `sold_at`/`occurred_at`. `sale.registered` representa una venta activa. `payments` conserva el desglose en centavos y nunca se inventa a partir del total.

También se admite el formato real **`sale.upserted`** enviado para las ventas 866 y 870:

- `sale.status.invoice_status: "invoiced"`, `is_voided: false`, `invoice_void_status: null`, `void: null` y `returns: []` identifican una venta `active`. `is_voided: true` identifica `cancelled`. Un estado desconocido o una anulación pendiente requiere `state` explícito; no se presupone venta activa.
- Si `payments` está vacío, se usa `payment_methods`, por ejemplo `[{"method":"tarjeta","amount":188}]` → `[{"method":"card","amount_cents":18800}]`. Se admiten también `efectivo` → `cash`, `transferencia` → `transfer`, `payphone` y `otro` → `other`. Un método desconocido se rechaza.
- `amount_paid` debe coincidir con la suma del desglose; `amount_paid + balance_due` debe coincidir con el total cuando no hay devoluciones. Ambos valores vienen en dólares. Si existen ambos desgloses no vacíos, deben coincidir por método, importe y devolución; no se suman entre sí.
- La fecha de venta proviene de `sold_at` y la versión de `updated_at`; una nueva hora de entrega `occurred_at` no convierte el mismo contenido en otra venta ni cambia su fecha.
- Las devoluciones no vacías requieren `state` y `refunded_cents` explícitos y el desglose de reembolsos por método. No se adivina el significado de elementos desconocidos en `returns`.
- El `total` final es autoritativo: no se le suman otra vez impuestos ni se resta otra vez `discount`. `clave_acceso` no se necesita ni se conserva en el modelo normalizado.

Los demás tipos de evento requieren `state` explícito.

Para la venta 866: conservar el ID original `866`, la factura `000000104`, el local `marjorie-sur` y `Idempotency-Key: mb-sale-866`. No sustituir el ID por el número de factura ni generar otro ID en un reintento. Mantener la misma versión y datos al repetir; si cambia la factura, un abono o una devolución, actualizar `source_updated_at`. Renovar únicamente el timestamp y la firma de entrega. La respuesta incluye `id` de Finanzas, `external_id`, `unit_id` e `ignored`; al repetir debe devolver el mismo `id`.

- Todos los importes son enteros en centavos USD; 8000 representa USD 80,00.
- `external_id`: estable, inmutable y único en todo el origen de Marjorie, incluidos todos los locales. Si el proveedor repite números por local, debe componer una clave con el local.
- `day`: fecha operativa de la venta en Ecuador.
- `source_updated_at`: timestamp de actualización con zona explícita y suficiente precisión. Una versión antigua se ignora. Repetir una versión idéntica es seguro; enviar distintos datos con la misma versión devuelve 409.
- Las variantes de sobre y los campos adicionales ajenos al modelo financiero no crean otra venta: una misma versión con local, factura, fecha, importes, estado y desglose de pagos idénticos conserva el mismo ID. Un cambio en esos datos financieros requiere una versión nueva.
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
