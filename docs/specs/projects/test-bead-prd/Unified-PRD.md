# Unified PRD: Test Bead - Contador +1

**Status**: Draft | **Date**: 2025-01-24

---

## 1. El Problema y la Tesis AI-Native

**Qué resolvemos**: Validar que el pipeline completo Bead funciona (agente → documento → código).

**Por qué IA es necesaria**: Este PRD es generado por Moncho (agente PM). Sin IA no existiría este flujo automático de idea → especificación → implementación.

---

## 2. Arquetipos y Relación con el Usuario

- **Rol del sistema**: Bead de prueba (output de validación para Poncho)
- **Usuario**: El Cartel de Desarrollo validando su propio workflow

---

## 3. Principios de Diseño y Comportamiento

- UI mínima: un botón "+1" y un número
- Sin estado persistente (el contador se resetea en cada refresh)
- Sin backend, todo client-side
- Fallback visual claro si algo falla

---

## 4. Resolución de Tensiones

No aplica. Es un bead de prueba, no hay conflictos.

---

## 5. Límites Éticos y Seguridad

- No almacena datos del usuario
- No hace llamadas a APIs externas
- Scope stricto: solo el archivo del bead

---

## 6. Arquitectura Funcional

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Moncho PRD │ ──▶ │ Poncho Bead  │ ──▶ │  Código TS  │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Componentes del bead**:
- `src/app/test-counter.ts` - Entry point simple
- Un botón que incrementa un counter en memoria
- Render en `/` route

---

## 7. Criterios de Aceptación

1. El bead compila sin errores
2. El botón +1 incrementa el número en pantalla
3. El contador no persiste entre refreshes
4. El bead es ejecutable con `npx tsx src/app/test-counter.ts`
