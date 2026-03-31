# Bead: Crear el proyecto canonico telegram-live-final
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["docs/specs/**/*.md", "agents/**/*.md", "scripts/**/*.sh", "src/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["docs/specs/projects/telegram-live-final/**"]
[BANNED_GLOBS]: ["src/**", "vendor/**", "ops/**"]

## 2. Contexto Minimo
El issue #12 intenta validar un proyecto `telegram-live-final`, pero ese proyecto no existe hoy en `docs/specs/projects/`. Este bead crea la base canonica minima para que Raymon y los ejecutores tengan un proyecto real desde el cual operar.

## 3. Criterios de Aceptacion
1. Debe existir la carpeta `docs/specs/projects/telegram-live-final/`.
2. Este bead debe definir que el objetivo del proyecto es validar el flujo real `Idea -> PRD -> arquitectura/beads -> launch -> QA -> cierre` desde Telegram.
3. El bead debe dejar explicito que los siguientes pasos del proyecto dependen de que existan PRD, arquitectura y beads canonicos en esa misma carpeta.
4. El bead no debe introducir backward compatibility ni referencias a sets residuales de beads ya inexistentes.

## 4. Instrucciones Especiales
- Este bead solo crea el punto de entrada canonico del proyecto.
- No modificar codigo de producto ni scripts operativos.
- Si aparecen referencias previas al proyecto fuera de esta carpeta y contradicen este bead, se consideran desactualizadas.
