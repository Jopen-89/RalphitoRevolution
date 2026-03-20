# Bead: Persistencia de sesión y logs
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/types/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/telegram/persistence/**/*.ts"]
[BANNED_GLOBS]: ["src/features/telegram/bot.ts", "src/features/llm-gateway/**"]

## 2. Contexto Minimo
Implementar repositorios para mantener el estado de la sesión por `chatId` y registrar los logs de ejecución en `docs/automation/logs/`.

## 3. Criterios de Aceptacion
1. Debe existir un `SessionRepository` que persista el estado de la conversación (SQLite o fallback en disco).
2. Debe existir un `EvidenceLogger` que exponga métodos para escribir logs estructurados en `docs/automation/logs/`.
3. Los logs deben incluir `chatId`, `timestamp`, `action` y `status`.

## 4. Instrucciones Especiales
- Asegura que las escrituras a disco sean asíncronas pero esperables (`await`).
- Si la carpeta de logs no existe, debe crearse automáticamente.

## 5. QA Metadata
```json
{
  "qaConfig": {
    "enableVisualQa": false,
    "shadowMode": true,
    "enableE2eQa": false,
    "e2eShadowMode": false,
    "devServerCommand": "npm run dev",
    "baseUrl": "http://127.0.0.1:3000",
    "visualRoutes": [],
    "e2eRoutes": [],
    "designRuleset": "docs/specs/projects/telegram-live-final/design-rubric.md",
    "e2eProfile": "core-flow"
  }
}
```