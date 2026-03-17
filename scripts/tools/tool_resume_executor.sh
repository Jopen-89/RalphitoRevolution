#!/bin/bash

set -euo pipefail

# Uso: ./tool_resume_executor.sh <session_id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../lib/ao-paths.sh"

SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_resume_executor <session_id>"}'
    exit 1
fi

if "$REPO_ROOT/scripts/resume.sh" "$SESSION_ID"; then
    # Tras inyectar el error, borramos el log de guardrail para que tool_check_status ya no lo marque como muerto
    WORKTREE_PATH=$(find_ao_worktree "$SESSION_ID")
    if [ -n "$WORKTREE_PATH" ]; then
        rm -f "$WORKTREE_PATH/.guardrail_error.log"
    fi
    echo '{"status": "success", "message": "Ralphito resucitado. Error inyectado en su contexto."}'
else
    echo '{"status": "error", "message": "Fallo al intentar resucitar a la sesión."}'
fi
