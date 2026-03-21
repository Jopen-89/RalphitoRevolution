#!/bin/bash
# Uso: ./tool_spawn_executor <proyecto> <prompt_o_spec_path>
# Ejemplo: ./tool_spawn_executor backend-team "Lee docs/specs/tarea1.md y ejecútala"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENGINE_CLI="$REPO_ROOT/src/features/engine/cli.ts"
PROJECT=""
PROMPT=""
BEAD_PATH=""
WORK_ITEM_KEY=""
MODEL=""
BEAD_SPEC_HASH=""
BEAD_SPEC_VERSION=""
QA_CONFIG_JSON="null"
TMP_PAYLOAD=""

run_engine_cli() {
    npx tsx "$ENGINE_CLI" "$@"
}

usage_error() {
    echo '{"error": "Faltan argumentos. Uso: tool_spawn_executor <proyecto> <prompt_o_spec_path>"}'
}

cleanup() {
    if [ -n "$TMP_PAYLOAD" ] && [ -f "$TMP_PAYLOAD" ]; then
        rm -f "$TMP_PAYLOAD"
    fi
}

trap cleanup EXIT

load_payload() {
    local payload_file="$1"

    if [ ! -f "$payload_file" ]; then
        echo '{"error": "Payload no encontrado. Uso: tool_spawn_executor --payload-file <path>"}'
        exit 1
    fi

    jq -e . "$payload_file" >/dev/null

    PROJECT="$(jq -r '.project // ""' "$payload_file")"
    PROMPT="$(jq -r '.prompt // ""' "$payload_file")"
    BEAD_PATH="$(jq -r '.beadPath // ""' "$payload_file")"
    WORK_ITEM_KEY="$(jq -r '.workItemKey // ""' "$payload_file")"
    MODEL="$(jq -r '.model // ""' "$payload_file")"
    BEAD_SPEC_HASH="$(jq -r '.beadSpecHash // ""' "$payload_file")"
    BEAD_SPEC_VERSION="$(jq -r '.beadSpecVersion // ""' "$payload_file")"
    QA_CONFIG_JSON="$(jq -c '.qaConfig // null' "$payload_file")"
}

if [ "${1:-}" = "--payload-file" ]; then
    if [ -z "${2:-}" ]; then
        echo '{"error": "Falta ruta. Uso: tool_spawn_executor --payload-file <path>"}'
        exit 1
    fi

    load_payload "$2"
else
    PROJECT="${1:-}"
    PROMPT="${2:-}"
fi

if [ -z "$PROJECT" ] || [ -z "$PROMPT" ]; then
    usage_error
    exit 1
fi

BEAD_FILE=""

if [ -z "$BEAD_PATH" ]; then
    BEAD_PATH=$(printf '%s' "$PROMPT" | grep -o 'docs/specs/[^ ]*bead[^ ]*\.md' | head -n 1 || true)
fi

if [ -n "$BEAD_PATH" ] && [ -f "$BEAD_PATH" ]; then
    BEAD_FILE="$BEAD_PATH"
elif [ -n "$BEAD_PATH" ] && [ -f "$REPO_ROOT/$BEAD_PATH" ]; then
    BEAD_FILE="$REPO_ROOT/$BEAD_PATH"
fi

if [ -n "$BEAD_FILE" ]; then
    if ! PRECHECK_OUTPUT="$(run_engine_cli preflight-locks "$BEAD_FILE" 2>&1)"; then
        printf '%s\n' "$PRECHECK_OUTPUT"
        exit 0
    fi
fi

TMP_PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/ralphito-engine-payload.XXXXXX.json")"

jq -n \
    --arg project "$PROJECT" \
    --arg prompt "$PROMPT" \
    --arg beadPath "${BEAD_PATH:-}" \
    --arg workItemKey "$WORK_ITEM_KEY" \
    --arg model "$MODEL" \
    --arg beadSpecHash "$BEAD_SPEC_HASH" \
    --arg beadSpecVersion "$BEAD_SPEC_VERSION" \
    --argjson qaConfig "$QA_CONFIG_JSON" \
    '
    {
      project: $project,
      prompt: $prompt
    }
    + (if $beadPath != "" then { beadPath: $beadPath } else {} end)
    + (if $workItemKey != "" then { workItemKey: $workItemKey } else {} end)
    + (if $model != "" then { model: $model } else {} end)
    + (if $beadSpecHash != "" then { beadSpecHash: $beadSpecHash } else {} end)
    + (if $beadSpecVersion != "" then { beadSpecVersion: $beadSpecVersion } else {} end)
    + (if $qaConfig != null then { qaConfig: $qaConfig } else {} end)
    ' > "$TMP_PAYLOAD"

run_engine_cli spawn-session "$TMP_PAYLOAD"
