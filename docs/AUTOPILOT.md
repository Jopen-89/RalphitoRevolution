# Autopilot

## Estado actual

Autopilot ya corre sobre Ralphito Engine. No hay runtime principal basado en AO ni fallback legacy.

## Componentes vivos

### 1. `scripts/bd.sh`

- `bd sync` es el unico comando de aterrizaje
- corre guardrails, sincroniza git y hace push
- registra step count, heartbeat y fallo estructurado en SQLite

### 2. Ralphito Engine

- crea `runtime_session_id`, branch y worktree
- mantiene locks por path resuelto
- ejecuta supervisor, loop, status y resume
- guarda fallo estructurado y metadata de sesion en el worktree

### 3. SQLite Ralphito

- fuente canonica para threads, mensajes, tasks, sessions y observabilidad
- `traceability.json` queda como snapshot derivado

## Hitos aterrizados

### Guardrails y landing

- `bd sync` / `bd merge`
- kill efimero tras sync
- reanudacion desde fallo estructurado
- notificaciones push a Telegram
- pipeline QA con Miron, Ricky y Juez

### Runtime propio

- migracion `ao_session_id` -> `runtime_session_id`
- locking real en SQLite
- worktrees propios en `~/.ralphito/worktrees/`
- spawn, status, resume y cleanup sin AO
- dashboard y ops status leyendo engine + SQLite

## Superficies vigentes

- `npm run db:migrate`
- `npm run search:index`
- `npm run search -- "<consulta>"`
- `npm run ops:status`
- `npm run backup:db`
- `GET /health`
- `GET /api/ops/status`
- `POST /api/ops/backup`
- `/dashboard`
