#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/runtime-paths.sh"

# Uso: ./scripts/resume.sh <session-id>
# Ejemplo: ./scripts/resume.sh rr-1

SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
    echo "❌ Debes proporcionar el ID de la sesión."
    echo "Uso: $0 <session-id>"
    exit 1
fi

echo "🔍 Buscando archivo de error en los worktrees del engine..."

WORKTREE_PATH=$(find_runtime_worktree "$SESSION_ID")

if [ -z "$WORKTREE_PATH" ]; then
    echo "❌ No se pudo encontrar el worktree para la sesión $SESSION_ID."
    exit 1
fi

ERROR_FILE="$WORKTREE_PATH/.guardrail_error.log"

if [ ! -f "$ERROR_FILE" ]; then
    echo "❌ No se encontró archivo .guardrail_error.log en $WORKTREE_PATH"
    echo "Quizás los guardrails no fallaron o el agente aún no ejecutó 'bd sync'."
    exit 1
fi

echo "✅ Error encontrado. Preparando inyección de contexto para resucitar al agente..."
echo "🚀 Enviando mensaje a la sesión $SESSION_ID..."
if ! npx tsx "$REPO_ROOT/src/features/engine/cli.ts" resume-session "$SESSION_ID" >/dev/null; then
    echo "❌ Falló la reanudación estructurada para $SESSION_ID."
    exit 1
fi

echo "✅ Contexto inyectado. El agente ha resucitado con el error."
