# Design Rubric: QA Pipeline Smoke

## Objetivo

Dar a Miron una referencia visual estable para el smoke test del pipeline QA.

## Reglas observables

1. La home usa una cabecera serif muy visible y un bloque principal centrado dentro de una tarjeta clara.
2. Debe existir navegacion clara entre `Home`, `Login` y `Settings`.
3. La paleta visual es calida, clara y sin dark mode.
4. El login debe mostrar un formulario vertical con campos `Email` y `Password` y un CTA redondeado.
5. Settings debe renderizar al menos dos cards secundarias con espaciado consistente.
6. Todas las vistas deben exponer `data-ready="true"` en el contenedor principal.

## Blocking vs preferencia

- Blocking: ausencia de navegacion, formulario ilegible, layout roto, falta de la cabecera principal, cards colapsadas o estados sin contenido.
- Preferencia: pequenas diferencias de tono, copy menor o ajustes cosmeticos no criticos.
