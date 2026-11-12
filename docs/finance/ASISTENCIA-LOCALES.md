# Asistencia de locales

Cada colaboradora marca «Llegué» y «Salí» desde Inicio. El servidor decide persona, fecha y hora de Ecuador; no acepta horas o empleadas enviadas por el teléfono. Se necesita un turno explícito en el calendario. Repetir la misma acción conserva la primera hora. La salida registra una jornada en la distribución salarial; un olvido requiere revisión de gerencia, sin inventar una hora.

Marlon, Morelia y Germán ven el calendario por local. Marlon y Morelia organizan turnos, configuran valores y revisan. Germán consulta. Las demás personas no reciben el calendario ni los valores de nómina.

Las políticas tienen vigencia por fecha y cada jornada conserva una copia al marcar o generar su aviso. Tarifas inicialmente pendientes, nunca supuestas como cero. Tolerancia de 3 minutos: para entrada 10:00 se admite el minuto 10:03 y se registra atraso desde 10:04, según la indicación directa de Marlon. Configurar una tarifa no recalcula jornadas ya registradas. No se alteran bancos ni caja.

## Horarios iniciales

Consultados directamente en Google Maps el 12/11/2026:

- Norte: lunes–viernes 10:00–18:00; sábado 10:00–17:00; domingo 10:00–15:00. Ficha `0x91d59b01f7c369f9:0xd02f890e798add76`.
- Sur: mismo horario. Ficha `0x91d5a30c5221a42b:0xd3c00d0436d17743`.
- Valle: mismo horario. Ficha `0x91d5bde79ae7c4ad:0x62e1fa88a51479cd`.
- Sebastián’s: pendiente de identificar la ficha exacta. No se sustituyó por el horario general del centro comercial ni por otro negocio de nombre parecido.

La asignación diaria prevalece sobre la apertura: un descanso nunca produce una falta. Los horarios se pueden editar por local y día de la semana.

## Revisiones y nómina

- Atraso: se calcula a partir de la entrada y tolerancia configuradas. Aplica la misma multa para todas; puede justificarse.
- Falta justificada: descuento del día, sin multa adicional.
- Falta injustificada: descuento del día más multa, solo después de terminar el turno y tras revisión.
- «Sí trabajó»: registra la jornada que olvidó marcar; mantiene las horas reales que existan.
- Reabrir: revierte la resolución y recalcula los descuentos, sin duplicarlos.

Los descuentos se muestran por fecha en la nómina del local asignado y en el PDF mensual. Cualquier tarifa pendiente mantiene la nómina provisional.

El proceso de avisos corre cada minuto y empieza a evaluar faltas el día posterior al primer despliegue de esta función. Al terminar un turno sin llegada o salida genera una revisión para Morelia. Si falta el horario, evalúa a partir del día siguiente. No se declara una falta injustificada automáticamente. Los avisos se muestran en Inicio y se envían por push a los dispositivos registrados de Morelia, una entrega exitosa por jornada/tipo/dispositivo; los fallos se reintentan.

## Verificación

Pruebas de hora del servidor, permisos, duplicados, turnos, revisiones, políticas históricas, nómina por local y envío exclusivo a Morelia en `backend/test/finance-staff-clock.test.js`. Prueba de interfaz móvil con base ficticia para Selena, Morelia, Germán y Normita. La entrega real de un aviso al celular requiere un dispositivo de Morelia inscrito y permiso de notificaciones.

El protocolo interno recibido menciona otros valores de multas; no se activan sin resolver la diferencia con la instrucción de mantenerlos pendientes. No se automatizan sanciones por uniforme, reportes u otras conductas fuera del alcance de asistencia.
