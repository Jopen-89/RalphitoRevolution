# Ciclo de Vida de Ralphito Engine

El ciclo de vida se divide en 4 fases principales: **Cola y Dispatch**, **Runtime Loop**, **Landing y Review** e **Integración final**.

---

## Fase 1: Inicialización y Aislamiento (Spawn)
El proceso arranca cuando Raymon/API encola una `ExecutionJob` mediante `spawn_session` sobre una task persistida. El arranque real del runtime ocurre cuando `ExecutionJobScheduler` reclama el job y llama `launch-execution-job`.

1.  **Entrada canonica**: `spawn_session` crea una `execution_job` `pending`; ya no existe spawn directo por payload arbitrario.
2.  **Claim y dispatch**: `ExecutionJobScheduler` reclama el job en SQLite y `Orchestrator.launchExecutionJob()` valida snapshot, locks y claim antes de tocar runtime.
3.  **Reaper y Limpieza**: `RuntimeReaper` limpia proactivamente sesiones zombies y worktrees huérfanos antes de empezar.
4.  **Identificadores**: Se genera un `runtimeSessionId` único (ej. `be-xxx-yyy`) y se define la rama de trabajo `branchName = jopen/<runtimeSessionId>`.
5.  **Comandos Git (Base Commit)**: El motor (`SessionSupervisor`) obtiene el último hash del branch por defecto (ej. master):
    ```bash
    git rev-parse master
    ```
6.  **Creación del Worktree**: `WorktreeManager` aísla completamente la ejecución mediante la funcionalidad de git worktrees. La carpeta se crea fuera del repo, en `~/.ralphito/worktrees/<runtimeSessionId>` (o en `RALPHITO_WORKTREE_ROOT/<runtimeSessionId>` si está configurado).
    ```bash
    git worktree add -b jopen/<runtimeSessionId> ~/.ralphito/worktrees/<runtimeSessionId> <base_commit_hash>
    ```
    *(Nota: si hubiera que limpiar uno después, el motor utiliza `git worktree remove --force <ruta>` y `git worktree prune`).*
7.  **Resolución de Locks**: Evalúa el `beadPath` para descubrir qué archivos/directorios tocará (el write scope). Intenta adquirir cerrojos (Locks en SQLite) vía `RuntimeLockRepository`. Si otro agente está usando esos archivos, el scheduler difiere el job para evitar conflictos.
8.  **Lanzamiento de Tmux y del Agente**: Inicia una sesión de tmux para el agente (Codex o Opencode), inyectando el prompt (`RALPHITO_INSTRUCTION`) y un set extenso de variables de entorno (`CI=1`, `RALPHITO_WORKTREE_PATH`, etc).
9.  **Desacoplamiento (Detached)**: Se realiza un `spawnDetached` del script de monitorización `cli.ts run-loop <runtimeSessionId>`.

---

## Fase 2: Ejecución, Monitorización y Guardrails (Session Loop)
El `SessionLoop` es el monitor detached que audita el runtime real y persiste el estado canonico.

1.  **Heartbeat y Estado**: Renueva locks, cuenta pasos, persiste heartbeat y sincroniza `agent_sessions`, `execution_jobs` y `execution_results`.
2.  **Captura de Terminal**: Usa tmux (`capture-pane`) para leer la cola reciente del runtime y derivar resumen, guardrails y señales terminales.
3.  **Detección de Guardrails**:
    -   **Prompts interactivos**: `[Y/n]`, `continue?`, `are you sure?`, `press any key`.
    -   **Daemons bloqueantes**: `watch mode`, `local: http://`, `waiting for file changes`.
    -   **Loop vacio/repetido** y otros guardrails persistidos en `execution_results.payload` y `system_events`.
4.  **Timeouts y stale recovery**: Si se supera `max_wall_time_ms`, `maxSteps`, `maxCommandTimeMs` o expira el lease, el job se reencola o falla segun budget.
5.  **Autoridad runtime**: El loop, no la tool, decide el estado terminal de la sesion. Si el agente aterriza y/o pide review, el loop registra el `execution_result` antes de cerrar la sesion runtime.

---

## Fase 3: Landing y Review (`finish_task` + `submit_for_review`)
Cuando el agente termina la implementacion dentro del worktree, aterriza cambios y deja un review job persistido. El cierre de la task ya no depende de chat libre ni de spawn directo.

1.  **Validaciones de estado**:
    ```bash
    git rev-parse --is-inside-work-tree # Se asegura que estás en un repo
    git branch --show-current # Obtiene la rama (ej. jopen/xxx)
    ```
2.  **Landing Commit (Pre-rebase)**:
    Si el agente dejo cambios en staging, los commitea para dejar el directorio limpio antes del rebase/guardrails.
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
4.  **Ejecucion de Guardrails Locales**:
    Se inspeccionan los archivos candidatos y se corren guardrails antes del push:
    ```bash
    # Comandos usados internamente para detectar archivos TS/TSX modificados
    git diff --cached --name-only
    git diff --name-only
    git ls-files --others --exclude-standard
    ```
    -   **Miron**: QA visual segun `qaConfig`.
    -   **Typescript Guardrail**: `npx tsc --noEmit` si aplica.
    -   **Linter Guardrail**: `npm run lint` si existe.
    -   **Test Guardrail**: `npm test` si existe.
5.  **Push a Remote**:
    Si los guardrails pasan, empuja la rama y deja el landing listo.
    ```bash
    git push --set-upstream origin jopen/<runtimeSessionId>
    ```
6.  **Solicitud de Review**:
    `submit_for_review` congela diff, estado git, bead snapshot y resumen de verificacion en `execution_reviews`; el job pasa a `review`.
7.  **Review Scheduler**:
    `poll-review-jobs` reclama reviews pendientes y ejecuta a Juez con firma alterna si existe; si no existe, deja marca `same_signature_review`.
8.  **Veredicto**:
    -   **approve**: `execution_job -> done`, task padre `-> done`.
    -   **reject**: `execution_job -> failed`, task padre `-> blocked`, task hija `-> pending`.

---

## Fase 4: Integración final a master
Tras aprobar review y QA operativa, queda la integracion humana/orquestada a `master`.

1.  **Verificación de PR Activa**:
    Verifica que no estemos en master e intenta localizar un PR abierto para la rama actual utilizando GitHub CLI:
    ```bash
    gh pr list --head jopen/<runtimeSessionId> --state open --json number,title,url
    ```
2.  **QA final**:
    Ricky/Miron pueden ejecutar gates finales segun `qaConfig`, pero el pipeline canonico ya debio dejar `execution_job` y `execution_review` persistidos antes de este punto.
3.  **Merge final**:
    Una vez aprobados los gates locales, se da la orden de fusionar (squash) con la rama destino usando GitHub CLI:
    ```bash
    gh pr merge <pr_number> --squash --delete-branch
    ```
4.  **Actualización de Local**:
    El agente vuelve al punto de origen para tener el repositorio principal saneado y actualizado listo para la siguiente iteración.
    ```bash
    git checkout master
    git pull --prune origin master
    ```
