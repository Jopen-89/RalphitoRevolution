# TELEGRAM LIVE FINAL PHASE 0 AUDIT

## Objetivo

Congelar el estado real antes de seguir con la issue #23 y separar cuatro cosas que ahora mismo estan mezcladas:

- lo que ya vive en `master`
- lo que solo existe en ramas laterales
- lo que solo existe como cambios locales sin commit en este workspace
- lo que no existe todavia y sigue siendo trabajo pendiente

## Estado de `master`

`master` contiene el set canonico de specs de `telegram-live-final`:

- `docs/specs/projects/telegram-live-final/Unified-PRD.md`
- `docs/specs/projects/telegram-live-final/architecture-design.md`
- `docs/specs/projects/telegram-live-final/_bead_graph.md`
- `docs/specs/projects/telegram-live-final/bead-1.md`
- `docs/specs/projects/telegram-live-final/bead-2.md`
- `docs/specs/projects/telegram-live-final/bead-3.md`
- `docs/specs/projects/telegram-live-final/bead-4.md`
- `docs/specs/projects/telegram-live-final/bead-5.md`

En `master` ya estan:

- `writeEvidenceTool` y su registro en gateway
- `TelegramStateRepository` para estado de conversacion
- el flujo de Raymon para descubrir beads y lanzar Ralphitos

En `master` no estan:

- `src/features/telegram/orchestration/**`
- `src/features/telegram/ingress/autonomousCoordinatorLoop.ts`
- `src/features/telegram/__tests__/live-flow.e2e.test.ts`
- `docs/automation/logs/`
- `docs/specs/projects/telegram-live-final/design-rubric.md`

## Cambios locales del workspace

Este workspace no esta limpio. Hay mucho trabajo operativo y QA sin aterrizar.

Impacto directo sobre `telegram-live-final`:

- cambios tracked en `src/features/telegram/bot.ts`
- cambios tracked en `src/features/telegram/orchestrationExecutor.ts`
- cambios tracked en `src/features/llm-gateway/tools/toolRegistry.ts`
- cambios tracked en `src/features/llm-gateway/tools/telegram-demo/index.ts`
- cambios tracked/untracked en scripts y QA (`scripts/**`, `src/features/qa/**`, `docs/runbooks/**`)

Conclusiones de fase 0:

- `npx tsc --noEmit` pasa en este workspace, pero no demuestra que `master` este limpio por si solo
- el typecheck pasa apoyandose en cambios locales no committeados en el gateway/tooling
- no es seguro hacer merge directo de ramas antiguas sobre este workspace sin integrar primero esos cambios locales

## Ramas laterales auditadas

### 1. `feature/bead-3-autonomous-coordinator`

Tip actual: `d807264` `feat: add telegram autonomous coordinator`

Archivos utiles que aporta:

- `src/features/telegram/orchestration/autonomousCoordinator.ts`
- `src/features/telegram/orchestration/evidenceLogger.ts`
- `src/features/telegram/orchestration/gatewayToolExecutor.ts`
- `src/features/telegram/orchestration/index.ts`

Tambien mete evidencia en repo:

- `docs/automation/evidence/evidence_2026-03-20T01-06-31-365Z.txt`
- `docs/automation/logs/bead-3-fail_writeEvidence_failure_2026-03-20T01-06-54-987Z.json`
- `docs/automation/logs/bead-3-smoke_writeEvidence_success_2026-03-20T01-06-31-365Z.json`

Veredicto:

- la logica del coordinador es reutilizable
- la evidencia generada no debe aterrizarse como parte del producto
- la rama fue creada sobre `master`, asi que no borra las specs actuales
- requiere adaptacion al `toolRegistry.ts` actual del workspace antes de aterrizar

### 2. `feat/telegram-live-bot-loop`

Tip actual: `08d98c8` `feat(telegram): route bot execution through coordinator loop`

Archivos utiles que aporta:

- `src/features/telegram/ingress/autonomousCoordinatorLoop.ts`
- cambios en `src/features/telegram/bot.ts`

Problema estructural detectado:

- esta rama parte de una base anterior a las specs actuales y por eso elimina `docs/specs/projects/telegram-live-final/*` al comparar contra `master`
- redirige cualquier `isExplicitExecutionIntent(...)` al coordinator loop
- eso mezcla la ejecucion del producto Telegram con la orquestacion actual de Raymon para lanzar Ralphitos

Veredicto:

- la idea del ingress es util
- el diff no es mergeable tal cual
- hay que portar el loop e integrar el routing a mano dentro del `bot.ts` actual

### 3. `feat/telegram-live-final-bead-5-e2e`

Tip actual: `14250f3` `test: add telegram live flow e2e coverage`

Archivo util que aporta:

- `src/features/telegram/__tests__/live-flow.e2e.test.ts`

Problema estructural detectado:

- el test usa la tool real, pero redefine dentro del propio test un coordinator, un logger y un ingress harness
- por tanto no valida el wiring real del producto en `src/features/telegram/`

Veredicto:

- sirve como referencia de harness y de casos happy/failure
- no cierra bead-5 segun el contrato estricto del proyecto

### 4. `jopen/be-33-bead-2`

Tip actual: `595a7a1` `docs: refresca evidencia bead-2`

Diff relevante frente a `master`:

- no introduce `EvidenceLogger`
- no introduce `src/features/telegram/persistence/**`
- toca `toolRegistry.ts`, `telegram-demo/index.ts`, scripts AO y docs/evidencia
- parte de una base anterior a las specs actuales y por eso tambien aparece borrando varias specs al comparar contra `master`

Veredicto:

- no completa bead-2
- no debe tratarse como rama fuente para la implementacion final del logger

## Viabilidad de la fase 0

La fase 0 es viable y queda cerrada si se acepta este inventario como baseline operativo.

### Hechos ya comprobados

- las specs canonicas de `telegram-live-final` estan en `master`
- bead-3 existe como rama reutilizable, no como codigo aterrizado
- bead-4 existe como rama reutilizable, pero con routing demasiado agresivo
- bead-5 existe como branch de referencia, pero no como E2E real del producto
- bead-2 sigue incompleto incluso contando ramas laterales
- el workspace actual tiene cambios locales que afectan directamente al area de integracion

### Riesgos abiertos

- intentar cherry-pick limpio de `feat/telegram-live-bot-loop` o `jopen/be-33-bead-2` borraria specs o chocaria con cambios locales
- integrar bead-3 sin adaptar el gateway actual puede romper el `toolRegistry.ts` ampliado del workspace
- dar por bueno bead-5 tal cual dejaria un falso positivo de cobertura E2E

## Orden recomendado despues de fase 0

1. congelar el baseline y no asumir que `master` == estado validado
2. aterrizar bead-3 portando solo `src/features/telegram/orchestration/**` y descartando evidencia generada
3. completar bead-2 de verdad alrededor del logger y decidir si vive en `persistence` o en `orchestration` sin romper la spec
4. integrar bead-4 a mano sobre el `bot.ts` actual, preservando el flujo de Raymon para `spawn_executors_from_beads`
5. reescribir bead-5 para que importe los modulos reales del producto en vez de redefinirlos en el test
6. solo despues validar Ricky/Juez y el comando final de Raymon

## Salida de fase 0

Baseline aceptado:

- `master` no representa aun el cierre de la issue #23
- la mayor parte del trabajo aprovechable vive en ramas separadas o cambios locales no aterrizados
- la siguiente fase segura es integrar bead-3 primero, no lanzar QA final todavia
