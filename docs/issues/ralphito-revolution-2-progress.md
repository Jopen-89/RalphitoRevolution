# Ralphito Revolution 2.0 Progress

## Completed

- [x] Fase 1 - Limpieza de peso muerto
  - [x] Eliminar residuos claros en raiz y scripts
  - [x] Alinear docs base con la estructura real actual

- [x] Fase 2 - Relocalizacion de identidades
  - [x] Mover consumo de roles a `src/core/prompt/roles/`
  - [x] Reparar wiring de Telegram para `agentRegistry`
  - [x] Eliminar referencias activas a `agents/` en servicios y scripts vivos

- [x] Fase 3 - Cerebro dinamico DB-first
  - [x] Unificar `AgentRegistry` con el contrato consumido por `server.ts`
  - [x] Sembrar `primary_provider`, `fallbacks_json`, `allowed_tools_json` y `tool_mode`
  - [x] Crear fallback `default` en `agent_registry`
  - [x] Resolver aliases de runtime y gateway sin depender de JSON/YAML legacy
  - [x] Reemplazar tests phase-3 que dependian de `gateway.config.json` y `engine-config.yaml`
  - [x] Dejar `npx tsc --noEmit` en verde
  - [x] Dejar `npm test` en verde

## Pending

- [x] Fase 4 - Manos nativas
  - [x] Migrar tools Git a TypeScript puro
  - [x] Consolidar filesystem tools con guardrails nativos

- [x] Fase 5 - Director de proyecto
  - [x] Crear `ProjectService.ts` real
  - [x] Sacar worktrees fuera del repo

- [ ] Fase 6 - Saneamiento final
  - [ ] Eliminar `scripts/` cuando ya no queden dependencias reales
  - [ ] Consolidar entrypoints finales del sistema
