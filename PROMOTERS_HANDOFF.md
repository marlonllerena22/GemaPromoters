# Traspaso para el chat de PROMOTERS

Este repositorio contiene PROMOTERS y todos los negocios que se administran dentro de esa plataforma. El chat dedicado a este proyecto debe trabajar directamente en esta carpeta, sin mover ni copiar archivos:

```text
C:\Users\acern\Documents\Codex\2026-06-04\quiero-crear-una-aplicaci-n-web\outputs\GemaPromoters
```

## Alcance del chat

Este chat atiende cambios de:

- PROMOTERS y el administrador principal.
- Promotoras Marjorie Botas y su equipo administrador.
- ProTickets y la ticketera publica.
- RENJI, sus registros, catalogo, pedidos y stock.
- PRODUCALZA, inventario, produccion, pedidos, reportes, locales, personal y finanzas.
- Los demas establecimientos o modulos que vivan dentro de GemaPromoters.

CreoNovi vive en un repositorio independiente. No modificar CreoNovi desde GemaPromoters salvo que la usuaria lo pida de forma expresa y el cambio sea necesario para completar una integracion entre ambos sistemas.

## Estado confirmado al crear este traspaso

- Rama: `main`.
- HEAD: `cbb6ca9 Allow two garments per Renji registration`.
- `origin/main` apunta al mismo commit.
- El arbol de trabajo estaba limpio.
- Produccion usa Render, el servicio `gemapromoters`, con disco persistente en `/var/data`.
- URL publica configurada: `https://promotersec.com`.
- Base de produccion: `/var/data/gemapromoters.sqlite`.

Cambios recientes ya implementados:

- RENJI permite registrar hasta dos prendas para un mismo cliente, conservando una sola ficha de datos personales.
- RENJI tiene catalogo visual por prenda, color y talla, con reserva y descuento de stock.
- ProTickets tiene campañas por correo para compras rechazadas o incompletas, excluyendo a quien finalmente concreto la compra, y envio individual por WhatsApp.
- Marjorie permite administradoras limitadas con permisos.
- Marjorie y promotoras tienen recuperacion de contraseña temporal y cambio obligatorio.
- La integracion de promotoras Marjorie con AlfaBusiness conserva codigos, ventas, devoluciones y comisiones.

Commits de referencia:

```text
cbb6ca9 Allow two garments per Renji registration
0a8b2ce Add Renji photo catalog with color and size stock reservations
34e9f18 Add recovered-sale email campaigns and per-customer WhatsApp in ProTickets
cd048a6 Agregar administradoras limitadas para Marjorie
1c6a793 Agregar recuperacion obligatoria de contraseñas
```

## Archivos principales

### Promotoras Marjorie

- `backend/src/marjorie-promoters-db.js`
- `backend/src/marjorie-promoters-routes.js`
- `backend/src/auth-recovery-routes.js`
- `frontend/src/MarjoriePromotersApp.jsx`
- `frontend/src/marjorie-promoters.css`
- `MARJORIE_INTEGRACION.md`

### ProTickets

- `backend/src/ticketing-db.js`
- `backend/src/ticketing-routes.js`
- `backend/src/ticketing-promotions.js`
- `backend/src/ticketing-finance.js`
- `frontend/src/ProTicketsApp.jsx`
- `frontend/src/ProTicketsPromotions.jsx`
- `frontend/src/TicketingPayments.jsx`
- `frontend/src/protickets.css`

### RENJI

- `backend/src/renji-catalog.js`
- `backend/src/renji-routes.js`
- Las tablas y migraciones de RENJI tambien se inicializan en `backend/src/db.js`.
- `frontend/src/RenjiApp.jsx`
- `frontend/src/RenjiPublicRegistration.jsx`
- `frontend/src/renji-catalog.css`

Rutas publicas relevantes:

- `/renji-registro`
- `/renji-separar`

### PRODUCALZA

- `backend/src/producalza-db.js`
- `backend/src/producalza-routes.js`
- `backend/src/producalza-inventory-seed.js`
- `frontend/src/ProducalzaApp.jsx`
- `frontend/src/LocalAttendancePage.jsx`

### Entrada compartida

- `frontend/src/main.jsx` decide que aplicacion mostrar segun la ruta, el rol y el establecimiento.
- `backend/src/db.js` inicializa la base compartida y los establecimientos.
- `backend/src/server.js` registra las rutas del sistema.
- `render.yaml` contiene la configuracion del servicio, sin los valores de secretos.

## Forma de trabajo

Antes de editar:

1. Leer este archivo y la documentacion relacionada con el modulo solicitado.
2. Ejecutar `git status --short` y revisar los ultimos commits.
3. Buscar el flujo real en frontend, rutas, base de datos y pruebas antes de asumir que una funcion falta.
4. Conservar datos y migraciones existentes; no reemplazar ni reiniciar la base persistente.
5. No escribir secretos en el repositorio. Las claves y contraseñas de produccion viven en las variables privadas de Render.
6. Mantener la separacion de establecimientos y permisos por rol.

Validacion habitual:

```powershell
npm run build
npm test --prefix backend
```

Usar pruebas mas especificas cuando el modulo las tenga. Revisar el cambio completo antes de publicar. La solicitud de la usuaria autoriza implementar y verificar; desplegar o enviar comunicaciones externas solo cuando lo haya pedido.

## Instruccion inicial recomendada

```text
Trabaja exclusivamente en PROMOTERS y sus modulos: Promotoras Marjorie, ProTickets, RENJI, PRODUCALZA y los demas negocios incluidos en GemaPromoters. Usa directamente el repositorio C:\Users\acern\Documents\Codex\2026-06-04\quiero-crear-una-aplicaci-n-web\outputs\GemaPromoters, sin mover ni duplicar archivos. Lee PROMOTERS_HANDOFF.md y revisa el codigo y el estado actual antes de cambiar algo. CreoNovi queda fuera de este chat salvo que yo lo pida expresamente. Cuando te solicite un cambio, implementalo, pruebalo y dejalo listo de punta a punta.
```
