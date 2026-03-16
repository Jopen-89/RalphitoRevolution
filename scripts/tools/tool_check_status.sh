#!/bin/bash
# Uso: ./tool_check_status

# Primero mostramos el estado que conoce Agent Orchestrator
echo "=== STATUS DE SESIONES (AGENT ORCHESTRATOR) ==="
ao session ls 

echo ""
echo "=== BUSCANDO RALPHITOS CAÍDOS (GUARDRAILS FALLIDOS) ==="
# Buscamos en el directorio de runtime de AO si hay algún error de guardrail reciente
FALLOS=$(find ~/.agent-orchestrator -type f -name ".guardrail_error.log" 2>/dev/null)

if [ -z "$FALLOS" ]; then
    echo "✅ No se detectaron errores de guardrails locales. Todos los Ralphitos vivos están sanos."
else
    for FALLO in $FALLOS; do
        # Extraemos el session_id desde la ruta: .../worktrees/<session_id>/.guardrail_error.log
        SESSION_ID=$(echo "$FALLO" | awk -F'/worktrees/' '{print $2}' | awk -F'/' '{print $1}')
        
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
