# Estudios Creativos: configuración

La landing pública vive en `https://estudioscreativos.com/` y el acceso/estudio en `https://estudioscreativos.com/ingresar`.

## Variables de entorno

```text
CONTENT_STUDIO_APP_URL=https://estudioscreativos.com
CONTENT_STUDIO_CONTACT_EMAIL=promoters.ecu@gmail.com
GOOGLE_CLIENT_ID=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
OPENAI_RESEARCH_MODEL=gpt-5.4-nano
```

`SMTP_FROM` debe ser una identidad permitida por la cuenta configurada en `SMTP_USER`. Los enlaces mágicos vencen en 20 minutos, almacenan únicamente un hash del token y se invalidan al primer uso.

## Google Identity Services

1. Crear o reutilizar una credencial **OAuth 2.0 Client ID** de tipo **Web application** en Google Cloud.
2. Configurar la pantalla de consentimiento y los datos públicos de Estudios Creativos.
3. Agregar como orígenes JavaScript autorizados:
   - `https://estudioscreativos.com`
   - `https://www.estudioscreativos.com`
   - `http://localhost:5173` para desarrollo
4. Guardar el Client ID en `GOOGLE_CLIENT_ID` en Render.

El frontend usa el botón oficial y One Tap/auto-select. El backend valida el ID token con `google-auth-library` y comprueba audiencia, firma, emisor, expiración y correo verificado antes de crear o iniciar una cuenta.

## Créditos y transferencias

Google y Magic Link crean cuentas activas con plan `Sin plan`, suscripción inactiva y cero créditos. El pago actual crea una solicitud de transferencia asociada al usuario autenticado. Un administrador confirma la referencia bancaria y el servidor activa el plan y reinicia el periodo de uso.

La migración de SQLite es automática e idempotente al iniciar el backend. Agrega `email`, `google_sub`, `avatar_url`, `credit_limit`, enlaces mágicos y eventos de pago. Los usuarios anteriores conservan su límite de créditos; los usuarios nuevos empiezan en cero. Los logos anteriores se copian únicamente a cuentas que ya existían durante la migración.

## Preparación futura de PayPhone

El esquema de solicitudes ya incluye proveedor, identificador de transacción y payload del proveedor. La activación del plan está centralizada en el backend y existe una tabla idempotente de eventos. Cuando se habilite PayPhone se necesitarán:

```text
PAYPHONE_TOKEN=
PAYPHONE_STORE_ID=
PAYPHONE_PREPARE_URL=https://pay.payphonetodoesposible.com/api/button/Prepare
PAYPHONE_CONFIRM_URL=https://pay.payphonetodoesposible.com/api/button/V2/Confirm
```

El paso pendiente es crear la solicitud de pago desde el backend y conectar la respuesta/webhook. Antes de otorgar créditos, el servidor deberá confirmar la transacción directamente con PayPhone, comparar pedido, moneda, valor y estado, y registrar el identificador del evento para impedir activaciones duplicadas.

## Validación

```powershell
node --test backend/test/content-studio.test.js
npm run build --prefix frontend
```

Las pruebas cubren aislamiento de logos, conservación de usuarios anteriores, cuentas nuevas con cero créditos, token mágico de un solo uso, solicitud y activación manual de plan, límites, formatos finales 1080 × 1350 y 1080 × 1920, composición exacta del logo y datos de contacto.
