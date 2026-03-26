# Ciclo de Vida de Ralphito Engine

El ciclo de vida se divide en 4 fases principales: **Aislamiento (Spawn)**, **Ejecución (Run-Loop)**, **Sincronización (Sync)** e **Integración (Merge)**.

---

## Fase 1: Inicialización y Aislamiento (Spawn)
El proceso arranca cuando el usuario o sistema ejecuta `spawn-session` pasándole un payload con el proyecto y el bead (archivo markdown que define la tarea).

1.  **Entrada en la CLI**: Se invoca `cli.ts spawn-session <payload>`.
2.  **Reaper y Limpieza**: `RuntimeReaper` limpia proactivamente sesiones zombies y worktrees huérfanos antes de empezar.
3.  **Identificadores**: Se genera un `runtimeSessionId` único (ej. `be-xxx-yyy`) y se define la rama de trabajo `branchName = jopen/<runtimeSessionId>`.
4.  **Comandos Git (Base Commit)**: El motor (`SessionSupervisor`) obtiene el último hash del branch por defecto (ej. master):
    ```bash
    git rev-parse master
    ```
5.  **Creación del Worktree**: `WorktreeManager` aísla completamente la ejecución mediante la funcionalidad de git worktrees. La carpeta se crea fuera del repo, en `~/.ralphito/worktrees/<runtimeSessionId>` (o en `RALPHITO_WORKTREE_ROOT/<runtimeSessionId>` si está configurado).
    ```bash
    git worktree add -b jopen/<runtimeSessionId> ~/.ralphito/worktrees/<runtimeSessionId> <base_commit_hash>
    ```
    *(Nota: si hubiera que limpiar uno después, el motor utiliza `git worktree remove --force <ruta>` y `git worktree prune`).*
6.  **Resolución de Locks**: Evalúa el `beadPath` para descubrir qué archivos/directorios tocará (el write scope). Intenta adquirir cerrojos (Locks en SQLite) vía `RuntimeLockRepository`. Si otro agente está usando esos archivos, la creación falla para evitar conflictos (Mutex).
7.  **Lanzamiento de Tmux y del Agente**: Inicia una sesión de tmux para el agente (Codex o Opencode), inyectando el prompt (`RALPHITO_INSTRUCTION`) y un set extenso de variables de entorno (`CI=1`, `RALPHITO_WORKTREE_PATH`, etc).
8.  **Desacoplamiento (Detached)**: Se realiza un `spawnDetached` del script de monitorización `cli.ts run-loop <runtimeSessionId>`.

---

## Fase 2: Ejecución, Monitorización y Guardrails (Session Loop)
El run-loop es un proceso invisible en background que no bloquea la máquina principal y audita al agente continuamente.

1.  **Heartbeat y Estado**: Se sincroniza constantemente con la base de datos (SQLite) actualizando pasos (`stepCount`) y renovando los "locks".
2.  **Captura de Terminal**: Se conecta al panel de tmux utilizando el CLI de tmux (`capture-pane`) para obtener las últimas 40 líneas de output.
3.  **Detección de Guardrails (Aborto inminente)**:
    El sistema escanea el output con Regex intentando detectar patrones prohibidos:
    -   **Prompts interactivos**: Detecta `[Y/n]`, `continue?`, `are you sure?`, `press any key`. Si el agente se queda atascado esperando input humano, el sistema emite una notificación de Telegram, escribe un error, mata la sesión (`tmux kill-session`) y borra el worktree.
    -   **Daemons bloqueantes**: Detecta comandos como servidores de desarrollo (`watch mode`, `local: http://`, `waiting for file changes`). Si el daemon persiste más allá de un tiempo de gracia, interrumpe el agente.
4.  **Timeouts**: Si la sesión supera su tiempo máximo total (`max_wall_time_ms`), sus pasos máximos o su tiempo máximo por comando (`max_command_time_ms`), la sesión es marcada como fallida/stuck y cancelada.
5.  **Finalización natural**: Si el comando del agente termina (la consola finaliza) y no hubo errores reportados, se marca la sesión como `done`.

---

## Fase 3: Landing y Guardrails Locales (`finish_task`)
Cuando el agente termina satisfactoriamente la tarea dentro de su worktree, ejecuta `finish_task` para validar el estado del worktree, crear el commit y dejar el trabajo listo para PR y merge.

1.  **Validaciones de estado**:
    ```bash
    git rev-parse --is-inside-work-tree # Se asegura que estás en un repo
    git branch --show-current # Obtiene la rama (ej. jopen/xxx)
    ```
2.  **Landing Commit (Pre-rebase)**:
    Si el agente dejó cambios en staging, los "guarda" para tener un directorio de trabajo limpio antes de operar.
    ```bash
    git diff --cached --quiet # Chequea staged
    git commit -m "Auto-sync from agent session"
    git diff --quiet # Si tras commitear hay cambios unstaged, ABORTA
    git ls-files --others --exclude-standard # Si hay archivos untracked, ABORTA
    ```
3.  **Sincronización de origen (Rebase Automático)**:
    ```bash
    git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' # Resuelve el origen
    git fetch origin master --quiet
    git rebase origin/master
    ```
    *(Si el rebase detecta conflictos, se notifica el fallo de guardrail "Fallo de Rebase. Conflictos de integración" y se aborta el despliegue).*
4.  **Ejecución de Guardrails Locales (Autopilot V1)**:
    Se obtienen los archivos que van a subirse:
    ```bash
    # Comandos usados internamente para detectar archivos TS/TSX modificados
    git diff --cached --name-only
    git diff --name-only
    git ls-files --others --exclude-standard
    ```
    -   **Miron (Shadow Mode)**: Ejecuta QA visual no bloqueante (`visual-qa.ts --shadow`).
    -   **Typescript Guardrail**: Si se detectó código `.ts/.tsx`, ejecuta `npx tsc --noEmit`. Si falla la compilación, aborta la subida.
    -   **Linter Guardrail**: Ejecuta `npm run lint`.
    -   **Test Guardrail**: Ejecuta `npm test`.
5.  **Push a Remote**:
    Si los tests pasan, empuja el código final subiendo la rama al repositorio remoto.
    ```bash
    git push --set-upstream origin jopen/<runtimeSessionId>
    ```
6.  **Destrucción**: Destruye la sesión de tmux restante y avisa por notificación ("Session Synced").

---

## Fase 4: QA, Code Review y Deploy a Master (bd merge)
Tras haber pusheado la rama (con o sin creación de PR, habitualmente se abre la PR automáticamente mediante integración o el usuario lo hace), se invoca `bd merge` desde la terminal o orchestrator.

1.  **Verificación de PR Activa**:
    Verifica que no estemos en master e intenta localizar un PR abierto para la rama actual utilizando GitHub CLI:
    ```bash
    gh pr list --head jopen/<runtimeSessionId> --state open --json number,title,url
    ```
2.  **Ricky (E2E QA Gate)**:
    Ejecuta `e2e-qa.ts`. Al no ser shadow mode, este chequeo es de carácter bloqueante. Si falla la automatización End-to-End, el merge es abortado automáticamente y se registra el fallo.
3.  **Juez (Code Review Gate)**:
    Extrae el diff directamente desde git contra el upstream o el commit previo. Analiza el código con agentes LLM y suelta warnings informativos por terminal. No aborta el merge en caso de "warnings" estéticos.
4.  **Merge final**:
    Una vez aprobados los gates locales, se da la orden de fusionar (squash) con la rama destino usando GitHub CLI:
    ```bash
    gh pr merge <pr_number> --squash --delete-branch
    ```
5.  **Actualización de Local**:
    El agente vuelve al punto de origen para tener el repositorio principal saneado y actualizado listo para la siguiente iteración.
    ```bash
    git checkout master
    git pull --prune origin master
    ```
