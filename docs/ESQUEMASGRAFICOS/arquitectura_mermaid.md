# Arquitectura Ralphito Engine (Mermaid)

Este diagrama representa el flujo lógico y la conexión entre capas del sistema post-refactor (Issue 56).

```mermaid
graph TD
    %% ==========================================
    %% CAPA 1: INGRESS (INTERFAZ DE USUARIO)
    %% ==========================================
    subgraph UI ["📱 CAPA DE INGRESO (INTERFAZ)"]
        T_USER(("Tú (Usuario)"))
        TBOT["Telegram Bot<br/>(src/interfaces/telegram/bot.ts)"]
        CLI["(Futura) CLI Conversacional<br/>(npx ralphito chat)"]
        
        T_USER -- "Mensajes de Chat" --> TBOT
        T_USER -. "En el futuro" .-> CLI
    end

    %% ==========================================
    %% CAPA 2: ORQUESTACIÓN (RAYMON Y LOS SABIOS)
    %% ==========================================
    subgraph ORCH ["🧠 CAPA DE ORQUESTACIÓN Y DISEÑO (En Memoria)"]
        ROUTER["Enrutador de Intenciones<br/>(chatExecutor.ts)"]
        
        RAYMON["Raymon (Planner)<br/>src/core/prompt/roles/ProjectPlanner(Raymon).md"]
        SABIOS["Moncho, Poncho, Lola...<br/>src/core/prompt/roles/*.md"]
        
        ROUTER -- "Entrada por defecto" --> RAYMON
        ROUTER -- "Reply / active agent" --> SABIOS
        RAYMON -- "Invoca especialistas" --> TOOL_SUMMON["summon_agent_to_chat<br/>handoff canonico"]
        RAYMON -- "Decide lanzar Sabios" --> TOOL_DIV["Runtime nativo:<br/>divergence via engine"]
        RAYMON -- "Decide lanzar Ejecutor" --> TOOL_SPAWN["Runtime nativo:<br/>spawn-session"]
        RAYMON -- "Supervisa/Resucita" --> TOOL_MGMT["Runtime nativo:<br/>status / resume-session"]
    end

    %% ==========================================
    %% CAPA 3: EL NUEVO MOTOR (RALPHITO ENGINE)
    %% ==========================================
    subgraph ENGINE ["⚙️ RALPHITO ENGINE (El Nuevo Motor Core)"]
        
        %% Componente: CLI Nativa
        CLI_ENGINE["CLI del Motor<br/>(src/core/engine/cli.ts)<br/>Comandos: spawn-session, resume-session, status"]
        
        %% Componente: Gestor de Worktrees
        WT_MANAGER["Worktree Manager<br/>(src/infrastructure/runtime/worktreeManager.ts)<br/>Crea y destruye entornos"]
        
        %% Componente: Bucle Autónomo
        EXEC_LOOP["Executor Loop (El Bucle)<br/>(src/core/engine/executorLoop.ts)<br/>Bucle 'While' asíncrono"]
        
        %% Componente: Base de Datos
        SQLITE[("SQLite (Single Source of Truth)<br/>src/infrastructure/persistence/db/")]
        
        %% Conexiones dentro del motor
        CLI_ENGINE -- "1. Escribe Estado" --> SQLITE
        CLI_ENGINE -- "2. Pide Worktree" --> WT_MANAGER
        CLI_ENGINE -- "3. Lanza" --> EXEC_LOOP
        
        EXEC_LOOP -- "Lee/Actualiza estado" --> SQLITE
    end

    %% ==========================================
    %% CAPA 4: EL GATEWAY Y LAS TOOLS DE IA
    %% ==========================================
    subgraph GATEWAY ["🌐 LLM GATEWAY & INYECCIÓN DE TOOLS"]
        LLM["API Gateway<br/>(src/app/server.ts)"]
        REGISTRY["Tool Registry dinámico<br/>(toolRegistry.ts)"]
        
        T_READ["readFileTool"]
        T_WRITE["writeFileTool"]
        T_BASH["executeBashCommandTool<br/>(Enjaulado al Worktree)"]
        T_WEB["webSearchTool"]
        
        REGISTRY -. "Inyecta a Peones" .-> T_BASH
        REGISTRY -. "Inyecta a Todos" .-> T_READ
        REGISTRY -. "Inyecta a Sabios" .-> T_WEB
    end

    %% ==========================================
    %% CAPA 5: LA FÁBRICA (EJECUCIÓN FÍSICA)
    %% ==========================================
    subgraph WORKTREES ["🏗️ LA FÁBRICA (SISTEMA DE ARCHIVOS aisaldos)"]
        WT1["Worktree Peón (Ralphito)<br/>~/.ralphito/worktrees/be-1/"]
        WT2["Worktree Sabio (Martapepis)<br/>~/.ralphito/worktrees/rs-1/"]
        
        BASH_EXEC["Ejecución Bash Real<br/>(child_process)"]
        
        SCRIPT_BD["Guardarraíles Locales<br/>(scripts/bd.sh sync)"]
        LINTER["npx tsc / npm test"]
        GIT_PUSH["git commit / git push"]
    end

    %% ==========================================
    %% CONEXIONES ENTRE CAPAS (FLUJOS PRINCIPALES)
    %% ==========================================
    
    %% Del Bot al Orquestador
    TBOT -- "Clasifica Mensaje" --> ROUTER
    
    %% De las Bash Tools al Motor
    TOOL_SPAWN -- "Llama a" --> CLI_ENGINE
    TOOL_DIV -- "Llama 4 veces a" --> TOOL_SPAWN
    TOOL_MGMT -- "Consulta" --> SQLITE
    
    %% Del Motor al Gateway
    EXEC_LOOP -- "Envía Prompt + Tools" --> LLM
    LLM -- "Usa Tools de IA" --> REGISTRY
    SABIOS -- "Charla pura" --> LLM
    
    %% De las Tools de IA a la Fábrica
    T_BASH -- "Ejecuta comando en" --> BASH_EXEC
    BASH_EXEC -- "Solo opera dentro de" --> WT1
    
    %% El Bucle de la Fábrica
    WT1 -- "El Peón decide ejecutar" --> SCRIPT_BD
    SCRIPT_BD -- "Corre" --> LINTER
    SCRIPT_BD -- "Termina" --> GIT_PUSH
    
    %% Fallos y Resurrección
    LINTER -- "Si falla" --> SQLITE : "Guarda error_log y status=failed"

    %% Estilos
    classDef ui fill:#2b3137,stroke:#58a6ff,stroke-width:2px,color:white;
    classDef orch fill:#1f2937,stroke:#8b949e,stroke-width:2px,color:white;
    classDef engine fill:#0d1117,stroke:#238636,stroke-width:3px,color:white;
    classDef gateway fill:#161b22,stroke:#a371f7,stroke-width:2px,color:white;
    classDef factory fill:#2ea0431a,stroke:#2ea043,stroke-width:2px,color:white,stroke-dasharray: 5 5;
    
    class UI ui;
    class ORCH orch;
    class ENGINE engine;
    class GATEWAY gateway;
    class WORKTREES factory;
```
