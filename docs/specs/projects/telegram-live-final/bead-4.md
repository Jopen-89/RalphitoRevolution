# Bead: Integración del loop del bot
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/telegram/orchestration/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/telegram/bot.ts", "src/features/telegram/ingress/**/*.ts"]
[BANNED_GLOBS]: ["src/features/llm-gateway/**"]

## 2. Contexto Minimo
Conectar el bot de Telegram existente con el nuevo `AutonomousCoordinator`.

## 3. Criterios de Aceptacion
1. `bot.ts` debe interceptar mensajes y pasarlos al coordinador.
2. Solo debe responder a Telegram cuando el coordinador retorne éxito o fallo controlado.
3. El mensaje de respuesta debe incluir el texto del resultado y la ruta relativa de la evidencia.

## 4. Instrucciones Especiales
- Mantén `bot.ts` lo más delgado posible. Su única responsabilidad es I/O.
- Maneja excepciones no controladas para evitar que el bot se caiga, respondiendo con un mensaje genérico de degradación.

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