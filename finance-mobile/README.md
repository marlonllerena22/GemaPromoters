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

Para actualizar el APK, incrementar `versionCode` y conservar la misma clave de firma. Los cambios de interfaz publicados en el servidor llegan sin reinstalar la APK. La aplicación requiere conexión; no almacena pantallas financieras para uso sin conexión.
