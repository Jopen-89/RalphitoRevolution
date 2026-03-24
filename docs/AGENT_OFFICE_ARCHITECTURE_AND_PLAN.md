# RalphitoRevolution: Arquitectura de Oficina Virtual Multi-Agente

Este documento resume la investigación arquitectónica y el plan de acción para transformar el sistema de agentes en una infraestructura interactiva, coherente y multi-rol.

## 1. Mapa Mental del Sistema

### Componentes Core
*   **Engine (`agentLoop.ts`)**: El "Cuerpo" o motor genérico. Ejecuta un bucle infinito de razonamiento (IA), gestiona el historial de mensajes y ejecuta herramientas. No tiene identidad propia.
*   **CLI (`cli.ts`)**: El "Mecanismo de Disparo". Prepara el entorno físico (Git Worktrees), la base de datos y lanza el proceso persistente del agente en **TMUX**.
*   **LLM-Gateway**: El "Traductor y las Manos". Interfaz unificada para diferentes modelos (Gemini, OpenAI, etc.) y encargado de ejecutar las **Tools** (leer/escribir archivos, ejecutar bash).
*   **Agent-Orchestrator (Raymon)**: El "Mánager". Un agente VIP que corre sobre un `agentLoop` pero tiene herramientas especiales (`spawn_executor`) para crear y supervisar a otros agentes basándose en el mapa de configuración.

### Identidad y Reglas
*   **Roles (`agents/roles/*.md`)**: El "Cerebro/Alma". Define la personalidad, especialidad y reglas específicas de cada agente (Moncho, Lola, Mapito, etc.).
*   **Reglas Técnicas**:
    *   **Engine Guardrails**: Instrucciones de supervivencia (sandbox, no interactividad, uso de tools).
    *   **Project Standards (`AGENTS.md`, `.agent-rules.md`)**: Normas del repositorio (Git, `bd sync`, protocolo anti-autoengaño).

---

## 2. El Problema: El "Teatro" vs. La Realidad

### El "Teatro" (Simulación en Telegram)
Agentes como Moncho (PM) o Poncho (Arquitecto) suelen actuar como "fantasmas" dentro del bot de Telegram. Simulan diálogos y generan texto en el chat, pero **no activan un `agentLoop` real**, por lo que no pueden escribir archivos PRD o de arquitectura en el disco duro.

### La Crisis de Identidad (Hardcodeo)
Actualmente, el `agentLoop.ts` tiene un mensaje hardcodeado (`RALPHITO_SYSTEM_PROMPT`) que obliga a todos los agentes a identificarse como "Ralphito". Esto causa:
1.  **Confusión de Roles**: Lola o Moncho se presentan como programadores genéricos.
2.  **Gasto de Contexto**: Se envían instrucciones contradictorias al modelo.
3.  **Falta de Especialización**: Los agentes ignoran sus Markdowns específicos en favor del prompt hardcodeado.

---

## 3. Plan de Acción: Hacia la Oficina Virtual

El objetivo es que **todos los agentes tengan un `agentLoop` real**, puedan **conversar fluidamente** y tengan **capacidad operativa** (Tools) para dejar archivos en el proyecto.

### FASE 1: Cirugía de Identidad (Refactor Core)
*   **Refactor de `promptBuilder.ts`**: Crear un "Chef de Prompts" que ensamble las reglas técnicas, las reglas del proyecto y la identidad del Markdown en un `System Prompt` único y potente.
*   **Limpieza de `agentLoop.ts`**: Eliminar identidades hardcodeadas. El motor será una "vasija vacía" que acepta cualquier rol inyectado desde el CLI.

### FASE 2: Habilitar los Equipos Reales
*   **Mapa de Orquestación**: Actualizar `ops/agent-orchestrator.yaml` para incluir todos los equipos (PM, Research, Architecture, etc.) vinculándolos a sus Markdowns de `agents/roles/`.
*   **Mapeo de Herramientas**: Configurar el `toolCatalog.ts` para que cada agente tenga acceso a las tools que necesita (ej. Moncho -> Document Tools).

### FASE 3: El Puente Conversacional (Interactive Loop)
*   **Tool `ask_human`**: Crear una herramienta que permita al agente pausar su loop y enviar una pregunta a Telegram.
*   **Handoff de Raymon**: Empoderar a Raymon para que "escuche" notificaciones de finalización de otros agentes y lance automáticamente la siguiente fase (ej. Moncho termina PRD -> Raymon lanza a Lola).
*   **Interacción Directa**: Permitir que las respuestas de Telegram se inyecten como nuevos mensajes `user` en un `agentLoop` persistente en TMUX.

---

## 4. Flujo de Trabajo Objetivo (Ejemplo)

1.  **Usuario** pide una idea en Telegram.
2.  **Raymon** lanza a **Moncho** (`spawn_executor`).
3.  **Moncho** (en su `agentLoop`) escribe el PRD real en `docs/specs/` y pide feedback vía `ask_human`.
4.  **Usuario** da el visto bueno en Telegram.
5.  **Moncho** finaliza la tarea.
6.  **Raymon** detecta el cierre y lanza a **Lola** para programar basándose en el archivo PRD creado por Moncho.
