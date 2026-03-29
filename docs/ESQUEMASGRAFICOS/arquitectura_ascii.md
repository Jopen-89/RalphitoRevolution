# Mapa Gráfico: Ralphito Engine (ASCII/Unicode)

Este esquema representa la arquitectura del sistema post-refactor (Issue 56) utilizando caracteres de dibujo de cajas.

```text
                                     ┌─────────────────────────┐
                                     │     TÚ (El Usuario)     │
                                     └───────────┬─────────────┘
                                                 │ "Hola Raymon, crea un login"
                                                 v
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               CAPA 1: INGRESO (INTERFAZ)                                 │
│                                                                                          │
│  ┌─────────────────────────┐                            ┌─────────────────────────────┐  │
│  │      Telegram Bot       │                            │ (Futuro) npx ralphito chat  │  │
│  │ (src/telegram/bot.ts)   │                            │       (CLI Propia)          │  │
│  └────────────┬────────────┘                            └─────────────────────────────┘  │
└───────────────┼──────────────────────────────────────────────────────────────────────────┘
                │ Enruta el texto
                v
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                          CAPA 2: ORQUESTACIÓN (Sala de Diseño)                           │
│                                                                                          │
│ ┌──────────────────────┐    Handoff canónico      ┌──────────────────────────────────┐   │
│ │   Raymon (Planner)   │ -----------------------> │ Sabios (Moncho, Poncho, Lola)    │   │
│ │ (Puerta de entrada)  │                          │ (Responden por reply/contexto)   │   │
│ └─────────┬────────────┘                          └──────────────────────────────────┘   │
│           │                                                                              │
│           │  Si Raymon decide que hay que "picar código", usa tools de runtime:          │
│           v                                                                              │
│ ┌───────────────────────────────┐ ┌──────────────────────────────────────────────────┐   │
│ │ spawn_session -> exec job     │ │ resume/cancel/reap session                       │   │
│ └──────────────┬────────────────┘ └───────────────────────┬──────────────────────────┘   │
└────────────────┼──────────────────────────────────────────┼──────────────────────────────┘
                 │                                          │
                 │ 1. Llama al motor                        │ 2. Consulta estado
                 v                                          v
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                 CAPA 3: RALPHITO ENGINE (El Nuevo Motor - Issue 56)                      │
│                                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │  CLI Interna (src/core/engine/cli.ts) [launch-execution-job, run-loop, resume-session, poll-execution-jobs, poll-review-jobs] │ │
│ └──────────┬────────────────────────────┬─────────────────────────────┬────────────────┘ │
│            │ 1. Reclama Job             │ 2. Crea Carpeta             │ 3. Arranca       │
│            v                            v                             v                  │
│ ┌──────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐   │
│ │                      │    │                         │    │       SESSION LOOP      │   │
│ │  BASE DE DATOS       │<───┤    WORKTREE MANAGER     │    │    (sessionLoop.ts)     │   │
│ │  (SQLite)            │    │  (worktreeManager.ts)   │    │   (Monitor detached)    │   │
│ │                      │    │                         │    │                         │   │
│ │ Tabla: execution_jobs│    │ + Crea ~/.ralphito/    │    │ Bucle monitor {         │   │
│ │ + agent_sessions     │    │ + git worktree add      │    │   heartbeat();          │   │
│ │ + execution_reviews  │    │ + git worktree remove   │    │   guardrails();         │   │
│ │ - id: rr-1           │    │                         │    │ }                       │   │
│ │ - status: running    │    │                         │    │                         │   │
│ │ - review: pending    │    │                         │    │                         │   │
│ │ - pid: 12345         │    └───────────┬─────────────┘    └───────┬────────┬────────┘   │
│ └──────────^───────────┘                │                          │        │            │
│            │ Actualiza estado           │                          │        │            │
└────────────┼────────────────────────────┼──────────────────────────┼────────┼────────────┘
             │                            │ Crea la carpeta          │        │
             │                            │                          │        │ Pide I.A. y Tools
┌────────────┼────────────────────────────┼──────────────────────────┼────────┼────────────┐
│            │                            │                          │        v            │
│            │                            │                          │   ┌─────────────┐   │
│            │                            │                          │   │ LLM GATEWAY │   │
│            │                            │     Ejecuta Tool de Bash │   │ (server.ts) │   │
│            │                            │       ENJAULADA al dir   │   └──────┬──────┘   │
│            │                            │            │             │          │          │
│            │                            │            v             v          │ Inyecta  │
│            │                            │ ┌───────────────────────────────────┐        │
│            │                            │ │ toolRegistry.ts (Tools Dinámicas) │<───────┘ │
│            │                            │ │ - executeBashCommand(cwd)         │          │
│            │                            │ │ - readFile, writeFile, search     │          │
│            │                            │ └───────────────────────────────────┘          │
│            │                            │                                                │
│            │                            │ CAPA 4: INTELIGENCIA Y TOOLS                   │
└────────────┼────────────────────────────┼────────────────────────────────────────────────┘
             │                            │
             │                            │
┌────────────┼────────────────────────────┼────────────────────────────────────────────────┐
│            │                            v                                                │
│            │              ┌───────────────────────────┐                                  │
│            │              │   CARPETA DEL PEÓN        │                                  │
│            │              │ worktrees/rr-1/           │                                  │
│            │              ├───────────────────────────┤                                  │
│            │              │ El Peón ejecuta:          │                                  │
│            │              │ 1. ls, cat (Lee specs)    │                                  │
│            │              │ 2. Escribe src/login.ts   │                                  │
│            │              │ 3. finish_task            │                                  │
│            │              │ 4. submit_for_review      │<── Guardarraíl final             │
│            │              └─────────────┬─────────────┘                                  │
│            │                            │                                                │
│            │ Si landing/review falla    │ Si landing/review pasa                         │
│            └────────────────────────────┤                                                │
│                 Guarda guardrail       v                                                │
│                 Cambia status=failed  ┌───────────────────────────┐                      │
│                                       │   REVIEW + GITHUB (PR)    │                      │
│                                       │ PR + review persistidos   │                      │
│ CAPA 5: LA FÁBRICA Y GITHUB           └───────────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
