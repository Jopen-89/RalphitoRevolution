#!/bin/bash

repo_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$script_dir/../.." && pwd
}

runtime_worktree_root() {
    if [ -n "${RALPHITO_WORKTREE_ROOT:-}" ]; then
        printf '%s\n' "$RALPHITO_WORKTREE_ROOT"
        return 0
    fi

    if [ -n "${RALPHITO_HOME:-}" ]; then
        printf '%s\n' "$RALPHITO_HOME/worktrees"
        return 0
    fi

    printf '%s\n' "$HOME/.ralphito/worktrees"
}

find_runtime_worktree() {
    local session_id="$1"
    local candidate
    candidate="$(runtime_worktree_root)/$session_id"

    if [ -d "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
    fi

    return 1
}

find_runtime_guardrail_logs() {
    local root
    root="$(runtime_worktree_root)"

    if [ -d "$root" ]; then
        find "$root" -type f -name ".guardrail_error.log" 2>/dev/null
    fi
}
