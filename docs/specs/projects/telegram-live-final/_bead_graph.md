# Bead Dependency Graph

## nodes:
- bead-1: Gateway tools y contrato de evidencia
- bead-2: Persistencia de sesión y logs
- bead-3: Coordinador autónomo
- bead-4: Integración del loop del bot
- bead-5: Tests E2E del flujo completo

## edges:
- bead-1 -> bead-3
- bead-2 -> bead-3
- bead-3 -> bead-4
- bead-4 -> bead-5