# Telegram live cleanup validation

Fecha: 2026-03-20
Branch: `feat/issue-12-live-cleanup-validation`

## Cambios validados

- `scripts/lib/ao-paths.sh` ahora encuentra worktrees en `~/.worktrees/<project>/<session>` y en el layout legacy.
- `scripts/tools/tool_spawn_executor.sh` acepta payload estructurado y persiste metadata de sesion en el worktree cuando aparece.
- `src/features/ao/aoSessionAdapter.ts` eleva el timeout y cae a tmux si fallan dashboard y `ao status`.
- `src/features/dashboard/dashboardService.ts` acepta `tmux_fallback` como fuente valida.

## Evidencia real

1. Spawn real con payload estructurado y metadata persistida:

```bash
$ ./scripts/tools/tool_spawn_executor.sh --payload-file <tmp-payload>
{"status":"success","session_id":"be-33","message":"Ralphito iniciado correctamente y prompt enviado. Usa tool_check_status para ver su progreso.","model":"minimax-m2.7","bead_spec_hash":"b16224d6e8463775805f26abcd4e29610ca5d82514d5cf5854549f484418e8a9","bead_spec_version":"b16224d6e846"}
```

2. Metadata real persistida en el worktree creado:

```json
{
  "sessionId": "be-33",
  "project": "backend-team",
  "model": "minimax-m2.7",
  "prompt": "Implementa docs/specs/projects/telegram-live-final/bead-2.md y deja evidencia real del resultado.",
  "beadPath": "docs/specs/projects/telegram-live-final/bead-2.md",
  "workItemKey": "bead-2-validation",
  "beadSpecHash": "b16224d6e8463775805f26abcd4e29610ca5d82514d5cf5854549f484418e8a9",
  "beadSpecVersion": "b16224d6e846",
  "qaConfig": {
    "enableVisualQa": false,
    "enableE2eQa": false
  },
  "updatedAt": "2026-03-20T00:18:34.165389+00:00"
}
```

3. Worktree lookup del layout gestionado:

```bash
$ bash -lc 'source "scripts/lib/ao-paths.sh" && find_ao_worktree be-50'
/home/pepu/.worktrees/backend-team/be-50
```

4. Lookup del session creado por spawn:

```bash
$ bash -lc 'source "scripts/lib/ao-paths.sh" && find_ao_worktree be-33'
/home/pepu/.worktrees/backend-team/be-33
```

5. Fallback operativo de estado:

```bash
$ npx tsx scripts/ao-status.ts table
  4aabf994d2c7-be-50  (tmux fallback)  -  [idle]  Fallback desde tmux; revisar dashboard/AO si falta metadata.
```

6. Tool de estado completo sin falsos negativos de fabrica parada:

```bash
$ ./scripts/tools/tool_check_status.sh
=== STATUS DE SESIONES (AGENT ORCHESTRATOR) ===
  4aabf994d2c7-be-50  (tmux fallback)  -  [idle]  Fallback desde tmux; revisar dashboard/AO si falta metadata.

=== BUSCANDO RALPHITOS CAIDOS (GUARDRAILS FALLIDOS) ===
✅ No se detectaron errores de guardrails locales. Todos los Ralphitos vivos estan sanos.

=== AUTOPILOT QUEUE CHECK ===
⚙️ Hay Ralphitos trabajando. Espera a que terminen o mueran.
```

7. Guardrails locales:

```bash
$ npm ci
added 222 packages, and audited 223 packages in 7s
found 0 vulnerabilities

$ npx tsc --noEmit
# sin errores

$ bash -n scripts/tools/tool_spawn_executor.sh && bash -n scripts/lib/ao-paths.sh && bash -n scripts/tools/tool_check_status.sh && bash -n scripts/resume.sh
# sin errores
```
