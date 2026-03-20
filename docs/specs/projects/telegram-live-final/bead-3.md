# Bead: Coordinador autónomo
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/telegram/persistence/**/*.ts", "src/features/llm-gateway/tools/telegram-demo/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/telegram/orchestration/**/*.ts"]
[BANNED_GLOBS]: ["src/features/telegram/bot.ts"]

## 2. Contexto Minimo
El cerebro del flujo que une la intención con la acción. Orquesta la llamada a la tool, la persistencia de logs y devuelve el payload de respuesta.

## 3. Criterios de Aceptacion
1. `AutonomousCoordinator.execute(intent, chatId)` debe ejecutar la tool del gateway.
2. Debe forzar la escritura de logs a través de `EvidenceLogger` antes de resolver.
3. Debe retornar un objeto con el mensaje final para el usuario y la ruta del artefacto generado.
4. Si la tool falla, debe retornar un mensaje de error controlado y registrar el fallo.

## 4. Instrucciones Especiales
- Esta clase no debe tener dependencias de red de Telegram, es puro dominio.
- La validación de evidencia es bloqueante.

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