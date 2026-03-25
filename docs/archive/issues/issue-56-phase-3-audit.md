# ISSUE 56 PHASE 3 AUDIT

## Objetivo

Cerrar el runtime propio minimo: supervisor Node, executor loop, guardrails/errores estructurados y `resume` sin AO en el path principal.

## Estado real

### master

- `master` sigue sin Fase 3
- AO sigue siendo la referencia historica en docs viejas, no la ruta viva de spawn/resume/status

### ramas

- rama activa: `jopen/issue-56-phase-0`
- destino: pendiente de commit/push/port; no canonica aun

### local

- spawn principal ya entra por Ralphito Engine
- `tool_spawn_executor.sh` ya crea worktree/branch/session tmux via supervisor propio
- `bd.sh` ya registra step/fallo estructurado/cierre en SQLite
- `resume.sh` ya reinyecta por engine usando fallo estructurado
- `ao-status.ts` ya lee estado del engine
- `find_ao_worktree` ya resuelve primero worktrees del engine
- se corrigio el rebind de `agent_sessions` para no pisar `pid/worktree/steps/failures`
- nuevos modulos engine:
  - `commandRunner.ts`
  - `config.ts`
  - `promptBuilder.ts`
  - `runtimeFiles.ts`
  - `tmuxRuntime.ts`
  - `sessionSupervisor.ts`
  - `executorLoop.ts`
  - `resume.ts`
  - `status.ts`
- nuevos tests:
  - `runtimePhase3.test.ts`

### faltante

- paridad completa dashboard/runtime API contra engine
- corte seco total de AO en observabilidad residual/docs
- limpieza final `src/features/ao/`, wrappers AO y vendor

## Cierre real de Fase 3

1. `SessionSupervisor` crea:
   - `runtime_session_id`
   - thread runtime sintetico
   - worktree + rama `jopen/...`
   - sesion tmux
   - session file
   - loop desacoplado
2. `ExecutorLoop` ya hace:
   - heartbeat de sesion/locks
   - step count por progreso observado
   - timeout por wall time
   - timeout por falta de progreso
   - cierre `done`
   - fallo estructurado y cleanup en limites
3. `resumeRuntimeSession` ya lee `failure_summary + logTail` y reinyecta prompt corto.
4. `bd.sh` ya persiste fallo estructurado y cierre `done` al aterrizar.
5. `tool_check_status.sh` y `ao-status.ts` ya reportan sesiones del engine.
6. `ralphito-db.ts` y dashboard leen guardrail logs del worktree propio antes de AO.

## Validacion ejecutada

- `npx tsc --noEmit` -> OK
- `node --import tsx --test src/features/engine/runtimePhase2.test.ts` -> OK
- `node --import tsx --test src/features/engine/runtimePhase3.test.ts` -> OK
- `bash -n scripts/bd.sh` -> OK
- `bash -n scripts/tools/tool_spawn_executor.sh` -> OK
- `bash -n scripts/resume.sh` -> OK
- `bash -n scripts/tools/tool_check_status.sh` -> OK

## Riesgos vivos

1. el loop usa progreso observado por salida tmux; no hay hook fino por tool interno del agente
2. `ao-status.ts` conserva nombre legacy aunque ya lee engine
3. quedan consumers/docs con terminologia AO que aun no fueron barridos

## Siguiente corte

Fase 4: paridad operativa y corte seco en dashboard/scripts/rutas finales.
