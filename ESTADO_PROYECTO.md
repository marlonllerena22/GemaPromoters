# Estado del Proyecto - GemaPromoters

Fecha de cierre: 2026-06-05

## Funcionalidades terminadas

- Aplicacion web funcional con React + Vite, Node.js + Express y SQLite local.
- Proyecto preparado para publicacion online como un solo servicio Node.js.
- Backend configurado para servir el frontend compilado en produccion.
- Base de datos configurable por variable `DB_PATH` para usar disco persistente.
- Login de administrador.
- Login de promotores.
- Modulo de eventos/conciertos:
  - Crear evento.
  - Editar evento.
  - Activar evento visible para promotores.
  - Evento inicial: `KRIS R EL TRAP DE KOLOMBIA`.
  - Promotores compartidos entre todos los eventos.
  - Localidades, niveles, beneficios y banners separados por evento.
- Panel principal con resumen de promotores activos, total vendido, comisiones y ventas del dia.
- Modulo de promotores:
  - Crear promotor.
  - Editar promotor.
  - Activar/desactivar promotor.
  - Codigo, usuario y contrasena generados automaticamente.
  - Codigo generado con nombre y primer apellido; si se repite, agrega numero al final.
  - Foto de perfil opcional desde archivo del dispositivo.
  - Habilitar/deshabilitar la opcion de vender por cada promotor.
  - Asignar puntos manuales por promotor desde el administrador.
  - Registrar codigo de referido cuando un promotor invita a otro promotor.
  - Ver cuántos referidos logro cada promotor y cuantos puntos gano por referidos.
- Modulo de ventas:
  - Registrar ventas desde administrador.
  - Registrar ventas desde promotor.
  - Asociar venta a promotor.
  - Registrar cliente, WhatsApp, localidad, cantidad, precio, total, fecha y estado de confirmacion.
  - Mostrar localidad en reporte de ventas.
  - Confirmar ventas pendientes desde administrador.
  - Eliminar definitivamente ventas desde administrador.
- Comisiones:
  - Las ventas pendientes de confirmacion no generan comision.
  - Las ventas confirmadas por administrador generan comision segun regla de localidad.
  - Comision configurable por localidad.
  - Tipo de comision: porcentaje o valor fijo por entrada.
  - Comision desde X entradas confirmadas por promotor y localidad.
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
  - Muestra foto, nombre, Instagram, WhatsApp y nivel.
  - No muestra puntos ni cantidad de ventas, porque esa informacion es interna.
  - Interfaz visual premium por nivel.
- Niveles:
  - Configuracion de Bronce, Plata y Diamante por puntos acumulados.
  - Cada localidad suma puntos distintos por entrada pagada.
  - Puntos globales por referido configurables por administrador.
  - Beneficios editables por nivel desde el panel administrador.
  - En el perfil del promotor se muestran beneficios desbloqueados y beneficios futuros bloqueados.
  - Nivel visible en la verificacion publica.
- Banners:
  - Crear banners por evento desde administrador.
  - Activar/desactivar banners.
  - Mostrar banners activos en el inicio del promotor.
- Panel del promotor:
  - Registrar ventas.
  - Sus ventas quedan pendientes hasta confirmacion del administrador.
  - Ver comision confirmada con opcion de ocultar el valor.
  - No puede registrar ventas si el administrador deshabilita su permiso de venta.
  - Ver sus ventas.
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
  - Asociadas al evento `KRIS R EL TRAP DE KOLOMBIA`.
  - BOX: 3 puntos por entrada confirmada.
  - VIP: 2 puntos por entrada confirmada.
  - Fan: 1 punto por entrada confirmada.
- Los puntos de nivel se calculan con ventas confirmadas por localidad mas los puntos manuales que asigne el administrador.
- Los puntos por referidos se calculan automaticamente multiplicando cantidad de promotores referidos por el valor global configurado.
- Los beneficios de Bronce, Plata y Diamante se guardan en `app_settings` y pueden editarse escribiendo un beneficio por linea.

## Estado actual de la base de datos

- Promotores: 3
- Promotores activos: 2
- Eventos: 1
- Evento activo: `KRIS R EL TRAP DE KOLOMBIA`
- Ventas registradas: 0
- Ventas pagadas: 0
- Ventas pendientes: 0
- Localidades: 3
- Banners: 0
- Configuraciones de evento guardadas: 7
- Archivo de base de datos: `backend/data/gemapromoters.sqlite`

## Notas de cierre

- El proyecto esta en una version minima funcional ampliada.
- Los servidores locales quedaron configurados para ejecutarse con `npm run dev`.
- No se detectaron archivos temporales de prueba pendientes dentro de `work`.
- `git` no esta disponible en esta maquina, por eso la verificacion de cambios se hizo revisando archivos creados, compilacion y estado de base de datos.
