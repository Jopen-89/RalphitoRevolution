# Project

RalphitoRevolution es un laboratorio de orquestacion autonoma sobre Ralphito Engine.

## Objetivo actual

- coordinar agentes efimeros con worktrees, locks y guardrails propios
- centralizar estado operativo y memoria en SQLite
- mantener `src/` limpio y usar specs/beads para paralelizar sin colisiones

## Piezas principales

- `src/`: producto, runtime propio, dashboard y persistencia
- `docs/specs/`: ideas, specs y beads
- `agents/`: roles y playbooks
- `ops/`: config viva del runtime y estado operativo
- `scripts/`: wrappers como `bd.sh`, `resume.sh`, QA y tooling
- `skills/`: skills locales reutilizables

## Estado actual

- **Ralphito Engine:** runtime vivo para spawn, status, resume, locks y cleanup
- **SQLite:** fuente canonica para threads, mensajes, tasks, sesiones y observabilidad
- **QA Pipeline:** Miron, Ricky y Juez via `bd sync` / `bd merge`
- **Dashboard Operativo:** vista unificada engine + SQLite en `/dashboard`
- **Notificaciones Push:** telemetria asincrona a Telegram al cerrar trabajo

## Contrato de ownership

- Ralphito Engine posee lifecycle tecnico, worktrees, locks, heartbeats y resume
- SQLite Ralphito posee memoria, joins de negocio, tasks/beads, eventos y summaries
- `traceability.json` queda solo como snapshot derivado

## Principios

- separar producto, operacion e infraestructura
- no mantener compatibilidad legacy
- priorizar contratos explicitos sobre scraping o estado duplicado
- reducir lecturas innecesarias para agentes y humanos
