# Issue 103 - Stage 4 Proactive Execution

This document freezes the first Stage 4 implementation decisions for the bead-driven refactor.

## Scope of this slice

This slice covers:

1. The canonical async kickoff contract for worker sessions.
2. The Raymon-facing tool surface for spawning and supervising implementation work.
3. The shutdown of legacy executor naming in the primary runtime path.

It does not yet cover:

- final validation and landing guardrails,
- automatic test correction loops,
- final worktree cleanup after a successful landing.

## Stage 4 goals

- Start implementation work as a detached background runtime session.
- Push the initial mission prompt proactively into the worker session at spawn time.
- Expose session-centric orchestration tools to Raymon.
- Retire legacy executor naming from the active orchestration surface.

## Canonical runtime terms

- `runtime session`: the persisted execution unit identified by `runtimeSessionId`.
- `worker session`: a runtime session dedicated to implementation work inside a managed worktree.
- `session loop`: the detached monitor process that supervises a worker session after kickoff.

Stage 4 removes `executor` as the canonical public term for the active implementation flow.

## Async kickoff contract

Stage 4 freezes the runtime kickoff flow to the following sequence:

1. Resolve the target project from canonical project metadata.
2. Provision a managed worktree and persist runtime session metadata.
3. Create the tmux-backed worker session.
4. Inject the first mission prompt through runtime environment variables.
5. Spawn the detached session loop that monitors the worker lifecycle.
6. Return session metadata immediately without blocking on task completion.

### Required return payload

- `runtimeSessionId`: unique session identifier.
- `baseCommitHash`: git `HEAD` captured before provisioning.
- `branchName`: ephemeral implementation branch for the session.
- `worktreePath`: absolute managed worktree path.

### Behavioral rules

- Kickoff must be non-blocking for the caller.
- The mission prompt must be injected proactively at spawn time; Raymon does not wait to send a follow-up command.
- The detached session loop is the single monitor of success, failure, timeout, and stuck conditions.
- Any resume, cancel, or cleanup flow must target the persisted `runtimeSessionId` instead of creating an ad hoc runtime.

## Raymon tool contract

Stage 4 renames the public orchestration tools to session-centric names.

### Canonical tools

- `spawn_session`: launch a new worker session for a bead or spec.
- `resume_session`: relaunch or rehydrate a failed worker session.
- `cancel_session`: stop a running worker session.
- `reap_stale_sessions`: audit and clean sessions that are persisted as running but no longer alive.

### Stable tools retained in this slice

- `list_project_backlog`
- `set_task_priority`
- `check_status`
- `run_divergence_phase`
- `summon_agent_to_chat`

### Naming rules

- Raymon-facing tools must use `session` terminology, not `executor` terminology.
- Primary docs, prompts, and tool catalogs must not instruct Raymon to call legacy `*_executor` names.
- No backward-compatibility alias is required for the legacy names in this slice.

## Legacy shutdown rules

- The primary runtime path must be `Orchestrator -> SessionSupervisor -> tmux worker session -> detached session loop`.
- Legacy executor naming may remain in archived audit documents, but not in active prompts, tool catalogs, or operator runbooks.
- Any operator recovery path must reference `resume_session` or the native CLI session commands.

## Acceptance criteria for this slice

- Stage 4 has an explicit contract document.
- Raymon exposes session-centric orchestration tools.
- Active prompts and runbooks no longer instruct users to call legacy `*_executor` tools.
- Worker kickoff stays detached and returns session metadata immediately.
- Runtime lifecycle actions operate on persisted sessions and managed worktrees.
