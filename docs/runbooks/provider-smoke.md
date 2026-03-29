# Provider Smoke

Smoke reproducible para los providers criticos del gateway.

## Cobertura

- `gemini`: `chat`, `tool-calling`
- `openai`: `chat`, `tool-calling`
- `opencode`: `chat`, `tool-calling`
- `codex`: `chat`

Los modelos usados salen de la matriz oficial en `src/gateway/providers/providerCatalog.ts`.

## Ejecutar

1. Arranca el gateway con `npm run start:gateway` o `npm start`.
2. Ejecuta `npm run smoke:providers`.

## Configurar perfiles Codex

- `providerProfile` sigue siendo solo para el provider `codex` en ruta chat/smoke.
- `executionProfile` es aparte y aplica al harness `codex` en runtime.
- Perfiles previstos: `jopen` y `martapa`.
- Variables soportadas por perfil:
  - `CODEX_PROFILE_JOPEN_HOME`
  - `CODEX_PROFILE_JOPEN_OPENCODE_HOME`
  - `CODEX_PROFILE_JOPEN_XDG_CONFIG_HOME`
  - `CODEX_PROFILE_JOPEN_XDG_DATA_HOME`
  - `CODEX_PROFILE_JOPEN_XDG_STATE_HOME`
  - `CODEX_PROFILE_JOPEN_ENV_JSON`
- Repite el mismo patron para `MARTAPA`.
- `providerProfile` se persiste por agente en `agent_registry.provider_profile`.
- `executionProfile` se persiste por agente en `agent_registry.execution_profile`.

## Comportamiento

- Si un provider aparece `available`, el smoke lo ejecuta de verdad contra `POST /api/providers/smoke`.
- Si un provider no esta disponible, el smoke lo marca `skipped` con los checks de readiness actuales.
- Si un provider sale `available` pero el smoke falla, el comando termina con exit code `1`.

## Fuente de verdad

- Estado operativo: `GET /api/providers/status`
- Ejecucion smoke: `POST /api/providers/smoke`
- Matriz oficial: `src/gateway/providers/providerCatalog.ts`

## Estado actual

- Validado en smoke live: `gemini`, `codex`, `opencode/minimax`
- `openai` no esta validado operativamente ahora mismo por error de cuota `429`
- La doble ruta Codex ya esta preparada en codigo via `providerProfile` (`jopen` / `martapa`)
- Pendiente operativo: validar cada perfil Codex con credenciales/sesion reales
