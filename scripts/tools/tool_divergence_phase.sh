#!/bin/bash
# tool_divergence_phase.sh - Inicia la Fase de Divergencia (Investigación Paralela)
# Uso: ./scripts/tools/tool_divergence_phase.sh <proyecto_id> <seed_idea>

set -euo pipefail

PROJECT_ID=$1
SEED_IDEA=$2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$PROJECT_ID" ] || [ -z "$SEED_IDEA" ]; then
    printf '{"status":"error","message":"Uso: tool_divergence_phase.sh <proyecto_id> <seed_idea>"}\n'
    exit 1
fi

json_escape() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Iniciando Fase de Divergencia para la idea: '$SEED_IDEA'..." >&2

launch_spawn() {
    local team=$1
    local prompt=$2
    local stdout_file="$TMP_DIR/${team}.stdout"
    local stderr_file="$TMP_DIR/${team}.stderr"

    "$SCRIPT_DIR/tool_spawn_executor.sh" "$team" "$prompt" >"$stdout_file" 2>"$stderr_file" &
    LAST_PID=$!
}

launch_spawn "research-team" "Eres Martapepis (Researcher). Tu tarea es la Fase de Divergencia: Investigación de Mercado y Negocio.
1. Lee agents/roles/Researcher(Martapepis).md.
2. Investiga la idea: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/business-analysis.md siguiendo tu plantilla."
RESEARCH_PID=$LAST_PID

launch_spawn "backend-team" "Eres Poncho (Architect). Tu tarea es la Fase de Divergencia: Investigación Técnica.
1. Lee agents/roles/TechnicalArchitect(Poncho).md.
2. Investiga la viabilidad técnica para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/technical-constraints.md siguiendo tu plantilla."
BACKEND_PID=$LAST_PID

launch_spawn "security-team" "Eres Mapito (Security). Tu tarea es la Fase de Divergencia: Seguridad y Ética.
1. Lee agents/roles/SecurityAuditor(Mapito).md.
2. Define los límites éticos y de seguridad para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/security-and-ethics.md siguiendo tu plantilla."
SECURITY_PID=$LAST_PID

launch_spawn "design-team" "Eres Lola (UI/UX). Tu tarea es la Fase de Divergencia: Comportamiento Humano y Diseño.
1. Lee agents/roles/UIDesigner(Lola).md.
2. Investiga la psicología de usuario y flujos para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/human-behavior.md siguiendo tu plantilla."
DESIGN_PID=$LAST_PID

wait "$RESEARCH_PID" || true
wait "$BACKEND_PID" || true
wait "$SECURITY_PID" || true
wait "$DESIGN_PID" || true

RESEARCH_RESULT=$(cat "$TMP_DIR/research-team.stdout")
BACKEND_RESULT=$(cat "$TMP_DIR/backend-team.stdout")
SECURITY_RESULT=$(cat "$TMP_DIR/security-team.stdout")
DESIGN_RESULT=$(cat "$TMP_DIR/design-team.stdout")

FAILED_TEAMS=()
for team in research-team backend-team security-team design-team; do
    if ! grep -q '"status":"success"' "$TMP_DIR/${team}.stdout"; then
        FAILED_TEAMS+=("$team")
    fi
done

if [ "${#FAILED_TEAMS[@]}" -eq 0 ]; then
    printf '{"status":"success","message":"Fase de Divergencia iniciada. 4 agentes lanzados en paralelo.","results":{"research-team":%s,"backend-team":%s,"security-team":%s,"design-team":%s}}\n' \
        "$RESEARCH_RESULT" \
        "$BACKEND_RESULT" \
        "$SECURITY_RESULT" \
        "$DESIGN_RESULT"
else
    printf '{"status":"partial","message":"Fase de Divergencia lanzada con fallos.","failed_teams":%s,"results":{"research-team":%s,"backend-team":%s,"security-team":%s,"design-team":%s}}\n' \
        "$(printf '%s\n' "${FAILED_TEAMS[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')" \
        "$(if [ -s "$TMP_DIR/research-team.stdout" ]; then printf '%s' "$RESEARCH_RESULT"; else printf '{"status":"error","stderr":%s}' "$(json_escape "$(cat "$TMP_DIR/research-team.stderr")")"; fi)" \
        "$(if [ -s "$TMP_DIR/backend-team.stdout" ]; then printf '%s' "$BACKEND_RESULT"; else printf '{"status":"error","stderr":%s}' "$(json_escape "$(cat "$TMP_DIR/backend-team.stderr")")"; fi)" \
        "$(if [ -s "$TMP_DIR/security-team.stdout" ]; then printf '%s' "$SECURITY_RESULT"; else printf '{"status":"error","stderr":%s}' "$(json_escape "$(cat "$TMP_DIR/security-team.stderr")")"; fi)" \
        "$(if [ -s "$TMP_DIR/design-team.stdout" ]; then printf '%s' "$DESIGN_RESULT"; else printf '{"status":"error","stderr":%s}' "$(json_escape "$(cat "$TMP_DIR/design-team.stderr")")"; fi)"
fi
