# Publicar GemaPromoters Online

Objetivo: abrir la app desde cualquier telefono con internet usando una URL publica.

## Opcion recomendada

Usar un hosting para Node.js con disco persistente. La app usa SQLite, que es un archivo; por eso necesita que el servidor tenga almacenamiento persistente para no perder datos al reiniciar o redeployar.

Render y Railway tienen soporte de almacenamiento persistente:

- Render: Persistent Disks
- Railway: Volumes

El proyecto ya quedo preparado para funcionar como un solo servicio:

- Backend Express sirve la API.
- Backend Express tambien sirve el frontend compilado.
- La base SQLite puede moverse con `DB_PATH`.

## Variables importantes

En produccion configura:

```text
NODE_ENV=production
JWT_SECRET=una-clave-larga-y-secreta
ADMIN_USER=admin
ADMIN_PASSWORD=tu-clave-segura
DB_PATH=/var/data/gemapromoters.sqlite
```

## Comandos de produccion

Build:

```bash
npm run build
```

Start:

```bash
npm start
```

## Render

Este proyecto incluye `render.yaml`.

Pasos generales:

1. Subir el proyecto a GitHub.
2. Entrar a Render.
3. Crear un nuevo Blueprint o Web Service desde el repositorio.
4. Usar:
   - Build command: `npm run build`
   - Start command: `npm start`
5. Agregar disco persistente:
   - Mount path: `/var/data`
   - Variable `DB_PATH`: `/var/data/gemapromoters.sqlite`
6. Configurar `ADMIN_PASSWORD` con una clave segura.
7. Deploy.

## Despues de publicar

Render entregara una URL parecida a:

```text
https://gemapromoters.onrender.com
```

Con esa URL puedes entrar desde celular:

```text
https://gemapromoters.onrender.com
```

Verificacion publica:

```text
https://gemapromoters.onrender.com/verificar
```

## Nota sobre datos actuales

La base local actual esta en:

```text
backend/data/gemapromoters.sqlite
```

Para produccion, lo ideal es usar el disco persistente del hosting. Si quieres llevar exactamente los datos actuales al servidor, hay que subir ese archivo SQLite al disco persistente del hosting o crear los datos nuevamente desde el panel administrador.
