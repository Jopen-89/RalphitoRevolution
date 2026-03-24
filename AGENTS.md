# RalphitoRevolution

Este repo combina producto, operacion de agentes y automatizacion local para el sistema Autopilot.

## Orden de lectura

1. Lee este archivo.
2. Lee `agents/routing.md`.
3. Segun la tarea, entra en la ruta correspondiente.

## Router rapido

- Producto y codigo: `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `src/`
- Specs y trabajo planificado: `docs/specs/`
- Operacion de agentes: `agents/`, `ops/`, `scripts/`
- Skills locales: `skills/`
- Infra vendorizada o externa: `vendor/agent-orchestrator/`; se tratara como infraestructura, no como producto

## Reglas practicas

- `src/` es solo codigo del producto
- `docs/` es documentacion humana y specs
- `agents/` contiene roles, playbooks y routing operativo
- `ops/` agrupa configuracion de runtime y orquestacion
- `scripts/` contiene wrappers y automatizacion ejecutable
- `agent-orchestrator.yaml` en raiz se mantiene como compatibilidad; la ruta canonica de config es `ops/agent-orchestrator.yaml`

## Protocolo anti autoengano

- Nunca declarar un trabajo como completo sin indicar si vive `en master`, `en rama <branch>`, `solo local` o `faltante`
- Para issues de seguimiento o validacion, empezar por una fase 0 con inventario `master | ramas | local | faltante`
- No confundir "funciona en este workspace" con "esta aterrizado"; si depende de cambios locales, hay que decirlo
- Una bead solo se considera cerrada cuando la spec canonica, la ruta esperada del codigo, la integracion y la validacion ya estan alineadas
- Las ramas laterales no son verdad canonica por defecto; cada una debe terminar `merged`, `descartada` o `pendiente de port`
- State requires location - Never say "done" or "implemented" without one of: `en master`, `en rama <branch>`, `solo local`, `faltante`.
- Done is not "works on my machine" - A manual run or local smoke test is not closure unless the result is landed in git and aligned with spec.
- Validate against an explicit baseline - Always check current branch, `git status`, and whether the result depends on tracked or untracked local changes.
- Separate implementation from integration - Code existing in a side branch, worktree or test double does not count as integrated product behavior.
- Follow-up issues start with phase 0 - First inventory `master | ramas | local | faltante` before making claims about completion.
- Bead closure uses a fixed checklist - A bead is not closed unless the spec is canonical, the code lives in the expected path, the result does not depend on unstaged local changes, validation was executed, and neighbor integration gaps are understood.
- Branches need an explicit destiny - Every branch should end as `merged`, `descartada`, or `pendiente de port`. Do not treat old side branches as canonical truth.
- Product tests must use real modules - If a test redefines coordinators, loggers or ingress locally, treat it as a harness reference, not as true end-to-end validation.
- Project status uses standard buckets - Report project state with the buckets `master | ramas | local | faltante` whenever there is integration ambiguity.
- Use conservative wording under uncertainty - Prefer `parcial`, `reutilizable`, `no aterrizado`, or `pendiente de integracion` until git + spec confirm closure.

## Git Workflow Interactivo (Interactive & Human Sessions)

- En sesiones interactivas humanas, `master` es de solo lectura para cambios de codigo; antes de editar, comprobar `git branch --show-current` y crear rama si estas en `master`
- Prohibido usar `git add .` a ciegas cuando haya multiples cambios en el worktree; usar siempre staging selectivo de los archivos del scope actual
- En trabajo interactivo, terminar significa completar el ciclo entero: validacion local, commit, push, PR, merge a `master`, actualizar `master` local y `git fetch --prune`
- Mientras un cambio siga solo en rama o sin mergear, no se declara como trabajo completo
- Los ejecutores lanzados via AO pueden seguir cerrando con `bd sync` dentro de sus worktrees aislados; esta excepcion no aplica a sesiones humanas sobre el workspace principal
- Protect `master` - `master` is read-only for code changes. Before editing code, run `git branch --show-current`. If the branch is `master`, create a new branch first (`feat/<name>` or `fix/<name>`).
- Use selective staging - Do not use `git add .` blindly when the worktree contains unrelated changes. Stage only the files that belong to the current task.
- Finish the whole landing cycle - For interactive work, "done" means all of the following: local validation passes, local commit exists, branch is pushed, pull request is created, pull request is merged to `master`, local workspace is updated.
- Do not claim completion before merge - Work that is still only local or only on a branch is not complete.

## Agent Instructions & Quick Reference

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

```bash
bd ready              # Buscar trabajo disponible
bd show <id>          # Detalles de una issue
bd update <id> --status in_progress  # Reclamar trabajo
bd close <id>         # Marcar como terminado localmente
bd sync               # Correr guardrails locales, sincronizar y push al PR
bd merge              # Ejecutar Cártel de QA (Ricky + Juez) y mergear a master
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `bd sync` termina con push exitoso.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up.
2. **Run local quality gates** (if code changed) - Tests, linters, builds.
3. **Update issue status** - Close finished work in tracking.
4. **LAND WITH `bd sync`** - MANDATORY:
   ```bash
   bd sync
   ```
5. **INTEGRATE WITH `bd merge`** (Human/Orchestrator only):
   - Una vez el PR está listo y notificado, el orquestador o el humano ejecuta `bd merge` para activar a Ricky y Juez.
6. **Clean up** - Clear stashes, prune remote branches.
7. **Verify** - All changes committed AND pushed.
8. **Hand off** - Provide context for next session.

**CRITICAL RULES:**
- Work is NOT complete until `bd sync` completes successfully and the branch is pushed.
- `bd merge` es el único punto de entrada a `master`.
- El ejecutor muere tras `bd sync`; la integración es asíncrona.

## Contract of `bd sync`

`bd sync` is the single landing command for this repo.

- runs local guardrails when needed
- performs the required git synchronization flow
- pushes the current branch to the remote
- only after success can the session be considered complete

## Equipos AO

- `backend-team`: implementacion backend y producto general
- `design-team`: discovery UX/UI, research de comportamiento y rubricas de Lola
- `frontend-team`: UI React y superficies visuales
- `visual-qa-team`: validacion visual renderizada y evidencia de Miron
- `qa-team`: tests, validacion y regresiones
- `devops-team`: runtime, CI/CD, ops y despliegue
- `security-team`: auditoria de seguridad sobre `src/**`; no escribe por defecto
- `research-team`: investigacion y contexto de mercado
- `automation-team`: RPA, formularios y automatizacion web

## Pipeline QA objetivo

- `Lola -> Poncho -> Ralphito -> Miron -> Ricky -> Juez -> Raymon`
- `Miron` bloquea `bd sync` solo para beads frontend cuando la UI renderizada no cumple la rubrica visual.
- `Ricky` bloquea merge final con validacion E2E automatica sobre rama ya aterrizada.
- `Juez` revisa diff y contrato tecnico despues del visto bueno funcional de `Ricky`.
- Referencia operativa: `docs/runbooks/qa-pipeline.md`

### No Backward Compatibility
Never write code for backward compatibility. No legacy fallbacks, no old-format deserialization shims, no deprecated type aliases. When a type or format changes, all producers and consumers change in the same task. Old data is dead.

### Specs & Architecture
IMPORTANT: Specs are the single source of truth. The current codebase may not match the specs — when there is a discrepancy, the specs are correct and the code must be updated to match. If something exists in the code but is not described in the specs, it should be removed. If the specs describe something that doesn't exist in the code yet, it needs to be implemented as specified. Specs marked as SUPERSEDED should not be implemented — any existing code matching superseded specs should be removed.

## Validacion

- TypeScript: `npx tsc --noEmit`
- Flujo local de aterrizaje: `scripts/bd.sh sync`
- Flujo de integración final: `scripts/bd.sh merge`
- `bd sync` es el comando único de aterrizaje: corre guardrails locales, sincroniza con git y hace push al PR.
- `bd merge` es el comando de cierre en master: ejecuta Ricky (E2E) y Juez (CR) antes de fusionar el código.
- `bd sync` exige worktree limpio: sin cambios unstaged ni archivos untracked.
- Reanudacion de sesion: `scripts/resume.sh <session-id>`

## Referencias

- Contexto del sistema: `docs/PROJECT.md`
- Arquitectura: `docs/ARCHITECTURE.md`

## Agent Orchestrator (ao) Session

You are running inside an Agent Orchestrator managed workspace.
Session metadata is updated automatically via shell wrappers.

If automatic updates fail, you can manually update metadata:
```bash
~/.ao/bin/ao-metadata-helper.sh  # sourced automatically
# Then call: update_ao_metadata <key> <value>
```