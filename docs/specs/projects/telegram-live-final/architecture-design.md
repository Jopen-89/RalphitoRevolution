# Architecture Design: telegram-live-final

## Objetivo V1
Implementar un flujo autónomo end-to-end en Telegram donde un mensaje dispara la ejecución de una herramienta real, la persistencia de evidencia en disco y una respuesta verificable al usuario. Cero simulación; éxito condicionado a la existencia de artefactos reales.

## Restricciones no negociables
1. **Evidencia antes de responder**: El bot no envía la respuesta de éxito a Telegram si no se ha validado la escritura en disco de la evidencia.
2. **Trazabilidad estricta**: Toda acción genera un log en `docs/automation/logs/` y evidencia en `docs/automation/evidence/`.
3. **Cero teatro funcional**: Las herramientas se ejecutan de verdad a través del gateway. Si la tool falla, el flujo reporta el fallo y la ruta del log de error.
4. **Separación de responsabilidades**: `bot.ts` se limita a I/O. La lógica de negocio vive en un coordinador autónomo.

## Arquitectura objetivo

### 1. Gateway de Herramientas (Tool Runtime)
Capa segura que expone la herramienta de escritura de evidencia (ej. escribir timestamp). Genera metadata estructurada post-ejecución.

### 2. Persistencia de Sesión y Evidencia
Capa encargada de mantener el estado de la conversación por `chatId` y proporcionar los adaptadores para escribir en `docs/automation/logs/` y `docs/automation/evidence/`.

### 3. Coordinador Autónomo
El cerebro del flujo. Recibe la intención, invoca la herramienta en el gateway, toma el resultado, ordena la persistencia de la evidencia, y finalmente construye el payload de respuesta verificable.

### 4. Telegram Ingress (Bot Loop)
El adaptador de entrada/salida. Escucha mensajes, los enruta al coordinador y publica la respuesta construida. Maneja rate limits y deduplicación básica.

### 5. Validación E2E
Suite de tests que levanta el flujo completo, inyecta un mensaje mockeado y verifica que el archivo de evidencia se crea en disco antes de dar por válido el test.