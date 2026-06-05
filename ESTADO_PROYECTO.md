# Estado del Proyecto - GemaPromoters

Fecha de cierre: 2026-06-05

## Funcionalidades terminadas

- Aplicacion web funcional con React + Vite, Node.js + Express y SQLite local.
- Proyecto preparado para publicacion online como un solo servicio Node.js.
- Backend configurado para servir el frontend compilado en produccion.
- Base de datos configurable por variable `DB_PATH` para usar disco persistente.
- Login de administrador.
- Login de promotores.
- Panel principal con resumen de promotores activos, total vendido, comisiones y ventas del dia.
- Modulo de promotores:
  - Crear promotor.
  - Editar promotor.
  - Activar/desactivar promotor.
  - Codigo, usuario y contrasena generados automaticamente.
  - Codigo generado con nombre y primer apellido; si se repite, agrega numero al final.
  - Foto de perfil opcional desde archivo del dispositivo.
- Modulo de ventas:
  - Registrar ventas desde administrador.
  - Registrar ventas desde promotor.
  - Asociar venta a promotor.
  - Registrar cliente, WhatsApp, localidad, cantidad, precio, total, fecha y estado de pago.
  - Mostrar localidad en reporte de ventas.
  - Marcar ventas pendientes como pagadas.
  - Eliminar definitivamente ventas desde administrador.
- Comisiones:
  - Las ventas pendientes no generan comision.
  - Las ventas pagadas generan comision segun regla de localidad.
  - Comision configurable por localidad.
  - Tipo de comision: porcentaje o valor fijo por entrada.
  - Comision desde X entradas pagadas por promotor y localidad.
  - Puntos de nivel configurables por localidad.
- Localidades:
  - Crear localidad.
  - Editar localidad.
  - Activar/desactivar localidad.
  - Eliminar localidad si no tiene ventas registradas.
- Ranking de promotores por ventas.
- Liquidaciones:
  - Total vendido por promotor.
  - Comisiones pendientes.
  - Comisiones pagadas.
  - Marcar comisiones como pagadas.
- Verificacion publica en `/verificar`:
  - Verifica codigo del promotor.
  - Tolera mayusculas, minusculas, espacios y guiones.
  - Muestra foto, nombre, Instagram, WhatsApp, nivel y ventas pagadas.
  - Interfaz visual premium por nivel.
- Niveles:
  - Configuracion de Bronce, Plata y Diamante por puntos acumulados.
  - Cada localidad suma puntos distintos por entrada pagada.
  - Nivel visible en la verificacion publica.
- Panel del promotor:
  - Registrar ventas.
  - Ver sus ventas.
  - Marcar sus ventas como pagadas.
  - Cambiar contrasena.
  - Actualizar foto de perfil.

## Funcionalidades pendientes

- QR individual para promotores.
- Reportes PDF.
- Exportacion Excel.
- Dashboard mas avanzado con filtros y graficos.
- Sistema de pagos real.
- Publicacion online.
- Subir proyecto a GitHub y conectarlo a un hosting.
- Configurar disco persistente online para SQLite.
- Definir contrasena segura de administrador en produccion.
- Subida directa de imagenes desde archivo, no solo URL.
- Roles/permisos mas avanzados.
- Recuperacion de contrasena.

## Estructura general del sistema

```text
GemaPromoters/
  package.json
  README.md
  ESTADO_PROYECTO.md
  CONTINUAR_MANANA.md
  PROXIMOS_PASOS.md
  PRODUCCION.md
  render.yaml
  backend/
    package.json
    .env.example
    data/
      gemapromoters.sqlite
    src/
      auth.js
      db.js
      seed.js
      server.js
  frontend/
    package.json
    index.html
    vite.config.js
    src/
      api.js
      main.jsx
      styles.css
```

## Usuarios de prueba

Administrador:

- Usuario: `admin`
- Contrasena: `admin123`

Promotores de ejemplo:

- Camila Vera
  - Usuario: `GEMA-CAMI`
  - Contrasena: `0912345678`
  - Estado: activo
- Mateo Rios
  - Usuario: `GEMA-MATEO`
  - Contrasena: `0923456789`
  - Estado: activo
- Sofia Andrade
  - Usuario: `GEMA-SOFI`
  - Contrasena: `0934567890`
  - Estado: inactivo

## Configuraciones importantes

- Backend local: `http://localhost:4000`
- Frontend local: `http://localhost:5173`
- Panel administrador: `http://localhost:5173`
- Verificacion publica: `http://localhost:5173/verificar`
- Base de datos SQLite: `backend/data/gemapromoters.sqlite`
- Base de datos en produccion configurable con `DB_PATH`
- Variables configurables en `backend/.env`:
  - `PORT`
  - `JWT_SECRET`
  - `ADMIN_USER`
  - `ADMIN_PASSWORD`
  - `DB_PATH`
- Niveles actuales por defecto:
  - Bronce desde 1 punto.
  - Plata desde 10 puntos.
  - Diamante desde 25 puntos.
- Localidades actuales:
  - BOX: 3 puntos por entrada pagada.
  - VIP: 2 puntos por entrada pagada.
  - Fan: 1 punto por entrada pagada.

## Estado actual de la base de datos

- Promotores: 3
- Promotores activos: 2
- Ventas registradas: 0
- Ventas pagadas: 0
- Ventas pendientes: 0
- Localidades: 3
- Configuraciones guardadas: 3
- Archivo de base de datos: `backend/data/gemapromoters.sqlite`

## Notas de cierre

- El proyecto esta en una version minima funcional ampliada.
- Los servidores locales quedaron configurados para ejecutarse con `npm run dev`.
- No se detectaron archivos temporales de prueba pendientes dentro de `work`.
- `git` no esta disponible en esta maquina, por eso la verificacion de cambios se hizo revisando archivos creados, compilacion y estado de base de datos.
