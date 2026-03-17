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
