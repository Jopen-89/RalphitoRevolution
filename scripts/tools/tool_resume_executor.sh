#!/bin/bash
# Uso: ./tool_resume_executor.sh <session_id>

SESSION_ID=$1

if [ -z "$SESSION_ID" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_resume_executor <session_id>"}'
    exit 1
fi

# Llamamos al script de la Fase 4
/home/pepu/IAproject/RalphitoRevolution/scripts/resume.sh "$SESSION_ID"

if [ $? -eq 0 ]; then
    # Tras inyectar el error, borramos el log de guardrail para que tool_check_status ya no lo marque como muerto
    WORKTREE_PATH=$(find ~/.agent-orchestrator -type d -path "*/worktrees/$SESSION_ID" | head -n 1)
    if [ -n "$WORKTREE_PATH" ]; then
        rm -f "$WORKTREE_PATH/.guardrail_error.log"
    fi
    echo '{"status": "success", "message": "Ralphito resucitado. Error inyectado en su contexto."}'
else
    echo '{"status": "error", "message": "Fallo al intentar resucitar a la sesión."}'
fi