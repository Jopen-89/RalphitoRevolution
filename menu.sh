#!/bin/bash

# ==========================================
# RALPHITO REVOLUTION - CONTROL PANEL
# ==========================================

# Variables
LOG_DIR="docs/state"
BOT_LOG="$LOG_DIR/telegram_bot.log"
AO_LOG="$LOG_DIR/ao_core.log"
GATEWAY_LOG="$LOG_DIR/gateway.log"
REPO_ROOT="$(pwd)"

# Asegurar que el directorio de logs existe
mkdir -p "$LOG_DIR"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Función para mostrar el estado actual
show_status() {
    echo -n "Estado AO: "
    if pgrep -f "agent-orchestrator" > /dev/null || pgrep -f "ao start" > /dev/null; then
        echo -e "${GREEN}Corriendo${NC}"
    else
        echo -e "${RED}Detenido${NC}"
    fi

    echo -n "Estado Gateway: "
    if pgrep -f "tsx src/features/llm-gateway/api/server.ts" > /dev/null; then
        echo -e "${GREEN}Corriendo (Puerto 3005)${NC}"
    else
        echo -e "${RED}Detenido${NC}"
    fi

    echo -n "Estado Bot: "
    if pgrep -f "src/features/telegram/bot.ts" > /dev/null; then
        echo -e "${GREEN}Corriendo${NC}"
    else
        echo -e "${RED}Detenido${NC}"
    fi

    # Verificar puerto del Dashboard
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
        echo -e "Dashboard: ${GREEN}Activo en http://localhost:3000${NC}"
    else
        echo -e "Dashboard: ${RED}No detectado en puerto 3000${NC}"
    fi
    echo ""
}

# Funciones de control
start_all() {
    echo -e "${YELLOW}🚀 Iniciando Agent Orchestrator...${NC}"
    nohup ao start backend-team > "$AO_LOG" 2>&1 &
    
    echo -e "${YELLOW}🧠 Iniciando LLM Gateway...${NC}"
    nohup npm run start:gateway > "$GATEWAY_LOG" 2>&1 &

    echo -e "${YELLOW}🤖 Iniciando Bot de Telegram...${NC}"
    nohup npm run start:bot > "$BOT_LOG" 2>&1 &
    
    echo -e "${GREEN}✅ Sistema iniciado en segundo plano.${NC}"
    echo "Presiona ENTER para continuar..."
    read
}

stop_all() {
    echo -e "${YELLOW}🛑 Deteniendo Bot de Telegram...${NC}"
    pkill -f "src/features/telegram/bot.ts" || echo -e "${CYAN}El bot ya estaba detenido.${NC}"
    echo -e "${YELLOW}🛑 Deteniendo LLM Gateway...${NC}"
    pkill -f "tsx src/features/llm-gateway/api/server.ts" || echo -e "${CYAN}El Gateway ya estaba detenido.${NC}"
    echo -e "${YELLOW}🛑 Deteniendo Agent Orchestrator...${NC}"
    ao stop backend-team || echo -e "${CYAN}AO ya estaba detenido.${NC}"
    echo -e "${GREEN}✅ Sistema completamente detenido.${NC}"
    read
}

check_status() {
    echo -e "${YELLOW}📊 Consultando estado de los agentes...${NC}"
    ./scripts/tools/tool_check_status.sh
    echo ""
    echo "Presiona ENTER para volver al menú..."
    read
}

view_logs() {
    echo -e "${CYAN}Últimos logs del Bot:${NC}"
    tail -n 10 "$BOT_LOG" 2>/dev/null
    echo -e "\n${CYAN}Últimos logs del Gateway:${NC}"
    tail -n 10 "$GATEWAY_LOG" 2>/dev/null
    echo -e "\n${CYAN}Últimos logs de AO:${NC}"
    tail -n 10 "$AO_LOG" 2>/dev/null
    echo ""
    read
}

open_dashboard() {
    echo -e "${YELLOW}🌐 Abriendo Dashboard...${NC}"
    xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null
    echo -e "Visita: ${CYAN}http://localhost:3000${NC}"
    read
}

start_inception() {
    read -p "Nueva Idea: " idea
    if [ -n "$idea" ]; then
        ./scripts/tools/tool_spawn_executor.sh backend-team "Eres Moncho. Idea: '$idea'. Inicia Fase 0: Inception (grill-me)."
    fi
    read
}

join_chat() {
    echo -e "${CYAN}======================================================${NC}"
    echo -e "${YELLOW}⌨️  CONSOLA DE CHAT (INTERACTUAR CON AGENTES)${NC}"
    echo -e "${CYAN}======================================================${NC}"
    echo -e "Listando sesiones activas..."
    npx tsx scripts/ao-status.ts table
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

configure_gateway() {
    npm run gateway
}

# Bucle Principal
while true; do
    clear
    echo -e "${CYAN}======================================================"
    echo "       🤖 RALPHITO REVOLUTION CONTROL PANEL 🤖       "
    echo -e "======================================================"
    echo -e "${NC}"
    show_status
    echo -e "  [${GREEN}1${NC}] 🚀 Arrancar Sistema (Fábrica + Gateway + Bot)"
    echo -e "  [${RED}2${NC}] 🛑 Detener Sistema"
    echo -e "  [${YELLOW}3${NC}] 🔄 Reiniciar Todo"
    echo -e "  [${CYAN}4${NC}] 📊 Ver Estado de los Ralphitos (Check Status)"
    echo -e "  [${CYAN}5${NC}] 📄 Ver Logs Rápidos (Bot/Gateway/AO)"
    echo -e "  [${CYAN}6${NC}] 🌐 Abrir Dashboard Web"
    echo -e "  [${YELLOW}7${NC}] 💬 Iniciar Nueva Idea (Chat con Moncho)"
    echo -e "  [${GREEN}8${NC}] ⌨️  Entrar al Chat de un Agente (Consola CLI)"
    echo -e "  [${YELLOW}9${NC}] ⚙️  Configurar Gateway (TUI Fallbacks)"
    echo -e "  [${MAGENTA}M${NC}] 📈 Live Monitor (Ver fábrica en tiempo real)"
    echo -e "  [${RED}0${NC}] ❌ Salir del Panel"
    echo ""
    read -p "Elige una opción (0-9, M): " option
    case $option in
        1) start_all ;;
        2) stop_all ;;
        3) stop_all; start_all ;;
        4) check_status ;;
        5) view_logs ;;
        6) open_dashboard ;;
        7) start_inception ;;
        8) join_chat ;;
        9) configure_gateway ;;
        m|M) npx tsx scripts/live-monitor.ts ;;
        0) exit 0 ;;
        *) sleep 1 ;;
    esac
done
