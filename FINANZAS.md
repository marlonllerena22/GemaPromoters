# Gema Finanzas

Centro financiero para Producalza, Marjorie Botas, Gemashow y finanzas personales. Módulo integrado en GemaPromoters, con interfaz independiente y adaptable, en `/finanzas/`.

## Abrir la versión de revisión

En Windows, ejecutar `ABRIR_FINANZAS.cmd` y abrir <http://127.0.0.1:4178/finanzas/>. Elegir **Abrir demostración**. La primera compilación está preparada; la base de ejemplo se guarda exclusivamente en `backend/data/finance-demo.sqlite`.

Los nombres y valores de esta demostración son ficticios. Su acceso automático funciona únicamente en loopback y fuera de producción. No se carga una copia de la base operativa y no se envían correos, pagos ni transacciones Payphone.

También se puede iniciar con `npm run finance:preview`. Mantener el proceso abierto para utilizarla. El instalador PWA está preparado para Chrome/Edge y la opción de agregar a inicio de Safari; compartirla con teléfonos requiere una publicación HTTPS accesible desde ellos.

## Funciones implementadas

- Panel consolidado, filtros de negocio y período, gráfico diario, distribución y cuentas.
- Comprobantes JPG, PNG, WebP y PDF privados, cifrados AES-256-GCM, con hash y detección de archivos repetidos.
- Lectura de comprobantes mediante OpenAI Responses cuando se configura el proveedor. Devuelve un borrador, nunca una acreditación.
- Cobros, solicitudes de gasto, revisión, motivos de rechazo y asociación con pedidos existentes.
- Conciliación parcial o total: varios comprobantes por movimiento bancario y varios movimientos por comprobante, con límites de asignación y correcciones auditadas.
- Al completar la conciliación de un cobro vinculado a Producalza, se aplica el abono al pedido reutilizando el ciclo de saldos existente. Revertir la conciliación restaura el pendiente cuando el abono nació en Finanzas. Los pagos vinculados quedan protegidos contra edición directa desde Producalza.
- Cuentas compartidas con distribución inicial por negocio, atribución mediante conciliaciones y fondos sin dueño identificado separados.
- Cuentas bancarias, billeteras, tarjetas, efectivo y custodios. Saldo inicial, importaciones CSV, comparación con saldo bancario y diferencias visibles.
- Traslados con origen y destino separados de ventas y gastos. Los lados bancarios requieren evidencia; las entregas físicas confirmadas actualizan el diario de efectivo/custodia.
- Ventas por sistema, local/evento y medio de cobro. Un aviso firmado de AlfaBusiness puede crear o actualizar una venta sin exigir promotora.
- Sincronización interna cada 60 segundos cuando hay propietario configurado: abonos históricos de Producalza y pedidos de ProTickets. También hay sincronización manual.
- Cierres de caja, vista previa calculada en servidor, bloqueo de movimientos de días cerrados, reapertura con motivo y aviso si posteriormente cambian ventas de origen.
- Gastos recurrentes que generan pendientes mensuales sin duplicarse; presupuestos por negocio y categoría, calculados sobre todos los registros del mes.
- Reporte consolidado, CSV con dólares y centavos, neutralización de fórmulas e impresión para guardar PDF desde el navegador.
- Asistente de consulta con fuentes autorizadas y referencias a movimientos. Sin proveedor ofrece un resumen determinista, identificado como tal.
- Propietario, administrador, colaborador y consulta; negocios y unidades asignables. Un colaborador ve sus movimientos y no los saldos de otros. Las cuentas compartidas y conciliación requieren propietario.
- Sesiones financieras independientes, cookies HttpOnly/SameSite, revocación, caducidad, límite de intentos y contraseñas con scrypt.
- Autenticación TOTP opcional, QR generado localmente, códigos de recuperación de un uso y cambio de contraseña con reautenticación. Secretos de autenticadores cifrados; recuperación almacenada como hash.
- Auditoría con actor, fecha, antes/después y hashes encadenados. Copia SQLite completa con comprobación de integridad.
- Tipografías alojadas en el propio proyecto, navegación móvil, formularios accesibles y funcionamiento como aplicación web instalable. No se guardan respuestas financieras en caché del service worker.

## Qué requiere activación externa

| Fuente                    | Estado real de esta entrega                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pedidos/abonos Producalza | Adaptador y aplicación de abonos integrados; se activan con la aplicación real y un propietario financiero.                                                                         |
| ProTickets                | Adaptador interno de pedidos y pagos. Un pago aprobado no se interpreta como depósito bancario.                                                                                     |
| AlfaBusiness              | Receptor firmado implementado y probado. El proveedor debe habilitar todas las ventas, históricos, devoluciones y recuperación. Ver `docs/finance/ALFABUSINESS.md`.                 |
| Bancos                    | Importación y conciliación manual de archivos. No existe conexión bancaria directa ni se solicitan contraseñas de bancos.                                                           |
| Payphone                  | Se leen pagos del módulo existente. La consulta automática de comisiones, liquidaciones y contracargos reales requiere capacidades y autorización del proveedor; no se ha simulado. |
| Correos bancarios         | Conector permanente pendiente. El acceso a Gmail de una conversación no se convierte en credenciales de esta aplicación.                                                            |
| OpenAI                    | Implementación probada con respuestas controladas. No había una clave disponible en el checkout; falta configurar y verificar el proveedor real.                                    |

## Configuración de operación

Usar `FINANZAS.env.example` como referencia y configurar los secretos en el alojamiento. No agregar un archivo de secretos al repositorio.

1. Respaldar la base operativa y probar la recuperación en un entorno separado.
2. Configurar `FINANCE_ADMIN_USER`, `FINANCE_ADMIN_NAME` y una contraseña inicial única en `FINANCE_ADMIN_PASSWORD`. Solo se utiliza al crear el primer propietario; modificar esa variable después no cambia contraseñas existentes.
3. Configurar `FINANCE_DOCUMENT_KEY`, una clave aleatoria estable de al menos 32 caracteres. Conservar una copia privada independiente. Perderla impide descifrar documentos y autenticadores anteriores. Una rotación requiere migración de cifrado, no sustituir simplemente el valor.
4. Mantener `NODE_ENV=production`, HTTPS y `DB_PATH` en el disco persistente. La autenticación financiera no hereda credenciales predeterminadas del administrador antiguo.
5. Instalar dependencias y compilar con el flujo habitual del repositorio. Entrar por `/finanzas/`; el administrador supremo también tiene enlace desde Promoters.
6. Activar el autenticador del propietario y guardar los códigos de recuperación. Crear los accesos de colaboradores y revisar sus alcances.
7. Elegir fecha de corte y cargar saldos **al inicio** de esa fecha. Importar movimientos desde ese día, evitando incluirlos ya en el saldo inicial. Las comparaciones posteriores se hacen contra saldos de **cierre** de la fecha indicada.
8. Comenzar con una cuenta y comprobar un período completo antes de ampliar. Los importes de demostración nunca deben trasladarse a operación.

El adaptador reconoce timestamps explícitos de ProTickets. Los timestamps antiguos sin zona se interpretan en la zona del servidor, salvo que `FINANCE_LEGACY_TIMESTAMP_OFFSET` defina un desfase auditado, por ejemplo `+00:00` para datos históricos de Render en UTC. Las nuevas confirmaciones de ProTickets guardan `paid_at` UTC explícito.

El almacenamiento de comprobantes tiene un límite inicial de 256 MiB, ajustable con `FINANCE_MAX_DOCUMENT_BYTES`. La capacidad del disco y las copias deben dimensionarse según el volumen. Una copia en el mismo disco no es respaldo externo.

## Archivos bancarios

CSV UTF-8, separador coma, punto y coma o tabulador. Encabezados `fecha`, `valor`; opcionales `referencia`, `descripcion`, `id`. Ingresos positivos, salidas negativas. Fecha AAAA-MM-DD o DD/MM/AAAA. Se admiten decimales con punto o coma; se rechazan valores ambiguos o más de dos decimales.

El identificador `id` debe ser estable y único **dentro de la cuenta**. Sin él se utiliza la combinación de fecha, monto, referencia y descripción. Si dos movimientos reales son indistinguibles, hay que aportar sus identificadores bancarios: no es seguro inventar que uno sobra. Volver a importar un archivo idéntico no cambia saldos.

Los movimientos importados actualizan saldos calculados, pero no confirman automáticamente un comprobante. Las asignaciones las revisa el propietario.

## Respaldo y recuperación

`npm run finance:backup` utiliza `DB_PATH` y crea una copia completa consistente con la API de SQLite, incluso con WAL. `FINANCE_BACKUP_DIR` permite elegir destino privado. Ejecuta `quick_check` sobre la copia. El respaldo incluye el resto de módulos porque comparten base; debe tratarse como información sensible.

Para probar recuperación: detener un servidor de pruebas, configurar otro `DB_PATH` apuntando a una copia del respaldo, suministrar la misma clave de documentos y comprobar acceso, totales y descarga de un comprobante. No sobreescribir una base activa ni copiar únicamente el archivo SQLite mientras existe WAL. Esta entrega no programa respaldos externos ni modifica el alojamiento.

## Comprobaciones

`npm run finance:test`: pruebas financieras y de las integraciones relacionadas. Incluye aislamiento, permisos, dinero en centavos, importaciones repetidas, asignaciones parciales, traslados, cierres, reversión de abonos de Producalza, cifrado, HMAC, vectores RFC 6238, recuperación MFA y contexto de IA restringido.

`npm run build --prefix frontend`: compilación completa del frontend. Finanzas carga como entrada separada; no descarga inicialmente el panel anterior.

La ejecución completa de `node --test` también revisa módulos ajenos. Se comprobó una falla preexistente en `content-studio.test.js`, prueba “logos, exact social dimensions…”, que espera cuatro planes y encuentra cinco. Se reprodujo sobre el checkout original sin estos cambios. No se alteraron planes ni pruebas de Estudios Creativos para ocultarla.

Validación de esta entrega: 41 pruebas financieras y relacionadas aprobadas; arranque completo con base aislada y conexión de módulos aprobado; suite global con 65 de 66 aprobadas y la falla preexistente descrita. Compilación de producción completada. En navegador se verificaron registro desde celular, carga privada de archivo, cierre con cálculo del servidor, reporte descargado y respuesta de datos sin proveedor IA. La instalación no se ha probado en un teléfono físico ni la IA contra una cuenta real.

## Límites para interpretar cifras

Ventas, cobros, depósitos y traslados son conceptos diferentes. Los saldos requieren saldos iniciales correctos y cobertura de movimientos; los correos por sí solos no garantizan esa cobertura. Un gasto aprobado puede seguir pendiente de pago. Los reportes no afirman utilidad contable ni disponibilidad libre. La clasificación fiscal, inventarios valorizados, cuentas por organizador y liquidaciones completas necesitan datos y reglas adicionales acordados con administración.

Los cierres conservan el conteo físico y su diferencia. Registrar “entregado para depósito” en un cierre no mueve por sí solo dinero entre cuentas: la entrega debe registrarse como traslado con su origen y destino. Las cuentas de efectivo/custodia muestran su saldo según movimientos registrados, que debe cotejarse con los cierres. Los gastos e informes antiguos de locales requieren una migración revisada; el adaptador interno no los convierte automáticamente en gastos conciliados.

La interfaz tiene un acabado financiero profesional; esto no constituye certificación bancaria ni una auditoría externa de seguridad. Antes de operar públicamente con datos reales corresponden la configuración, validación de fuentes y revisión de despliegue. Los módulos antiguos comparten origen, servidor y base: su seguridad también forma parte del alcance de una revisión de producción.

La lectura de documentos y el asistente usan [Responses y salidas estructuradas de OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), con `store: false` y sin herramientas de modificación. Los documentos se transmiten al proveedor únicamente al solicitar su análisis.
