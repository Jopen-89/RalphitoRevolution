#!/bin/bash
# Uso: ./tool_spawn_executor <proyecto> <prompt_o_spec_path>
# Ejemplo: ./tool_spawn_executor RalphitoRevolution "Lee docs/specs/tarea1.md y ejecútala"

PROJECT=$1
PROMPT=$2

if [ -z "$PROJECT" ] || [ -z "$PROMPT" ]; then
    echo '{"error": "Faltan argumentos. Uso: tool_spawn_executor <proyecto> <prompt>"}'
    exit 1
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