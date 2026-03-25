# Bead: Telegram EvidenceLogger real
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/interfaces/telegram/telegramStateRepository.ts"]
[WRITE_ONLY_GLOBS]: ["src/interfaces/telegram/persistence/**/*.ts"]
[BANNED_GLOBS]: ["src/interfaces/telegram/bot.ts", "src/gateway/**"]

## 2. Contexto Minimo
Bead real para validar `engine -> tmux -> opencode` con trabajo de producto acotado y verificable. El objetivo es implementar un `EvidenceLogger` real dentro de `src/interfaces/telegram/persistence/` para escribir logs estructurados en `docs/automation/logs/`, sin salir del scope permitido.

## 3. Criterios de Aceptacion
1. Debe existir una implementacion real de `EvidenceLogger` en `src/interfaces/telegram/persistence/`.
2. La implementacion debe escribir logs estructurados en `docs/automation/logs/`.
3. Cada log debe incluir `chatId`, `timestamp`, `action` y `status`.
4. La implementacion debe crear la carpeta de destino si no existe.
5. Las operaciones de escritura deben usar `async/await`.
6. No se puede tocar codigo fuera de `src/interfaces/telegram/persistence/**/*.ts`.

## 4. Instrucciones Especiales
- Usa `src/interfaces/telegram/telegramStateRepository.ts` solo como referencia de lectura.
- No introducir stubs, mocks ni fallbacks legacy.
- No tocar `src/interfaces/telegram/bot.ts`.
- No tocar nada en `src/gateway/**`.
