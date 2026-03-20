# Unified PRD: telegram-live-final

**Status**: Draft | **Date**: 2025-01-14

---

## 1. Problema y tesis AI-native

### El problema
Los bots de Telegram actuales generan texto plausible pero no ejecutan acciones verificables. El usuario no tiene forma de confirmar que algo realmente ocurrió en el sistema.

### Tesis
Un flujo autónomo válido requiere: recibir intención → ejecutar herramienta real → persistir evidencia → responder con resultado verificable. Sin esos tres pasos, no hay autonomía real.

---

## 2. Usuario, contexto y valor

**Usuario**: Operador del sistema que necesita una demo operativa, no una simulación.

**Contexto**: Un mensaje en Telegram triggering una acción que modifica estado en disco y responde con evidencia.

**Valor**:
| Antes | Después |
|-------|---------|
| Respuesta genérica | Resultado real con evidencia |
| Sin trazabilidad | Log de acciones ejecutadas |
| Demo no repetible | Prueba funcional verificable |

---

## 3. Principios de experiencia y comportamiento

1. **Ciclo completo sin intervención manual**: recibir → ejecutar → persistir → responder ocurre de forma automática.
2. **Respuesta con trazabilidad**: el bot devuelve resultado + referencia a evidencia en disco.
3. **Fallo con evidencia**: si algo falla, se registra y se reporta, no se finge éxito.

---

## 4. Resolucion de tensiones

- **Texto vs acción**: la respuesta prioriza el resultado verificable, no el texto explicativo.
- **Seguridad vs autonomía**: las herramientas usan variables de entorno, nunca credenciales en código.
- **Velocidad vs confiabilidad**: la validación de evidencia es bloqueante antes de responder.

---

## 5. Limites eticos y seguridad

- No se exponen credenciales en scripts ni logs.
- Las acciones están scoped al contexto del proyecto, sin acceso a recursos externos no autorizados.
- Se captura evidencia de cada acción para auditoría.

---

## 6. Arquitectura funcional de alto nivel

1. **Gateway de herramientas** (bead-1): metadata y contrato de tools disponibles.
2. **Persistencia de sesión** (bead-2): estado durable y logs de evidencia.
3. **Coordinador autónomo** (bead-3): interpreta intención y orquesta ejecución.
4. **Loop del bot** (bead-4): integra gateway, sesión y respuesta verificable.
5. **Tests del flujo** (bead-5): validación end-to-end del ciclo completo.

---

## 7. Criterios de exito y alcance

### Criterio de éxito
Un mensaje en Telegram dispara una acción que modifica estado en disco. El bot responde con el resultado y una referencia a la evidencia generada. El ciclo es reproducible.

### Alcance MVP
- Una sola acción verificable (ej: escribir archivo con timestamp).
- Evidencia capturada en `docs/automation/evidence/`.
- Log en `docs/automation/logs/`.
- Sin UI adicional, solo Telegram como interfaz.

### Fuera de alcance
- Múltiples herramientas simultáneas.
- UI de monitoreo separate.
- Autenticación avanzada más allá de tokens de entorno.

---

*PRD listo para derivación a Poncho (arquitectura) y beads de implementación.*
