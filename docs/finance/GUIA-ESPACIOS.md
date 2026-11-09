# Espacios y perfiles

Los espacios sustituyen la organización de los grupos para pedir pagos, consultar su estado y encontrar comprobantes. La aplicación operativa conserva el historial; la vista privada publicada utiliza ejemplos que se reinician al recargar.

## Organización inicial propuesta

| Espacio                 | Personas propuestas            | Uso                                                                      |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Pagos Producalza        | Tú, Norma, Morelia y Germán    | Cajas, servicios, proveedores, adelantos y transporte.                   |
| Materiales de bodega    | Tú, Norma, Morelia, Ana y José | Materiales solicitados por bodega.                                       |
| Mago de Oz · Loja       | Tú y las personas que asignes  | Pagos e historial del evento. Crear otro espacio para cada evento.       |
| Dani Manager · Exterior | Tú y las personas que asignes  | Pagos al exterior realizados con tarjeta.                                |
| Depósitos varios        | Tú y Germán                    | Otros pagos de los negocios. Tus gastos personales permanecen separados. |

Las sugerencias no otorgan acceso por sí solas. En operación, el propietario crea o selecciona usuarios reales y les asigna negocios, unidades y espacios desde Personas. Los perfiles visibles en la demostración solo existen en una base de ejemplo en memoria, con contraseñas aleatorias desconocidas.

## Tres pasos cotidianos

1. El colaborador abre su espacio, pulsa **Pedir un pago** y escribe o dicta cuánto necesita y para qué. Puede adjuntar la factura o los datos de respaldo. Revisa el monto y envía.
2. El propietario ve la solicitud en **Por transferir**, realiza la transferencia en el banco y pulsa **Ya transferí**. Guarda monto, fecha, cuenta, referencia y comprobante del pago realizado.
3. El comprobante queda en el historial del espacio. **Compartir comprobante** prepara únicamente ese pago para enviarlo a quien corresponda.

Una solicitud es una obligación pendiente, no un gasto ya pagado. Los pagos reales se registran por separado. Un abono parcial reduce lo pendiente y conserva el resto. La comprobación contra movimientos bancarios es un paso separado: subir un comprobante no confirma el saldo del banco.

## Qué ve cada persona

- **Tú:** todos los negocios, tus finanzas personales, saldos, permisos, pendientes y registro de transferencias realizadas. El registro de pagos de solicitudes es exclusivo del propietario.
- **Germán:** inicio con saldos calculados de las cuentas de trabajo; el detalle de movimientos de los negocios está en otro apartado. Puede consultar comprobantes autorizados. No recibe transacciones bancarias sin filtrar, gastos personales, notas privadas ni desglose personal de cuentas compartidas. Un saldo total de una cuenta compartida puede incluir dinero de varias procedencias; la distribución personal queda oculta.
- **Norma:** sus envíos y los espacios generales de Producalza y materiales que se le asignen.
- **Morelia:** espacios y negocios asignados para coordinar solicitudes. El perfil propuesto no le concede automáticamente administración general, permisos de otros usuarios ni acceso a cuentas bancarias.
- **Ana y José:** inicio sencillo y espacio Materiales de bodega. Pueden seguir solicitudes y comprobantes del espacio; no acceden a saldos generales.

El propietario puede modificar los alcances. Cambiar permisos revoca las sesiones existentes para que el nuevo alcance se aplique al volver a entrar.

## Avisos y pendientes

La barra fija y la bandeja **Por transferir** se calculan desde solicitudes y pagos guardados en la base. Leer el aviso, cerrar una notificación del teléfono, cambiar de pantalla o desactivar notificaciones no resuelve la obligación. Un pago completo la retira de pendientes. Una anulación requiere motivo y queda auditada. Una reversión válida de un pago reabre el pendiente; un pago conciliado exige revertir antes su conciliación.

El sistema operativo permite descartar sus propias notificaciones: la aplicación no puede impedirlo. Por eso la bandeja persistente es independiente. Los avisos con la aplicación cerrada requieren HTTPS, configurar VAPID y que el propietario autorice notificaciones en ese dispositivo. En esta entrega no hay claves ni suscripciones reales activadas. El mensaje de pantalla bloqueada es genérico, sin montos ni destinatarios. La cola de envío reintenta fallos y omite solicitudes ya resueltas.

## WhatsApp

Cada espacio puede guardar un grupo sugerido o un número internacional de destino. En un dispositivo compatible, compartir abre el selector nativo con el archivo y texto; la persona elige WhatsApp y el destinatario. En otros dispositivos, se descarga el archivo y puede abrirse WhatsApp con el texto preparado para adjuntarlo manualmente. Un enlace de WhatsApp no adjunta el archivo automáticamente y un nombre de grupo no selecciona ese grupo por sí solo.

El envío automático a números o grupos queda pendiente de una integración oficial que admita el destino y de configurar su autorización. La demostración no envía mensajes ni comparte documentos. No se debe incluir acceso general al sistema en el texto enviado.

## Verificación de esta entrega

56 pruebas financieras e integraciones relacionadas aprobadas; compilación del frontend y arranque de la aplicación completa con base aislada aprobados. Revisión en navegador: solicitud ficticia de Ana recibida en la bandeja del propietario, pago completo retirado de pendientes, historial, vista de Germán sin negocio Personal, imagen del asistente y ausencia de desbordamiento horizontal a 320 px. Los pagos parciales, reversión, límites de permisos, privacidad y reintentos de avisos también se comprobaron con pruebas automatizadas.

No se han activado usuarios operativos, enviado WhatsApp, realizado transferencias ni configurado conexiones bancarias reales. Las capturas en `screenshots/` contienen exclusivamente ejemplos.
