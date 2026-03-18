# Architecture

La arquitectura del repo se organiza en tres zonas claras: producto, operacion de agentes e infraestructura integrada.

## 1. Producto

El codigo del producto vive en `src/`.

- `src/features/` contiene slices funcionales
- cada feature debe tender a concentrar contratos, mocks e implementacion relacionados
- `src/` no debe absorber prompts, reglas, specs ni config operativa

## 2. Operacion de agentes

La capa operativa coordina como se diseña, ejecuta, valida y reanuda el trabajo de los agentes.

- `.agent-rules.md` define el workflow duro de ejecucion y cierre
- `agents/` contiene roles y playbooks del sistema
- `ops/` concentra configuracion de orquestacion y runtime
- `scripts/` expone wrappers ejecutables para `bd`, resume y tooling auxiliar
- `scripts/bd.sh` es el comando unico de aterrizaje: valida, sincroniza y hace push

## Ownership de runtime vs memoria

- AO posee el lifecycle tecnico de sesiones y agentes
- Ralphito posee el estado operativo y la memoria propia del producto
- la capa central objetivo para Ralphito es SQLite
- no debe existir doble verdad entre AO y artefactos locales mutables

### AO es fuente de verdad de

- session ids
- status y activity de sesion
- branch y worktree
- timestamps del ciclo de vida
- PRs y metadata tecnica de sesion

### SQLite Ralphito es fuente de verdad de

- threads y mensajes
- relacion chat/agente/sesion
- tasks y beads
- eventos operativos y errores
- summaries persistentes
- indice documental y de codigo

### `traceability.json`

- deja de ser un coordinador transaccional vivo
- no debe editarse como mecanismo operativo
- si se mantiene, se genera desde SQLite como snapshot documental

## 3. Documentacion y specs

`docs/` es la fuente humana.

- `docs/AUTOPILOT.md` describe la evolucion del sistema Autopilot
- `docs/specs/` contiene ideas, specs maestras y beads paralelizables
- `docs/runbooks/` se reserva para operacion humana repetible
- `docs/lessons/` se reserva para aprendizaje acumulado

## 4. Infraestructura integrada

`vendor/agent-orchestrator/` es una base externa integrada localmente.

- no forma parte del producto principal
- su funcion es soportar el runtime y la coordinacion del sistema
- a medio plazo debe aislarse bajo una zona de vendor para evitar contaminar la raiz

## Flujo operativo resumido

1. Negocio o usuario define una idea.
2. Se documenta en `docs/specs/`.
3. Arquitectura divide el trabajo en beads con scope estricto.
4. Ralphito persiste estado y memoria propia en SQLite.
5. Los ejecutores trabajan contra mocks o contratos locales.
6. `scripts/bd.sh sync` corre guardrails antes del push.
7. Si fallan, `scripts/resume.sh` reinyecta el error en la sesion.

## Reglas operativas de `bd sync`

- el worktree debe estar limpio de cambios unstaged y archivos untracked
- los cambios que se quieran aterrizar deben estar staged o ya existir como commits locales
- si no hay nada que sincronizar, `bd sync` termina sin hacer push
- fuera de tmux, `bd sync` no mata procesos; termina limpio

## Direccion de la reorganizacion

- mantener la raiz minima
- mover prompts operativos fuera de la raiz a `agents/roles/`
- mover config de orquestacion a `ops/`
- reservar `vendor/` para dependencias integradas de gran tamano
