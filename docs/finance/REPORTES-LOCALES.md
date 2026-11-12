# Reportes de locales

Ruta: `/finanzas/locales`. Acceso directo «Mis locales» en Inicio. Día, semana de lunes a domingo, mes y consolidado de locales autorizados. Zona horaria Ecuador; importes enteros en centavos.

## Flujo de consulta desde el celular

Al entrar se elige uno de los cuatro locales o el consolidado. La vista inicial es **Diario**, como el cuaderno. Presenta producto/talla, pares, efectivo, transferencia, tarjeta, total y comisión; gerencia también ve costo, descuento bancario estimado y margen. Los pagos mixtos se distribuyen conservando exactamente los totales de filas y columnas. Si falta el detalle original, se muestra «Por completar» y no se inventan pares o costos.

En vertical se muestra producto, venta y comisión; al tocar la fila se abre el detalle con medios de pago y valores por par. Al girar el celular aparecen las columnas completas. El botón **Ampliar reporte** ocupa la pantalla sin navegación exterior. La tabla mantiene cabeceras y totales visibles y desplaza sus filas dentro del cuadro. No se necesita otra APK: Gema Finanzas permite orientación automática.

Debajo del diario están los gastos y las entregas, agrupados y plegados, y los subtotales. «Venta menos gastos registrados» es un subtotal operativo, no utilidad; el efectivo de caja se muestra aparte. Las entregas a propietarios nunca reducen las ventas ni se descuentan dos veces del resultado.

**Semanal** es una tabla con las siete fechas y sus ventas, incluyendo fechas sin registros. El interruptor «Incluir gastos» añade gastos y venta menos gastos. **Mensual** conserva los bloques del formato de las hojas y permite generar un PDF privado para gerencia: resumen por local y anexos de gastos, nómina, entregas y datos pendientes. Los permisos de acceso se verifican antes de generar el PDF.

**Configuración general** se abre independientemente de la fecha consultada. Guarda desde el mes actual y se hereda hacia adelante; conserva meses anteriores. Los cuatro arriendos se editan juntos, igual que los seis sueldos. Extras, descuentos y confirmación de jornadas son propios del mes y no se arrastran. Las referencias de octubre no se aplican automáticamente.

Endpoints nuevos: `GET/POST /api/finance/retail/configuration` (Marlon y Morelia), `GET /api/finance/retail/monthly.pdf?day=YYYY-MM-DD&unit_id=...` (gerencia). El POST de configuración fija la vigencia al mes actual en servidor, aunque el usuario esté consultando un mes histórico.

## Reglas confirmadas por Marlon

- Comisión por **par**, sobre su precio después de descuentos. Meta de 60 pares por local/mes; al alcanzarla se pagan todas las comisiones del mes. También aplica a tarjeta. Escalas diferentes para Bosque/Sebastián’s y Marjorie.
- Descuento de tarjeta provisional **8,7%**, editable por vigencia mensual. No es una liquidación bancaria comprobada ni se aplica a PayPhone por suposición.
- Producalza: $38 por par identificado como suyo. Otros productos llevan su costo propio.
- Salarios completos más extras se reparten según jornadas registradas entre todos los locales; medio día permitido, máximo un día por empleada/fecha. Redondeo por restos mayores conserva los centavos. Comisiones se quedan en el local de cada venta.
- Adelantos se muestran como salidas de caja y pagos a cuenta del sueldo, no como otro costo adicional. Descuentos de nómina afectan el pendiente estimado, no rebajan artificialmente el costo salarial. El pendiente mostrado resta adelantos identificados; no es una liquidación de nómina certificada.
- Marlon y Morelia configuran; Germán consulta el resultado. Las colaboradoras solo ven sus locales sin costos ni resultado. Los permisos se aplican en servidor, no solo en pantalla.

## Lectura de los PDF

Se revisaron las 12 páginas mensuales (agosto, septiembre y octubre de 2026 de Sur, Norte, Valle y Bosque) y las 5 páginas diarias. Son referencias de formato, no un nuevo asiento histórico.

El cuadro intermedio de las hojas intenta conciliar fondos, gastos y entregas. No mide utilidad. En varias hojas el total termina en negativo por el mismo valor de los sueldos, mientras se usan bases distintas de servicios en el cuadro de utilidad. Por eso la aplicación separa caja/entregas y resultado, en lugar de reproducir esos totales como una fórmula universal.

Se conservan PRAS/CARGO, Servientrega, transporte/motorizado, suministros, aseo, mantenimiento y otros; servicios incluyen arriendo, luz, agua, internet, alarmas y alícuota. Publicidad y nómina se identifican aparte. Descripción obligatoria en el registro rápido de gasto de caja.

Valores de octubre se muestran solo como referencia revisable, especialmente el arriendo de Bosque que contiene una anotación distinta. No se aplican sueldos ni gastos históricos sin configuración vigente.

## Flujo

1. Recibir ventas de AlfaBusiness sin crear un segundo cobro bancario.
2. Completar productos y vendedora si el origen todavía no los transmite.
3. Registrar gasto pagado desde caja, entrega, fondos recibidos y conteo desde el propio reporte. Un identificador de operación hace idempotentes los reintentos.
4. Gastos existentes aprobados/conciliados del local se agrupan automáticamente por concepto; los rechazados no cuentan. Los pendientes se señalan.
5. Gastos fijos configurados se muestran como previsión. Cuando existe gasto real de la categoría/local/mes, se usa el real y no se suma otra vez la previsión. En períodos parciales la previsión se prorratea por días calendario; el gasto real se muestra en su fecha de registro.
6. Caja = fondo al inicio del día indicado + ventas en efectivo + fondos añadidos − gastos en efectivo conciliados − entregas. Tarjeta y transferencia directa de clientes no entran en caja.
7. Entregas y depósitos bancarios confirmados se consultan por separado para evitar sumar otra vez el mismo dinero. Registrar una entrega no acredita el banco sin comprobación.
8. Conteo de caja conserva diferencia contra los registros a esa fecha. No modifica saldos bancarios ni equivale a cerrar/reabrir el cierre contable existente.

## Integración adicional de AlfaBusiness

Los eventos actuales importados 866/870 contienen total y medio de pago, pero **no pares, productos, proveedor ni vendedora**. El receptor ya admite el campo opcional `sale.retail` (o `retail` en el contrato canónico):

```json
{
  "retail": {
    "items": [
      {
        "product": "Botín modelo 248",
        "size": "37",
        "quantity": 2,
        "unit_price_cents": 7000,
        "seller": "Selena",
        "producalza": true
      },
      {
        "product": "Producto comprado fuera",
        "size": "36",
        "quantity": 1,
        "unit_price_cents": 4800,
        "seller": "Selena",
        "producalza": false,
        "unit_cost_cents": 2200
      }
    ]
  }
}
```

En ese ejemplo la venta neta debe ser $188. Los pares/precios deben ser netos de descuentos y devoluciones y cuadrar con `total_cents - refunded_cents`. Para un descuento que produzca precios diferentes por centavos, se envían filas separadas. Vendedoras admitidas: Liliana, Martha, Belén, Nayely, Yamileth, Selena. No deducir el proveedor de una etiqueta ni dividir el total entre $38.

Mantener mismo ID de venta, firma habitual y `updated_at` más reciente al añadir/corregir detalles. Esto actualiza la venta existente sin duplicarla. Un cambio de versión invalida el complemento manual anterior si el origen no manda detalles nuevos, para no conservar costos/cantidades incompatibles.

Se reconocen las etiquetas de factura `SIN UTILIZACION DEL SISTEMA FINANCIERO` como efectivo y `OTROS CON UTILIZACION DEL SISTEMA FINANCIERO` como transferencia, además del contrato anterior. Esta última correspondencia es la indicada expresamente por Marlon para su sistema.

## Límites visibles

- Sin cobertura completa, productos, sueldos o jornadas confirmadas, el resultado principal dice «Por completar». El cálculo parcial puede abrirse y está etiquetado como provisional.
- Los abonos en fechas posteriores, reservas y devoluciones requieren eventos de cobro con fecha real para un libro de caja exacto. Se señalan como pendientes de revisión; los acumulados de una factura no permiten reconstruir esas fechas automáticamente.
- No se conectan nuevos correos de vouchers en esta entrega. El 8,7% es una estimación autorizada.
- No se importan las hojas antiguas como ventas nuevas ni se reajustan los saldos bancarios.
- Conexión saliente desde caja aún debe aportar cobertura completa y detalles de productos para eliminar el complemento manual. Haber importado dos ventas no certifica el histórico completo.

## Validación

Pruebas de comisión por par/meta mensual retroactiva, tarjeta/efectivo, proveedor externo, reparto salarial y centavos, duplicación de guardados, previsiones/gastos reales, privacidad entre perfiles, versiones de venta y etiquetas de factura. Prueba móvil 390 px contra SQLite en memoria: registrar gasto y verlo agrupado sin desbordamiento ni errores JavaScript.
