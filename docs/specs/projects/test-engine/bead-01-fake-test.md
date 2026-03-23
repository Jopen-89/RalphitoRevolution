# Bead: Fake Test Bead for Engine
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: []
[WRITE_ONLY_GLOBS]: ["output/engine-test.txt"]
[BANNED_GLOBS]: ["src/**"]

## 2. Contexto Mínimo
Bead de prueba falsa solicitada para validar el ciclo de ejecución del motor (Ralphito Engine) sin alterar el código fuente del proyecto.

## 3. Criterios de Aceptación
1. El archivo `output/engine-test.txt` debe ser creado exitosamente.
2. El archivo debe contener el texto "engine test ok".

## 4. Instrucciones Especiales
- Asegúrate de crear el directorio `output/` si no existe antes de escribir el archivo.