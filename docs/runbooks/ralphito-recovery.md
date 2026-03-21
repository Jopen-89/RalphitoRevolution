# Ralphito Recovery Runbook

## Objetivo

Operar Ralphito sin inspeccion manual constante y recuperar rapido el sistema cuando falle DB, retrieval o bindings engine/Telegram.

## Health y estado operativo

- Gateway health: `GET /health`
- Estado operativo completo: `GET /api/ops/status`
- CLI equivalente: `npm run ops:status`

Campos clave a mirar:

- `health.db.ok`: la base SQLite responde
- `health.engine.ok`: el engine responde y puede listar sesiones
- `metrics.failedQueries`: numero de consultas de retrieval/search fallidas
- `metrics.averageRetrievalMs`: latencia media reciente de retrieval
- `metrics.orphanSessions`: bindings SQLite -> engine sin sesion viva
- `metrics.stuckTasks`: tasks abiertas sin movimiento durante la ventana de alerta

## Backups SQLite

- Crear backup manual: `npm run backup:db`
- Los backups se guardan en `ops/runtime/backups/ralphito/`

Flujo recomendado:

1. Ejecutar `npm run backup:db`
2. Verificar el path emitido por el comando
3. Copiar el archivo fuera de la maquina si es un hito importante

## Recovery de SQLite

1. Parar procesos que escriban en Ralphito (`start:bot`, `start:gateway`)
2. Crear un backup del estado actual aunque este degradado
3. Elegir el backup de restauracion desde `ops/runtime/backups/ralphito/`
4. Sustituir `ops/runtime/ralphito/ralphito.sqlite` por el backup elegido
5. Arrancar de nuevo gateway y bot
6. Confirmar con `npm run ops:status`

## Recovery de sesiones huerfanas

Si `metrics.orphanSessions` es mayor que 0:

1. Revisar `GET /api/ops/status` o `npm run ops:status`
2. Confirmar si el engine ya no tiene esas sesiones
3. Reenlazar la conversacion provocando una nueva interaccion en Telegram con el agente correspondiente
4. Verificar que `agent_sessions` reciba el nuevo `runtime_session_id`

## Recovery de tasks atascadas

Si `metrics.stuckTasks` es mayor que 0:

1. Revisar los ids expuestos en `stuckTasks`
2. Abrir el dashboard en `/dashboard`
3. Pausar (`blocked`) o cancelar (`cancelled`) si la task no puede continuar
4. Si aplica, reinyectar el error al ejecutor con `scripts/tools/tool_resume_executor.sh <session-id>`

## Fallos de retrieval o search

Si sube `metrics.failedQueries`:

1. Reindexar documentos con `npm run search:index`
2. Revalidar con `GET /api/search?q=<consulta>`
3. Revisar `recentEvents` en `GET /api/ops/status`

## Cierre

Antes de declarar el sistema sano:

- `health.db.ok = true`
- `health.engine.ok = true`
- `metrics.orphanSessions = 0` o explicado
- `metrics.stuckTasks = 0` o explicado
