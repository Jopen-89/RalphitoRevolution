#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/runtime-paths.sh"

# Uso: ./tool_get_diff.sh <session_id>
# Para que Juez vea qué ha hecho el Ralphito

SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_get_diff <session_id>"}'
    exit 1
fi

# Buscamos el worktree
WORKTREE_PATH=$(find_runtime_worktree "$SESSION_ID")

if [ -z "$WORKTREE_PATH" ]; then
    echo '{"error": "No se encontró el worktree para la sesión '$SESSION_ID'"}'
    exit 1
fi

echo "=== DIFF DE LA SESIÓN $SESSION_ID ==="
cd "$WORKTREE_PATH" || exit 1
# Mostramos el diff entre la rama principal (master) y la rama actual del Ralphito
git diff origin/master...HEAD
