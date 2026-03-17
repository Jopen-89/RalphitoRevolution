# Bead: Implementar Clases de Proveedores Reales (Gemini, Codex, Opencode)
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/llm-gateway/interfaces/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/llm-gateway/providers/**/*.ts"]
[BANNED_GLOBS]: ["src/features/llm-gateway/api/**"]

## 2. Contexto Mínimo
Construye las clases reales que conectan con los LLMs. Crea `src/features/llm-gateway/providers/gemini.provider.ts`, `codex.provider.ts` y `opencode.provider.ts`. También crea `provider.factory.ts` que devuelve la instancia correcta.

## 3. Criterios de Aceptación (Acceptance Criteria)
1. Las 3 clases deben implementar la interfaz `ILLMProvider` definida en `src/features/llm-gateway/interfaces/gateway.types.ts`.
2. Las implementaciones reales pueden ser *stubs* por ahora (solo devolver un string con `Promise.resolve("Respuesta real de API: " + prompt)`), pero la estructura de clases debe estar lista.
3. El `ProviderFactory.getProvider(name: Provider)` debe devolver la clase concreta según el string ('gemini', 'codex', etc.). Lanzar error si no existe.

## 4. Instrucciones Especiales
- Tienes totalmente PROHIBIDO tocar la carpeta `api/` o meterte con `express`. Tú solo construyes las piezas de lógica interna que el API usará en el futuro.
