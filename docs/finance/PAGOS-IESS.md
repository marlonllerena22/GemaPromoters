# Planillas IESS

Normita puede abrir **Subir planilla IESS** desde Inicio. Los perfiles que ya solicitan pagos también tienen la pestaña **Planilla IESS** en el formulario existente. Se mantienen los permisos de negocio, local, espacio y documentos.

La foto o PDF se guarda cifrada. La lectura con IA prepara monto total, número de comprobante (con ceros iniciales), concepto/período, nombre/razón social y RUC de exactamente 13 dígitos. Los campos son editables antes de enviar; subir la planilla no representa un pago ni modifica saldos. El RUC de ejemplo no se utiliza como valor predeterminado.

La ficha muestra el logo de IESS sobre fondo blanco y botones para copiar comprobante, razón social y RUC. El número de planilla y la referencia del banco son datos distintos. La identidad RUC + comprobante evita enviar dos veces la misma planilla.

## Pago y conciliación

- Un aviso bancario ya aplicado descuenta por el mecanismo bancario existente. La asociación IESS reutiliza ese débito; nunca vuelve a importarlo.
- Se exige débito de importe exacto, fecha desde la solicitud, mención IESS e identificador de planilla o RUC. Debe existir una sola coincidencia en ambos sentidos. El importe solo no basta. Una ambigüedad no se confirma automáticamente.
- La asociación se intenta al aplicar correo/aviso Android y cada minuto como recuperación. Solo afecta nuevas solicitudes IESS; no modifica saldos iniciales ni crea solicitudes históricas.
- Si ya hay un gasto genérico de correo por ese débito, se reutiliza y clasifica con el negocio de la planilla, conservando auditoría. Un movimiento respaldando otro pago no se reutiliza.
- Marlon también puede subir el comprobante bancario y confirmar cuenta de salida, fecha, referencia e importe. Se busca primero un débito existente; si no existe, se registra una única salida declarada por el propietario y se concilia. El correo posterior con la misma referencia, cuenta, fecha e importe usa la deduplicación existente.
- La planilla original no se admite como comprobante del pago. No se inventa evidencia bancaria para los pagos detectados automáticamente.
- Se respetan los cortes de saldo manuales. Si no hay hora suficiente para demostrar que un movimiento es posterior al saldo inicial del mismo día, la importación conserva la protección existente.

## Verificación

Pruebas de permisos, campos, idempotencia, ambigüedad, conciliación banco primero/comprobante primero, reclasificación del gasto y deduplicación de correo. UI móvil comprobada con perfiles ficticios Normita/Marlon y lectura OCR simulada. Falta validar la extracción con una planilla real de la usuaria; no se proporcionó una en esta solicitud.

Logo: recurso oficial https://www.iess.gob.ec/wp-content/themes/s5_business_line/images/s5_logo.png, mostrado en monocromo sobre blanco.

## Validación de comprobantes (12 de noviembre)

Todas las peticiones de dinero requieren pago completo y comprobante leído con el mismo importe exacto. El formulario muestra valor solicitado y valor leído, bloquea diferencias en ambos sentidos y mantiene el monto solicitado sin sustituirlo. El servidor vuelve a comprobarlo: no admite abonos, importes desconocidos ni una cuenta distinta a la detectada. Para IESS también rechaza un RUC leído distinto al de la planilla.

En comprobantes de servicios Produbanco, el bloque «Con / Nro.» es el producto debitado. El código del servicio/RUC se conserva separado de la referencia bancaria. Si la pantalla no trae la referencia bancaria, se usa una referencia interna de documento, que se sustituye por la oficial al corroborar el correo por RUC, importe, cuenta y fecha, con coincidencia única.

Los avisos oficiales «Pago de Servicio PAGO IESS», «Cuenta Débito» y fechas con mes escrito se reconocen automáticamente. Un pago ya declarado se corrobora sin crear un segundo débito.

Las correcciones de asociaciones ya conciliadas se ejecutan mediante un trabajo cifrado y de corta duración en el servidor, con precondiciones sobre los registros originales, comprobante, planilla y correo bancario confiable. Conserva auditoría, copia cifrada previa e idempotencia; se detiene si encuentra un saldo comprobado posterior o registros cambiados.
