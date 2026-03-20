#!/bin/bash
# Uso: ./notify_telegram.sh "Mensaje que quieres enviar" [chat_id]
# Si chat_id no se pasa, usa TELEGRAM_ALLOWED_CHAT_ID del .env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Intentar cargar .env si existe
if [ -f "$REPO_ROOT/.env" ]; then
    export $(grep -v '^#' "$REPO_ROOT/.env" | xargs)
fi

MESSAGE="$1"
CHAT_ID="${2:-${TELEGRAM_ALLOWED_CHAT_ID}}"

if [ -z "$MESSAGE" ]; then
    echo "Error: Se requiere un mensaje."
    exit 1
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "Aviso: TELEGRAM_BOT_TOKEN o CHAT_ID no configurados. No se enviará notificación."
    exit 0
fi

# Hacer la petición a la API de Telegram usando curl
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=${MESSAGE}" \
    -d "parse_mode=HTML")

# Verificar si fue exitoso
if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "Notificación enviada a Telegram."
else
    echo "Error enviando notificación a Telegram: $RESPONSE"
    exit 1
fi
