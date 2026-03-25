# RalphitoRevolution Engine

Este repo combina producto, operación de agentes y automatización local. El motor del sistema (`Ralphito Engine`) es 100% nativo en TypeScript.

## Router Rápido (Arquitectura)
- **`src/core/`**: Motor del Autopilot, agent loops y orquestación (El "Cerebro").
- **`src/gateway/`**: Servicio de LLMs y herramientas nativas (TypeScript Tool Calling).
- **`src/app/`**: Puntos de entrada ejecutables para comandos de terminal y servidores (`.ts`).
- **`src/interfaces/`**: Interacción con el usuario (Telegram Bot, Dashboard UI).
- **`src/infrastructure/`**: Conexiones a BD local (SQLite) y búsqueda.
- **`scripts/`**: Wrappers shell legacy y utilidades operativas en retirada.
- **`docs/specs/`**: Especificaciones y trabajo planificado.
- **`src/core/prompt/roles/`**: Definición de personalidad y reglas de cada agente.

## Protocolo Anti Autoengaño
- **State requires location:** Nunca decir "completado" sin especificar si está `en master`, `en rama <branch>`, `solo local` o `faltante`.
- **Done is not "works on my machine":** La validación local no es cierre. Debe aterrizar en git y alinear con la spec.
- **Follow-up issues:** Empiezan siempre con un inventario Fase 0 (`master | ramas | local | faltante`).
- **Ramas laterales:** Deben terminar `merged` o `descartadas`. No son verdad canónica.

## Git Workflow (Sesiones)
- `master` es de solo lectura para desarrollo. Si estás en `master`, crea una rama (`feat/` o `fix/`) antes de editar código.
- Usa staging selectivo de archivos. **Prohibido usar `git add .` a ciegas.**
- Un trabajo solo está terminado cuando: se valida, hace commit, push, PR y merge a `master`.

## Comandos Operativos (`bd`)
El proyecto sigue usando **bd** (beads) para gestión de tareas. El aterrizaje nativo del runtime se hace con `finish_task` y la oficina virtual arranca con `npm start`.
```bash
bd ready              # Buscar trabajo disponible
bd update <id> --status in_progress
bd close <id>         # Marcar tarea como terminada
bd sync               # Legacy/operativo humano: guardrails, commit y push al PR.
bd merge              # Integra a master (Ejecuta QA: Ricky + Juez)
```

## Landing the Plane (Obligatorio)
El trabajo **NO está completo** hasta que uses la herramienta de finalización.
1. Crea sub-tareas (issues) para el trabajo que falte.
2. Ejecuta guardrails de calidad (TSC, Lint).
3. Aterriza finalizando la tarea. El agente ejecutor muere tras el cierre exitoso.
4. Integración final vía `bd merge` (solo humanos u Orquestador).

## Pipeline QA
`Lola -> Poncho -> Ralphito -> Miron -> Ricky -> Juez -> Raymon`
- **Miron:** Bloquea el aterrizaje final si la UI no cumple la rúbrica visual.
- **Ricky:** Bloquea el merge final si fallan los tests E2E.
- **Juez:** Revisa el diff (Tool Calling) antes de aprobar el PR.

## Reglas de Producto
- **No Backward Compatibility:** No mantengas código heredado, shims o alias viejos. Si un formato cambia, actualiza consumidores y productores en el mismo PR.
- **Specs = Single Source of Truth:** Si el código no coincide con `docs/specs/`, las specs tienen razón. Si la spec dice que se borre, bórralo. No implementes specs marcadas como SUPERSEDED.
