# GemaPromoters

Aplicacion web sencilla para administrar promotores de eventos de GEMASHOW.

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

- Usuario: `admin`
- Contrasena: `admin123`

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
- Login de promotores para registrar sus propias ventas
- Panel con totales de promotores activos, ventas, comisiones y ventas del dia
- Crear, editar, activar y desactivar promotores
- Generar automaticamente codigo, usuario y contrasena al crear promotor
- Agregar foto de perfil para cada promotor desde archivo del dispositivo
- Crear y editar localidades con precios
- Registrar ventas por promotor
- Comision automatica del 3%
- Ranking por total vendido
- Liquidaciones con comisiones pendientes y pagadas
- Verificacion publica de codigo de promotor
- Verificacion publica premium con foto y nivel del promotor
- Niveles Bronce, Plata y Diamante configurables por ventas pagadas
- Diseno responsive para celular

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

Cuando un promotor registra una venta, esa venta queda guardada tambien para el administrador, aparece en ventas, ranking, panel y liquidaciones.

Los promotores tambien pueden cambiar su contrasena desde su panel.

Tambien pueden agregar o actualizar su foto de perfil eligiendo una imagen desde su dispositivo. Esa foto aparece en la verificacion publica.

## Localidades y precios

En el panel administrativo entra a `Localidades` para crear o editar:

- Nombre de localidad
- Precio
- Tipo de comision: porcentaje o valor fijo por entrada
- Valor de la comision
- Desde cuantas entradas pagadas empieza a generar comision
- Puntos para nivel por cada entrada pagada
- Estado activo/inactivo

Al registrar una venta, selecciona la localidad y el precio se llena automaticamente.

Tambien puedes eliminar una localidad si todavia no tiene ventas registradas. Si ya tiene ventas, el sistema no la elimina para conservar el historial; en ese caso dejala inactiva.

## Pagos y comisiones

- Una venta pendiente no genera comision todavia.
- Cuando la venta se marca como pagada, el sistema calcula la comision segun la regla de su localidad.
- Las reglas son acumuladas por promotor y localidad. Ejemplo: si VIP paga comision desde 5 entradas, el promotor empieza a ganar desde la quinta entrada VIP pagada.
- El administrador puede marcar ventas como pagadas desde `Ventas`.
- El promotor puede marcar sus propias ventas como pagadas desde su panel.

## Niveles

En `Niveles`, el administrador define desde cuantas ventas pagadas entra un promotor a:

- Bronce
- Plata
- Diamante

Ahora los niveles se calculan por puntos, no solo por numero de ventas. Cada localidad puede sumar puntos distintos por entrada pagada. Ejemplo: BOX puede sumar 3 puntos, VIP 2 puntos y Fan 1 punto. El nivel aparece en la verificacion publica del promotor junto con su foto.

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
