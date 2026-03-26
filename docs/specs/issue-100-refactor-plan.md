# Specification: Issue 100 - TypeScript-Native Refactor Plan

This document outlines the comprehensive 20-point plan for refactoring the RalphitoRevolution system into a unified, TypeScript-native architecture.

---

### 1. Simplest Possible Version (MVP)
A single Node.js process started via `npm start` that runs the Telegram bot, the LLM Gateway, and the runtime engine. All Telegram messages are routed strictly to the **Raymon** agent (planner). Specialists are invoked only through Raymon using the `summon_agent_to_chat` tool. The Gateway handles provider/model switching based on a single SQLite table (`agent_registry`).

### 2. Architecture Diagram (Text)
```text
[User] <--> [Telegram Bot]
                 |
                 v
        [Message Router] ---- (Only allows entry via Raymon)
                 |
                 v
        [Raymon (Planner)] <--------+
                 |                  | (Tool Calls / Delegation)
                 v                  |
        [Runtime Engine] <----------+
        (Execution Engine)          |
                 |                  v
                 +---------> [Specialist Agents]
                 |
                 v
        [LLM Gateway] (OpenAI, Gemini, etc.)
                 |
                 v
        [Agent Registry (SQLite)] (Single Source of Truth)
                 |
                 v
        [Operational Dashboard (UI)]
```

### 3. Components
- **Telegram Bot:** The I/O interface.
- **Message Router:** Logic for directing traffic.
- **Raymon (Planner):** The central decision-maker.
- **Runtime Engine:** The task execution engine.
- **Specialist Agents:** Technical executors (Lola, Poncho, etc.).
- **LLM Gateway:** Multi-provider abstraction layer.
- **Agent Registry:** Centralized configuration database.
- **Operational Dashboard:** Management UI.

### 4. Responsibilities
- **Telegram Bot:** Listen to inputs, format and send outputs to the user.
- **Message Router:** Enforce the "Raymon-first" policy; maintain `active_agent` session state.
- **Raymon:** Analyze user intent, create execution plans, and summon specialists.
- **Runtime Engine:** Manage agent loops, execute tools, and handle the "Landing the Plane" workflow.
- **Specialist Agents:** Perform scoped tasks (QA, coding, etc.) under Raymon's direction.
- **LLM Gateway:** Standardize provider responses, handle retries, and manage fallback models.
- **Agent Registry:** Serve as the Single Source of Truth (SSOT) for agent config.
- **Dashboard:** Provide a human interface to modify agent settings and monitor health.

### 5. Data Flow
1. **Ingress:** Message arrives -> Router identifies chat context and active agent.
2. **Routing:** If no active agent or explicit Raymon mention, route to Raymon. Otherwise, route to the active specialist.
3. **Inference:** Agent sends request -> Gateway looks up config in Registry -> Gateway calls LLM provider -> Gateway normalizes response.
4. **Execution:** If a tool call occurs (e.g., `summon_agent_to_chat`), the runtime engine executes it and updates the chat state.
5. **Egress:** Agent/runtime yields text -> Bot sends message to user.

### 6. Control Flow
- **Hierarchical:** Telegram -> Raymon -> Specialists.
- **Restricted Tools:** Only Raymon has permission to use `summon_agent_to_chat`.
- **State Machine:** The runtime engine tracks task states (Planning, Executing, Validating, Done).

### 7. Tech Stack
- **Language:** TypeScript.
- **Runtime:** Node.js.
- **Database:** SQLite with Drizzle ORM.
- **Bot Framework:** node-telegram-bot-api / telegraf.
- **Frontend:** React / Vite (Dashboard).
- **Logging:** Structured JSON (Pino/Winston).

### 8. Folder Structure Proposal
```text
src/
├── app/                  # Entrypoints (server.ts, cli.ts)
├── core/
│   ├── engine/           # Runtime engine & task lifecycle
│   ├── planner/          # Raymon specific logic
│   └── domain/           # Shared types & constants
├── gateway/              # LLM providers & normalization
├── agents/               # Registry & Tool definitions
├── interfaces/           # Telegram & Dashboard API
└── infrastructure/       # SQLite connection & Logging
```

### 9. Agent Lifecycle
1. **Discovery:** Loaded from `agent_registry`.
2. **Instantiation:** The runtime engine creates agent instance with specific config.
3. **Active Loop:** Processes inputs, calls tools, generates text.
4. **Hibernation:** State saved to DB between user turns.
5. **Retirement:** Agent removed from active context when task is closed.

### 10. Configuration Model (Agent Registry)
- `id`: Unique string (e.g., 'lola').
- `primary_provider`: 'openai' | 'gemini' | 'opencode'.
- `model`: Specific model string (e.g., 'gpt-4o').
- `fallbacks_json`: Array of fallback models.
- `allowed_tools_json`: Tools enabled for this agent.
- `role_prompt`: System instruction string.

### 11. Startup Sequence
1. Init logger and error handlers.
2. Connect to SQLite and run migrations.
3. Load and cache Agent Registry.
4. Start LLM Gateway and verify connectivity.
5. Launch Telegram Bot and Dashboard API.
6. Print: `🚀 Ralphito Virtual Office is online.`

### 12. Step-by-Step Build Order
1. **P0:** Gateway stability and provider smoke tests.
2. **P1:** Migrate agent config to SQLite (`agent_registry`).
3. **P2:** Implement Raymon-first routing in Telegram handler.
4. **P3:** Restrict specialist invocation so only Raymon can summon agents.
5. **P4:** Update `summon_agent_to_chat` with automatic response trigger and active-agent handoff.
6. **P5:** Unify startup into `npm start`.
7. **P6:** Persist provider/model/providerProfile/fallbacks in `agent_registry`.
8. **P7:** Build operational Dashboard UI for agent management.
9. **P9:** Cleanup legacy scripts and documentation drift.

### 13. Migration Plan
- **Sync:** Script to import current filesystem agents into SQLite.
- **Feature Flag:** Roll out Raymon routing to specific chat IDs first.
- **Documentation:** Update all `GEMINI.md` and `README.md` to reflect the new flow.

### 14. Edge Cases
- **Simultaneous Summons:** Handle if Raymon tries to summon two agents at once.
- **Model Incompatibility:** Gateway must detect if a tool-calling request is sent to a model that doesn't support it.
- **Session Timeout:** Automatic cleanup of stale "Active Agents" in chat.

### 15. Scaling Strategy
- **Horizontal:** Move SQLite to a managed PostgreSQL if DB load increases.
- **Asynchronous:** Ensure all LLM calls are non-blocking to keep the bot responsive.

### 16. Possible Bottlenecks
- **LLM Latency:** Can be mitigated with streaming responses (V2).
- **SQLite Locking:** Use Write-Ahead Logging (WAL) mode.

### 17. Observability/Logging Needs
- **Trace IDs:** Track a single request from Telegram to the final LLM response.
- **Metrics:** Token usage per agent and provider success rates.

### 18. Testing Strategy
- **Smoke Tests:** Daily verification of provider API health.
- **Integration Tests:** Verify that Raymon can successfully summon Lola and get a response.

### 19. Cleanup Plan
- Delete `scripts/bd.sh` and related legacy shell wrappers.
- Remove old YAML/JSON agent definitions once DB is the SSOT.

### 20. V2 Improvements
- **Multi-Modal Native:** Vision and file analysis in the Gateway.
- **Vector Memory:** RAG for long-term project and architectural memory.
- **Webhooks:** Low-latency Telegram communication.
- **Proactive Monitoring:** Agents that detect system issues before the user reports them.
