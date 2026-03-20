# Bead: Endurecer spawn y status para telegram-live-final
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["docs/specs/**/*.md", "scripts/**/*.sh", "src/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["scripts/lib/ao-paths.sh", "scripts/tools/tool_spawn_executor.sh", "src/features/ao/**/*.ts", "src/features/dashboard/**/*.ts", ".gitignore", "docs/specs/projects/telegram-live-final/**", "docs/automation/evidence/**"]
[BANNED_GLOBS]: ["vendor/**", "ops/**"]

## 2. Contexto Minimo
La validacion live de `telegram-live-final` encontro fallos operativos que rompen el flujo real de Raymon y de los Ralphitos:

- AO crea worktrees en `~/.worktrees/<project>/<session>` y no siempre en `~/.agent-orchestrator/...`.
- `ao status` puede expirar en maquinas cargadas y producir falsos negativos.
- `tool_spawn_executor.sh` crea sesiones, pero no deja metadata persistida en el worktree para que la inspeccion posterior sea confiable.

## 3. Criterios de Aceptacion
1. `find_ao_worktree` y `find_ao_guardrail_logs` deben tolerar tanto el layout legacy de AO como el layout gestionado por worktrees.
2. `tool_spawn_executor.sh` debe aceptar prompt directo y payload estructurado, y persistir `.ralphito-session.json` dentro del worktree cuando la sesion aparezca.
3. La metadata persistida debe incluir `sessionId`, `project`, `prompt`, `beadPath`, `workItemKey`, `model`, `beadSpecHash`, `beadSpecVersion`, `qaConfig` y `updatedAt`.
4. El adapter de sesiones AO debe elevar el timeout y tener fallback a tmux cuando fallen dashboard y `ao status`.
5. El dashboard debe aceptar la nueva fuente `tmux_fallback` sin romper tipos.
6. El bead debe dejar evidencia real de validacion en `docs/automation/evidence/`.

## 4. Instrucciones Especiales
- No agregar backward compatibility mas alla de soportar ambos layouts reales de worktree detectados en produccion.
- Si se agrega metadata, todos los consumidores del repo deben leer el formato nuevo en la misma tarea.
- La evidencia debe mencionar comandos reales ejecutados y el resultado observado.
