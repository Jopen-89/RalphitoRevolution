# Issue 103 - Stage 2 Design Contracts

This document freezes the first two Stage 2 decisions for the bead-driven refactor.

## Scope of this slice

This document now covers:

1. The canonical contract for a designed bead.
2. The request and response contract for Poncho's decomposition tool.

It still does not cover:

- scheduling or dependency resolution beyond basic backlog ordering,
- any new SQLite schema beyond Stage 1.

## Stage 2 goals

- Convert high-level specs into executable beads.
- Keep bead markdown as the human-readable source of intent.
- Reuse SQLite tasks as the machine-readable execution backlog.

## Canonical bead contract

A designed bead must produce both:

- a markdown artifact inside `docs/specs/projects/<projectId>/`, and
- a Stage 1 task record linked through `task_id`.

### Required fields

- `projectId`: canonical project identifier.
- `title`: short actionable title.
- `slug`: stable kebab-case slug derived from the title.
- `goal`: concise objective for the bead.
- `scope`: list of included changes.
- `acceptanceCriteria`: checklist of verifiable outcomes.
- `priority`: `low`, `medium`, or `high`.
- `status`: initial value must be `pending`.
- `sourceSpecPath`: source PRD or spec used for decomposition.
- `beadPath`: final markdown path.

### Optional fields

- `outOfScope`: list of explicit exclusions.
- `dependencies`: upstream bead or task identifiers.
- `componentPath`: primary implementation area.

### Storage rules

- Bead markdown is mandatory for Stage 2.
- `task_id` remains the canonical identity.
- `beadPath` must point to a markdown file under `docs/specs/projects/<projectId>/`.
- The markdown title and the SQLite task title must match.
- Default priority is `medium` when omitted.
- Default dependencies are empty.

### Naming convention

- Folder: `docs/specs/projects/<projectId>/`
- File name: `bead-<nn>-<slug>.md`
- `slug` must be short, kebab-case, and stable after creation.

### Recommended markdown shape

```md
# <title>

## Goal
...

## Scope
- ...

## Out of Scope
- ...

## Acceptance Criteria
- [ ] ...

## Dependencies
- none

## Metadata
- projectId: system
- priority: medium
- componentPath: src/core/...
- sourceSpecPath: docs/specs/...
```

## Poncho tool contract

The Stage 2 decomposition tool is named `design_beads_from_spec`.

### Request contract

- `projectId`: target project. Required.
- `specPath`: source PRD or spec path. Required.
- `designMode`: `append` or `replace`. Optional. Default is `append`.
- `maxBeads`: maximum number of beads to generate. Optional.
- `priorityDefault`: `low`, `medium`, or `high`. Optional. Default is `medium`.
- `componentHint`: optional architectural hint.

### Response contract

- `projectId`: target project.
- `specPath`: source document used.
- `designMode`: normalized design mode.
- `createdCount`: number of beads created.
- `beads`: list of created beads with `taskId`, `title`, `priority`, `status`, `beadPath`, and optional `componentPath`.
- `warnings`: non-blocking design ambiguities.
- `success`: boolean execution result.

### Behavioral rules

- `projectId` must resolve to an existing project.
- `specPath` must resolve inside the workspace.
- `append` is the default and recommended first implementation mode.
- `replace` supersedes prior beads generated from the same source spec by cancelling their tasks and replacing their markdown artifacts.
- If a bead path already exists, the tool must fail clearly for that bead instead of silently overwriting it.
- If the source spec is ambiguous, the tool should still emit partial output and surface warnings.

## Acceptance criteria for this slice

- The bead contract is documented and explicit.
- The Poncho tool request and response schema are documented.
- The system has stable TypeScript types for these contracts.
- The implementation can operate in both `append` and `replace` mode without renegotiating field names.
