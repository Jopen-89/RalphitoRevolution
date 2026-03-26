# Issue 103 - Stage 3 Worktree Isolation

This document freezes the first Stage 3 implementation decisions for the bead-driven refactor.

## Scope of this slice

This slice covers:

1. The canonical provisioning contract for managed worktrees.
2. The runtime persistence contract for worktree-aware sessions.
3. The Gateway request contract for worktree-scoped tool execution.

It does not yet cover:

- async executor kickoff and detached mission loops,
- validation and landing guardrails,
- cleanup automation after success or failure.

## Stage 3 goals

- Create an isolated git worktree per runtime session.
- Persist the selected worktree path as part of the runtime session state.
- Ensure every mutating Gateway tool executes against the managed worktree, not the repo root.

## Canonical provisioning contract

Stage 3 introduces a dedicated provisioning flow named `provision_worktree`.

The first implementation may exist as an internal TypeScript service, but it freezes the contract that later tools and orchestration layers must reuse.

### Required inputs

- `projectId`: canonical project identifier.
- `project.path`: repository root resolved from the `projects` table.
- `project.worktreeRoot`: managed worktree root resolved from the `projects` table.

### Derived runtime outputs

- `runtimeSessionId`: unique runtime session identifier.
- `baseCommitHash`: git `HEAD` commit hash from the project repo root at provisioning time.
- `branchName`: ephemeral implementation branch for the session.
- `worktreePath`: absolute filesystem path of the managed worktree.

### Behavioral rules

- Provisioning must always resolve the repo root from the canonical project metadata.
- `baseCommitHash` must be read from the project repo root before creating the worktree.
- The default branch naming convention is `jopen/<runtimeSessionId>`.
- Managed worktrees must live under `projects.worktree_root/<runtimeSessionId>`.
- Provisioning must fail clearly if the target worktree path already exists.
- The returned `worktreePath` must be absolute and point inside the managed worktree root.

## Runtime persistence contract

The runtime session is the source of truth for the active implementation workspace.

### Source of truth

- SQLite `agent_sessions.worktree_path`
- `.ralphito-session.json` inside the managed worktree

### Persistence rules

- `worktree_path` must be written when the runtime session is created.
- The same `worktreePath` must also be written into the session file.
- `baseCommitHash`, `branchName`, and `worktreePath` must stay aligned across SQLite and the session file.
- Any resume or status flow must read the persisted worktree path instead of recomputing a new one.

## Gateway request contract

Stage 3 uses an HTTP header to propagate the execution workspace into the Gateway.

### Header

- `x-ralphito-worktree-path`: absolute managed worktree path for the active session.

### Behavioral rules

- The runtime agent loop must send `x-ralphito-worktree-path` on every `/v1/chat` request.
- Gateway tool construction must bind file, git, and document tools to that worktree path.
- Tools that mutate the workspace must not silently fall back to the repo root when the header is missing.
- Stage 3 validation must reject unmanaged or invalid worktree paths before tool execution.

## Acceptance criteria for this slice

- Stage 3 provisioning has a single reusable contract.
- Runtime session creation persists `baseCommitHash`, `branchName`, and `worktreePath` together.
- Gateway requests carry an explicit worktree header for runtime execution.
- Managed tools execute inside the provisioned worktree instead of the project root.
