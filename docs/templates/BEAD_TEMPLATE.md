# BEAD SPECIFICATION: [BEAD_ID] - [TITLE]

## MISSION
- **PRD Reference:** [Path to PRD]
- **Goal:** [Concise technical goal]
- **Current State:** [Briefly describe relevant existing code state]

## TARGET_FILES
- [List of absolute paths to files allowed to be modified]
- [e.g., src/core/engine/executorLoop.ts]

## INTERFACE_CONTRACT
```typescript
// Define EXACT TypeScript interfaces, types, or function signatures to be added/modified.
// This is the "Lock" that the Coder must fulfill.
```

## LOGIC_RULES
```
IF condition THEN action
IF condition THEN action
[pseudocode for complex algorithms]
[forbidden patterns or side effects]
```

## VERIFICATION_COMMAND
`[EXACT_SHELL_COMMAND_FOR_ENGINE]`
