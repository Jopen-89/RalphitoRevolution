#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info() {
    printf '%s\n' "$1"
}

warn() {
    printf '%s\n' "$1" >&2
}

die() {
    warn "$1"
    exit 1
}

require_cmd() {
    local cmd="$1"

    if ! command -v "$cmd" >/dev/null 2>&1; then
        die "❌ Required command not found: $cmd"
    fi
}

ensure_git_repo() {
    git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "❌ Not inside a git repository."
}

current_branch() {
    git -C "$REPO_ROOT" branch --show-current
}

ensure_branch() {
    local branch
    branch="$(current_branch)"

    [ -n "$branch" ] || die "❌ Could not determine current git branch."
}

ensure_sync_preconditions() {
    require_cmd git
    require_cmd gh
    ensure_git_repo
    ensure_branch
}

has_staged_changes() {
    ! git -C "$REPO_ROOT" diff --cached --quiet
}

has_unstaged_changes() {
    ! git -C "$REPO_ROOT" diff --quiet
}

has_untracked_changes() {
    [ -n "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)" ]
}

remote_branch_exists() {
    local branch
    branch="$(current_branch)"

    git -C "$REPO_ROOT" ls-remote --exit-code --heads "$(upstream_remote)" "$branch" >/dev/null 2>&1
}

has_local_commits_ahead() {
    local upstream
    upstream="$(resolve_upstream_ref)"

    if git -C "$REPO_ROOT" rev-parse --verify "$upstream" >/dev/null 2>&1; then
        [ -n "$(git -C "$REPO_ROOT" rev-list "${upstream}..HEAD" 2>/dev/null || true)" ]
        return
    fi

    if remote_branch_exists; then
        [ -n "$(git -C "$REPO_ROOT" rev-list "origin/$(current_branch)..HEAD" 2>/dev/null || true)" ]
        return
    fi

    return 0
}

resolve_upstream_ref() {
    local branch
    branch="$(current_branch)"

    git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || printf 'origin/%s\n' "$branch"
}

upstream_remote() {
    local upstream
    upstream="$(resolve_upstream_ref)"
    printf '%s\n' "${upstream%%/*}"
}

upstream_branch() {
    local upstream
    upstream="$(resolve_upstream_ref)"
    printf '%s\n' "${upstream#*/}"
}

ensure_remote_ref_exists() {
    local upstream
    upstream="$(resolve_upstream_ref)"

    git -C "$REPO_ROOT" rev-parse --verify "$upstream" >/dev/null 2>&1 || git -C "$REPO_ROOT" fetch origin "$(current_branch)" >/dev/null 2>&1 || true
}

ensure_syncable_worktree() {
    if has_unstaged_changes; then
        die "❌ Unstaged changes detected. Stage or commit them before running bd sync."
    fi

    if has_untracked_changes; then
        die "❌ Untracked files detected. Stage or remove them before running bd sync."
    fi

    if ! has_staged_changes && ! has_local_commits_ahead; then
        info "ℹ️ Nothing to sync. No staged changes and no commits pending push."
        exit 0
    fi
}

guardrail_log_path() {
    printf '%s/.guardrail_error.log\n' "$REPO_ROOT"
}

reset_guardrail_log() {
    rm -f "$(guardrail_log_path)"
}

record_guardrail_failure() {
    local message="$1"
    printf '%s\n' "$message" | tee -a "$(guardrail_log_path)"
}

has_package_json() {
    [ -f "$REPO_ROOT/package.json" ]
}

read_package_script() {
    local script_name="$1"

    has_package_json || return 0
    require_cmd node

    node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=pkg.scripts?.[process.argv[2]]; if (typeof value === 'string') process.stdout.write(value);" "$REPO_ROOT/package.json" "$script_name"
}

has_npm_script() {
    local script_name="$1"
    [ -n "$(read_package_script "$script_name")" ]
}

is_placeholder_test_script() {
    local test_script
    test_script="$(read_package_script test)"

    [[ "$test_script" == *"no test specified"* ]]
}

collect_modified_files() {
    {
        git -C "$REPO_ROOT" diff --cached --name-only
        git -C "$REPO_ROOT" diff --name-only
        git -C "$REPO_ROOT" ls-files --others --exclude-standard
    } | sort -u
}

run_guardrail() {
    local start_message="$1"
    local failure_message="$2"
    shift 2

    info "$start_message"
    "$@" > "$(guardrail_log_path)" 2>&1 || {
        record_guardrail_failure "$failure_message"
        exit 1
    }
}

usage() {
    cat <<'EOF'
Usage: bd [onboard|ready|show <id>|update <id> --status in_progress|close <id>|sync]
EOF
}

COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
    usage
    exit 1
fi

shift || true

case "$COMMAND" in
    "onboard")
        require_cmd gh
        info "✅ Authenticated with GitHub."
        gh auth status || warn "⚠️ Please run: gh auth login"
        info "✅ bd (beads) system initialized for Agent Orchestrator."
        ;;
    "ready")
        require_cmd gh
        info "🔍 Fetching available work (Open Issues)..."
        gh issue list --state open --limit 10
        ;;
    "show")
        require_cmd gh
        ISSUE_ID="${1:-}"
        [ -n "$ISSUE_ID" ] || die "❌ Provide an issue ID"
        gh issue view "$ISSUE_ID"
        ;;
    "update")
        require_cmd gh
        ISSUE_ID="${1:-}"
        [ -n "$ISSUE_ID" ] || die "❌ Provide an issue ID"
        info "🔄 Marking issue #$ISSUE_ID as in_progress..."
        gh issue edit "$ISSUE_ID" --add-label "in progress" 2>/dev/null || true
        gh issue assign "$ISSUE_ID" --me 2>/dev/null || true
        info "✅ Issue updated."
        ;;
    "close")
        require_cmd gh
        ISSUE_ID="${1:-}"
        [ -n "$ISSUE_ID" ] || die "❌ Provide an issue ID"
        gh issue close "$ISSUE_ID" --reason completed
        info "✅ Issue #$ISSUE_ID closed."
        ;;
    "sync")
        ensure_sync_preconditions
        ensure_remote_ref_exists
        ensure_syncable_worktree

        info "🛫 Landing the plane... Initiating sync sequence."
        info "⏳ Running pre-sync guardrails..."

        # --- AUTOPILOT V1 HOOK: GUARDRAILS LOCALES ---
        MODIFIED_FILES="$(collect_modified_files)"

        HAS_TS=false

        for FILE in $MODIFIED_FILES; do
            if [[ "$FILE" == *.ts || "$FILE" == *.tsx ]]; then
                HAS_TS=true
            fi
        done

        reset_guardrail_log

        if [ "$HAS_TS" = true ]; then
            info "🔍 TypeScript files detected. Running TS Guardrails..."

            if [ -f "$REPO_ROOT/tsconfig.json" ]; then
                require_cmd npx
                run_guardrail "⚡ Running tsc --noEmit..." "❌ Guardrail failed: TypeScript type errors found." npx tsc --noEmit
            fi

            if has_npm_script lint; then
                require_cmd npm
                run_guardrail "🧹 Running linter..." "❌ Guardrail failed: Linter errors found." npm run lint
            fi

            if has_npm_script test; then
                require_cmd npm
                if is_placeholder_test_script; then
                    info "⏭️ Skipping placeholder test script in package.json."
                else
                    run_guardrail "🧪 Running tests..." "❌ Guardrail failed: Tests failed." npm test
                fi
            fi
        fi

        info "✅ All guardrails passed."

        if remote_branch_exists; then
            git -C "$REPO_ROOT" pull --rebase "$(upstream_remote)" "$(upstream_branch)" || die "❌ Rebase failed. Fix conflicts and retry."
        else
            info "ℹ️ No remote branch exists yet for $(current_branch). Skipping rebase before first push."
        fi

        if has_staged_changes; then
            info "📝 Found staged changes. Creating landing commit..."
            git -C "$REPO_ROOT" commit -m "Auto-sync from agent session" || die "❌ Commit failed."
        fi

        info "🚀 Pushing to remote..."
        git -C "$REPO_ROOT" push --set-upstream "$(upstream_remote)" "$(current_branch)" || die "❌ Push failed."

        info "✅ Sync complete. Work safely landed."

        if [ -f "$REPO_ROOT/scripts/notify_telegram.sh" ]; then
            "$REPO_ROOT/scripts/notify_telegram.sh" "✅ Un agente terminó su tarea (Sync exitoso en rama $(current_branch))" || true
        fi

        info "💀 Phase 3: Terminating agent session to release resources..."
        if [ -n "${TMUX:-}" ]; then
            tmux kill-window
        else
            info "✅ Session finished outside tmux. No process termination needed."
        fi
        ;;
    *)
        usage
        exit 1
        ;;
esac
