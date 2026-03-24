# Architecture

La arquitectura del repo se organiza en producto, operacion y persistencia.

## 1. Producto

El codigo del producto vive en `src/`.

- `src/features/` concentra slices funcionales
- `src/features/engine/` contiene el runtime propio
- `src/` no absorbe prompts, reglas ni playbooks

## 2. Operacion

La capa operativa vive fuera de `src/`.

- AGENTS.md define el workflow duro
- `agents/` contiene roles y playbooks
- `ops/` contiene config y estado operativo
- `scripts/` expone `bd`, resume, QA y tooling

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

- `src/features/llm-gateway/api/server.ts`: chat, dashboard, search, health y ops status
- `src/features/dashboard/`: vista operacional engine + SQLite
- `src/features/search/`: indice FTS5 de codigo y docs
- `src/features/memory/`: summaries por thread, runtime session y task
- `src/features/ops/`: health, metricas, eventos y backups

## 5. Flujo resumido

1. La idea nace en `docs/specs/`.
2. Arquitectura la divide en beads.
3. El engine crea sesion, branch, worktree y locks.
4. SQLite persiste estado y memoria.
5. `scripts/bd.sh sync` valida y aterriza.
6. Si falla, `scripts/resume.sh` reinyecta el error estructurado.

## 6. Reglas de `bd sync`

- worktree limpio: sin unstaged ni untracked
- cambios staged o commits locales antes de sincronizar
- si no hay nada que sync, termina sin push
- fuera de tmux no mata procesos
