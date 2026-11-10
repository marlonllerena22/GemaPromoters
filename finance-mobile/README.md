# Gema Finanzas Android

Aplicación Android independiente (`com.gemafinanzas.app`). No modifica ProTickets Scanner. Usa exclusivamente el servidor HTTPS de Gema Finanzas y los mismos usuarios y permisos. Los comprobantes pueden compartirse con la hoja de compartir de Android. Los avisos utilizan Firebase Cloud Messaging.

## Compilar

1. Instalar JDK 21, Android SDK 36 y Node.js. Ejecutar `npm ci` en este directorio.
2. Descargar `google-services.json` de la aplicación Android del proyecto Firebase de avisos y colocarlo en `android/app/`. Este archivo no se guarda en Git.
3. Ejecutar `npm run sync`.
4. Proporcionar `GEMA_SIGNING_STORE` y `GEMA_SIGNING_PASSWORD` desde el almacén privado; el alias de firma es `gema-finanzas`. Nunca guardar claves de firma ni claves de servicio Firebase en la aplicación.
5. Desde `android`, ejecutar `gradlew.bat assembleRelease lintRelease`. El APK queda en `app/build/outputs/apk/release/`.

El servidor necesita `FINANCE_FCM_CREDENTIALS`, con una cuenta de servicio restringida a `cloudmessaging.messages.create` en el proyecto de avisos. La clave privada se conserva solo en el servidor. Los tokens de dispositivos se guardan cifrados y el servidor aplica los permisos de cada usuario al enviar avisos. Al cerrar sesión, la APK elimina su registro de avisos.

La primera instalación requiere iniciar sesión y permitir Notificaciones de Android. El botón **Probar aviso Android** envía una prueba a ese mismo dispositivo. Una respuesta aceptada por Firebase no demuestra por sí sola que Android haya mostrado el aviso; debe comprobarse en el teléfono. Los pagos pendientes permanecen en la bandeja aunque se descarte una notificación del sistema.

## Avisos bancarios (APK 1.1.0)

Solo el propietario puede conectar apps desde **Inicio → Avisos de tus bancos**, o **Más → Fuentes y conexiones**. Selecciona las apps instaladas, asigna el banco y, si esa app tiene una sola cuenta, la cuenta receptora. El permiso de Android es general; Gema filtra los paquetes seleccionados antes de leer su texto y descarta códigos, claves y avisos de seguridad antes de enviarlos. No utiliza accesibilidad, SMS ni contraseñas bancarias. Android puede ocultar parte del contenido; una notificación incompleta queda para revisión.

La selección queda fijada al certificado de la app instalada. Los avisos se capturan desde la conexión, sin recuperar notificaciones antiguas. Una cola local cifrada con Android Keystore conserva hasta 500 avisos; WorkManager reintenta por HTTPS cuando hay Internet. El sistema puede retrasar el trabajo por ahorro de batería o al detener la aplicación. La pantalla muestra permiso, cola, última captura/envío y errores. Hace falta comprobar una notificación real en el teléfono antes de considerar validada cada entidad.

El token del dispositivo está cifrado en el teléfono, se almacena como hash en el servidor y solo permite enviar avisos. Depende de la sesión del propietario y deja de funcionar al cerrarla, expirar o revocar el dispositivo. Al cerrar sesión en la APK se elimina la cola y la conexión local. Una sesión nueva renueva el acceso si el propietario había mantenido la conexión activa.

El modo inicial es **revisión**. El registro automático es opcional por app y exige un importe inequívoco, dirección, cuenta y referencia de una operación completada. Los movimientos que coinciden con correo, declaración o comprobante no se vuelven a sumar; si falta referencia o hay dudas, quedan pendientes. Se puede relacionar un aviso con un movimiento existente o confirmar explícitamente que corresponde a otra operación distinta. Los avisos y las decisiones quedan auditados. No se realizan transferencias desde Gema.

Los botones **Compartir** y **Guardar** aparecen en cada pago. Compartir utiliza el menú de Android; no envía por sí solo a un contacto. Guardar conserva el comprobante en **Descargas / Gema Finanzas** en Android 10 o superior; en Android 7–9 se elige la carpeta con el selector del sistema.

Para actualizar el APK, incrementar `versionCode` y conservar la misma clave de firma. Los cambios de interfaz publicados en el servidor llegan sin reinstalar la APK. La aplicación requiere conexión; no almacena pantallas financieras para uso sin conexión.
