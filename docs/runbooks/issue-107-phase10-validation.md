# Issue 107 Fase 10: validacion final

## Objetivo

Cerrar el refactor validando 4 cosas:

- config por agente cambia sin redeploy
- sesiones vivas conservan snapshot
- pipeline `ExecutionJob -> Runtime -> Review` llega a `done|failed`
- docs/ops ya no empujan al spawn legacy directo

## Precondiciones

- rama: `jopen/agent-registry-execution-refactor`
- task y bead persistidos
- providers listos segun credenciales reales
- si se prueba `codex`, perfiles `CODEX_PROFILE_*` cargados

## Baseline automatizable

```bash
npx tsc --noEmit
node --import tsx --test --test-concurrency=1 src/infrastructure/persistence/db/migrations.test.ts src/core/services/ExecutionPipelineService.test.ts src/core/services/ExecutionReviewService.test.ts src/core/services/ReviewScheduler.test.ts src/core/services/ExecutionJobScheduler.test.ts src/core/engine/orchestrator.test.ts src/gateway/tools/raymonTools.test.ts src/interfaces/dashboard/dashboardService.test.ts src/interfaces/dashboard/dashboardPage.test.ts
```

## Smoke live

1. Ver readiness y catalogo vivo.

```bash
node --import tsx src/app/gateway-dashboard.ts
```

2. Leer config actual del agente.

```bash
node --import tsx src/app/ralphito-agents.ts get default
```

3. Cambiar config de una sesion nueva sin redeploy.

```bash
node --import tsx src/app/ralphito-agents.ts set default primaryProvider openai model gpt-5.4 executionHarness codex executionProfile jopen toolMode allowed allowedTools finish_task,submit_for_review
```

4. Confirmar que el dashboard/API refleja `Registry now`.

```bash
curl -fsS http://127.0.0.1:3000/api/agents
curl -fsS http://127.0.0.1:3000/api/dashboard/sessions
```

5. Encolar una task canonica via Raymon. Payload minimo esperado por `spawn_session`:

```json
{
  "project": "backend-team",
  "taskId": "<task-id-persistido>",
  "beadPath": "<ruta-bead>",
  "prompt": "Implementa <task-id-persistido>"
}
```

6. Arrancar claims pendientes.

```bash
node --import tsx src/core/engine/cli.ts poll-execution-jobs 1
```

7. Mientras la sesion viva corre, cambiar otra vez `agent_registry`. La evidencia correcta es:

- la sesion actual conserva `Snapshot`
- `Registry now` cambia
- el runtime no relee config viva para esa sesion

8. Cuando el job llegue a review, procesarlo.

```bash
node --import tsx src/core/engine/cli.ts poll-review-jobs 1
```

9. Revisar evidencia final en dashboard/API.

```bash
curl -fsS http://127.0.0.1:3000/api/dashboard/sessions/<runtimeSessionId>
```

Debe verse:

- `Snapshot` y `Registry now`
- review `status/provider/model/summary`
- `flag=same_signature_review` si Juez no pudo cambiar firma
- ultimo guardrail si existio

## Checks legacy

```bash
node --import tsx src/core/engine/cli.ts spawn-session
rg -n "spawn-session|status / resume-session" docs/ENGINE_FASES.md docs/ESQUEMASGRAFICOS docs/AGENT_OFFICE_ARCHITECTURE_AND_PLAN.md
```

Resultado esperado:

- `spawn-session` falla ruidoso y manda al pipeline canon
- docs operativas ya no venden spawn directo legacy

## Cierre

Fase 10 queda lista cuando:

- config editable y visible sin redeploy
- sesion viva conserva snapshot
- job simple llega a `review` y luego `done|failed`
- review usa firma alterna o deja marca explicita
- no quedan docs operativas apuntando al flujo viejo
