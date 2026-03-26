# Issue 103 - Stage 5 Validation and Landing

This document freezes the first Stage 5 implementation decisions for the bead-driven refactor.

## Scope of this slice

This slice covers:

1. The canonical landing contract for `finish_task`.
2. The guardrail contract that runs before a session may close successfully.
3. The runtime rule that the session loop, not the tool call, is the final authority for closure.

It does not yet cover:

- automatic multi-attempt guardrail correction loops,
- PR creation or merge automation,
- post-merge cleanup outside the managed worktree lifecycle.

## Stage 5 goals

- Run quality guardrails before a worker session can land successfully.
- Keep `finish_task` as the single landing request tool for the agent.
- Move the canonical `done` decision to the runtime session loop.
- Guarantee that a session is only marked `done` after landing is verified against git state.

## Canonical landing contract

Stage 5 freezes the landing flow to the following sequence:

1. The worker agent invokes `finish_task` from inside the managed worktree.
2. `finish_task` performs the landing attempt inside that worktree:
   - validate local git hygiene,
   - commit staged changes if needed,
   - update against `origin/master`,
   - run guardrails,
   - push the branch upstream.
3. If the landing attempt fails, the runtime persists a structured failure record for resume/retry flows.
4. If the landing attempt succeeds, the worker process exits successfully.
5. The detached `session loop` validates the landing result using persisted session metadata.
6. Only after that validation passes may the runtime:
   - mark the runtime session `done`,
   - sync the linked task to `done`,
   - emit the success notification,
   - clean up the managed terminal/worktree lifecycle.

## Ownership rules

### `finish_task`

- `finish_task` is a landing request, not the final closure authority.
- It may return success only when the landing attempt finished locally without guardrail/git errors.
- It must not mark the runtime session as `done` directly.
- It must not mark the linked bead/task as `done` directly.

### `session loop`

- The `session loop` is the only component allowed to convert a successful landing attempt into terminal `done` state.
- The `session loop` must verify all of the following before closing successfully:
  - managed `worktreePath` exists,
  - worktree is clean,
  - branch has a valid upstream,
  - remote branch exists,
  - `HEAD` differs from the captured `baseCommitHash`.
- If verification fails, the session must be marked `failed`, never `done`.

## Guardrail contract

Stage 5 guardrails run inside the managed worktree.

### Required policy for this slice

- `npx tsc --noEmit` when `tsconfig.json` exists.
- `npm run lint` when `package.json` exposes a `lint` script.
- `npm test` when `package.json` exposes a usable `test` script.
- Guardrails run after git hygiene checks and before the final push.

### Failure persistence

- Guardrail failures must persist a runtime failure record.
- Failures must also write `.guardrail_error.log` inside the managed worktree.
- Resume flows must re-inject a structured failure summary into the same runtime session context.

### Auto-resume policy

- Auto-resume is allowed only for deterministic landing failures:
  - `typescript_guardrail_failed`
  - `lint_guardrail_failed`
  - `test_guardrail_failed`
  - `rebase_failed`
- Auto-resume budget is capped at 2 attempts per failure kind and per runtime session.
- The budget is persisted in `.ralphito-session.json` so the policy survives process restarts.
- These failures are terminal without auto-resume:
  - `landing_not_completed`
  - `interactive_prompt_unresolved`
  - `blocked_daemon_detected`
  - `human_suspend_timeout`
  - `max_command_time_exceeded`
  - `max_wall_time_exceeded`
  - `process_exit_nonzero`
  - `silent_exit`
- When the budget is exhausted, the runtime must fail terminally and emit a final `session.guardrail_failed` notification that states the retry budget was exhausted.

## Acceptance criteria for this slice

- Stage 5 has an explicit contract document.
- `finish_task` performs only the landing attempt and does not finalize runtime state.
- Successful session closure is decided by `session loop` verification.
- Runtime `done` and task `done` are written only after landing verification passes.
- Success notifications are emitted only after the runtime session is conclusively landed.
