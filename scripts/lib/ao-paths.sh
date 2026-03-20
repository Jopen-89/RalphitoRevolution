#!/bin/bash

ao_data_dir() {
    printf '%s\n' "${AO_DATA_DIR:-$HOME/.agent-orchestrator}"
}

ao_worktree_roots() {
    printf '%s\n' "$HOME/.worktrees"
    printf '%s\n' "$(ao_data_dir)"
}

find_ao_worktree() {
    local session_id="$1"
    local root
    local match=""

    while IFS= read -r root; do
        [ -d "$root" ] || continue
        match=$(find "$root" -type d \( -path "*/worktrees/$session_id" -o -path "*/$session_id" \) 2>/dev/null | head -n 1 || true)
        if [ -n "$match" ]; then
            printf '%s\n' "$match"
            return 0
        fi
    done < <(ao_worktree_roots)

    return 1
}

wait_for_ao_worktree() {
    local session_id="$1"
    local timeout_seconds="${2:-20}"
    local started_at="$(date +%s)"
    local match=""

    while true; do
        match=$(find_ao_worktree "$session_id" || true)
        if [ -n "$match" ]; then
            printf '%s\n' "$match"
            return 0
        fi

        if [ $(( $(date +%s) - started_at )) -ge "$timeout_seconds" ]; then
            return 1
        fi

        sleep 1
    done
}

find_ao_guardrail_logs() {
    local root

    while IFS= read -r root; do
        [ -d "$root" ] || continue
        find "$root" -type f -name ".guardrail_error.log" 2>/dev/null
    done < <(ao_worktree_roots)
}
