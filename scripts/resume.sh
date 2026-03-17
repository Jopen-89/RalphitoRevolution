#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/ao-paths.sh"

# Uso: ./scripts/resume.sh <session-id>
# Ejemplo: ./scripts/resume.sh rr-1

SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
    echo "❌ Debes proporcionar el ID de la sesión."
    echo "Uso: $0 <session-id>"
    exit 1
fi

echo "🔍 Buscando archivo de error en los worktrees..."

# Buscamos el archivo de error en el worktree correspondiente a esa sesión.
# Asumimos la estructura por defecto de AO: ~/.agent-orchestrator/<hash>-<project>/worktrees/<session-id>/
WORKTREE_PATH=$(find_ao_worktree "$SESSION_ID")

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

# Leemos el error, pero lo truncamos a las últimas 50 líneas para no gastar demasiados tokens.
ERROR_CONTENT=$(tail -n 50 "$ERROR_FILE")

PROMPT="Los guardrails locales han fallado al intentar hacer 'bd sync'. Tu código no puede ser pusheado hasta que arregles este error. Aquí tienes la salida del fallo:\n\n\`\`\`\n$ERROR_CONTENT\n\`\`\`\n\nPor favor, arréglalo y vuelve a ejecutar 'bd sync'."

echo "🚀 Enviando mensaje a la sesión $SESSION_ID..."

# Usamos el comando nativo de Agent Orchestrator para enviarle el error a la sesión.
# Esto despertará al agente (si está en pausa) o se pondrá en la cola.
ao send "$SESSION_ID" "$PROMPT"

echo "✅ Contexto inyectado. El agente ha resucitado con el error."
