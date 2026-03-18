# ADR: Current vs Target Architecture

## Status

Accepted.

## Context

Ralphito hoy mezcla varias fuentes de estado operativo:

- `ops/runtime/telegram/state.json` guarda conversaciones, reply routing, agente activo e historial reciente.
- `traceability.json` actua como coordinador vivo para el progreso de beads.
- scripts como `scripts/live-monitor.ts` y `scripts/tools/tool_check_status.sh` dependen de parsear salida de CLI o de mutar JSONs.
- AO ya es el runtime real de sesiones, pero Ralphito no tiene una capa persistente propia para memoria, trazabilidad y joins de negocio.

Esto crea doble verdad, riesgo de corrupcion por concurrencia y una base fragil para dashboard, memoria persistente y contexto enriquecido desde Telegram.

## Decision

Se adopta una arquitectura con ownership explicito:

- AO es la fuente de verdad del lifecycle tecnico de sesiones y agentes.
- SQLite Ralphito es la fuente de verdad de estado operativo y memoria propia de Ralphito.

SQLite concentrara:

- conversaciones y mensajes
- relacion chat/agente/sesion AO
- tasks y beads
- eventos operativos append-only
- artifacts y summaries persistentes
- indice documental y de codigo

El Gateway pasa a ser el punto de ensamblado de contexto. El bot de Telegram pasa a ser un cliente conversacional con memoria persistente. El dashboard debe leer interfaces estructuradas de AO y metadata de SQLite, no screen scraping.

## Ownership por entidad

### AO

- session id
- status y activity de sesion
- branch/worktree
- timestamps de lifecycle de sesion
- PR y metadata tecnica asociada a la sesion
- envio de mensajes a sesiones vivas

### SQLite Ralphito

- threads de Telegram u otros canales
- messages y message routes
- active agent y fingerprints anti-duplicado
- binding `thread + logical agent -> ao_session_id`
- tasks/beads, status y ownership
- task events y errores operativos
- session summaries y memoria de largo plazo
- indice `documents`, `document_chunks` y FTS

## Decision sobre `traceability.json`

`traceability.json` deja de ser un mecanismo vivo de coordinacion transaccional.

Decision final:

- no se edita a mano
- no se usa como fuente de verdad operativa
- si se conserva, sera un snapshot derivado desde SQLite con fines documentales

Hasta que la capa SQLite este implementada, cualquier referencia existente a `traceability.json` se considera deuda a retirar, no contrato objetivo.

## Consecuencias

- `conversationStore.ts` debe migrar de `state.json` a SQLite.
- Poncho deja de generar `traceability.json` como coordinador obligatorio; en su lugar define tasks/beads y ownership sobre la capa central.
- Tracker deja de actualizar progreso mediante scripts que mutan JSON; debe leer estado transaccional desde SQLite.
- `tool_check_status.sh`, `tool_update_traceability.sh` y el tooling relacionado deben migrar a consultas/escrituras estructuradas.
- dashboards y monitores deben integrar AO de forma estructurada en vez de parsear stdout.

## Alternativas descartadas

### Mantener `traceability.json` como verdad operativa

Descartado por riesgo de concurrencia, mutaciones fragiles y duplicacion de estado.

### Guardar memoria solo en AO

Descartado porque AO no es la capa de memoria y negocio de Ralphito; su dominio es el runtime de sesiones.

### Saltar directamente a embeddings o RAG semantico

Descartado para la primera iteracion. Primero se resuelve persistencia, trazabilidad y retrieval determinista/FTS.
