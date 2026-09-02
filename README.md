# GemaPromoters

Aplicacion web sencilla para administrar promotores por establecimientos bajo la empresa PROMOTERS.

## Tecnologias

- Frontend: React + Vite
- Backend: Node.js + Express
- Base de datos: SQLite local con `better-sqlite3`
- Produccion: backend Express sirve tambien el frontend compilado

## Requisitos

- Node.js 20 o superior recomendado
- npm

## Instalacion

Desde la carpeta del proyecto:

```bash
npm install
npm run install:all
```

Copia el archivo de entorno del backend:

```bash
cp backend/.env.example backend/.env
```

En Windows PowerShell puedes usar:

```powershell
Copy-Item backend/.env.example backend/.env
```

Credenciales iniciales:

- Administrador supremo PROMOTERS:
  - Usuario: `promoters`
  - Contrasena: `promoters123`
- Administrador GEMASHOW:
  - Usuario: `admin`
  - Contrasena: `admin123`
- Administrador Marjorie Botas:
  - Usuario: `marjorie`
  - Contrasena: `marjorie123`
- Administrador ProTickets:
  - Usuario: `protickets`
  - Contrasena inicial: `protickets123`

Puedes cambiarlas en `backend/.env`.

## Crear datos de ejemplo

```bash
npm run seed
```

Esto crea promotores y ventas de prueba en `backend/data/gemapromoters.sqlite`.

## Ejecutar en local

```bash
npm run dev
```

Abre:

- Panel admin: http://localhost:5173
- Verificacion publica: http://localhost:5173/verificar
- API backend: http://localhost:4000/api/health
- Ticketera publica: http://localhost:5173/tickets

## Compilar para produccion

```bash
npm run build
npm start
```

En produccion, el backend sirve la API y el frontend desde un solo servicio.

Guia de publicacion:

```text
PRODUCCION.md
```

## Funcionalidades incluidas

- Login de administrador con JWT
- Login de administrador supremo PROMOTERS
- Crear y editar establecimientos
- Establecimientos iniciales: `GEMASHOW` y `Marjorie Botas`
- Tipo de establecimiento:
  - `Evento o concierto`: funciona como GEMASHOW.
  - `Local comercial`: funciona como Marjorie Botas, con ventas registradas por administrador.
- Cada establecimiento tiene su propio usuario y contrasena de administrador/dueño.
- Crear y editar sucursales por establecimiento.
- Configurar si los promotores de un establecimiento pueden registrar ventas desde su cuenta
- Login de promotores para registrar sus propias ventas
- Crear y editar eventos/conciertos desde administrador
- Evento inicial creado: `KRIS R EL TRAP DE KOLOMBIA`
- Promotores separados por establecimiento
- Localidades, niveles, beneficios, puntos y banners configurables por evento
- Panel con totales de promotores activos, ventas, comisiones y ventas del dia
- Crear, editar, activar y desactivar promotores
- Generar automaticamente codigo, usuario y contrasena al crear promotor
- Agregar foto de perfil para cada promotor desde archivo del dispositivo
- Habilitar o bloquear la opcion de vender por cada promotor
- Asignar puntos manuales al promotor que el administrador elija
- Registrar referidos usando el codigo del promotor que invito
- Configurar cuantos puntos gana un promotor por cada referido
- Crear y editar localidades con precios
- Registrar ventas por promotor
- Eliminar definitivamente ventas desde administrador
- Comision automatica del 3%
- Ranking por total vendido
- Liquidaciones con comisiones pendientes y pagadas
- Verificacion publica de codigo de promotor
- Verificacion publica premium con foto y nivel del promotor
- Niveles Bronce, Plata y Diamante configurables por ventas confirmadas
- Beneficios editables por nivel y visibles para promotores segun su progreso
- Banners publicitarios por evento visibles en el panel del promotor
- Diseno responsive para celular

## ProTickets

ProTickets funciona como un negocio independiente dentro de PROMOTERS. Su pagina publica esta en `/tickets` y permite:

- Consultar eventos sin iniciar sesion.
- Crear una cuenta de comprador con correo y contrasena.
- Ingresar con Google cuando `GOOGLE_CLIENT_ID` esta configurado.
- Elegir localidad y cantidad, reservar stock durante 20 minutos y abrir el enlace de pago Bendo.
- Consultar pedidos y entradas digitales desde `Mis entradas`.
- Recibir por correo un codigo QR unico por cada entrada confirmada.

El administrador ProTickets puede crear y editar eventos, cargar imagenes y banners desde su dispositivo, definir precios, cargos de servicio, stock y limite por compra, asignar enlaces Bendo, confirmar pagos y validar entradas en el acceso.

El evento inicial `KRIS R EL TRAP DE KOLOMBIA` se crea publicado, pero sus localidades empiezan con stock `0`. Antes de vender, entra como administrador ProTickets, edita el evento y configura el stock real y el enlace Bendo.

Para enviar entradas por correo configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Para Google configura `GOOGLE_CLIENT_ID`. La confirmacion automatica de Bendo queda preparada en `/api/ticketing/payments/bendo/webhook`; debe ajustarse a la documentacion y credenciales finales que entregue Bendo. Mientras tanto, el administrador puede confirmar cada pago manualmente y el sistema emite las entradas en ese momento.

## Acceso de promotores

Cada promotor puede entrar desde la misma pantalla de login, usando la opcion `Promotor`.

Al crear un promotor, el administrador solo necesita completar:

- Nombre
- Cedula
- WhatsApp
- Instagram

La foto de perfil es opcional.

El sistema genera credenciales iniciales asi:

- Codigo: generado automaticamente con nombre y primer apellido, por ejemplo `GEMA-JUANPEREZ`
- Si ya existe el mismo codigo, agrega un numero, por ejemplo `GEMA-JUANPEREZ-2`
- Usuario: igual al codigo generado
- Contrasena: cedula del promotor

El promotor puede cambiar su contrasena y su foto desde su panel.

Cuando el establecimiento permite ventas por promotor, el promotor puede registrar ventas y quedan pendientes hasta que el administrador las confirme.

En establecimientos con ventas por promotor desactivadas, como `Marjorie Botas`, el promotor solo ve perfil, nivel, beneficios y banners. El administrador registra las ventas a su nombre usando su codigo.

El administrador puede bloquear la venta de un promotor especifico sin desactivarlo por completo. Si esta bloqueado, el promotor puede entrar a su panel, pero no puede registrar ventas.

Al crear o editar un promotor, el administrador puede escribir el codigo del promotor que lo invito en el campo de referidos. El sistema valida que ese codigo exista y suma puntos automaticamente al promotor que invito.

Los promotores tambien pueden cambiar su contrasena desde su panel.

Tambien pueden agregar o actualizar su foto de perfil eligiendo una imagen desde su dispositivo. Esa foto aparece en la verificacion publica.

## Localidades y precios

Primero selecciona el evento/concierto en el selector superior del panel administrativo. Luego entra a `Localidades` para crear o editar:

- Nombre de localidad
- Precio
- Tipo de comision: porcentaje o valor fijo por entrada
- Valor de la comision
- Desde cuantas entradas confirmadas empieza a generar comision
- Puntos para nivel por cada entrada confirmada
- Estado activo/inactivo

Al registrar una venta, selecciona la localidad y el precio se llena automaticamente.

Tambien puedes eliminar una localidad si todavia no tiene ventas registradas. Si ya tiene ventas, el sistema no la elimina para conservar el historial; en ese caso dejala inactiva.

## Eventos y banners

En `Eventos`, el administrador puede crear, editar y activar el evento visible para los promotores.

Los promotores son globales y sirven para todos los eventos. Lo que cambia por evento es:

- Localidades y precios.
- Reglas de comision.
- Puntos por localidad.
- Niveles y beneficios.
- Banners publicitarios.

En `Banners`, el administrador puede subir imagenes para el evento seleccionado. Los banners activos aparecen en el inicio del promotor de forma visual y ordenada.

## Confirmacion y comisiones

- Una venta registrada por promotor queda por confirmar y no genera comision todavia.
- Cuando el administrador confirma la venta desde `Ventas`, el sistema calcula la comision segun la regla de su localidad.
- Las reglas son acumuladas por promotor y localidad. Ejemplo: si VIP paga comision desde 5 entradas, el promotor empieza a ganar desde la quinta entrada VIP confirmada.
- El administrador puede confirmar ventas desde `Ventas`.
- El administrador puede eliminar definitivamente una venta desde `Ventas`.
- El promotor no puede confirmar sus propias ventas.
- El promotor puede ver su comision confirmada y ocultar el valor desde su panel.

## Niveles

En `Niveles`, el administrador define desde cuantas ventas confirmadas entra un promotor a:

- Bronce
- Plata
- Diamante

Ahora los niveles se calculan por puntos, no solo por numero de ventas. Cada localidad puede sumar puntos distintos por entrada confirmada. Ejemplo: BOX puede sumar 3 puntos, VIP 2 puntos y Fan 1 punto.

El administrador tambien puede sumar puntos manuales al promotor que quiera. Esos puntos se agregan al calculo del nivel, junto con los puntos obtenidos por entradas confirmadas.

El administrador tambien define cuantos puntos vale cada referido. Ese valor es global para todos los promotores, sin preferencias individuales.

En la misma pantalla de `Niveles`, el administrador puede escribir beneficios para Bronce, Plata y Diamante. Se recomienda escribir un beneficio por linea.

En el perfil del promotor aparecen los beneficios de forma profesional: los beneficios alcanzados se ven desbloqueados y los beneficios de niveles superiores aparecen bloqueados hasta que el promotor llegue a ese nivel.

El nivel aparece en la verificacion publica del promotor junto con su foto, pero los puntos y las ventas confirmadas no se muestran publicamente.

## Estructura

```text
GemaPromoters/
  backend/
    src/
      auth.js
      db.js
      seed.js
      server.js
  frontend/
    src/
      api.js
      main.jsx
      styles.css
```
