# Bead 01: Validación E2E del Fix - Raymon

## Metadata
- **bead-id**: test-opencode-spawn-fix
- **team**: qa-team
- **assignee**: Raymon
- **created**: 2026-03-22

## Objective
Validar que la eliminación del `sendLiteral` duplicado en `sessionSupervisor.ts:247` funciona correctamente.

## Root Cause
- Primer envío: `buildLaunchCommand()` → `opencode run 'prompt' -m model` ✅
- Segundo envío (BUG): `sendLiteral()` sin quotes → rompe TMUX ❌

## Tasks
1. Checkout a `bead/opencode-spawn-validacion`
2. Ejecutar `bd merge` para invocar Ricky (E2E) y Judge (CR)
3. Verificar que el merge a master es exitoso
4. Confirmar que TMUX recibe el prompt correctamente

## Success Criteria
- Ricky pasa validación E2E
- Judge aprueba CR técnico
- Código fusionado a master

## Rama con Fix
- **Branch**: `bead/opencode-spawn-validacion`
- **PR**: https://github.com/Jopen-89/RalphitoRevolution/pull/66

## Fix Aplicado
```diff
- await this.tmuxRuntime.sendLiteral(runtimeSessionId, prompt);
```
(Línea eliminada: sessionSupervisor.ts:247)