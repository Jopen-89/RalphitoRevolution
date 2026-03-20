# TELEGRAM LIVE FINAL LANDING PLAN

## Objetivo

Mover el trabajo actual de `telegram-live-final` desde `solo local` a un estado aterrizable sin mezclarlo con otros cambios locales del workspace.

## Estado actual

- `bead-1`: en `master`
- `bead-2`: solo local
- `bead-3`: solo local
- `bead-4`: solo local
- `bead-5`: solo local

## Riesgo principal

El workspace contiene mucho trabajo local no relacionado. No es seguro hacer `git add .` ni preparar un commit grande desde este estado.

## Alcance exacto a aterrizar para telegram-live-final

### Archivos de producto de esta tanda

- `src/features/telegram/conversationStore.ts`
- `src/features/telegram/bot.ts`
- `src/features/telegram/ingress/autonomousCoordinatorLoop.ts`
- `src/features/telegram/orchestration/autonomousCoordinator.ts`
- `src/features/telegram/orchestration/evidenceLogger.ts`
- `src/features/telegram/orchestration/gatewayToolExecutor.ts`
- `src/features/telegram/orchestration/index.ts`
- `src/features/telegram/persistence/evidenceLogger.ts`
- `src/features/telegram/persistence/index.ts`
- `src/features/telegram/persistence/sessionRepository.ts`
- `src/features/telegram/__tests__/live-flow.e2e.test.ts`

### Documentacion de control creada en esta sesion

- `docs/issues/telegram-live-final-phase-0-audit.md`
- `docs/issues/telegram-live-final-landing-plan.md`

### Reglas operativas opcionales para commit separado

- `.agent-rules.md`
- `AGENTS.md`

Estas reglas son valiosas, pero no forman parte estricta del producto `telegram-live-final`. Conviene aterrizarlas en un commit separado para no mezclar feature y proceso.

## Archivos que NO deben entrar en este aterrizaje

Aunque esten modificados en el workspace, no forman parte del cierre actual de `telegram-live-final`:

- `src/features/telegram/agentRegistry.ts`
- `src/features/telegram/chatExecutor.ts`
- `src/features/telegram/executor.ts`
- `src/features/telegram/orchestrationExecutor.ts`
- `src/features/telegram/divergenceContext.ts`
- `src/features/telegram/projectRouting.ts`
- cambios amplios en `scripts/**`, `src/features/qa/**`, `src/features/llm-gateway/**`, `docs/runbooks/**`, `vendor/**`

## Estrategia de aterrizaje recomendada

### Fase A - Aislar en rama propia

1. Crear rama dedicada desde el estado actual del workspace.
2. Preparar solo los archivos listados en "Archivos de producto de esta tanda".
3. No incluir cambios ajenos del workspace.

### Fase B - Commit de producto

Objetivo del commit:

- bead-2: persistencia de sesion y logs
- bead-3: coordinador autonomo
- bead-4: integracion del loop del bot
- bead-5: test E2E real del flujo

### Fase C - Commit de proceso

Si se desea aterrizar tambien el protocolo anti autoengano, hacerlo en un commit aparte con:

- `.agent-rules.md`
- `AGENTS.md`

### Fase D - Validacion previa a landing

Ejecutar como minimo:

- `npx tsc --noEmit`
- `node --import tsx --test src/features/telegram/__tests__/live-flow.e2e.test.ts`

### Fase E - Landing real

1. Verificar `git status`
2. Confirmar que solo hay staged changes del alcance correcto
3. Crear commit(s)
4. Ejecutar `scripts/bd.sh sync` cuando el worktree ya este limpio y el commit sea coherente
5. Validar despues si queda `en rama` o `en master`

## Comandos sugeridos

```bash
git switch -c feat/telegram-live-final-closeout

git add \
  src/features/telegram/conversationStore.ts \
  src/features/telegram/bot.ts \
  src/features/telegram/ingress/autonomousCoordinatorLoop.ts \
  src/features/telegram/orchestration/autonomousCoordinator.ts \
  src/features/telegram/orchestration/evidenceLogger.ts \
  src/features/telegram/orchestration/gatewayToolExecutor.ts \
  src/features/telegram/orchestration/index.ts \
  src/features/telegram/persistence/evidenceLogger.ts \
  src/features/telegram/persistence/index.ts \
  src/features/telegram/persistence/sessionRepository.ts \
  src/features/telegram/__tests__/live-flow.e2e.test.ts \
  docs/issues/telegram-live-final-phase-0-audit.md \
  docs/issues/telegram-live-final-landing-plan.md

npx tsc --noEmit
node --import tsx --test src/features/telegram/__tests__/live-flow.e2e.test.ts
```

Si tambien se aterrizan reglas operativas:

```bash
git add .agent-rules.md AGENTS.md
```

## Criterio de salida

La fase `local -> rama` queda lista cuando:

- existe una rama dedicada
- el diff staged solo contiene archivos de `telegram-live-final`
- bead-2/3/4/5 pasan validacion tecnica
- no depende de incluir cambios no relacionados del workspace

La fase `rama -> master` queda lista cuando:

- el aterrizaje via `bd sync` o flujo equivalente termina bien
- el estado deja de ser `solo local`
- se puede reportar honestamente como `en rama <branch>` o `en master`
