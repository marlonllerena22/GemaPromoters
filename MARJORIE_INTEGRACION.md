# Integracion de inventario y facturacion con Promotoras Marjorie

Este documento se entrega al programador del sistema de inventario y facturacion.

## Informacion que necesitamos

- URL base y documentacion de su API.
- Credenciales exclusivas de prueba o sandbox.
- Metodo de autenticacion: API key, Bearer token u OAuth.
- Identificador unico e inmutable de cada factura o venta.
- Catalogo o identificadores de los cuatro locales.
- Ejemplos JSON de una venta pagada, entregada, anulada y devuelta.
- Webhooks disponibles y mecanismo para verificar su firma.
- Regla exacta si, ademas de pares vendidos, existe otro saldo de puntos que se pueda ganar o utilizar.

No se deben compartir contrasenas personales. Las credenciales tienen que crearse exclusivamente para la integracion servidor a servidor.

## API preparada en PROMOTERS

La autenticacion usa:

```http
Authorization: Bearer MARJORIE_INVENTORY_API_KEY
```

La credencial se configura de forma privada en Render. Nunca debe incluirse en el frontend.

### Validar un codigo

```http
GET /api/integrations/marjorie/promoters/MB-0001
```

La respuesta indica si el codigo esta activo, devuelve el descuento general configurado por administracion y los pares validos del ciclo:

```json
{
  "valid": true,
  "code": "MB-0001",
  "status": "active",
  "discount_percent": 10,
  "cycle_points": 4,
  "cycle_pairs": 4
}
```

El inventario solo debe aplicar `discount_percent` cuando `valid` sea `true`. El descuento es para la compra del cliente; la comision de la promotora se calcula por separado dentro de PROMOTERS.

### Crear o actualizar una venta

```http
POST /api/integrations/marjorie/sales
Content-Type: application/json
```

```json
{
  "source": "sistema-facturacion",
  "sale_id": "FAC-000123",
  "promoter_code": "MB-0001",
  "branch_name": "Local Marjorie Botas Norte",
  "customer_name": "Cliente",
  "customer_whatsapp": "0999999999",
  "pairs": 2,
  "returned_pairs": 0,
  "discount_percent": 10,
  "sale_date": "2026-09-06",
  "is_paid": true,
  "is_delivered": true,
  "is_cancelled": false,
  "notes": "Factura pagada"
}
```

`source + sale_id` es la llave de idempotencia. Enviar nuevamente esos valores actualiza la venta existente y no crea otra.

La venta solo suma para comision cuando esta pagada, entregada, no anulada y conserva pares no devueltos. Para registrar una devolucion se vuelve a enviar la misma venta con `returned_pairs`; para anularla se usa `is_cancelled: true`.

## Flujo recomendado

1. El cajero escribe o escanea el codigo de la promotora.
2. Facturacion consulta el endpoint de validacion.
3. La factura conserva el codigo como referencia.
4. Al quedar pagada y entregada, facturacion envia la venta a PROMOTERS.
5. Una anulacion o devolucion vuelve a enviar el mismo `sale_id` con el estado actualizado.
6. PROMOTERS recalcula pares, nivel, comision retroactiva y ajustes pendientes.

El sistema de inventario es quien confirma la venta y coordina los dos avisos posteriores:

- Envia a Azure los datos necesarios para emitir la factura.
- Envia a PROMOTERS el codigo, la venta y su estado para acreditar la comision.

Si uno de los dos servicios no responde, inventario debe reintentar ese envio sin repetir la venta. PROMOTERS evita duplicados usando `source + sale_id`.

## Configuracion administrativa

El administrador de Promotoras Marjorie puede cambiar el descuento general desde `Configuracion`. Todos los codigos activos reciben ese mismo porcentaje en la API. Cambiar el descuento no modifica ventas anteriores.
