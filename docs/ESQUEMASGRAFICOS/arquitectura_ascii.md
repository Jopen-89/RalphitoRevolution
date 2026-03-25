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
│ ┌──────────────────────┐    Hablan entre ellos    ┌──────────────────────────────────┐   │
│ │ Raymon (Orchestrator)│ <----------------------> │ Sabios (Moncho, Poncho, Lola)    │   │
│ │ (Toma decisiones)    │                          │ (Escriben PRDs y Beads en docs/) │   │
│ └─────────┬────────────┘                          └──────────────────────────────────┘   │
│           │                                                                              │
│           │  Si Raymon decide que hay que "picar código", usa sus Bash Tools:            │
│           v                                                                              │
│ ┌───────────────────────────────┐ ┌──────────────────────────────────────────────────┐   │
│ │ tool_spawn_executor.sh <bead> │ │ tool_check_status.sh / tool_resume_executor.sh   │   │
│ └──────────────┬────────────────┘ └───────────────────────┬──────────────────────────┘   │
└────────────────┼──────────────────────────────────────────┼──────────────────────────────┘
                 │                                          │
                 │ 1. Llama al motor                        │ 2. Consulta estado
                 v                                          v
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                 CAPA 3: RALPHITO ENGINE (El Nuevo Motor - Issue 56)                      │
│                                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │  CLI Interna (src/features/engine/cli.ts) [spawn, kill, resume, status]              │ │
│ └──────────┬────────────────────────────┬─────────────────────────────┬────────────────┘ │
│            │ 1. Crea Sesión             │ 2. Crea Carpeta             │ 3. Arranca       │
│            v                            v                             v                  │
│ ┌──────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐   │
│ │                      │    │                         │    │      EXECUTOR LOOP      │   │
│ │  BASE DE DATOS       │<───┤    WORKTREE MANAGER     │    │   (executorLoop.ts)     │   │
│ │  (SQLite)            │    │  (worktreeManager.ts)   │    │  (El Bucle del Peón)    │   │
│ │                      │    │                         │    │                         │   │
│ │ Tabla: agent_sessions│    │ + Crea ~/.ralphito/    │    │ Bucle while(!done) {    │   │
│ │ - id: rr-1           │    │ + git worktree add      │    │   hablar_con_gateway(); │   │
│ │ - status: working    │    │ + git worktree remove   │    │   ejecutar_tools();     │   │
│ │ - error_log: null    │    │                         │    │ }                       │   │
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
│            │              │ 3. npx tsc, npm test      │                                  │
│            │              │ 4. ./scripts/bd.sh sync   │<── Guardarraíl final             │
│            │              └─────────────┬─────────────┘                                  │
│            │                            │                                                │
│            │ Si bd.sh sync falla        │ Si bd.sh sync pasa                             │
│            └────────────────────────────┤                                                │
│                 Guarda error_log        v                                                │
│                 Cambia status=failed  ┌───────────────────────────┐                      │
│                                       │        GITHUB (PR)        │                      │
│                                       │ PR: "Añadido sistema login"                      │
│ CAPA 5: LA FÁBRICA Y GITHUB           └───────────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
