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

- existe una feature inicial en `src/features/llm-gateway/`
- el flujo Autopilot esta descrito en `docs/AUTOPILOT.md`
- las reglas duras del agente viven en `.agent-rules.md`
- el repo todavia esta en proceso de reorganizacion estructural

## Principios del repo

- separar producto, operacion e infraestructura
- priorizar slices funcionales frente a carpetas por herramienta
- reducir lecturas innecesarias para agentes y humanos
- dejar un template repetible para proyectos futuros
