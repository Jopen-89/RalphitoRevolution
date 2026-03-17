# Feature: LLM Gateway Multiplexer
**Tag**: PROYECTO

## 1. Visión y Valor
Un API Gateway centralizado que unifica el acceso a diferentes proveedores de LLM (Gemini, Codex, Opencode) bajo una única interfaz. Esto permite a nuestras aplicaciones cliente cambiar de modelo o proveedor sin modificar su código interno, gestionando las claves de suscripción de forma segura en un solo lugar.

## 2. User Stories
Como desarrollador de integraciones, quiero llamar a un endpoint único `/v1/chat`, para poder obtener respuestas de cualquier LLM configurando solo un parámetro de proveedor.
Como administrador de sistemas, quiero que las API keys de Gemini, Codex y Opencode estén guardadas en el entorno del gateway y no expuestas a las aplicaciones cliente, para poder mantener la seguridad.

## 3. Criterios de Aceptación Core
- Regla 1: El endpoint POST `/v1/chat` debe aceptar un JSON con `provider` (gemini|codex|opencode) y `prompt`.
- Regla 2: El gateway debe rutear la petición al SDK/API correspondiente basado en el `provider`.
- Regla 3: Si falta la API Key en el entorno para el proveedor solicitado, debe devolver 500 con mensaje claro.

## 4. Casos Límite a Contemplar
- ¿Qué pasa si el proveedor devuelve un timeout o error 429 (Too Many Requests)?
- ¿Qué pasa si se solicita un proveedor no soportado?
