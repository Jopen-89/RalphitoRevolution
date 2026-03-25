# Lecciones Arquitectónicas: Ralphito Engine y Function Calling

Este documento es una recopilación de apuntes técnicos sobre la evolución del sistema de agentes (Issue 56 y 57), pasando de un modelo "legacy" de orquestación a una verdadera Fábrica de Software Autónoma.

## 1. El Concepto de "Function Calling"

El Function Calling es el salto evolutivo de los LLMs: pasar de ser "Chatbots que escupen texto" a "Agentes con manos que ejecutan acciones".

### 1.1 El Modelo Antiguo (Intercepción de Texto)
- **Cómo funcionaba:** La IA escribía comandos en formato texto en el chat (ej: `Voy a ejecutar ./scripts/bd.sh`).
- **El Traductor:** Un script de Node.js (`orchestrationExecutor.ts`) leía el chat usando Expresiones Regulares (Regex) para adivinar si la IA quería ejecutar un comando.
- **El Problema:** Era frágil (un error tipográfico rompía todo) y ensuciaba el chat con logs técnicos.

### 1.2 El Nuevo Modelo (Function Calling)
- **Cómo funciona:** El LLM Gateway le envía a la IA una "Carta de Menú" (un JSON con las Tools disponibles y sus descripciones).
- **El Emparejamiento:** La IA lee tu petición, lee las descripciones de las Tools, y **elige** la que necesita.
- **La Petición Invisible:** La IA responde con un JSON invisible pidiendo usar la Tool y pasando los parámetros extraídos.
- **La Ejecución:** El Motor de Node.js recibe la petición, ejecuta el código real de la Tool (ej: leer un archivo), y le devuelve el resultado a la IA.

## 2. Inyección Dinámica de Tools (El Control de Acceso)

No todos los agentes tienen los mismos "superpoderes". El Gateway inyecta las Tools basándose en el **Rol del Agente**.

- **El "Obrero" (Ralphito / Peón):** Se le inyecta `executeBashCommand`, `writeFile`, `readFile`. Su trabajo es programar, así que necesita acceso al sistema (enjaulado en su Worktree).
- **Los "Sabios" (Moncho, Poncho, Martapepis):** Se les inyectan Tools seguras como `webSearch` o `writeFile` restringido a la carpeta `docs/`. Ellos diseñan, no programan.
- **El "Gerente" (Raymon):** Se le inyectarán Tools de orquestación (`spawnAgent`, `checkStatus`) para gestionar a los peones sin tocar código.

> **Regla de Oro del Prompt Engineering:** La `description` de una Tool en el código TypeScript es vital. Es el "manual de instrucciones" que la IA lee para saber cuándo elegir esa herramienta.

## 3. Anatomía del Motor (Ralphito Engine)

El Engine (`src/features/engine/`) es la maquinaria física que sustenta a la IA.

1. **CLI Interna (`cli.ts`):** Los "botones de control" para encender o apagar agentes (`spawn`, `kill`, `resume`).
2. **Worktree Manager (`worktreeManager.ts`):** El "Albañil". Por seguridad, aisla a cada agente (Peón o Sabio) en su propia carpeta `~/.ralphito/worktrees/` y en su propia rama de Git. Evita colisiones.
3. **Executor Loop (`executorLoop.ts`):** El "Reloj". Es un bucle `while` infinito que gestiona el Function Calling: envía prompt -> recibe petición de Tool -> ejecuta Tool -> devuelve resultado a la IA -> repite.
4. **Tool Sanitizer (`toolSanitizer.ts`):** El "Guardia de Seguridad". Antes de ejecutar un comando Bash pedido por un Peón, verifica que no sea destructivo (`rm -rf`) y que no se salga de su carpeta (`cd ..`).

## 4. El Flujo de Vida del Código (De la Idea a Producción)

El sistema funciona en dos grandes fases:

### FASE 1: Diseño (La Estrategia)
- Ocurre puramente en Telegram y en la carpeta `docs/`.
- Raymon invoca al **Consejo de Sabios** (Divergencia) para investigar.
- Los Sabios trabajan en paralelo en sus Worktrees y hacen un merge automático de sus informes en `docs/specs/meta/research/`.
- Moncho (PM) y Poncho (Arquitecto) leen los informes y escriben los `Beads` (instrucciones atómicas).

### FASE 2: Construcción (La Táctica)
- Raymon lanza un **Ralphito (Peón)**.
- El Motor "arranca la sesión": lo registra en SQLite, le crea su Worktree, le inyecta su Prompt y enciende su Bucle (Executor Loop).
- El Peón usa su Tool de Bash para programar y testear (`tsc`, `npm test`).
- Cuando termina, el Peón ejecuta `./scripts/bd.sh sync`. Este script hace el commit, se sincroniza con master y crea el Pull Request.
- Juez y Ricky (QA) revisan el PR.
- Raymon hace el `merge` final. La carpeta del Peón se borra.

## Resumen Arquitectónico
Hemos construido una **Fábrica de Software Autónoma**. El humano solo toma decisiones estratégicas en Telegram. El Orquestador (Raymon) reparte el trabajo. El Gateway traduce la IA en acciones. Y el Engine (Motor + Worktrees) proporciona el entorno físico seguro para que los agentes construyan el producto.
