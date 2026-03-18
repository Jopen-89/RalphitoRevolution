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

echo "Iniciando Fase de Divergencia para la idea: '$SEED_IDEA'..." >&2

# 1. Martapepis (Business & Market)
"$SCRIPT_DIR/tool_spawn_executor.sh" "$PROJECT_ID" \
"Eres Martapepis (Researcher). Tu tarea es la Fase de Divergencia: Investigación de Mercado y Negocio.
1. Lee agents/roles/Researcher(Martapepis).md.
2. Investiga la idea: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/business-analysis.md siguiendo tu plantilla."

# 2. Poncho (Technical Constraints)
"$SCRIPT_DIR/tool_spawn_executor.sh" "$PROJECT_ID" \
"Eres Poncho (Architect). Tu tarea es la Fase de Divergencia: Investigación Técnica.
1. Lee agents/roles/TechnicalArchitect(Poncho).md.
2. Investiga la viabilidad técnica para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/technical-constraints.md siguiendo tu plantilla."

# 3. Mapito (Security & Ethics)
"$SCRIPT_DIR/tool_spawn_executor.sh" "$PROJECT_ID" \
"Eres Mapito (Security). Tu tarea es la Fase de Divergencia: Seguridad y Ética.
1. Lee agents/roles/SecurityAuditor(Mapito).md.
2. Define los límites éticos y de seguridad para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/security-and-ethics.md siguiendo tu plantilla."

# 4. Lola (UI/UX & Human Behavior)
"$SCRIPT_DIR/tool_spawn_executor.sh" "$PROJECT_ID" \
"Eres Lola (UI/UX). Tu tarea es la Fase de Divergencia: Comportamiento Humano y Diseño.
1. Lee agents/roles/UIDesigner(Lola).md.
2. Investiga la psicología de usuario y flujos para: '$SEED_IDEA'.
3. Escribe tus hallazgos en docs/specs/meta/research/human-behavior.md siguiendo tu plantilla."

printf '{"status":"success","message":"Fase de Divergencia iniciada. 4 agentes (Martapepis, Poncho, Mapito, Lola) están investigando en paralelo. Usa tool_check_status.sh para monitorearlos."}\n'
