#!/bin/bash

ao_data_dir() {
    printf '%s\n' "${AO_DATA_DIR:-$HOME/.agent-orchestrator}"
}

find_ao_worktree() {
    local session_id="$1"

    find "$(ao_data_dir)" -type d -path "*/worktrees/$session_id" 2>/dev/null | head -n 1
}

find_ao_guardrail_logs() {
    find "$(ao_data_dir)" -type f -name ".guardrail_error.log" 2>/dev/null
}
