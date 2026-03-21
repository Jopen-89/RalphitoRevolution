# ISSUE 56 PHASE 4 AUDIT

## Objetivo

Cerrar paridad operativa y corte seco: dashboard, status, resume, diff, observabilidad y QA sobre Ralphito Engine, sin depender de AO en el path principal.

## Estado real

### master

- `master` sigue sin Fase 4
- AO y vendor siguen presentes fuera del path principal

### ramas

- rama activa: `jopen/issue-56-phase-0`
- destino: pendiente de commit/push/port; no canonica aun

### local

- Fase 4 implementada solo local en este workspace
- `scripts/engine-status.ts` reemplaza `scripts/ao-status.ts`
- `scripts/lib/runtime-paths.sh` reemplaza `scripts/lib/ao-paths.sh`
- `resume`, `tool_check_status`, `tool_get_diff`, `tool_resume_executor` ya resuelven worktrees/logs del engine propio
- dashboard y ops status ya leen sesiones recientes del engine, no AO adapter
- `tool_check_status.sh` ya detecta `session_id` correcto desde `.agent-worktrees/<id>`
- QA ya toma tipos desde `src/features/engine/qaConfig.ts`
- QA ya deja evidencia por defecto en `~/.ralphito/qa/*`, no en `~/.agent-orchestrator/*`

### faltante

- limpieza final `src/features/ao/`
- limpieza de wrappers/docs/config residual AO
- eliminacion de `vendor/agent-orchestrator/`

## Cierre real de Fase 4

1. `getEngineSessionsStatus` ya expone sesiones recientes, incluidas terminales, con metadata util para dashboard/live-monitor.
2. `dashboardService` y `observabilityService` ya leen solo Ralphito Engine + SQLite.
3. `engine-status.ts` reemplaza la superficie legacy `ao-status.ts`.
4. `runtime-paths.sh` deja el path principal atado solo a `.agent-worktrees/`.
5. `tool_check_status.sh` deja de parsear rutas AO y ya encuentra bien guardrails del engine.
6. dashboard actualiza copy/contadores al contrato real `queued | running | done | failed | cancelled | stuck`.
7. QA deja de colgar tipos de `src/features/ao/` y mueve evidencia default a `~/.ralphito/qa`.

## Validacion ejecutada

- `npx tsc --noEmit` -> OK
- `node --import tsx --test src/features/engine/runtimePhase2.test.ts` -> OK
- `node --import tsx --test src/features/engine/runtimePhase3.test.ts` -> OK
- `node --import tsx --test src/features/engine/runtimePhase4.test.ts` -> OK
- `bash -n scripts/resume.sh` -> OK
- `bash -n scripts/tools/tool_check_status.sh` -> OK
- `bash -n scripts/tools/tool_get_diff.sh` -> OK
- `bash -n scripts/tools/tool_resume_executor.sh` -> OK

## Riesgos vivos

1. `ops/agent-orchestrator.yaml` sigue siendo config canonica mientras no entre Fase 5
2. `src/features/ao/` aun existe, aunque ya no esta en el path principal F4
3. `gateway-dashboard.ts` y docs viejas aun conservan terminologia AO

## Siguiente corte

Fase 5: limpieza final de AO, vendor y docs residuales.
