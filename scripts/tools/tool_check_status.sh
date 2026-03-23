#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/../lib/runtime-paths.sh"

# Uso: ./tool_check_status

# Primero mostramos el estado que conoce Ralphito Engine
echo "=== STATUS DE SESIONES (RALPHITO ENGINE) ==="
ENGINE_STATUS=$(node --import tsx "$REPO_ROOT/scripts/engine-status.ts" table || echo "")
echo "$ENGINE_STATUS"

echo ""
echo "=== ENGINE NOTIFICATIONS OUTBOX ==="
node --import tsx "$REPO_ROOT/scripts/engine-status.ts" notification-summary || true

echo ""
echo "=== ULTIMAS NOTIFICACIONES ==="
node --import tsx "$REPO_ROOT/scripts/engine-status.ts" notifications || true

echo ""
echo "=== BUSCANDO RALPHITOS CAÍDOS (GUARDRAILS FALLIDOS) ==="
FALLOS=$(find_runtime_guardrail_logs)

if [ -z "$FALLOS" ]; then
    echo "✅ No se detectaron errores de guardrails locales. Todos los Ralphitos vivos están sanos."
else
    for FALLO in $FALLOS; do
        SESSION_ID=$(basename "$(dirname "$FALLO")")
        
        # Leemos solo las últimas 15 líneas para no gastar demasiados tokens de Raymon
        ERROR_SNIPPET=$(tail -n 15 "$FALLO")
        
        echo "❌ [ERROR EN GUARDRAIL] Sesión muerta: $SESSION_ID"
        echo "Resumen del error:"
        echo "$ERROR_SNIPPET"
        echo "---"
        echo "💡 Acción sugerida para Raymon: Ejecuta './tool_resume_executor.sh $SESSION_ID' para revivirlo inyectando este error."
        echo ""
    done
fi

echo ""
echo "=== AUTOPILOT QUEUE CHECK ==="
ACTIVE_COUNT=$(node --import tsx "$REPO_ROOT/scripts/engine-status.ts" active-count || echo "0")

if [ "$ACTIVE_COUNT" = "0" ]; then
    echo "⚠️ [AUTOPILOT TRIGGER] La fábrica está parada. No hay Ralphitos trabajando."

    echo "=== ESTADO TRANSACCIONAL DE TASKS (RALPHITO SQLITE) ==="
    npx tsx "$REPO_ROOT/scripts/ralphito-tasks.ts" status-report

    echo "💡 Acción sugerida para Raymon:"
    echo "   - Si estás en MODO MANUAL: Detente y pide confirmación al usuario."
    echo "   - Si estás en MODO CONTINUO: Verifica tu límite de tandas. Si no lo has superado, invoca a Tracker para que revise el estado transaccional y evalúe los siguientes pasos."
else
    echo "⚙️ Hay Ralphitos trabajando. Espera a que terminen o mueran."
fi
