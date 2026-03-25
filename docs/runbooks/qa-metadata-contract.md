# QA Metadata Contract

## Objetivo

Definir el contrato machine-readable que acompana a una sesion o bead cuando una feature necesita QA visual o E2E automatizado.

## Campo canonico

El payload estructurado de una sesion runtime acepta un objeto `qaConfig`.

```json
{
  "project": "frontend-team",
  "prompt": "Implementa el bead...",
  "beadPath": "docs/specs/projects/foo/beads/bead-1-home.md",
  "qaConfig": {
    "enableVisualQa": true,
    "shadowMode": true,
    "enableE2eQa": true,
    "e2eShadowMode": true,
    "devServerCommand": "npm run dev",
    "baseUrl": "http://127.0.0.1:3000",
    "healthcheckUrl": "http://127.0.0.1:3000/",
    "visualRoutes": ["/", "/settings"],
    "e2eRoutes": ["/", "/login", "/settings"],
    "designRuleset": "docs/specs/projects/foo/design-rubric.md",
    "e2eProfile": "core-auth",
    "evidencePath": "~/.ralphito/qa/visual",
    "waitForSelector": "[data-ready='true']",
    "requiredSelectors": ["main", "form"],
    "loginRoute": "/login",
    "loginSelectors": {
      "user": "input[name='email']",
      "password": "input[name='password']",
      "submit": "button[type='submit']"
    },
    "waitForMs": 1500,
    "viewport": {
      "width": 1440,
      "height": 1100
    }
  }
}
```

## Semantica de campos

- `enableVisualQa`: activa a Miron para la sesion.
- `shadowMode`: si es `true`, Miron reporta pero no bloquea.
- `enableE2eQa`: activa a Ricky para la sesion.
- `e2eShadowMode`: si es `true`, Ricky reporta pero no bloquea.
- `devServerCommand`: comando para levantar la app local antes de capturar.
- `baseUrl`: URL base que Playwright debe abrir.
- `healthcheckUrl`: endpoint o URL de readiness; si falta, se usa `baseUrl`.
- `visualRoutes`: rutas concretas a capturar en modo visual.
- `e2eRoutes`: rutas que Ricky debe recorrer durante el smoke E2E.
- `requiredSelectors`: selectores que deben existir para considerar la pantalla cargada funcionalmente.
- `loginRoute`: ruta de login cuando el flujo requiere autenticacion.
- `loginSelectors`: selectores para usuario, password y submit del login.
- `designRuleset`: ruta al documento que contiene la rubrica visual de Lola.
- `e2eProfile`: perfil funcional esperado para Ricky en la etapa pre-merge.
- `evidencePath`: directorio externo al repo donde guardar screenshots y reportes.
- `waitForSelector`: selector opcional que indica que la UI ya esta lista.
- `waitForMs`: espera extra antes de capturar.
- `viewport`: tamano del navegador para la evidencia.
- `visualProvider`: proveedor y modelo primario para evaluacion visual (Miron). Ejemplo: `{ provider: "gemini", model: "gemini-2.5-pro" }`. Si no se especifica y no hay fallbacks, Miron se degrada a `skipped`.
- `visualProviderFallbacks`: lista ordenada de proveedores visuales de respaldo. Cada entrada tiene `{ provider, model }`. Si el primario falla, se intenta el siguiente en orden. Si todos fallan, Miron reporta `warn` con screenshot conservado.

## Reglas de uso

- La evidencia no debe escribirse dentro del worktree del repo.
- `visualRoutes` debe contener rutas navegables sin ambiguedad.
- `designRuleset` debe apuntar a una rubrica observable, no a texto puramente aspiracional.
- Si una sesion frontend no define `qaConfig`, Miron puede ejecutarse en modo `skip` pero no tendra contexto suficiente para validar.

## Integracion actual

- `src/core/engine/cli.ts spawn-session <payload_file>` persiste `qaConfig` dentro de `.ralphito-session.json`.
- Raymon puede propagar `qaConfig` al crear sesiones mediante el runtime nativo.
- `finish_task` usa esa metadata para lanzar a Miron.
- `resume.sh` y `src/core/engine/cli.ts resume-session <runtime_session_id>` conservan `qaConfig` al reinyectar sesiones.
- `src/app/e2e-qa.ts` ejecuta a Ricky leyendo la metadata persistida de la sesion.
