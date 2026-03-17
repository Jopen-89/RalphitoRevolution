# Architecture: LLM Gateway

El objetivo es construir un multiplexor de APIs para LLMs utilizando Node.js (TypeScript) y Express o similar, estructurado mediante "Vertical Slicing" en la carpeta `src/features/llm-gateway/`.

Para garantizar el paralelismo de los ejecutores, se ha definido una interfaz central `ILLMProvider` y un Mock.
- El equipo de API (Bead 1) implementará los endpoints usando el `MockProviderFactory`.
- El equipo de Proveedores (Bead 2) implementará las clases reales que conectan con Gemini, Codex, etc., cumpliendo la interfaz `ILLMProvider`.

Esto garantiza cero colisiones.
