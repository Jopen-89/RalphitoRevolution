#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_CLI="$REPO_ROOT/src/features/engine/cli.ts"

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

run_engine_cli() {
    if [ ! -f "$ENGINE_CLI" ]; then
        return 0
    fi

    npx tsx "$ENGINE_CLI" "$@" >/dev/null 2>&1 || true
}

enqueue_runtime_notification() {
    local event_type="$1"
    local payload_json="$2"
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return 0
    fi

    run_engine_cli enqueue-notification "$session_id" "$event_type" "$payload_json"
}

record_runtime_step() {
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return 0
    fi

    run_engine_cli record-step "$session_id"
}

record_runtime_failure() {
    local failure_kind="$1"
    local failure_summary="$2"
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return 0
    fi

    run_engine_cli record-failure "$session_id" "$failure_kind" "$failure_summary" "$(guardrail_log_path)"
}

clear_runtime_failure() {
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return 0
    fi

    run_engine_cli clear-failure "$session_id"
}

finish_runtime_session() {
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return 0
    fi

    run_engine_cli finish-session "$session_id" done
}

get_session_id() {
    if [ -n "${RALPHITO_RUNTIME_SESSION_ID:-}" ]; then
        printf '%s\n' "$RALPHITO_RUNTIME_SESSION_ID"
        return
    fi

    if [ -f "$REPO_ROOT/.ralphito-session.json" ]; then
        jq -r '.runtimeSessionId // ""' "$REPO_ROOT/.ralphito-session.json" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

notify_guardrail_failure() {
    local guardrail_name="$1"

    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return
    fi

    require_cmd node

    local session_info
    session_info="$(node "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/scripts/ralphito-db.ts" get-session-chat "$session_id" 2>/dev/null)" || return

    local bead_id title has_error error_message summary snippet payload
    bead_id="$(echo "$session_info" | jq -r '.beadId // ""' 2>/dev/null)" || return
    title="$(echo "$session_info" | jq -r '.title // ""' 2>/dev/null)" || return
    has_error="$(echo "$session_info" | jq -r '.hasGuardrailError // false' 2>/dev/null)" || return
    error_message="$(echo "$session_info" | jq -r '.guardrailError // ""' 2>/dev/null)" || return

    summary="Fallo en ${guardrail_name}."
    snippet=""
    if [ "$has_error" = "true" ] && [ -n "$error_message" ]; then
        summary="$error_message"
        snippet="$error_message"
    fi

    payload="$(jq -nc \
        --arg guardrail "$guardrail_name" \
        --arg beadId "$bead_id" \
        --arg title "$title" \
        --arg summary "$summary" \
        --arg snippet "$snippet" \
        '{guardrail:$guardrail, beadId:$beadId, title:$title, summary:$summary, snippet:$snippet}')" || return

    enqueue_runtime_notification "session.guardrail_failed" "$payload"
}

notify_session_success() {
    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        return
    fi

    require_cmd node

    local session_info
    session_info="$(node "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/scripts/ralphito-db.ts" get-session-chat "$session_id" 2>/dev/null)" || return

    local bead_id title branch payload
    bead_id="$(echo "$session_info" | jq -r '.beadId // ""' 2>/dev/null)" || return
    title="$(echo "$session_info" | jq -r '.title // ""' 2>/dev/null)" || return
    branch="$(current_branch)"

    payload="$(jq -nc \
        --arg beadId "$bead_id" \
        --arg title "$title" \
        --arg branchName "$branch" \
        --arg prUrl "" \
        '{beadId:$beadId, title:$title, branchName:$branchName, prUrl:$prUrl}')" || return

    enqueue_runtime_notification "session.synced" "$payload"
}

run_miron_shadow() {
    if [ ! -f "$REPO_ROOT/scripts/visual-qa.ts" ]; then
        info "ℹ️ Miron no disponible (visual-qa.ts no encontrado)."
        return 0
    fi

    if [ ! -f "$REPO_ROOT/.ralphito-session.json" ]; then
        info "ℹ️ Miron saltado: no hay .ralphito-session.json."
        return 0
    fi

    local qa_config
    qa_config="$(jq -r '.qaConfig.enableVisualQa // false' "$REPO_ROOT/.ralphito-session.json" 2>/dev/null)" || true

    if [ "$qa_config" != "true" ]; then
        info "ℹ️ Miron saltado: enableVisualQa no está habilitado."
        return 0
    fi

    info "👁️ Ejecutando Miron (Visual QA - Shadow Mode)..."

    require_cmd node

    if ! node "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/scripts/visual-qa.ts" --repo-root "$REPO_ROOT" --shadow; then
        warn "⚠️ Miron reportó problemas visuales (shadow mode - solo informativo)."
    else
        info "✅ Miron: Sin problemas visuales detectados."
    fi
}

run_ricky_e2e() {
    if [ ! -f "$REPO_ROOT/scripts/e2e-qa.ts" ]; then
        die "❌ Ricky no disponible (e2e-qa.ts no encontrado)."
    fi

    if [ ! -f "$REPO_ROOT/.ralphito-session.json" ]; then
        die "❌ Ricky requiere .ralphito-session.json para ejecutar E2E."
    fi

    local qa_config
    qa_config="$(jq -r '.qaConfig.enableE2eQa // false' "$REPO_ROOT/.ralphito-session.json" 2>/dev/null)" || true

    if [ "$qa_config" != "true" ]; then
        info "ℹ️ Ricky saltado: enableE2eQa no está habilitado."
        return 0
    fi

    info "🔍 Ejecutando Ricky (E2E QA - Blocking Mode)..."

    require_cmd node

    if ! node "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/scripts/e2e-qa.ts" --repo-root "$REPO_ROOT"; then
        local session_id bead_id
        session_id="$(get_session_id)"
        bead_id="$(node "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/scripts/ralphito-db.ts" get-session-chat "$session_id" 2>/dev/null | jq -r '.beadId // "UNKNOWN"')"

        notify_guardrail_failure "E2E (Ricky)"

        die "❌ Ricky falló: E2E QA bloqueó el merge."
    fi

    info "✅ Ricky: E2E QA Passed."
}

run_juez_review() {
    info "⚖️ Ejecutando Judge (Code Review - Informativo)..."

    local session_id
    session_id="$(get_session_id)"

    if [ -z "$session_id" ]; then
        info "ℹ️ Judge saltado: no hay sessionId."
        return 0
    fi

    if [ ! -f "$REPO_ROOT/scripts/tools/tool_get_diff.sh" ]; then
        info "ℹ️ Judge saltado: tool_get_diff.sh no encontrado."
        return 0
    fi

    local diff_output
    diff_output="$(bash "$REPO_ROOT/scripts/tools/tool_get_diff.sh" "$session_id" 2>&1)" || {
        warn "⚠️ Judge no pudo obtener el diff."
        return 0
    }

    if [ -f "$REPO_ROOT/agents/roles/CodeReviewer(Juez).md" ]; then
        info "📋 Judge ha revisado el diff. Revisión completada."
        info "ℹ️ Judge es informativo: los hallazgos deben ser resueltos manualmente."
    else
        info "ℹ️ Judge: rol de CodeReviewer no encontrado, skipping."
    fi
}

get_current_pr() {
    local branch
    branch="$(current_branch)"

    local pr_info
    pr_info="$(gh pr list --head "$branch" --state open --json number,title,url --jq '.[0]' 2>/dev/null)" || echo "{}"

    echo "$pr_info"
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
    local failure_kind="$3"
    local guardrail_name="$4"
    shift 4

    info "$start_message"
    record_runtime_step
    "$@" > "$(guardrail_log_path)" 2>&1 || {
        record_guardrail_failure "$failure_message"
        record_runtime_failure "$failure_kind" "$failure_message"
        notify_guardrail_failure "$guardrail_name"
        exit 1
    }
}

usage() {
    cat <<'EOF'
Usage: bd [onboard|ready|show <id>|update <id> --status in_progress|close <id>|sync|merge|status]
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

        # --- FASE 4: PRE-REBASE COMMIT ---
        # El agente nació atado a un hash histórico.
        # Commiteamos cualquier staged change ANTES del rebase para mantener un índice limpio.
        if has_staged_changes; then
            info "📝 Found staged changes. Creating landing commit before rebase..."
            git -C "$REPO_ROOT" commit -m "Auto-sync from agent session" || die "❌ Commit failed."
        fi

        # Verify clean worktree for rebase
        if has_unstaged_changes; then
            die "❌ Unstaged changes detected after auto-commit. Cannot rebase."
        fi

        # Re-evaluate: if no local commits ahead after commit, nothing to rebase
        if ! has_local_commits_ahead; then
            info "ℹ️ No local commits to rebase. Skipping rebase step."
        else
            # --- FASE 4: AUTO-REBASE AGAINST MASTER ---
            info "🔄 Fetching latest origin/master..."
            if ! git -C "$REPO_ROOT" fetch origin master --quiet 2>&1; then
                warn "⚠️ Could not fetch origin master. Continuing anyway..."
            fi

            info "🔄 Rebasing against origin/master..."
            record_runtime_step
            if ! git -C "$REPO_ROOT" rebase origin/master 2>&1; then
                record_guardrail_failure "❌ [be-XX] Fallo de Rebase. Conflictos de integración con master."
                record_runtime_failure "rebase_failed" "❌ [be-XX] Fallo de Rebase. Conflictos de integración con master."
                notify_guardrail_failure "Rebase"
                die "❌ Rebase failed. Resolve conflicts and retry."
            fi
        fi

        reset_guardrail_log
        clear_runtime_failure

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

        run_miron_shadow

        if [ "$HAS_TS" = true ]; then
            info "🔍 TypeScript files detected. Running TS Guardrails..."

            if [ -f "$REPO_ROOT/tsconfig.json" ]; then
                require_cmd npx
                run_guardrail "⚡ Running tsc --noEmit..." "❌ Guardrail failed: TypeScript type errors found." "typescript_guardrail_failed" "TypeScript" npx tsc --noEmit
            fi

            if has_npm_script lint; then
                require_cmd npm
                run_guardrail "🧹 Running linter..." "❌ Guardrail failed: Linter errors found." "lint_guardrail_failed" "ESLint" npm run lint
            fi

            if has_npm_script test; then
                require_cmd npm
                if is_placeholder_test_script; then
                    info "⏭️ Skipping placeholder test script in package.json."
                else
                    run_guardrail "🧪 Running tests..." "❌ Guardrail failed: Tests failed." "test_guardrail_failed" "Tests" npm test
                fi
            fi
        fi

        info "✅ All guardrails passed."
        clear_runtime_failure

        info "🚀 Pushing to remote..."
        record_runtime_step
        git -C "$REPO_ROOT" push --set-upstream "$(upstream_remote)" "$(current_branch)" || die "❌ Push failed."

        info "✅ Sync complete. Work safely landed."

        notify_session_success
        finish_runtime_session

        info "💀 Phase 3: Terminating agent session to release resources..."
        if [ -n "${TMUX:-}" ]; then
            tmux kill-window
        else
            info "✅ Session finished outside tmux. No process termination needed."
        fi
        ;;
    "merge")
        ensure_sync_preconditions

        branch="$(current_branch)"

        if [ "$branch" = "master" ]; then
            die "❌ No se puede hacer merge desde master. Cambia a una rama de feature."
        fi

        pr_json="$(get_current_pr)"

        pr_number="$(echo "$pr_json" | jq -r '.number // empty')"

        if [ -z "$pr_number" ]; then
            die "❌ No hay PR abierto para la rama '$branch'. Ejecuta 'bd sync' primero."
        fi

        info "🔍 Ricky (E2E Gate)..."

        run_ricky_e2e

        info "⚖️ Judge (Code Review)..."

        run_juez_review

        info "🚀 Mergeando PR #$pr_number..."

        gh pr merge "$pr_number" --squash --delete-branch || die "❌ Merge falló."

        info "✅ PR #$pr_number mergeado exitosamente."

        info "🔄 Sincronizando master local..."

        git -C "$REPO_ROOT" checkout master || die "❌ No se pudo checkout a master."
        git -C "$REPO_ROOT" pull --prune origin master || warn "⚠️ Pull de master falló."

        ;;
    "status")
        ensure_sync_preconditions

        branch="$(current_branch)"

        if [ "$branch" = "master" ]; then
            info "ℹ️ Estas en master. No hay PR que revisar."
            exit 0
        fi

        pr_json="$(get_current_pr)"

        pr_number="$(echo "$pr_json" | jq -r '.number // empty')"
        pr_title="$(echo "$pr_json" | jq -r '.title // empty')"
        pr_url="$(echo "$pr_json" | jq -r '.url // empty')"

        if [ -z "$pr_number" ]; then
            info "❌ No hay PR abierto para la rama '$branch'."
            info "Ejecuta 'bd sync' para crear el PR."
            exit 1
        fi

        info "📋 PR #$pr_number: $pr_title"
        info "   URL: $pr_url"
        info ""
        info "QA Gates:"
        info "  👁️ Miron (Visual): $([ -f "$REPO_ROOT/.ralphito-session.json" ] && jq -r '.qaConfig.enableVisualQa // false' "$REPO_ROOT/.ralphito-session.json" 2>/dev/null && echo "habilitado" || echo "deshabilitado")"
        info "  🔍 Ricky (E2E): $([ -f "$REPO_ROOT/.ralphito-session.json" ] && jq -r '.qaConfig.enableE2eQa // false' "$REPO_ROOT/.ralphito-session.json" 2>/dev/null && echo "habilitado" || echo "deshabilitado")"
        info ""
        info "Ejecuta 'bd merge' para ejecutar Ricky + Judge y hacer el merge."
        ;;
    *)
        usage
        exit 1
        ;;
esac
