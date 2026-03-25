# Bead: QA Pipeline Smoke Fixture
**Target Agent**: frontend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/app/**/*.ts", "docs/**/*.md", "package.json"]
[WRITE_ONLY_GLOBS]: ["src/app/qa-fixture-server.ts", "src/app/qa-pipeline-smoke.ts", "docs/specs/projects/qa-pipeline-smoke/**/*.md", "package.json"]
[BANNED_GLOBS]: ["vendor/**"]

## 2. Contexto Mínimo
Crear un smoke harness reproducible para probar Miron y Ricky aunque el repo no tenga una app frontend productiva dedicada.

## 3. Criterios de Aceptación
1. Existir un servidor fixture navegable con rutas `/`, `/login` y `/settings`.
2. El bead debe incluir `qaConfig` machine-readable para Miron y Ricky.
3. Debe existir un script que ejecute el smoke test y deje evidencia local fuera del worktree.

## 4. Instrucciones Especiales
- No tocar codigo de producto para este smoke.
- El fixture debe vivir en `src/app/` como entrypoint operativo y servir solo para validar el pipeline QA.

## 5. QA Metadata
```json
{
  "qaConfig": {
    "enableVisualQa": true,
    "shadowMode": true,
    "enableE2eQa": true,
    "e2eShadowMode": true,
    "devServerCommand": "npx tsx src/app/qa-fixture-server.ts",
    "baseUrl": "http://127.0.0.1:4173",
    "healthcheckUrl": "http://127.0.0.1:4173/health",
    "visualRoutes": ["/", "/settings"],
    "e2eRoutes": ["/", "/login", "/settings"],
    "designRuleset": "docs/specs/projects/qa-pipeline-smoke/design-rubric.md",
    "e2eProfile": "qa-pipeline-smoke",
    "evidencePath": "~/.ralphito/qa/smoke",
    "waitForSelector": "[data-ready='true']",
    "requiredSelectors": ["main", "nav", "form"],
    "loginRoute": "/login",
    "loginSelectors": {
      "user": "input[name='email']",
      "password": "input[name='password']",
      "submit": "button[type='submit']"
    },
    "visualProvider": {
      "provider": "gemini",
      "model": "gemini-2.5-pro"
    },
    "visualProviderFallbacks": [
      { "provider": "opencode", "model": "minimax-m2.7" }
    ]
  }
}
```
