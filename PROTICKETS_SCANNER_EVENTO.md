# ProTickets Scanner Offline

Aplicación Android para controlar el ingreso aun cuando el recinto no tenga señal. La app descarga previamente los boletos del evento, valida contra esa copia local y guarda cada lectura en el teléfono. Al recuperar internet, sincroniza las lecturas y descarga ventas, usos o cancelaciones recientes.

## Preparación antes del evento

1. Instala el APK en cada teléfono Android que se usará en puertas.
2. En ProTickets, crea un usuario distinto para cada validador desde **Validar QR > Accesos para validadores**. No compartas la cuenta administradora.
3. Con internet, inicia sesión en la app.
4. En **Preparar**, selecciona el evento, asigna un nombre claro al dispositivo, por ejemplo `Puerta principal 1`, y pulsa **Descargar y actualizar boletos**.
5. Confirma que la lista esté actualizada, no existan lecturas pendientes y la batería supere el 80 %.
6. Prueba la cámara, la linterna, el sonido y la vibración. Para probar un acceso aprobado usa únicamente un boleto creado para pruebas, porque una lectura válida lo marca como utilizado.
7. Activa modo avión y escanea un QR de prueba para confirmar que el funcionamiento offline esté listo. Luego recupera internet y comprueba que el pendiente vuelva a cero.

## Funciones incluidas

- Escaneo con cámara y entrada manual del código.
- Lista local por evento para trabajar sin internet.
- Resultado visual, sonido y vibración diferentes para acceso aprobado o rechazado.
- Linterna para espacios oscuros y pantalla activa durante el escaneo.
- Detección local de QR repetidos, anulados o desconocidos.
- Cola persistente: cerrar la app o reiniciar el teléfono no borra las lecturas pendientes.
- Sincronización automática cada 30 segundos cuando hay internet.
- Resolución de conflictos si otro teléfono utilizó o anuló el boleto mientras el dispositivo estaba offline.
- Búsqueda por cliente, pedido, localidad o código cuando el QR esté dañado.
- Historial, conteos del turno, estado de batería, última actualización y resumen copiable.

## Equipo recomendado para el día del concierto

- Dos teléfonos Android por puerta y uno de respaldo ya configurado.
- Una batería portátil de al menos 10.000–20.000 mAh por equipo, cables cortos y cargadores identificados.
- Un punto de acceso o SIM de una operadora distinta a la principal del recinto.
- Protector de lluvia, correa para teléfono y paño para limpiar la cámara.
- Lista de compradores exportada o impresa como último respaldo.
- Pulseras, sellos o control físico posterior al escaneo para impedir reingresos por otra puerta.
- Un responsable de incidencias con acceso al administrador de ProTickets.
- Filas separadas para QR listo, búsqueda manual e incidencias.

## Reglas operativas importantes

- Actualiza todos los teléfonos justo antes de abrir puertas y cada vez que recuperen señal.
- Una venta o cancelación hecha después de la última descarga no puede conocerse mientras el teléfono siga totalmente offline.
- Dos dispositivos completamente desconectados no pueden avisarse entre sí en tiempo real. Mantén cada fila asignada a una puerta y sincroniza periódicamente para detectar duplicados entre equipos.
- Nunca borres los datos de la app mientras existan lecturas pendientes.
- Conserva el archivo de firma Android guardado fuera del repositorio; será necesario para instalar futuras actualizaciones sobre esta misma app.

## Compilación

La app usa Capacitor y Android 7 o superior (`minSdk 24`).

```powershell
cd frontend
npm run android:sync
cd android
.\gradlew.bat assembleRelease
```

El APK distribuible debe alinearse y firmarse con la misma clave de ProTickets en cada versión.
