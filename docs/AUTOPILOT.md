# Autopilot Architecture & Roadmap

## Contexto y Visión
Este proyecto extiende la funcionalidad base de **Agent Orchestrator (AO)** para crear un sistema autónomo de dos capas diseñado para optimizar el consumo de tokens, asegurar la calidad del código mediante guardrails locales y coordinar múltiples agentes.

- **Autopilot v1 (La Base Estricta):** Un sistema determinista que fuerza a los agentes ejecutores a seguir un flujo de trabajo innegociable ("Landing the Plane") utilizando una herramienta simulada llamada `bd`. Al interceptar el comando `bd sync`, el sistema inyecta guardrails locales (pruebas, linters basados en `git diff`) *antes* de permitir el push.
- **Autopilot v2 (El Orquestador IA):** Un sistema superior donde un "Agente Maestro" (ej. Gemini 3.1 Pro) gestiona agentes efímeros (Codex, Opencode). Los ejecutores mueren tras programar para liberar recursos y resucitan usando caché de contexto (`/resume -last`) si los guardrails locales detectan errores.

---

## Componentes Actuales

### 1. El Wrapper `bd` (`scripts/bd.sh`)
La clave de la arquitectura actual. Es un binario falso instalado en el PATH del sistema que intercepta los comandos de gestión de tareas del agente.
- Traduce comandos abstractos (`bd ready`, `bd close`) a GitHub CLI (`gh`).
- **Contrato Operativo:** `bd sync` es el unico comando de aterrizaje. Debe correr guardrails, sincronizar git y hacer push.
- **Punto de Inyección:** El comando `bd sync` es el hook donde implementaremos la Fase 2 (los Guardrails).

### 2. Reglas Estrictas (`.agent-rules.md`)
Reglas inyectadas nativamente a cada agente instanciado por AO mediante la propiedad `agentRulesFile` en `ops/agent-orchestrator.yaml`. El archivo `agent-orchestrator.yaml` en raiz se conserva como compatibilidad local. Fuerzan al agente a usar `bd` y prohiben dar por finalizado un trabajo sin un push exitoso.

## Contrato de arquitectura objetivo

- AO sigue siendo la fuente de verdad del lifecycle tecnico de sesiones y agentes.
- Ralphito necesita una capa persistente propia para memoria, trazabilidad y joins de negocio.
- La capa central objetivo de Ralphito es SQLite.
- `traceability.json` deja de ser el coordinador transaccional vivo; si se conserva, sera un snapshot derivado desde la capa persistente.
- El dashboard debe consumir interfaces estructuradas de AO y metadata Ralphito, no screen scraping.

---

## Roadmap de Implementacion (Fases)

### ✅ Fase 0: Alineacion de contrato y ownership
**Estado: COMPLETADO**
**Objetivo:** Eliminar la doble verdad entre AO, JSONs operativos y memoria volatil.
- Fijar por documentacion que AO posee el lifecycle tecnico de sesiones.
- Fijar por documentacion que SQLite Ralphito poseera conversaciones, tasks/beads, eventos, summaries e indice documental.
- Reemplazar el contrato vivo de `traceability.json` por un modelo transaccional central; si se conserva, solo como snapshot derivado.
- Ajustar roles y tooling para dejar de tratar JSONs como fuente de verdad operativa.

### ✅ Fase 1: Asentar las Bases (Configuración Estricta)
**Estado: COMPLETADO**
- Se creó `.agent-rules.md` con el flujo de "Landing the Plane".
- Se configuró `ops/agent-orchestrator.yaml` como fuente canonica para usar `agent: opencode` (preparado para Gemini/Codex) y enlazar las reglas.
- Se desarrolló e instaló el script `bd` (`scripts/bd.sh`) localmente.

### ✅ Fase 2: Autopilot v1 (Guardrails Locales y Pipeline CLI)
**Estado: COMPLETADO**
**Objetivo:** Interceptar el flujo antes del PR para correr validaciones locales según el lenguaje.
1. Modificar la sección `bd sync` del script `bd.sh`.
2. Implementar lógica para hacer `git diff --name-only origin/master...HEAD`.
3. Analizar extensiones de archivos modificados (ej. `.ts` -> `npm test`, `.rs` -> `cargo test`).
4. Si hay fallos, abortar el push y escupir el error en la terminal para que el agente ejecutor lo arregle en su próximo ciclo de iteración.

## Contrato actual de aterrizaje

El repositorio adopta `bd sync` como comando unico de cierre operativo.

- no se debe hacer `git pull --rebase` y `git push` manualmente como flujo paralelo
- `bd sync` es responsable de validar, sincronizar y empujar
- la sesion solo se considera terminada cuando `bd sync` termina con exito

### ✅ Fase 3: Autopilot v2 Parte A (Ciclo de Vida Efímero)
**Estado: COMPLETADO**
**Objetivo:** Matar al agente ejecutor (Opencode/Codex/Gemini CLI) tras la codificación para ahorrar recursos.
- Se implementó un "kill switch" en `scripts/bd.sh` que detecta la sesión `$TMUX` y ejecuta `tmux kill-window` tras un `sync` exitoso, forzando la terminación del agente para no gastar tokens en estado inactivo.

### ✅ Fase 4: Autopilot v2 Parte B (Snapshot y Resurrección - `/resume -last`)
**Estado: COMPLETADO**
**Objetivo:** Optimizar tokens recargando solo el contexto necesario.
- Se implementó la generación de `.guardrail_error.log` en el comando `bd sync`.
- Se creó el script `scripts/resume.sh` que busca el error en el worktree del agente, extrae un resumen y usa `ao send` para resucitar al agente inyectándole el error directamente, permitiendo continuar la sesión (y aprovechar el Context Caching de la API) en lugar de reiniciar un agente desde cero.

### ✅ Fase 5: Autopilot v2 Parte C (El Agente Orquestador Maestro)
**Estado: COMPLETADO**
**Objetivo:** Eliminar la interacción humana en el inicio del proceso.
- Raymon (Agente Maestro) lee el objetivo del usuario desde Telegram.
- Descubre proyectos, lee `_bead_graph.md` y spawnea múltiples Ralphitos en paralelo.
- Monitoriza asíncronamente el estado de los worktrees y notifica el progreso.

### ✅ Fase 6: Spawning Determinista (Anti-Branch Drift)
**Estado: COMPLETADO**
**Objetivo:** Erradicar la desincronización de ramas mediante el anclaje a hashes.
- Vendor (`agent-orchestrator`) parcheado para aceptar el flag `--base-ref <hash>`.
- `tool_spawn_executor.sh` inyecta el hash del commit actual en la creación del agente.
- SQLite (`agent_sessions`) persiste el `base_commit_hash` para trazabilidad absoluta.
- `bd sync` fuerza un `fetch` y `rebase origin/master` automáticos para resolver la deriva temporal de forma segura.

### ✅ Fase 7: Notificaciones Proactivas Asíncronas
**Estado: COMPLETADO**
**Objetivo:** Mantener al usuario informado sin esperas síncronas.
- El sistema recupera el `chat_id` original desde SQLite al finalizar `bd sync`.
- Envía un mensaje push a Telegram con el estado exacto de la tarea (éxito o fallo de guardrails).

### ✅ Fase 8: Cártel de QA y Comando `bd merge`
**Estado: COMPLETADO**
**Objetivo:** Implementar una barrera de calidad infranqueable antes de la integración final.
- Se separó el aterrizaje (`bd sync`) de la integración final.
- Se creó el comando `bd merge` para ejecutar validaciones bloqueantes:
  - **Miron** (Visual) actúa en shadow mode.
  - **Ricky** (E2E) actúa de forma bloqueante antes del merge.
  - **Juez** (Code Review) actúa de forma informativa.

## Estado actual de Ralphito Memory Refactor

La plataforma ya no depende del esquema original de JSONs vivos y scraping como capa principal. El estado operativo y la memoria propia de Ralphito quedaron aterrizados sobre SQLite.

### Capas ya implementadas

- SQLite como capa central para `threads`, `messages`, `agent_sessions`, `tasks`, `task_events`, `artifacts`, `session_summaries`, `documents`, `document_chunks` y `system_events`
- persistencia real de Telegram con binding `chat + agent -> ao_session_id`
- estado transaccional de tasks/beads con `traceability.json` como snapshot derivado
- integracion estructurada con AO para sesiones y dashboard
- dashboard operativo unificado en `/dashboard`
- context loader determinista para Telegram
- indice FTS5 para `src/`, `docs/` y `agents/`
- memoria de largo plazo con summaries por hilo, sesion AO y task
- health checks, metricas operativas, backups SQLite y runbook de recovery

### Superficies operativas vigentes

- `npm run db:migrate`
- `npm run search:index`
- `npm run search -- "<consulta>"`
- `npm run ops:status`
- `npm run backup:db`
- `GET /health`
- `GET /api/ops/status`
- `POST /api/ops/backup`
