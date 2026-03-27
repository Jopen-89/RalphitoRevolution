# Objective
Implement the MVP of the Agent Execution Pipeline: A predictable, safe, and automated workflow from PRD to validated code, using a strict Spec-Driven approach (Beads), a CI validation loop, and a circuit breaker for LLM failures within isolated git worktrees.

# Background & Motivation
Currently, agents have too much autonomy, leading to context loss, infinite error loops, and "hallucinated" success. We need to transition from a chat-based flow to an automated pipeline where:
- The design (Poncho) produces strict technical contracts (Beads).
- The executor (Ralphito) is constrained by a CI-validated loop running inside an isolated `git worktree`.
- The engine enforces a 3-strike circuit breaker to prevent infinite API spend and code corruption, escalating critical failures back to the architect rather than resuming a corrupted executor session.

# Implementation Plan

## Stage 1: The Strict Contract (Poncho & The Bead Template)
Goal: Ensure Poncho generates actionable, machine-readable specifications instead of vague prose.

- [ ] **1.1 Create the Bead Template:** 
  - Create `docs/templates/BEAD_TEMPLATE.md`.
  - Define strict blocks: `TARGET_FILES` (array of paths), `INTERFACE_CHANGES` (TS blocks), `LOGIC_RULES` (pseudocode), and `VERIFICATION_COMMAND` (e.g., `npm run lint`).
- [ ] **1.2 Update Poncho's System Prompt:**
  - Modify `src/core/prompt/roles/TechnicalArchitect(Poncho).md`.
  - Mandate the use of `BEAD_TEMPLATE.md` when using `design_beads_from_spec`.
  - Add a rule: "Never write implementation logic in natural language; use strict state-transformation pseudocode and TypeScript interfaces."
- [ ] **1.3 Validate Bead Generation:**
  - Test via Telegram: Ask Raymon to bring Poncho and generate a Bead from a sample PRD. Verify the output strictly matches the template.

## Stage 2: The Execution Guardrails (Tools & Worktree Setup)
Goal: Constrain the Coder (Ralphito) so it operates safely inside its isolated environment.

- [ ] **2.1 Implement `submit_for_review` Tool:**
  - Create the `submit_for_review` tool in `src/gateway/tools/` specifically for the Coder role.
  - The tool should accept an optional "notes" parameter but its primary function is to trigger the engine's validation phase.
- [ ] **2.2 Verify Worktree Isolation:**
  - Audit `src/core/engine/orchestrator.ts` (`spawn_session`) to ensure it correctly creates a `git worktree` for the specific Bead and that all Ralphito commands execute *within* that directory.
- [ ] **2.3 Enforce Write-Scope (Guardrail):**
  - Update the file-editing tool (e.g., `edit_file`) to check the target path against the `TARGET_FILES` array from the active Bead. Block edits to unauthorized files.

## Stage 3: The CI Engine & Circuit Breaker (Executor Loop)
Goal: The TypeScript engine acts as the ultimate judge, running tests, returning tool errors for minor issues, and killing bad sessions on critical failure.

- [ ] **3.1 Capture the Review Submission:**
  - Modify `src/core/engine/executorLoop.ts` to intercept the `submit_for_review` tool call.
- [ ] **3.2 Execute Local CI (Minor Failures):**
  - When intercepted, run the `VERIFICATION_COMMAND` defined in the Bead inside the active worktree.
  - If it fails, capture the `stderr`/`stdout` and return it as the **tool response** directly to Ralphito in the active session.
- [ ] **3.3 Implement the 3-Strike Kill Switch (Critical Failures):**
  - Add state tracking in the executor loop: `submission_attempts = 0`.
  - **Success (Exit 0):** Mark task as complete in SQLite, exit loop gracefully.
  - **Failure & Attempts == 3 (Strike 3):**
    - Execute `git reset --hard HEAD` in the worktree.
    - Terminate the Ralphito agent loop (do not allow `/resume` for this agent).
    - Update the task status in SQLite to `BLOCKED_BY_EXECUTION_FAILURE`.
    - Extract the final error log and trigger an escalation event to Poncho/Raymon.

## Stage 4: End-to-End Orchestration (Raymon & Telegram)
Goal: Connect the pieces so Raymon can smoothly launch the validated loop and handle escalations.

- [ ] **4.1 Update `spawn_session` Injection:**
  - Ensure `spawn_session` accepts a `beadPath`.
  - Read the content of `beadPath` and inject it as the core mission in Ralphito's initial system prompt.
  - Explicitly instruct Ralphito: "Your task is to implement this Bead. You must call `submit_for_review` when finished."
- [ ] **4.2 End-to-End Test (Happy Path):**
  - Trigger Raymon via Telegram to launch a simple Bead.
  - Verify Ralphito edits the file, calls `submit_for_review`, the CI passes, the worktree is cleaned up (if applicable), and the task closes.
- [ ] **4.3 End-to-End Test (Circuit Breaker Escalation):**
  - Intentionally provide a Bead with impossible requirements.
  - Verify Ralphito fails 3 times, the engine runs `git reset`, the session dies, and Raymon/Poncho receives the post-mortem error report via the EventBus/Telegram.

# Verification
- The system must not allow a PR/Commit if the local CI command fails.
- The repository state must remain clean after a Strike-3 failure, with the error escalated, not looped.
- API spending per task is strictly bounded by the 3-attempt limit.