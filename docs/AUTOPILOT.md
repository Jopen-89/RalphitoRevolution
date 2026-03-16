# Autopilot Architecture & Roadmap

## Contexto y Visión
Este proyecto extiende la funcionalidad base de **Agent Orchestrator (AO)** para crear un sistema autónomo de dos capas diseñado para optimizar el consumo de tokens, asegurar la calidad del código mediante guardrails locales y coordinar múltiples agentes.

- **Autopilot v1 (La Base Estricta):** Un sistema determinista que fuerza a los agentes ejecutores a seguir un flujo de trabajo innegociable ("Landing the Plane") utilizando una herramienta simulada llamada `bd`. Al interceptar el comando `bd sync`, el sistema inyecta guardrails locales (pruebas, linters basados en `git diff`) *antes* de permitir el push.
- **Autopilot v2 (El Orquestador IA):** Un sistema superior donde un "Agente Maestro" (ej. Gemini 3.1 Pro) gestiona agentes efímeros (Codex, Opencode). Los ejecutores mueren tras programar para liberar recursos y resucitan usando caché de contexto (`/resume -last`) si los guardrails locales detectan errores.

---

## Componentes Actuales

### 1. El Wrapper `bd` (`scripts/bd.sh`)
La clave de la arquitectura actual. Es un binario falso instalado en el PATH del sistema que intercepta los comandos de gestión de tareas del agente.
- Traduce comandos abstractos (`bd ready`, `bd close`) a GitHub CLI (`gh`).
- **Punto de Inyección:** El comando `bd sync` es el hook donde implementaremos la Fase 2 (los Guardrails).

### 2. Reglas Estrictas (`.agent-rules.md`)
Reglas inyectadas nativamente a cada agente instanciado por AO mediante la propiedad `agentRulesFile` en `agent-orchestrator.yaml`. Fuerzan al agente a usar `bd` y prohíben dar por finalizado un trabajo sin un push exitoso.

---

## Roadmap de Implementación (Fases)

### ✅ Fase 1: Asentar las Bases (Configuración Estricta)
**Estado: COMPLETADO**
- Se creó `.agent-rules.md` con el flujo de "Landing the Plane".
- Se configuró `agent-orchestrator.yaml` para usar `agent: opencode` (preparado para Gemini/Codex) y enlazar las reglas.
- Se desarrolló e instaló el script `bd` (`scripts/bd.sh`) localmente.

### 🚧 Fase 2: Autopilot v1 (Guardrails Locales y Pipeline CLI)
**Estado: PENDIENTE**
**Objetivo:** Interceptar el flujo antes del PR para correr validaciones locales según el lenguaje.
1. Modificar la sección `bd sync` del script `bd.sh`.
2. Implementar lógica para hacer `git diff --name-only origin/master...HEAD`.
3. Analizar extensiones de archivos modificados (ej. `.ts` -> `npm test`, `.rs` -> `cargo test`).
4. Si hay fallos, abortar el push y escupir el error en la terminal para que el agente ejecutor lo arregle en su próximo ciclo de iteración.

### ⏳ Fase 3: Autopilot v2 Parte A (Ciclo de Vida Efímero)
**Estado: PENDIENTE**
**Objetivo:** Matar al agente ejecutor (Opencode/Codex/Gemini CLI) tras la codificación para ahorrar recursos.
- Modificar la integración del agente en AO para que el proceso termine (`exit 0`) y no se quede en espera (idle) dentro de `tmux` gastando tokens de contexto a lo tonto.

### ⏳ Fase 4: Autopilot v2 Parte B (Snapshot y Resurrección - `/resume -last`)
**Estado: PENDIENTE**
**Objetivo:** Optimizar tokens recargando solo el contexto necesario.
- Entender y extraer cómo el agente ejecutor subyacente (ej. Gemini CLI u Opencode) guarda su historial de sesión.
- Crear un comando (ej. `ao resume <sesion> --inject-error <log_file>`).
- Enviar el estado previo cacheado (Prompt Caching) junto con el log del guardrail fallido de la Fase 2 para que lo corrija de forma eficiente.

### ⏳ Fase 5: Autopilot v2 Parte C (El Agente Orquestador Maestro)
**Estado: PENDIENTE**
**Objetivo:** Eliminar la interacción humana en el inicio del proceso.
- Un LLM Maestro (ej. Gemini 3.1 Pro Preview) lee el objetivo del usuario.
- Decide qué ejecutores spamear (`ao spawn frontend ...`, `ao spawn backend ...`).
- Monitoriza asíncronamente el estado de los worktrees y da por finalizado el proyecto.
