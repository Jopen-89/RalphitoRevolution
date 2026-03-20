#!/bin/bash

# ==========================================
# RALPHITO REVOLUTION - CONTROL PANEL
# ==========================================

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LOG_DIR="$REPO_ROOT/docs/state"
BOT_LOG="$LOG_DIR/telegram_bot.log"
GATEWAY_LOG="$LOG_DIR/gateway.log"
GATEWAY_PORT=3005
GATEWAY_BASE_URL="http://localhost:$GATEWAY_PORT"
HEALTH_URL="$GATEWAY_BASE_URL/health"
OPS_STATUS_URL="$GATEWAY_BASE_URL/api/ops/status"
DASHBOARD_URL="$GATEWAY_BASE_URL/dashboard"

# Asegurar que el directorio de logs existe
mkdir -p "$LOG_DIR"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

pause() {
    echo ""
    read -r -p "Presiona ENTER para continuar..."
}

get_gateway_http_code() {
    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$HEALTH_URL" 2>/dev/null)"
    if [ -z "$code" ]; then
        echo "000"
        return
    fi

    echo "$code"
}

is_gateway_process_running() {
    pgrep -f "tsx src/features/llm-gateway/api/server.ts" >/dev/null
}

is_bot_running() {
    pgrep -f "node --import tsx src/features/telegram/bot.ts" >/dev/null || pgrep -f "src/features/telegram/bot.ts" >/dev/null
}

start_background_command() {
    local log_file="$1"
    shift

    (
        cd "$REPO_ROOT" || exit 1
        nohup "$@" > "$log_file" 2>&1 &
    )
}

run_repo_command() {
    (
        cd "$REPO_ROOT" || exit 1
        "$@"
    )
}

show_status() {
    local gateway_http_code
    gateway_http_code="$(get_gateway_http_code)"

    echo -n "Estado Gateway: "
    if [ "$gateway_http_code" = "200" ]; then
        echo -e "${GREEN}OK${NC} (${HEALTH_URL})"
    elif is_gateway_process_running; then
        echo -e "${YELLOW}Responde ${gateway_http_code}${NC}"
    else
        echo -e "${RED}Detenido${NC}"
    fi

    echo -n "Estado Bot: "
    if is_bot_running; then
        echo -e "${GREEN}Corriendo${NC}"
    else
        echo -e "${RED}Detenido${NC}"
    fi

    if lsof -Pi :"$GATEWAY_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "Dashboard: ${GREEN}Activo en ${DASHBOARD_URL}${NC}"
    else
        echo -e "Dashboard: ${RED}No detectado en ${DASHBOARD_URL}${NC}"
    fi

    echo ""
}

# Funciones de control
start_all() {
    echo -e "${YELLOW}🚀 Iniciando Sistema Base...${NC}"

    if [ "$(get_gateway_http_code)" = "200" ] || is_gateway_process_running; then
        echo -e "${CYAN}Gateway ya activo.${NC}"
    else
        echo -e "${YELLOW}🧠 Iniciando LLM Gateway...${NC}"
        start_background_command "$GATEWAY_LOG" npm run start:gateway
    fi

    if is_bot_running; then
        echo -e "${CYAN}Bot ya activo.${NC}"
    else
        echo -e "${YELLOW}🤖 Iniciando Bot de Telegram...${NC}"
        start_background_command "$BOT_LOG" npm run start:bot
    fi
    
    echo -e "${GREEN}✅ Sistema iniciado en segundo plano.${NC}"
    pause
}

stop_all() {
    echo -e "${YELLOW}🛑 Deteniendo Bot de Telegram...${NC}"
    pkill -f "node --import tsx src/features/telegram/bot.ts" || pkill -f "src/features/telegram/bot.ts" || echo -e "${CYAN}El bot ya estaba detenido.${NC}"
    echo -e "${YELLOW}🛑 Deteniendo LLM Gateway...${NC}"
    pkill -f "tsx src/features/llm-gateway/api/server.ts" || echo -e "${CYAN}El Gateway ya estaba detenido.${NC}"
    echo -e "${GREEN}✅ Sistema Base detenido.${NC}"
    pause
}

show_ops_status() {
    local response

    echo -e "${YELLOW}📊 Consultando estado API...${NC}"
    response="$(curl -fsS --max-time 5 "$OPS_STATUS_URL" 2>/dev/null)"

    if [ -z "$response" ]; then
        echo -e "${RED}Gateway no disponible en ${OPS_STATUS_URL}.${NC}"
        pause
        return
    fi

    if command -v jq >/dev/null 2>&1; then
        echo "$response" | jq '{health, metrics, stuckTasks, backup}'
    else
        echo "$response"
    fi

    pause
}

view_logs() {
    echo -e "${CYAN}Últimos logs del Bot:${NC}"
    tail -n 10 "$BOT_LOG" 2>/dev/null
    echo -e "\n${CYAN}Últimos logs del Gateway:${NC}"
    tail -n 10 "$GATEWAY_LOG" 2>/dev/null
    pause
}

open_dashboard() {
    echo -e "${YELLOW}🌐 Abriendo Dashboard...${NC}"

    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$DASHBOARD_URL" >/dev/null 2>&1
    elif command -v open >/dev/null 2>&1; then
        open "$DASHBOARD_URL" >/dev/null 2>&1
    fi

    echo -e "Visita: ${CYAN}${DASHBOARD_URL}${NC}"
    pause
}

start_inception() {
    read -p "Nueva Idea: " idea
    if [ -n "$idea" ]; then
        run_repo_command ./scripts/tools/tool_spawn_executor.sh backend-team "Eres Moncho. Idea: '$idea'. Inicia Fase 0: Inception (grill-me)."
    fi
    pause
}

join_chat() {
    echo -e "${CYAN}======================================================${NC}"
    echo -e "${YELLOW}⌨️  CONSOLA DE CHAT (INTERACTUAR CON AGENTES)${NC}"
    echo -e "${CYAN}======================================================${NC}"
    echo -e "Listando sesiones activas..."
    run_repo_command npx tsx scripts/ao-status.ts table
    echo ""
    read -p "Introduce el SESSION ID para entrar al chat (ej: rr-1) o 'all': " sid
    if [ -n "$sid" ]; then
        echo -e "${GREEN}Abriendo chat interactivo para $sid...${NC}"
        echo -e "${YELLOW}(Tip: Presiona Ctrl+B y luego D para salir del chat sin matarlo)${NC}"
        sleep 2
        ao open "$sid"
    fi
    echo "Presiona ENTER para volver..."
    read
}

live_monitor() {
    run_repo_command npx tsx scripts/live-monitor.ts
}

# Bucle Principal
while true; do
    clear
    echo -e "${CYAN}======================================================"
    echo "       🤖 RALPHITO REVOLUTION CONTROL PANEL 🤖       "
    echo -e "======================================================"
    echo -e "${NC}"
    show_status
    echo -e "${MAGENTA}[=== OPERACIONES PRINCIPALES ===]${NC}"
    echo -e "  [${GREEN}1${NC}] 🚀 Arrancar Sistema Base (Gateway + Telegram Bot)"
    echo -e "  [${RED}2${NC}] 🛑 Detener Sistema Base"
    echo -e "  [${YELLOW}3${NC}] 🔄 Reiniciar Sistema"
    echo -e "  [${CYAN}4${NC}] 🌐 Abrir Dashboard Web (${DASHBOARD_URL})"
    echo ""
    echo -e "${MAGENTA}[=== MONITORIZACIÓN ===]${NC}"
    echo -e "  [${CYAN}5${NC}] 📈 Live Monitor (Fábrica en tiempo real)"
    echo -e "  [${CYAN}6${NC}] 📊 Ver Estado de SQLite / Tareas (API Status)"
    echo -e "  [${CYAN}7${NC}] 📄 Ver Logs (Bot/Gateway)"
    echo ""
    echo -e "${MAGENTA}[=== INTERACCIÓN DE AGENTES ===]${NC}"
    echo -e "  [${YELLOW}8${NC}] 💬 Iniciar Nueva Idea (Chat con Moncho)"
    echo -e "  [${GREEN}9${NC}] ⌨️  Entrar al Chat de un Agente (Consola CLI)"
    echo -e "  [${RED}0${NC}] ❌ Salir del Panel"
    echo ""
    read -p "Elige una opción (0-9): " option
    case $option in
        1) start_all ;;
        2) stop_all ;;
        3) stop_all; start_all ;;
        4) open_dashboard ;;
        5) live_monitor ;;
        6) show_ops_status ;;
        7) view_logs ;;
        8) start_inception ;;
        9) join_chat ;;
        0) exit 0 ;;
        *) sleep 1 ;;
    esac
done
