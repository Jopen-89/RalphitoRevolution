#!/bin/bash

set -euo pipefail

# Uso: ./tool_spawn_executor.sh <proyecto> <prompt_o_spec_path>
#    o ./tool_spawn_executor.sh --payload-file <ruta.json>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCKS_FILE="$SCRIPT_DIR/.locks.jsonl"

source "$SCRIPT_DIR/../lib/ao-paths.sh"

json_escape() {
    python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

extract_payload_field() {
    local payload_file="$1"
    local field_name="$2"

    python3 - <<'PY' "$payload_file" "$field_name"
import json
import sys

payload_path, field_name = sys.argv[1], sys.argv[2]
with open(payload_path, encoding='utf-8') as handle:
    payload = json.load(handle)

value = payload.get(field_name)
if value is None:
    raise SystemExit(0)

if isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=True))
else:
    print(value)
PY
}

compute_bead_hash() {
    local bead_file="$1"

    if [ ! -f "$bead_file" ]; then
        return 0
    fi

    sha256sum "$bead_file" | cut -d' ' -f1
}

compute_bead_version() {
    local bead_hash="$1"

    if [ -z "$bead_hash" ]; then
        return 0
    fi

    printf '%s\n' "${bead_hash:0:12}"
}

persist_session_metadata() {
    local worktree_path="$1"
    local session_id="$2"
    local project="$3"
    local prompt="$4"
    local bead_path="$5"
    local work_item_key="$6"
    local model="$7"
    local bead_spec_hash="$8"
    local bead_spec_version="$9"
    local qa_config="${10}"

    local session_file="$worktree_path/.ralphito-session.json"

    python3 - <<'PY' "$session_file" "$session_id" "$project" "$prompt" "$bead_path" "$work_item_key" "$model" "$bead_spec_hash" "$bead_spec_version" "$qa_config"
import json
import os
import sys
from datetime import datetime, timezone

(
    session_file,
    session_id,
    project,
    prompt,
    bead_path,
    work_item_key,
    model,
    bead_spec_hash,
    bead_spec_version,
    qa_config_raw,
) = sys.argv[1:]

payload = {
    'sessionId': session_id,
    'project': project,
    'model': model or None,
    'prompt': prompt,
    'beadPath': bead_path or None,
    'workItemKey': work_item_key or None,
    'beadSpecHash': bead_spec_hash or None,
    'beadSpecVersion': bead_spec_version or None,
    'qaConfig': json.loads(qa_config_raw) if qa_config_raw else None,
    'updatedAt': datetime.now(timezone.utc).isoformat(),
}

if os.path.exists(session_file):
    try:
        with open(session_file, encoding='utf-8') as handle:
            existing = json.load(handle)
        if isinstance(existing, dict):
            existing.update({key: value for key, value in payload.items() if value is not None or key == 'qaConfig'})
            payload = existing
    except Exception:
        pass

with open(session_file, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, indent=2)
    handle.write('\n')
PY
}

parse_args() {
    PROJECT=""
    PROMPT=""
    BEAD_PATH=""
    WORK_ITEM_KEY=""
    MODEL=""
    QA_CONFIG=""
    PAYLOAD_FILE=""

    if [ "${1:-}" = "--payload-file" ]; then
        PAYLOAD_FILE="${2:-}"

        if [ -z "$PAYLOAD_FILE" ] || [ ! -f "$PAYLOAD_FILE" ]; then
            printf '{"status":"error","message":"Falta un payload valido para --payload-file."}\n'
            exit 1
        fi

        PROJECT="$(extract_payload_field "$PAYLOAD_FILE" project)"
        PROMPT="$(extract_payload_field "$PAYLOAD_FILE" prompt)"
        BEAD_PATH="$(extract_payload_field "$PAYLOAD_FILE" beadPath)"
        WORK_ITEM_KEY="$(extract_payload_field "$PAYLOAD_FILE" workItemKey)"
        MODEL="$(extract_payload_field "$PAYLOAD_FILE" model)"
        QA_CONFIG="$(extract_payload_field "$PAYLOAD_FILE" qaConfig)"
    else
        PROJECT="${1:-}"
        PROMPT="${2:-}"
    fi

    if [ -z "$PROJECT" ] || [ -z "$PROMPT" ]; then
        printf '{"status":"error","message":"Faltan argumentos. Uso: tool_spawn_executor.sh <proyecto> <prompt_o_spec_path> o --payload-file <ruta.json>"}\n'
        exit 1
    fi

    if [ -z "$BEAD_PATH" ]; then
        BEAD_PATH=$(printf '%s' "$PROMPT" | python3 -c 'import re,sys; match=re.search(r"docs/specs/[^\s]*bead[^\s]*\.md", sys.stdin.read()); print(match.group(0) if match else "")')
    fi
}

acquire_lock_if_needed() {
    local bead_file=""
    local write_globs=""
    local normalized_globs=""

    if [ -z "$BEAD_PATH" ]; then
        return 0
    fi

    bead_file="$REPO_ROOT/$BEAD_PATH"
    if [ ! -f "$bead_file" ]; then
        return 0
    fi

    write_globs=$(python3 - <<'PY' "$bead_file"
import re
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    content = handle.read()

match = re.search(r'^\[WRITE_ONLY_GLOBS\]:\s*(.+)$', content, re.MULTILINE)
print(match.group(1).strip() if match else '')
PY
)

    if [ -z "$write_globs" ]; then
        return 0
    fi

    normalized_globs=$(printf '%s' "$write_globs" | tr -d ' []"')

    if [ -f "$LOCKS_FILE" ] && grep -Fq "\"lock\": \"$normalized_globs\"" "$LOCKS_FILE"; then
        local collision_message
        collision_message="MUTEX COLLISION: Otro Ralphito ya esta editando $normalized_globs. Pon este bead en cola y lanza otro distinto."
        printf '{"status":"error","message":%s}\n' "$(printf '%s' "$collision_message" | json_escape)"
        exit 1
    fi

    python3 - <<'PY' "$LOCKS_FILE" "$normalized_globs" "$BEAD_PATH"
import json
import sys

lock_file, normalized_globs, bead_path = sys.argv[1:]
with open(lock_file, 'a', encoding='utf-8') as handle:
    handle.write(json.dumps({'lock': normalized_globs, 'bead': bead_path}) + '\n')
PY
}

main() {
    parse_args "$@"
    acquire_lock_if_needed

    local bead_file=""
    local bead_spec_hash=""
    local bead_spec_version=""
    local spawn_log="/tmp/spawn_output_$$.log"
    local send_log="/tmp/send_output_$$.log"
    local session_id=""
    local worktree_path=""
    local metadata_warning=""

    if [ -n "$BEAD_PATH" ]; then
        bead_file="$REPO_ROOT/$BEAD_PATH"
        bead_spec_hash="$(compute_bead_hash "$bead_file")"
        bead_spec_version="$(compute_bead_version "$bead_spec_hash")"
    fi

    echo "🚀 Spawned Ralphito para el proyecto: $PROJECT" >&2
    echo "Instruccion: $PROMPT" >&2

    if ao spawn "$PROJECT" > "$spawn_log" 2>&1; then
        session_id=$(python3 - <<'PY' "$spawn_log"
import sys

session_id = ''
with open(sys.argv[1], encoding='utf-8') as handle:
    for line in handle:
        if line.startswith('SESSION='):
            session_id = line.strip().split('=', 1)[1]

print(session_id)
PY
)

        if [ -z "$session_id" ]; then
            printf '{"status":"error","message":"AO creo una sesion pero no devolvio SESSION=. Revisa tool_check_status."}\n'
            rm -f "$spawn_log" "$send_log"
            exit 1
        fi

        if ! ao send "$session_id" "$PROMPT" > "$send_log" 2>&1; then
            local error
            error=$(tr '\n' ' ' < "$send_log")
            printf '{"status":"error","session_id":"%s","message":"Se creo la sesion pero fallo el envio del prompt.","details":%s}\n' "$session_id" "$(printf '%s' "$error" | json_escape)"
            rm -f "$spawn_log" "$send_log"
            exit 1
        fi

        worktree_path=$(wait_for_ao_worktree "$session_id" 20 || true)
        if [ -n "$worktree_path" ]; then
            persist_session_metadata "$worktree_path" "$session_id" "$PROJECT" "$PROMPT" "$BEAD_PATH" "$WORK_ITEM_KEY" "$MODEL" "$bead_spec_hash" "$bead_spec_version" "$QA_CONFIG"
        else
            metadata_warning=' La sesion arranco, pero no pude persistir metadata porque el worktree no aparecio a tiempo.'
        fi

        printf '{"status":"success","session_id":"%s","message":"Ralphito iniciado correctamente y prompt enviado.%s Usa tool_check_status para ver su progreso.","model":%s,"bead_spec_hash":%s,"bead_spec_version":%s}\n' \
            "$session_id" \
            "$metadata_warning" \
            "$(printf '%s' "$MODEL" | json_escape)" \
            "$(printf '%s' "$bead_spec_hash" | json_escape)" \
            "$(printf '%s' "$bead_spec_version" | json_escape)"
    else
        local error
        error=$(tr '\n' ' ' < "$spawn_log")
        printf '{"status":"error","message":%s}\n' "$(printf '%s' "$error" | json_escape)"
        rm -f "$spawn_log" "$send_log"
        exit 1
    fi

    rm -f "$spawn_log" "$send_log"
}

main "$@"
