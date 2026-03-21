#!/bin/bash
# Uso: ./tool_spawn_executor <proyecto> <prompt_o_spec_path>
# Ejemplo: ./tool_spawn_executor backend-team "Lee docs/specs/tarea1.md y ejecútala"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROJECT=$1
PROMPT=$2
LOCKS_FILE="$SCRIPT_DIR/.locks.json"

json_escape() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

if [ -z "$PROJECT" ] || [ -z "$PROMPT" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_spawn_executor <proyecto> <prompt_o_spec_path>"}'
    exit 1
fi

# 1. Intentamos extraer la ruta al archivo bead desde el prompt (si la hay)
BEAD_PATH=$(echo "$PROMPT" | grep -o 'docs/specs/[^ ]*bead[^ ]*\.md' | head -n 1 || true)
BEAD_FILE=""

if [ -n "$BEAD_PATH" ]; then
    BEAD_FILE="$REPO_ROOT/$BEAD_PATH"
fi

if [ -n "$BEAD_FILE" ] && [ -f "$BEAD_FILE" ]; then
    # Extraemos el WRITE_ONLY_GLOBS del archivo
    WRITE_GLOBS=$(grep '\[WRITE_ONLY_GLOBS\]:' "$BEAD_FILE" | cut -d':' -f2-)
    
    if [ -n "$WRITE_GLOBS" ]; then
        # Normalizamos la cadena para comparar
        NORMALIZED_GLOBS=$(echo "$WRITE_GLOBS" | tr -d ' ' | tr -d '"' | tr -d '[' | tr -d ']')
        
        # Comprobamos el lock
        if grep -q "\"$NORMALIZED_GLOBS\"" "$LOCKS_FILE" 2>/dev/null; then
            echo '{"status": "error", "message": "MUTEX COLLISION: Otro Ralphito ya está editando '$NORMALIZED_GLOBS'. Pon este Bead en cola y lanza otro distinto."}'
            exit 1
        fi
        
        # Registramos el lock (esto es muy básico, en producción usaríamos jq)
        echo "{\"lock\": \"$NORMALIZED_GLOBS\", \"bead\": \"$BEAD_PATH\"}" >> "$LOCKS_FILE"
    fi
fi

echo "🚀 Spawned Ralphito para el proyecto: $PROJECT" >&2
echo "Instrucción: $PROMPT" >&2

# Ejecutamos ao spawn sin issue para evitar colisiones de branch derivadas del prompt.
# Luego enviamos el prompt al Ralphito ya creado.
LOG_DIR="${TMPDIR:-/tmp}/ralphito-spawn-logs"
mkdir -p "$LOG_DIR"
SAFE_PROJECT=$(printf '%s' "$PROJECT" | tr -c '[:alnum:]._-' '_')
SPAWN_LOG=$(mktemp "$LOG_DIR/${SAFE_PROJECT}.spawn.XXXXXX.log")
SEND_LOG=$(mktemp "$LOG_DIR/${SAFE_PROJECT}.send.XXXXXX.log")

CURRENT_COMMIT_HASH=$(git -C "$REPO_ROOT" rev-parse HEAD)

if ao spawn "$PROJECT" --base-ref "$CURRENT_COMMIT_HASH" > "$SPAWN_LOG" 2>&1; then
    SESSION_ID=$(python3 - <<'PY' "$SPAWN_LOG"
import sys

session_id = ""
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        if line.startswith("SESSION="):
            session_id = line.strip().split("=", 1)[1]

print(session_id)
PY
)
    if [ -z "$SESSION_ID" ]; then
        printf '{"status":"error","message":"AO creó una sesión pero no devolvió SESSION=. Revisa tool_check_status.","spawn_log":%s}\n' "$(json_escape "$SPAWN_LOG")"
    elif ao send "$SESSION_ID" "$PROMPT" > "$SEND_LOG" 2>&1; then
        rm -f "$SPAWN_LOG" "$SEND_LOG"
        printf '{"status":"success","session_id":"%s","base_commit_hash":"%s","message":"Ralphito iniciado correctamente y prompt enviado. Usa tool_check_status para ver su progreso."}\n' "$SESSION_ID" "$CURRENT_COMMIT_HASH"
    else
        ERROR=$(tr '\n' ' ' < "$SEND_LOG")
        ESCAPED_ERROR=$(json_escape "$ERROR")
        printf '{"status":"error","session_id":"%s","message":"Se creó la sesión pero falló el envío del prompt.","details":%s,"spawn_log":%s,"send_log":%s}\n' "$SESSION_ID" "$ESCAPED_ERROR" "$(json_escape "$SPAWN_LOG")" "$(json_escape "$SEND_LOG")"
    fi
else
    ERROR=$(tr '\n' ' ' < "$SPAWN_LOG")
    ESCAPED_ERROR=$(json_escape "$ERROR")
    printf '{"status":"error","message":%s,"spawn_log":%s}\n' "$ESCAPED_ERROR" "$(json_escape "$SPAWN_LOG")"
fi
