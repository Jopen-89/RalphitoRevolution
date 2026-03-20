# Telegram live cleanup validation

Fecha: 2026-03-20
Branch: `jopen/be-33-bead-2`

## Cambios validados

- `scripts/lib/ao-paths.sh` ahora encuentra worktrees en `~/.worktrees/<project>/<session>` y en el layout legacy.
- `scripts/tools/tool_spawn_executor.sh` acepta `--payload-file`, calcula hash/version del bead y persiste `.ralphito-session.json` cuando aparece el worktree.
- `src/features/ao/aoSessionAdapter.ts` sube timeout a `15000ms` y cae a tmux si fallan dashboard + `ao status`.
- `src/features/dashboard/dashboardService.ts` acepta `tmux_fallback`.
- Se añadieron las specs canonicas `docs/specs/projects/telegram-live-final/bead-1.md` y `docs/specs/projects/telegram-live-final/bead-2.md`.

## Evidencia real

1. Guardrails locales:

```bash
$ npm ci
added 222 packages, and audited 223 packages in 6s
found 0 vulnerabilities

$ npx tsc --noEmit
# sin errores

$ bash -n scripts/tools/tool_spawn_executor.sh && bash -n scripts/lib/ao-paths.sh && bash -n scripts/tools/tool_check_status.sh && bash -n scripts/resume.sh
# sin errores
```

2. Lookup real del layout gestionado por worktrees:

```bash
$ bash -lc 'source scripts/lib/ao-paths.sh && find_ao_worktree be-51 || true'
/home/pepu/.worktrees/backend-team/be-51
```

3. Fallback real de estado via tmux:

```bash
$ npx tsx scripts/ao-status.ts table
  42107c4c1c4e-be-33  (tmux fallback)  -  [idle]  Fallback desde tmux; revisar dashboard/AO si falta metadata.
  4aabf994d2c7-be-51  (tmux fallback)  -  [idle]  Fallback desde tmux; revisar dashboard/AO si falta metadata.
```

4. Spawn real con payload estructurado:

```bash
$ ./scripts/tools/tool_spawn_executor.sh --payload-file <tmp-payload>
{"status":"success","session_id":"be-33","message":"Ralphito iniciado correctamente y prompt enviado. Usa tool_check_status para ver su progreso.","model":"minimax-m2.7","bead_spec_hash":"b16224d6e8463775805f26abcd4e29610ca5d82514d5cf5854549f484418e8a9","bead_spec_version":"b16224d6e846"}
```

5. Lookup real del worktree creado por spawn:

```bash
$ bash -lc 'source scripts/lib/ao-paths.sh && find_ao_worktree be-33 || true'
/home/pepu/.worktrees/backend-team/be-33
```

6. Metadata real persistida por el spawn:

```json
{
  "sessionId": "be-33",
  "project": "backend-team",
  "model": "minimax-m2.7",
  "prompt": "Validacion bead-2. No hagas cambios. Solo confirma que la sesion arranco y termina.",
  "beadPath": "docs/specs/projects/telegram-live-final/bead-2.md",
  "workItemKey": "bead-2-validation",
  "beadSpecHash": "b16224d6e8463775805f26abcd4e29610ca5d82514d5cf5854549f484418e8a9",
  "beadSpecVersion": "b16224d6e846",
  "qaConfig": {
    "enableVisualQa": false,
    "enableE2eQa": false
  },
  "updatedAt": "2026-03-20T00:33:58.663582+00:00"
}
```

7. Estado completo sin falso negativo de fabrica parada:

```bash
$ ./scripts/tools/tool_check_status.sh
=== STATUS DE SESIONES (AGENT ORCHESTRATOR) ===
  be-33  (25s ago)  session/be-33  [spawning]  -

=== BUSCANDO RALPHITOS CAIDOS (GUARDRAILS FALLIDOS) ===
✅ No se detectaron errores de guardrails locales. Todos los Ralphitos vivos están sanos.

=== AUTOPILOT QUEUE CHECK ===
⚙️ Hay Ralphitos trabajando. Espera a que terminen o mueran.
```

## Nota operativa

- Durante la validacion, AO recreo el worktree `session/be-33`; por eso el trabajo final se consolido en la rama manual `jopen/be-33-bead-2`, que no se autodestruye al lanzar nuevas sesiones.
