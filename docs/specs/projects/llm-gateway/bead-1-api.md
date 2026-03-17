# Bead: Implementar Express API Gateway
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: ["src/features/llm-gateway/interfaces/**/*.ts"]
[WRITE_ONLY_GLOBS]: ["src/features/llm-gateway/api/**/*.ts", "package.json"]
[BANNED_GLOBS]: ["src/features/llm-gateway/providers/**"]

## 2. Contexto Mínimo
Construye un servidor express muy simple en `src/features/llm-gateway/api/server.ts` que escuche en el puerto 3000. Debe tener un endpoint POST `/v1/chat` que acepte `ChatRequest` y devuelva `ChatResponse`.

## 3. Criterios de Aceptación (Acceptance Criteria)
1. Instalar `express` y sus tipos si no están en package.json.
2. El endpoint debe validar que `provider` venga en el body.
3. El endpoint debe usar `MockProviderFactory.getProvider(provider)` (IGNORAR las implementaciones reales) y llamar a `generateResponse(prompt)`.
4. Devolver la respuesta en JSON.

## 4. Instrucciones Especiales
- Tu trabajo es SOLO la capa HTTP. No te preocupes de cómo se llama a Gemini o Codex. Usa los mocks en `src/features/llm-gateway/interfaces/provider.mock.ts`.
