# Bead: Demo bead para validacion de Raymon launch command
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: []
[WRITE_ONLY_GLOBS]: ["docs/automation/evidence/demo-launch-*.txt"]
[BANNED_GLOBS]: ["src/**", "docs/specs/**"]

## 2. Contexto Minimo
Bead de prueba para validar que Raymon puede descubrir y lanzar beads de un proyecto.

## 3. Criterios de Aceptacion
1. El bead es descubrible por el orquestador via glob de specs.
2. El bead tiene scope valido con solo escritura en evidence.

## 4. Instrucciones Especiales
- Solo genera un archivo de evidencia en docs/automation/evidence/
- No modifica codigo fuente

## 5. QA Metadata
```json
{
  "qaConfig": {
    "enableVisualQa": false,
    "shadowMode": true,
    "enableE2eQa": false,
    "e2eShadowMode": false
  }
}
```
