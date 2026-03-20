# Bead: Gateway tools y contrato de evidencia
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/llm-gateway/types/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/llm-gateway/tools/telegram-demo/**/*.ts"]
[BANNED_GLOBS]: ["src/features/telegram/**"]

## 2. Contexto Minimo
Definir la herramienta específica que el agente usará para generar la acción verificable (escribir un archivo con timestamp) y su contrato de metadata.

## 3. Criterios de Aceptacion
1. Debe existir una tool `writeEvidenceTool` registrada en el gateway.
2. La tool debe retornar metadata estructurada (ej. `filePath`, `bytesWritten`, `success`).
3. La tool debe fallar de forma controlada si faltan permisos o rutas.

## 4. Instrucciones Especiales
- La herramienta solo debe permitir escrituras dentro de `docs/automation/evidence/`.
- No acoples esta tool a Telegram, es puramente de gateway.

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