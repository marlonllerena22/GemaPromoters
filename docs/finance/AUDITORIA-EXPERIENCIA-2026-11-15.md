# Revisión de experiencia y funcionamiento de Gema Finanzas

Fecha: 15 de noviembre de 2026. Enfoque: uso diario desde celular, conservando los procesos y permisos acordados.

## Dictamen

Los recorridos principales funcionan en las simulaciones y la revisión encontró problemas concretos de orientación, legibilidad y prevención de errores. Se corrigieron en esta entrega. La app necesita menos búsqueda y ofrece respuestas más claras al guardar, cerrar o perder conexión.

La verificación cubre la interfaz web que utiliza la APK y las reglas del servidor. No equivale a una certificación de todos los dispositivos ni de la precisión de cada lectura de comprobantes. Cámara, micrófono, avisos en segundo plano y TalkBack necesitan una comprobación en Android real. La captura automática de saldos bancarios sigue pospuesta.

Todas las operaciones simuladas utilizaron bases de datos en memoria. No se ajustaron saldos reales, asistencia real, movimientos ni credenciales de usuarios.

## Cambios realizados

| Hallazgo | Mejora aplicada | Efecto para la persona |
| --- | --- | --- |
| Inicio de gerencia comenzaba con accesos grandes a locales y calendario | Fondos y tres acciones principales primero; locales y asistencia en dos tarjetas compactas | Identificar antes qué hacer y ver pendientes con menos desplazamiento |
| Algunos perfiles tenían búsqueda o campana que llevaba a una pantalla no disponible | Accesos según páginas permitidas; campana de revisión abre confirmaciones y la de gerencia abre pagos | Evitar botones que no conducen al trabajo esperado |
| Texto muy claro sobre fondos claros | Contraste corregido en inicio, cuentas, formularios, reportes, cierres, espacios y equipo | Leer sin depender de brillo alto o de distinguir tonos parecidos |
| Formularios podían cerrarse accidentalmente | Aviso de cambios sin guardar, con seguir editando o descartar | Conservar lo escrito durante cierres accidentales |
| Gastos iniciaban clasificados como Servientrega | Categoría vacía y obligatoria | Evitar gastos mal clasificados por no cambiar el valor inicial |
| Registro de gasto mostraba controles de contexto antes de los datos necesarios | Local y fecha resumidos, editables al pulsar; monto y concepto prioritarios | Registrar más rápido conservando la posibilidad de corregir |
| Adjuntar foto y archivo no era explícito en gastos | Botones separados para subir comprobante y tomar foto, estado de subida y opción de quitar | Entender cómo aportar evidencia |
| Fallos de conexión mostraban mensajes técnicos | Mensajes en español, conservación de campos y aviso de comprobar el registro antes de repetir | Evitar perder datos y reducir reintentos que puedan duplicar operaciones |
| Navegación con teclado alcanzaba el fondo de ventanas y menús | Foco contenido, fondo inactivo, Escape, restauración de foco y títulos únicos | Recorrer una ventana sin saltar a controles ocultos |
| Campos podían abrir el teclado apenas aparecía una ventana | El foco inicial va al título | Leer el formulario antes de empezar a escribir |
| Tablas desplazables difíciles de usar sin ratón | Regiones de tabla enfocables y con nombre accesible | Desplazarse usando teclado |
| Contraseña sin opción de comprobar lo escrito | Mostrar/ocultar contraseña | Detectar errores de escritura al ingresar |
| Asistencia con mensaje técnico de estado heredado y errores sin recuperación clara | Texto orientado a marcar llegada y botón de reintento | Entender el próximo paso |

También se marcaron las páginas activas en la navegación, se actualizaron títulos de página, se mejoró el foco visible y se respetó la preferencia de movimiento reducido.

## Recorridos por perfil

| Perfil | Trabajo principal comprobado | Restricciones preservadas |
| --- | --- | --- |
| Marlon | Inicio, pendientes, cuentas, reportes, acceso a comprobantes y asistente | No se cambian reglas de aprobación, importes ni conciliación |
| Morelia | Inicio de trabajo, accesos a locales/asistencia y confirmaciones | Alcance de cuentas existente; sin ampliar visibilidad bancaria |
| Germán | Consulta y navegación de gerencia | Permisos existentes conservados |
| Normita | Petición de pago y planilla IESS | Sin habilitar saldos generales |
| Bodega | Inicio y solicitudes propias | Sin cuentas ni reportes de gerencia |
| Liliana, Belén, Selena, Nayely, Martha y Yamileth | Llegué/Salí, gasto del local y acceso a comprobante de cliente | Sin pedir transferencias, sin saldos bancarios o caja de gerencia; local según asignación |

Desde Inicio, una chica abre el gasto con un toque; selecciona concepto, completa los datos y guarda. Para una transferencia recibida abre el acceso de comprobante y sigue el envío existente. La asistencia mantiene sus dos acciones, Llegué y Salí. La confirmación del dinero y el enrutamiento por banco/local no se sustituyen por un proceso nuevo.

## Evidencia de pruebas

| Prueba | Resultado |
| --- | --- |
| Suite funcional financiera | 288 pruebas aprobadas; 0 fallos |
| Inicio completo del servidor, autenticación, alcance y rutas privadas | Smoke test aprobado |
| Accesibilidad automatizada con axe-core, reglas WCAG 2 A/AA, 2.1 AA y 2.2 AA | 32 pantallas/estados, 11 perfiles; 0 infracciones detectadas al finalizar |
| Errores JavaScript y desbordamiento horizontal de esas pantallas | 0 errores y 0 desbordamientos |
| Interacción y recuperación | 9 escenarios aprobados: login, accesos por perfil, menú, foco, categoría obligatoria, cierre accidental, desconexión, navegación y ventanas encadenadas |
| Tamaños de pantalla | Formulario comprobado en 360×640, 390×844, horizontal 844×390 y escritorio 1440×900 |
| Seis perfiles de locales | Gasto asignado al local y marcaciones de llegada/salida; restricciones de descanso y de permisos comprobadas |
| Enrutamiento de comprobantes | Martha/Norte → Liliana; Guayaquil → Marlon; Sur/Produbanco → Morelia; Valle con titular Morelia → Morelia |
| IESS | Petición de Normita, gestión de Marlon, rechazo de monto incorrecto y selección de origen Produbanco |
| Reportes de locales | Diario, registro de gasto, semanal de siete días con opción de gastos, horizontal, arriendo editable, mensual y PDF |
| Reporte de cuentas | Selección de cuentas, memoria de selección, edición de Diners, copiar texto y PDF; formato establecido conservado |

En comprobantes e IESS se simuló la respuesta de lectura de imagen. Se ejecutaron las rutas reales de autorización, envío y registro dentro de la base de prueba; no se midió la precisión del reconocimiento de fotos reales. La ausencia de infracciones automáticas no demuestra accesibilidad completa con lector de pantalla.

## Orden recomendado de las siguientes comprobaciones

1. **Una jornada acompañada en Android.** Cada rol completa su tarea habitual. Verificar teclado abierto, cámara, selección de archivo, voz y notificación con la app cerrada. Registrar el paso exacto si alguien se detiene; evitar pedir una transferencia bancaria solo para comprobar una pantalla.
2. **Calidad de automatización con evidencia real.** Evaluar ejemplos de los bancos y comprobantes que realmente utilizan, manteniendo una sola operación cuando coinciden correo, aviso y foto. Esta entrega no modifica ese motor ni garantiza una lectura perfecta de toda imagen.
3. **Rendimiento en conexión lenta.** La compilación avisa que el paquete principal general supera 500 kB. Medir en el teléfono antes de separar cargas adicionales; evitar aumentar formularios o paneles iniciales.
4. **Continuidad ante cierre del sistema.** El aviso protege cambios mientras la ventana sigue abierta; no garantiza recuperarlos si Android mata la app. Como siguiente mejora, diseñar borradores recuperables para formularios largos, diferenciándolos claramente de operaciones guardadas.

## Repetir la revisión

Desde la raíz del repositorio, con dependencias de backend y frontend instaladas:

```sh
npm install --prefix backend/data/ui-tools --no-audit --no-fund playwright@1.65.0 axe-core@4.14.0
npm run finance:test
npm run finance:smoke
npm run finance:ux
```

La suite UX usa Chrome si está instalado en la ubicación habitual de Windows. Para otra ubicación se puede definir `FINANCE_QA_CHROME`; fuera de Windows se puede instalar Chromium con el ejecutable de Playwright de `backend/data/ui-tools/node_modules/.bin/playwright` y `install chromium`.

Los scripts permanentes son `backend/scripts/finance-ux-audit.mjs` y `backend/scripts/finance-ux-interactions.mjs`. Usan servidores locales en los puertos 4201 y 4202, desactivan sincronización interna, no utilizan la clave de IA y crean una base en memoria. Guardan capturas y resultados en `backend/data/ux-audit/`, que está excluido de Git. El comando falla si detecta infracciones, desbordamiento, errores JavaScript o una aserción fallida.
