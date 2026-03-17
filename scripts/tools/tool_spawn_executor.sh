#!/bin/bash
# Uso: ./tool_spawn_executor <proyecto> <prompt_o_spec_path>
# Ejemplo: ./tool_spawn_executor RalphitoRevolution "Lee docs/specs/tarea1.md y ejecútala"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROJECT=$1
PROMPT=$2
LOCKS_FILE="$SCRIPT_DIR/.locks.json"

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

echo "🚀 Spawned Ralphito para el proyecto: $PROJECT"
echo "Instrucción: $PROMPT"

# Ejecutamos ao spawn y filtramos la salida para dar un JSON limpio al orquestador.
# 'ao spawn' normalmente devuelve texto formateado para humanos, intentaremos capturar si fue exitoso.
ao spawn "$PROJECT" "$PROMPT" > /tmp/spawn_output_$$.log 2>&1

if [ $? -eq 0 ]; then
    echo '{"status": "success", "message": "Ralphito iniciado correctamente. Usa tool_check_status para ver su session_id y progreso."}'
else
    ERROR=$(cat /tmp/spawn_output_$$.log | tr '\n' ' ')
    echo '{"status": "error", "message": "'"$ERROR"'"}'
fi
rm /tmp/spawn_output_$$.log
