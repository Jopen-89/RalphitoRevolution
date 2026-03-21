#!/bin/bash
# Uso: ./tool_update_traceability.sh <ruta_al_json> <bead_id> <nuevo_estado> [assigned_agent] [runtime_session_id] [failure_reason]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

JSON_PATH="${1:-}"
BEAD_ID="${2:-}"
NEW_STATUS="${3:-}"
ASSIGNED_AGENT="${4:-}"
RUNTIME_SESSION_ID="${5:-}"
FAILURE_REASON="${6:-}"

if [ -z "$JSON_PATH" ] || [ -z "$BEAD_ID" ] || [ -z "$NEW_STATUS" ]; then
    echo '{"error": "Faltan argumentos. Uso: ./tool_update_traceability.sh <json_path> <bead_id> <status> [assigned_agent] [runtime_session_id] [failure_reason]"}'
    exit 1
fi

if [ ! -f "$JSON_PATH" ]; then
    echo '{"error": "El archivo JSON no existe."}'
    exit 1
fi

npx tsx "$REPO_ROOT/scripts/ralphito-tasks.ts" update-from-trace "$JSON_PATH" "$BEAD_ID" "$NEW_STATUS" "$ASSIGNED_AGENT" "$RUNTIME_SESSION_ID" "$FAILURE_REASON"
