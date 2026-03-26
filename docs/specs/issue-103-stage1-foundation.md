# Issue 103 - Stage 1 Foundation

This document freezes the first two Stage 1 implementation decisions for the bead-driven refactor.

## Scope of this slice

This slice only covers:

1. Canonical terminology and identity rules.
2. Database schema changes required to support DB-first projects.

It does not yet cover:

- backfill and seed execution,
- DB-first project resolution,
- lifecycle service implementation,
- runtime integration changes.

## Canonical terms

- `project`: an executable repository or workspace that Ralphito can operate on.
- `project_id`: the stable canonical identifier for a project in SQLite.
- `task`: the lifecycle record stored in SQLite.
- `task_id`: the canonical identity of a task.
- `bead`: a spec or work artifact linked to a task.
- `bead_path`: filesystem path to the linked bead document when one exists.

## Rules frozen in this stage

### Project semantics

- A project is not an agent, team alias, or dashboard section.
- A project represents a repo/workspace execution scope.
- `system` is the canonical project for the current Ralphito repository.
- `system` is stored as a normal row with `kind = 'system'`.

### Task semantics

- `task_id` is the canonical identity of a task.
- `bead_path` is metadata, not identity.
- Multiple runtime flows may reference the same task, but they must converge on one `task_id`.

### Compatibility rules

- `project_key` remains temporarily for compatibility with legacy code paths.
- `source_spec_path` remains temporarily for compatibility with legacy code paths.
- New Stage 1 work should target `project_id` and `bead_path`.

### Foreign key strategy

- Stage 1 schema adds `project_id` to `tasks`.
- Strict foreign key enforcement from `tasks.project_id` to `projects.project_id` is deferred until backfill is complete.
- This keeps the migration safe for existing SQLite databases with legacy task rows.

## Schema target introduced in this stage

### projects

The new `projects` table is the SQLite source of truth for project metadata.

Required columns:

- `project_id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `repo_path TEXT NOT NULL`
- `worktree_root TEXT NOT NULL`
- `default_branch TEXT NOT NULL`
- `agent_rules_file TEXT`
- `is_active INTEGER NOT NULL DEFAULT 1`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### tasks additions

The existing `tasks` table is extended with:

- `project_id TEXT`
- `bead_path TEXT`

Existing fields remain in place during the transition.

## Acceptance criteria for phases 1-2

- Canonical terminology is documented.
- `projects` exists in SQLite.
- `tasks` contains `project_id` and `bead_path` columns.
- Indexes exist to support project-scoped task queries.
- No runtime code is forced to migrate in the same change.
