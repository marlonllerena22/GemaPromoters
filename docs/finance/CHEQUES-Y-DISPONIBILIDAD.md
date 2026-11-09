# Cheques, cuentas y disponibilidad

Los grupos por fecha conservan todos los cheques y el total original del cuaderno. Al abrir una fecha se muestran beneficiario, número, valor y estado; el subtotal pendiente cambia al cobrar, sin borrar filas del historial.

Marlon y Germán pueden declarar cobrado un cheque, con control de versión, clave de envío y auditoría. Morelia puede registrar y corregir cheques pendientes, pero no declarar su cobro. Una declaración manual reduce el saldo calculado de corriente, sin inventar un movimiento bancario. Cuando llega el débito correspondiente, reemplaza la deducción manual.

La asociación automática exige cuenta, importe negativo exacto, número explícito de cheque, beneficiario y un único movimiento candidato dentro de cinco días de la fecha prevista. Si ya fue declarado cobrado, la evidencia humana permite asociar el mismo número, cuenta e importe aunque el banco omita el beneficiario. Un comprobante aislado o la fecha de vencimiento no prueban un débito.

La disponibilidad general excluye corriente y muestra ese saldo por separado. Para cheques se reserva únicamente la diferencia entre los compromisos acumulados y el dinero ya apartado en corriente. También se contemplan cuotas, tarjetas, solicitudes y pagos reportados pendientes de conciliación dentro de los próximos tres días, incluidos vencidos. Un monto desconocido se presenta como pendiente de indicar.

La vista de Germán agrupa las cuentas propias de Pichincha y Guayaquil, sin exponer números ni detalles personales. Henry, Marcela y Ñaña Paty se mantienen separados. Los pagos de tarjeta muestran totales y vencimientos; su edición sigue reservada al propietario. Los números completos se guardan cifrados y las auditorías conservan únicamente terminaciones.

## Conexiones

- Producalza: sincronización interna cada minuto, con corte de apertura e identificadores que evitan duplicados.
- AlfaBusiness: receptor firmado disponible en el endpoint documentado en [ALFABUSINESS.md](ALFABUSINESS.md). Falta la conexión del emisor y la verificación de cobertura de todas las ventas.
- Gmail: el servidor usa OAuth de lectura con autorización del propietario. Requiere `FINANCE_GMAIL_CLIENT_ID`, `FINANCE_GMAIL_CLIENT_SECRET` y `FINANCE_GMAIL_REDIRECT_URI`. La conexión del chat no proporciona credenciales al servidor.
- PayPhone: la conexión nueva de liquidaciones espera que el propietario seleccione la cuenta correcta. No se cambian las credenciales ni el flujo existente de cobros de la ticketera.

Para preparar Gmail, habilitar Gmail API en un proyecto apropiado de Google Cloud, crear un cliente web y registrar exactamente `https://gemapromoters.onrender.com/api/finance/integrations/gmail/callback`. Configurar sus credenciales exclusivamente en el servidor y, después, autorizar desde Finanzas → Conexiones → Conectar con Google. No publicar secretos ni trasladar tokens del conector del chat. Revisar las condiciones de publicación del consentimiento de Google antes de considerar permanente la conexión.

## Validación

85 pruebas aprobadas: permisos, migración de instalaciones existentes, protección de números completos, repetición de solicitudes, conflictos concurrentes, cobro manual y asociación bancaria sin doble descuento, agrupación privada y reservas de liquidez. Compilación de producción, comprobación de componentes React y prueba integral de arranque de la aplicación aprobadas. La revisión visual en navegador de esta actualización quedó pendiente por una interrupción de la herramienta de control.
