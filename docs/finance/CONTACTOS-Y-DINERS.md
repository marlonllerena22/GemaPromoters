# Peticiones con contactos y saldos de Diners

## Pedir una transferencia

El colaborador pulsa **Pedir un pago**, escribe el monto grande, elige un contacto y añade el motivo en una frase. El espacio y negocio se toman de su contexto cuando hay una sola opción.

**Nuevo contacto** permite guardar nombre, banco, tipo y número de cuenta. Cédula/RUC y correo son opcionales. Un contacto puede tener varias cuentas y titulares bancarios distintos de su nombre comercial. Todas las cuentas se conservan; el propietario decide cuál usar al realizar cada pago.

La opción de subir una foto permite leer los datos con el proveedor de IA configurado. El resultado es un borrador: se revisan los números antes de guardar. Las cuentas ocultas o incompletas quedan vacías; nunca se reconstruyen dígitos. Si hay varias cuentas se muestran como alternativas. Una imagen que mezcla varios destinatarios no debe combinar sus datos. Sin proveedor, la imagen se conserva y los datos se completan manualmente. No se envían imágenes automáticamente sin usar la acción de carga que informa del análisis.

En la demostración publicada las cargas reales están bloqueadas. **Probar lectura de ejemplo** rellena datos ficticios preparados; no ejecuta OCR sobre documentos reales.

## Pagar y consultar comprobantes

El propietario abre la petición y ve el valor grande, las cuentas completas y sus bancos. Puede tocar o mantener pulsado el número para copiarlo; el texto también admite selección nativa. La disponibilidad de copia depende de los permisos del navegador. Cédula/RUC y correo tienen su propio control de copia.

Después de realizar el pago en su banco, pulsa **Ya transferí**, indica la cuenta de destino utilizada y adjunta el comprobante a esa petición. Monto, fecha, referencia y cuenta de salida se conservan; la IA de comprobantes puede proponer monto, fecha y referencia cuando está configurada. Los datos de beneficiario quedan congelados en la solicitud, y la cuenta de destino utilizada se guarda en el pago. La referencia, evidencia e identificador de envío protegen contra pagos duplicados.

Los participantes autorizados pueden tocar la miniatura para abrir el comprobante a pantalla completa, ampliarlo, descargarlo o preparar su envío por WhatsApp. Compartir entrega el archivo al selector del dispositivo cuando es compatible. El envío automático a grupos sigue pendiente de una integración oficial; la demostración no envía mensajes. El visor permite mostrar la imagen grande a otra persona.

Las solicitudes anteriores sin contacto siguen consultables y pagables; no se inventan sus datos bancarios.

## Privacidad y almacenamiento

Los contactos se separan por negocio y espacio; los privados sin espacio quedan restringidos a su creador y al propietario. El servidor verifica el acceso al seleccionar un contacto, crear la petición, consultar el destinatario o descargar evidencia. Los contactos y las copias históricas de destinatarios se cifran con AES-GCM y la clave de documentos. La deduplicación de números usa HMAC, sin guardar los números completos en texto plano ni en la auditoría. Una coincidencia con datos distintos se detiene para revisión, sin sobrescribir el contacto.

Los números completos de las cuentas propias proporcionadas por el propietario y su correo de avisos quedaron en `backend/data/finance-own-accounts.dpapi`, fuera de Git y de la vista publicada. Es un registro local cifrado con Windows DPAPI, ligado al usuario de Windows. Se verificaron las cinco cuentas y la conservación de ceros iniciales. No contiene contraseñas bancarias, no consulta el correo y no crea saldos iniciales. Antes de usarlo en otro servidor se requiere una migración privada de configuración: copiar el archivo cifrado por sí solo no lo vuelve legible en otro usuario o equipo.

El código y las capturas publicados contienen exclusivamente contactos, números y comprobantes ficticios. No se publicaron las imágenes enviadas en la conversación.

## Diners

Diners se trata como fondos procedentes de ventas de Marjorie, sin pedir número de cuenta. El propietario actualiza **Efectivizado**, **Por efectivizar** y la fecha del saldo. La consulta de negocios autorizada puede ver los dos valores, pero no editarlos. Los colaboradores no reciben esos saldos.

Los dos valores son saldos manuales actuales, no ventas nuevas. Se muestran separados del saldo bancario y de los cobros históricos del período; el dinero por efectivizar no se suma a disponible. Los cambios conservan auditoría y no generan movimientos bancarios. Los saldos también se incluyen en el reporte imprimible y en el contexto autorizado del asistente.

Al retirar a Pichincha, el dinero deja de estar en Diners: se debe actualizar el saldo manual que queda y conciliar el traslado hacia el banco. Esta actualización manual no ejecuta ni acredita una transferencia. Todavía no hay conexión a liquidaciones de Diners ni a correos bancarios.

## Verificación

60 pruebas financieras e integraciones relacionadas aprobadas, incluidas cuentas alternativas, ceros iniciales, cifrado, duplicados, destinos históricos, elección de cuenta al registrar el pago, contactos privados y saldos manuales sin duplicar ingresos. La lectura de imágenes se probó con una respuesta controlada del proveedor; no se hizo una llamada con documentos reales. Compilación completa y arranque con base aislada aprobados.

En navegador se comprobó el flujo de Ana a propietario, la copia exacta al portapapeles de un número ficticio, elección de Produbanco entre dos cuentas, pago completo, comprobante ampliado con zoom y saldos de Diners visibles pero no editables para Germán. Las capturas están en `screenshots/`.
