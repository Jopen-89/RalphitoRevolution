# ISSUE 56 PHASE 0 AUDIT

## Objetivo

Congelar el estado real antes del desacople a runtime propio y cerrar el drift mas inmediato del contrato de spawn.

## Estado real

### master

- issue `#56` abierta con plan actualizado
- AO sigue siendo runtime tecnico actual
- `src/features/ao/spawnExecutorClient.ts` llamaba `tool_spawn_executor.sh --payload-file`, pero el script no lo soportaba
- el runbook de QA declaraba persistencia de `.ralphito-session.json`, pero el spawn real no la hacia

### ramas

- rama activa de Fase 0: `jopen/issue-56-phase0-wt`
- ramas detectadas: `feat/43`, `feat/issue-42`, `fix/issue-44-e2e-qa-hang`, `jopen/be-33-bead-2`, `pr-11`, `pr-11-checkout`, `session/*`
- destino de esta rama: pendiente de port/merge; no canonica aun
- worktree dedicado: `/tmp/rr-issue56-phase0`

### local

- worktree dedicado limpio salvo cambios de esta fase
- en el workspace principal sigue existiendo un untracked ajeno al scope: `docs/specs/projects/cv-enhancer/`
- tambien existen artefactos locales ignorados en `docs/state/`; no cuentan como entregable del repo

### faltante

- migrar `ao_session_id` -> `runtime_session_id`
- crear `runtime_locks` en SQLite
- crear `src/features/engine/`
- cortar AO de dashboard, observabilidad, resume, status, tasks y summaries
- eliminar AO/vendor tras paridad

## Inventario AO actual

### src

- `src/features/ao/aoSessionAdapter.ts`: adapta sesiones AO para dashboard/status
- `src/features/ao/spawnExecutorClient.ts`: cliente TS de spawn con payload estructurado
- `src/features/dashboard/dashboardService.ts`: mezcla AO + SQLite y lee errores desde `~/.agent-orchestrator`
- `src/features/ops/observabilityService.ts`: health y observabilidad con AO
- `src/features/telegram/*`: bindings y estado con `ao_session_id`
- `src/features/memory/summaryService.ts`: summaries por scope `ao_session`
- `src/features/persistence/db/*`: esquema y repos con `ao_session_id`

### scripts

- `scripts/tools/tool_spawn_executor.sh`: spawn + send + mutex fragil
- `scripts/resume.sh`: resume via `ao send`
- `scripts/tools/tool_resume_executor.sh`: wrapper de resume
- `scripts/tools/tool_check_status.sh`: status consolidado via `scripts/ao-status.ts`
- `scripts/ao-status.ts`: adapter CLI de sesiones AO
- `scripts/live-monitor.ts`: monitor de sesiones AO
- `scripts/lib/ao-paths.sh`: descubrimiento de worktrees y logs AO
- `scripts/ralphito-db.ts`: lookup de chat/tarea por `ao_session_id`

### ops

- `ops/agent-orchestrator.yaml`: config canonica actual de AO
- `ops/claude/metadata-updater.sh`: usa `AO_SESSION`

### docs

- `docs/ARCHITECTURE.md`, `docs/PROJECT.md`, `docs/AUTOPILOT.md`: AO sigue declarado como runtime tecnico actual
- `docs/runbooks/qa-metadata-contract.md`: declaraba un contrato que el script real no cumplia

## Cierre real de Fase 0

1. `tool_spawn_executor.sh` ya soporta `--payload-file` ademas del modo posicional.
2. El payload estructurado ya puede transportar `project`, `prompt`, `beadPath`, `workItemKey`, `model`, `beadSpecHash`, `beadSpecVersion`, `qaConfig`.
3. Tras crear sesion, el spawn ya persiste `.ralphito-session.json` en el worktree AO para que `bd.sh`, Miron y Ricky lean metadata real.
4. `SpawnExecutorPayload` en TS ya refleja `beadSpecHash` y `beadSpecVersion`.

## Validacion ejecutada

- `bash -n scripts/tools/tool_spawn_executor.sh` -> OK
- `npx tsc --noEmit` -> OK
- smoke con `ao` mock + `AO_DATA_DIR` temporal -> OK
- confirmado: el modo `--payload-file` crea sesion y persiste `.ralphito-session.json` con `qaConfig`
- Fase 0 reubicada y revalidada en worktree dedicado `/tmp/rr-issue56-phase0`

## Riesgos vivos

1. el mutex sigue en `scripts/tools/.locks.json`
2. `ao_session_id` sigue en DB, repositorios, dashboard y summaries
3. AO sigue siendo runtime de produccion actual
4. la dependencia a `~/.agent-orchestrator` sigue viva en dashboard, resume y tooling

## Siguiente corte

Fase 1: migracion persistente `ao_session_id` -> `runtime_session_id` y repositorio neutral de sesiones de runtime. Solo dentro del worktree dedicado.
