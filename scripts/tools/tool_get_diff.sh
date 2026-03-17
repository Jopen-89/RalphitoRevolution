#!/bin/bash
# Uso: ./tool_get_diff.sh <session_id>
# Para que Juez vea qué ha hecho el Ralphito

SESSION_ID=$1

if [ -z "$SESSION_ID" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_get_diff <session_id>"}'
    exit 1
fi

# Buscamos el worktree
WORKTREE_PATH=$(find ~/.agent-orchestrator -type d -path "*/worktrees/$SESSION_ID" | head -n 1)

if [ -z "$WORKTREE_PATH" ]; then
    echo '{"error": "No se encontró el worktree para la sesión '$SESSION_ID'"}'
    exit 1
fi

echo "=== DIFF DE LA SESIÓN $SESSION_ID ==="
cd "$WORKTREE_PATH" || exit 1
# Mostramos el diff entre la rama principal (master) y la rama actual del Ralphito
git diff origin/master...HEAD
