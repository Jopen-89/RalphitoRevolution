#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/runtime-paths.sh"

# Uso: ./scripts/resume.sh <session-id>
# Ejemplo: ./scripts/resume.sh rr-1

SESSION_ID="${1:-}"
ENGINE_CLI="$REPO_ROOT/src/features/engine/cli.ts"

if [ -z "$SESSION_ID" ]; then
    echo "❌ Debes proporcionar el ID de la sesión."
    echo "Uso: $0 <session-id>"
    exit 1
fi

run_engine_cli() {
    npx tsx "$ENGINE_CLI" "$@"
}

echo "🔍 Buscando fallo runtime en los worktrees del engine..."

WORKTREE_PATH=$(find_runtime_worktree "$SESSION_ID")

if [ -z "$WORKTREE_PATH" ]; then
    echo "❌ No se pudo encontrar el worktree para la sesión $SESSION_ID."
    exit 1
fi

FAILURE_FILE="$WORKTREE_PATH/.ralphito-runtime-failure.json"
LEGACY_LOG_FILE="$WORKTREE_PATH/.guardrail_error.log"

if [ -f "$FAILURE_FILE" ]; then
    echo "✅ Failure moderno encontrado."
elif [ -f "$LEGACY_LOG_FILE" ]; then
    echo "⚠️ Solo hay log legacy. Convirtiendo a failure record moderno..."
    FAILURE_SUMMARY="$(grep -m1 -v '^[[:space:]]*$' "$LEGACY_LOG_FILE" || true)"
    if [ -z "$FAILURE_SUMMARY" ]; then
        FAILURE_SUMMARY="Fallo legacy sin resumen estructurado."
    fi
    if ! run_engine_cli record-failure "$SESSION_ID" "legacy_guardrail_failed" "$FAILURE_SUMMARY" "$LEGACY_LOG_FILE" >/dev/null; then
        echo "❌ No pude convertir el log legacy a failure record moderno."
        exit 1
    fi
else
    echo "❌ No se encontró .ralphito-runtime-failure.json ni .guardrail_error.log en $WORKTREE_PATH"
    echo "Quizás no hubo fallo resumible."
    exit 1
fi

echo "✅ Fallo encontrado. Preparando reanudación..."
echo "🚀 Enviando mensaje a la sesión $SESSION_ID..."
if ! run_engine_cli resume-session "$SESSION_ID" >/dev/null; then
    echo "❌ Falló la reanudación estructurada para $SESSION_ID."
    exit 1
fi

echo "✅ Contexto reinyectado. Sesión reanudada."
