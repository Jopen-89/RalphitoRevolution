# ISSUE 56 PHASE 2 AUDIT

## Objetivo

Cerrar locking real por path resuelto, preparar worktree manager propio y dejar reaper base para sesiones/locks stale.

## Estado real

### master

- `master` sigue sin Fase 2
- AO sigue siendo runtime tecnico actual

### ramas

- rama activa: `jopen/issue-56-phase-0`
- destino: pendiente de commit/push/port; no canonica aun

### local

- Fase 2 implementada solo local en este workspace
- `tool_spawn_executor.sh` ya hace preflight/acquire de locks en SQLite
- nuevo engine local:
  - `writeScope.ts`
  - `runtimeLockRepository.ts`
  - `worktreeManager.ts`
  - `runtimeReaper.ts`
  - `cli.ts`
  - `runtimePhase2.test.ts`

### faltante

- supervisor/executor loop
- heartbeat vivo durante ejecucion real
- resume/status/spawn sin AO
- cutover dashboard/scripts al runtime propio
- limpieza final AO/vendor

## Cierre real de Fase 2

1. `WRITE_ONLY_GLOBS` ya resuelve a base paths reales antes del spawn.
2. `runtime_locks` ya guarda locks por path resuelto y detecta colision `same | ancestor | descendant`.
3. `tool_spawn_executor.sh` ya hace:
   - preflight lock
   - acquire lock por `runtime_session_id`
   - release + `ao session kill` si falla acquire/send
4. creado `WorktreeManager` con `createWorkspace` y `teardownWorkspace`.
5. creado `RuntimeReaper` para locks vencidos y sesiones activas con heartbeat stale.
6. `.agent-worktrees/` queda ignorado en git.
7. migracion 11 deja `runtime_locks` sin FK a `agent_sessions` para permitir lockeo previo al bind operativo.

## Validacion ejecutada

- `npx tsc --noEmit` -> OK
- `node --import tsx --test src/features/engine/runtimePhase2.test.ts` -> OK
- `bash -n scripts/tools/tool_spawn_executor.sh` -> OK

## Riesgos vivos

1. AO sigue creando worktree real; `WorktreeManager` propio aun no entra en el path principal
2. el lock heartbeat aun no se refresca durante ejecucion real
3. dashboard y observabilidad aun no consumen locks/worktrees del engine propio

## Siguiente corte

Fase 3: supervisor Node, executor loop, guardrails reales y resume con fallo estructurado.
