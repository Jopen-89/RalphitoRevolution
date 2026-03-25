# Architecture

La arquitectura del repo se organiza en producto, operacion y persistencia.

## 1. Producto

El codigo del producto vive en `src/`.

- `src/core/` contiene el runtime, la orquestacion y los servicios del engine
- `src/gateway/` expone providers LLM y catalogo de tools
- `src/interfaces/` concentra Telegram y dashboard
- `src/infrastructure/` contiene persistencia, runtime y observabilidad
- `src/app/` agrupa entrypoints ejecutables
- `src/` si absorbe prompts y reglas: los roles viven en `src/core/prompt/roles/`

## 2. Operacion

La capa operativa se reparte entre `src/`, `docs/` y un conjunto reducido de scripts legacy.

- AGENTS.md define el workflow duro
- `docs/specs/` contiene ideas, PRDs, arquitectura y beads
- `ops/runtime/` contiene estado operativo persistido en disco
- `scripts/` queda como capa minima de compatibilidad shell; los entrypoints vivos residen en `src/app/`

## 3. Ownership

### Ralphito Engine posee

- `runtime_session_id`
- branch y worktree
- locks por path resuelto
- heartbeats, status, fallos estructurados y resume

### SQLite Ralphito posee

- threads y mensajes
- relacion chat/agente/sesion
- tasks, beads y task events
- summaries, observabilidad y backups
- indice documental y de codigo

### `traceability.json`

- no es coordinador vivo
- se deriva desde SQLite

## 4. Superficies operativas

- `src/app/server.ts`: chat, dashboard, search, health y ops status
- `src/interfaces/dashboard/`: vista operacional engine + SQLite
- `src/core/services/codeIndexService.ts`: indice FTS5 de codigo y docs
- `src/core/services/summaryService.ts`: summaries por thread, runtime session y task
- `src/infrastructure/logging/observabilityService.ts`: health, metricas, eventos y backups

## 5. Flujo resumido

1. La idea nace en `docs/specs/`.
2. Arquitectura la divide en beads.
3. El engine crea sesion, branch, worktree y locks.
4. SQLite persiste estado y memoria.
5. `finish_task` valida y aterriza via entrypoints nativos.
6. Si falla, `resume` reinyecta el error estructurado.

## 6. Reglas de `finish_task`

- worktree limpio: sin unstaged ni untracked
- cambios staged o commits locales antes de sincronizar
- si no hay nada que aterrizar, termina sin push
- fuera de tmux no mata procesos
