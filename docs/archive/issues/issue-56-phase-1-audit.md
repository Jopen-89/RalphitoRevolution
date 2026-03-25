# ISSUE 56 PHASE 1 AUDIT

## Objetivo

Mover el estado operativo de sesiones a contrato canonico `runtime_session_id`, preparar lifecycle real en SQLite y dejar listo el repositorio base del engine.

## Estado real

### master

- `master` sigue sin Fase 1
- AO sigue siendo runtime tecnico actual

### ramas

- rama activa de Fase 1: `jopen/issue-56-phase0-wt`
- worktree dedicado: `/tmp/rr-issue56-phase0`
- destino: pendiente de port/merge; no canonica aun

### local

- worktree dedicado limpio salvo cambios de esta fase
- el workspace principal mantiene un untracked ajeno al scope: `docs/specs/projects/cv-enhancer/`

### faltante

- lock repository real y colision por ancestro/descendiente
- worktree manager propio
- supervisor/executor loop
- cutover de dashboard/scripts fuera de AO
- limpieza final AO/vendor

## Cierre real de Fase 1

1. `agent_sessions` migra a `runtime_session_id` y soporta lifecycle real: `worktree_path`, `pid`, `step_count`, `max_steps`, `started_at`, `heartbeat_at`, `finished_at`, `failure_kind`, `failure_summary`, `failure_log_tail`.
2. `agent_sessions` deja de colapsar historial por `thread_id + agent_id`; ahora el id unico canonico es `runtime_session_id`.
3. `tasks` migra a `runtime_session_id`.
4. SQLite crea `runtime_locks` con indexes base para la Fase 2.
5. Se crea [runtimeSessionRepository.ts](/tmp/rr-issue56-phase0/src/features/engine/runtimeSessionRepository.ts) con `create`, `heartbeat`, `attachPid`, `incrementStepCount`, `fail`, `finish`, `markStuck`, `getByRuntimeSessionId`, `listActive`.
6. Consumidores SQL/TS ya leen y escriben `runtime_session_id` en tasks, dashboard, memoria, observabilidad, Telegram y CLIs.

## Validacion ejecutada

- `npx tsc --noEmit` -> OK
- smoke DB nueva -> OK
- smoke migracion DB existente -> OK
- smoke `RuntimeSessionRepository` -> OK

## Riesgos vivos

1. `runtime_locks` existe pero aun no tiene `lockRepository`
2. AO sigue siendo fuente tecnica de status/spawn/resume
3. dashboard y observabilidad aun mezclan AO + SQLite

## Siguiente corte

Fase 2: locking real por path resuelto, colision ancestro/descendiente, worktree manager y cleanup/reaper.
