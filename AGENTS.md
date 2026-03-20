# RalphitoRevolution

Este repo combina producto, operacion de agentes y automatizacion local para el sistema Autopilot.

## Orden de lectura

1. Lee este archivo.
2. Lee `agents/routing.md`.
3. Segun la tarea, entra en la ruta correspondiente.
4. Si vas a ejecutar o cerrar trabajo, aplica `/.agent-rules.md`.

## Router rapido

- Producto y codigo: `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `src/`
- Specs y trabajo planificado: `docs/specs/`
- Operacion de agentes: `agents/`, `ops/`, `scripts/`, `.agent-rules.md`
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

## Git Workflow Interactivo

- En sesiones interactivas humanas, `master` es de solo lectura para cambios de codigo; antes de editar, comprobar `git branch --show-current` y crear rama si estas en `master`
- Prohibido usar `git add .` a ciegas cuando haya multiples cambios en el worktree; usar siempre staging selectivo de los archivos del scope actual
- En trabajo interactivo, terminar significa completar el ciclo entero: validacion local, commit, push, PR, merge a `master`, actualizar `master` local y `git fetch --prune`
- Mientras un cambio siga solo en rama o sin mergear, no se declara como trabajo completo
- Los ejecutores lanzados via AO pueden seguir cerrando con `bd sync` dentro de sus worktrees aislados; esta excepcion no aplica a sesiones humanas sobre el workspace principal

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
- `bd sync` es el comando unico de aterrizaje: corre guardrails, sincroniza con git y hace push
- `bd sync` exige worktree limpio: sin cambios unstaged ni archivos untracked
- Reanudacion de sesion: `scripts/resume.sh <session-id>`

## Referencias

- Reglas estrictas: `.agent-rules.md`
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
