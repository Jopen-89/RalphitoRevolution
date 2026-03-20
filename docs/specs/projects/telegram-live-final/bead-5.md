# Bead: Tests E2E del flujo completo
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/telegram/__tests__/live-flow.e2e.test.ts"]
[BANNED_GLOBS]: []

## 2. Contexto Minimo
Suite de pruebas que valida que el ciclo completo (Ingress -> Coordinador -> Tool -> Persistencia -> Respuesta) funciona y deja rastros en disco.

## 3. Criterios de Aceptacion
1. Test de Happy Path: Simular un mensaje de Telegram y verificar que se crea el archivo de evidencia en `docs/automation/evidence/`.
2. Test de Fallo: Forzar un error en la tool y verificar que se registra en `docs/automation/logs/` y se responde adecuadamente.
3. Los tests deben limpiar los archivos generados después de ejecutarse.

## 4. Instrucciones Especiales
- Usa mocks solo para la API de Telegram. El resto del sistema (Coordinador, Gateway, Persistencia) debe ser real.
- Verifica explícitamente la existencia de los archivos usando `fs.existsSync`.

## 5. QA Metadata
```json
{
  "qaConfig": {
    "enableVisualQa": false,
    "shadowMode": true,
    "enableE2eQa": true,
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