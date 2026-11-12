# Accesos, jornadas y cobros de locales

Actualización: 12 de noviembre de 2026.

| Perfil | Inicio / acciones | Saldos |
|---|---|---|
| Marlon | Administración, confirmaciones y ejecución de pagos | Todas sus cuentas y cajas |
| Germán | Consulta, solicitudes y cheques | Cuentas y cajas, respetando la vista de negocios |
| Morelia | Solicitudes, reportes, calendario, gastos y confirmaciones de Sur | Solo cuentas Liliana y MORE Local SUR; cajas de locales |
| Norma / Normita | Solicitudes, comprobantes y registro de cheques | Sin saldos bancarios ni caja |
| Ana / José / bodega | Solo sus solicitudes y comprobantes de pago | Sin saldos |
| Chicas de locales | Gasto rápido, comprobante de cliente y reporte del local del día | Sin saldos bancarios ni saldo de caja |

Las chicas no solicitan pagos. Solo Marlon registra la transferencia realizada. Germán recibe un aviso informativo con monto y destinatario cuando Norma o Morelia solicita un pago. Los permisos se aplican en servidor y también en navegación; no basta ocultar botones.

## Local del día

Morelia y Marlon organizan el calendario en Locales → Asistencia. Las empleadas con un único local conservan ese local hasta que se programe otra jornada. Martha y Yamileth requieren asignación explícita cada día. Descanso bloquea las acciones de local. La sesión actualiza su alcance al consultar nuevamente el servidor.

Asignar una jornada futura no genera sueldo trabajado. La casilla Trabajó alimenta la distribución de sueldos; solo admite fechas ya transcurridas o el día actual. El registro anterior de medias jornadas sigue disponible en el reporte.

## Confirmaciones

- Norte: Liliana. Sus propios comprobantes a sus cuentas se confirman al subir y se registran una sola vez.
- Valle y Bosque: Marlon.
- Sur: Morelia para MORE Local SUR (Pichincha). Guayaquil y Produbanco del propietario: Marlon. Una cuenta de destino identificada prevalece sobre una regla general por banco.
- Las cuentas Liliana Pichincha, Produbanco y Pacífico y MORE Local SUR se crean sin número ni saldo verificado. Por indicar no significa saldo bancario cero.
- La cuenta anterior de Morelia queda separada. No se cambian saldos existentes al activar estos perfiles.

## Depósitos desde caja

En Subir transferencia se distingue Transferencia de un cliente de Depósito desde la caja del local. El segundo registra una salida de caja una sola vez y el crédito bancario se registra al confirmar. No agrega una venta. El contraste de Sur muestra ventas por transferencia, cobros confirmados y depósitos desde caja por separado. Es una comparación del período, no una afirmación de conciliación individual por factura; cobro y venta pueden tener fechas diferentes.

## Validación

251 pruebas automatizadas, compilación de producción y prueba integrada de arranque. Navegación móvil a 390 × 844 con once perfiles, bloqueo de solicitudes de las chicas, gasto desde Inicio, privacidad de caja/cuentas, cuentas dedicadas de Morelia y asignación de reemplazo en calendario. Pruebas de reintento de comprobantes, crédito único a Liliana, depósito de caja sin venta adicional y aviso informativo de Germán. La entrega física del push depende del dispositivo ya registrado.
