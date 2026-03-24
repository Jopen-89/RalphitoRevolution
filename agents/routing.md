# Routing de agentes

Usa este router para caer rapido en el contexto correcto.

## Si tocas producto

Lee en este orden:

1. `docs/PROJECT.md`
2. `docs/ARCHITECTURE.md`
3. `docs/specs/` si la tarea viene de una spec
4. `src/`

Foco:

- `src/features/` para vertical slices
- mocks e interfaces de una feature junto a la propia feature

## Si tocas flujo de agentes u operacion

Lee en este orden:

1. `AGENTS.md`
2. `docs/AUTOPILOT.md`
3. `agents/`
4. `ops/`
5. `scripts/`

Foco:

- roles en `agents/roles/`
- playbooks en `agents/playbooks/`
- configuracion y hooks en `ops/`
- wrappers ejecutables en `scripts/`

## Si tocas una skill local

Lee en este orden:

1. `skills/README` si existe
2. `skills/<skill>/SKILL.md`
3. refs o documentos auxiliares de la skill

## Si tocas infraestructura externa o vendorizada

Solo entra si la tarea lo exige de forma explicita.

- `vendor/agent-orchestrator/` es infraestructura integrada localmente
- no lo trates como parte del producto principal salvo que la tarea sea sobre la integracion con AO
