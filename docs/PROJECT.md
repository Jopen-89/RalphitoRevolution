# Project

RalphitoRevolution es un laboratorio de orquestacion autonoma sobre Agent Orchestrator orientado a coordinar agentes efimeros, reducir consumo de contexto y aplicar guardrails locales antes del push.

## Objetivo actual

- definir una base clara para el producto y para la operacion de agentes
- mantener `src/` limpio y separado de prompts, runtime y wrappers
- usar specs y beads para paralelizar trabajo sin colisiones

## Piezas principales

- `src/`: codigo del producto y prototipos funcionales
- `docs/specs/`: feature ideas, specs y beads de trabajo
- `agents/`: roles operativos y playbooks del sistema
- `ops/`: configuracion de orquestacion, prompts base y hooks
- `scripts/`: automatizacion local como `bd.sh` y `resume.sh`
- `skills/`: skills locales reutilizables

## Estado actual

- **Autopilot v2 en Producción:** Sistema estable con orquestación masiva y spawning determinista.
- **Raymon (Orquestador Maestro):** Coordina múltiples Ralphitos desde Telegram.
- **Flujo Anti-Drift:** Sincronización basada en commit hashes para evitar colisiones de ramas.
- **Cártel de QA:** Barreras automáticas (Ricky E2E, Juez CR) vía `bd merge`.
- **Memoria Persistente:** Estado operativo y conversaciones centralizados en SQLite.
- **Notificaciones Push:** Telemetría asíncrona a Telegram al finalizar tareas.
- **Dashboard Operativo:** Vista unificada AO + Ralphito en `/dashboard`.

## Direccion objetivo de estado y memoria

- AO sigue siendo el runtime y la fuente de verdad del lifecycle tecnico de sesiones
- SQLite Ralphito pasa a ser la fuente de verdad de memoria y estado operativo propio
- `traceability.json` deja de ser el coordinador vivo; si se conserva, sera un artefacto derivado
- Telegram, tasks/beads, eventos operativos y summaries deben converger en una sola capa persistente
- dashboard y tooling deben leer interfaces estructuradas, no depender de scraping de CLI o JSONs vivos

## Principios del repo

- separar producto, operacion e infraestructura
- priorizar slices funcionales frente a carpetas por herramienta
- reducir lecturas innecesarias para agentes y humanos
- dejar un template repetible para proyectos futuros
